import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import type { Fetcher } from "@openrouter/sdk/lib/http.js";
import type {
  VideoGenerationRequest,
  VideoGenerationResponse,
} from "@openrouter/sdk/models";
import {
  compatibilityProfiles,
  compatibleDurations,
  normalizeModel,
  profileFor,
  revalidate,
} from "./capabilities.js";
import { dataStream, fileAsset, publicUrl } from "./assets.js";
import { Media, type ToolPaths } from "./media.js";
import { Router, httpStatus, retryable } from "./openrouter.js";
import { planSegments, retainedFrameCount } from "./planner.js";
import { transcribe } from "./transcription.js";
import {
  VideoError,
  type AssetDescriptor,
  type CompatibilityProfile,
  type FailureContext,
  type GenerationResult,
  type ModelCapabilities,
  type OperationOptions,
  type PlanInput,
  type ProgressEvent,
  type RenderOptions,
  type SegmentResult,
  type Stage,
  type VideoPlan,
} from "./types.js";

export interface ClientOptions {
  apiKey: string;
  tools?: ToolPaths;
  /** Fetch boundary for deterministic tests; requests still use the official SDK. */
  fetcher?: Fetcher;
  compatibilityProfiles?: readonly CompatibilityProfile[];
  /** Delay between successful status requests; defaults to 2 seconds. */
  pollIntervalMs?: number;
  /** Per-job polling budget, including status retries; defaults to 20 minutes. */
  pollTimeoutMs?: number;
  /** Retries per status/download burst. Status bursts continue within the polling budget. */
  retries?: number;
  retryDelayMs?: number;
}
const reserved = new Set([
  "model",
  "duration",
  "prompt",
  "frameImages",
  "frame_images",
  "inputReferences",
  "input_references",
  "generateAudio",
  "generate_audio",
  "size",
  "resolution",
  "aspectRatio",
  "aspect_ratio",
  "previousJobId",
  "previous_job_id",
  "source",
  "start",
  "end",
  "mode",
]);
function providerOptions(options: RenderOptions, model: ModelCapabilities) {
  for (const values of Object.values(options.providerOptions ?? {})) {
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      throw new VideoError(
        "CONFIGURATION",
        "Provider options must be keyed by provider SDK name",
      );
    }
    for (const key of Object.keys(values)) {
      if (reserved.has(key) || !model.passthrough.includes(key)) {
        throw new VideoError(
          "CONFIGURATION",
          `Unadvertised or reserved provider option: ${key}`,
        );
      }
    }
  }
}
async function abortable<T>(
  work: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return work;
  }
  let interrupt: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    interrupt = () => reject(signal.reason);
    signal.addEventListener("abort", interrupt, { once: true });
    if (signal.aborted) {
      interrupt();
    }
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (interrupt) {
      signal.removeEventListener("abort", interrupt);
    }
  }
}
class Run {
  readonly id = randomUUID();
  stage: Stage = "discovery";
  segmentIndex?: number;
  jobId?: string;
  jobStatus?: string;
  readonly segments: SegmentResult[] = [];
  readonly assets: AssetDescriptor[] = [];
  constructor(
    readonly options: OperationOptions,
    readonly plan?: VideoPlan,
  ) {}
  emit(stage: Stage) {
    this.stage = stage;
    const s =
      this.segmentIndex === undefined
        ? undefined
        : this.plan?.segments[this.segmentIndex];
    const event: ProgressEvent = {
      runId: this.id,
      stage,
      completedSegments: this.segments.length,
      segmentIndex: this.segmentIndex,
      segmentCount: this.plan?.segments.length,
      mode: s?.mode,
      fallbackReason: s?.fallbackReason,
      requestedDuration: s?.requestedDuration,
      jobId: this.jobId,
      jobStatus: this.jobStatus,
    };
    this.options.onProgress?.(event);
    this.options.signal?.throwIfAborted();
  }
  context(): FailureContext {
    return {
      runId: this.id,
      stage: this.stage,
      segmentIndex: this.segmentIndex,
      jobId: this.jobId,
      jobStatus: this.jobStatus,
      completedSegments: [...this.segments],
      publishedAssets: [...this.assets],
    };
  }
  fail(error: unknown): never {
    const context = this.context();
    const typed = this.options.signal?.aborted
      ? new VideoError(
          "CANCELLED",
          "Local work stopped; an accepted remote job may still run",
          context,
        )
      : error instanceof VideoError
        ? new VideoError(error.code, error.message, {
            ...context,
            ...error.context,
          })
        : new VideoError(
            this.stage === "trim" ||
            this.stage === "assembly" ||
            this.stage === "probing" ||
            this.stage === "frame"
              ? "MEDIA"
              : "CONFIGURATION",
            `Operation failed during ${this.stage}`,
            context,
          );
    try {
      this.options.onProgress?.({
        runId: this.id,
        stage: "failure",
        completedSegments: this.segments.length,
        segmentIndex: this.segmentIndex,
        segmentCount: this.plan?.segments.length,
        jobId: this.jobId,
        jobStatus: this.jobStatus,
      });
    } catch {
      /* Preserve the original failure. */
    }
    throw typed;
  }
}
export class OpenRouterVideo {
  private readonly router: Router;
  private readonly media: Media;
  private readonly profiles: readonly CompatibilityProfile[];
  private readonly pollInterval: number;
  private readonly pollTimeout: number;
  private readonly retries: number;
  private readonly retryDelay: number;
  constructor(options: ClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new VideoError(
        "CONFIGURATION",
        "An OpenRouter API key is required",
      );
    }
    this.router = new Router(options.apiKey, options.fetcher);
    this.media = new Media(options.tools);
    this.profiles = structuredClone(
      options.compatibilityProfiles ?? compatibilityProfiles,
    );
    this.pollInterval = options.pollIntervalMs ?? 2000;
    this.pollTimeout = options.pollTimeoutMs ?? 20 * 60_000;
    this.retries = options.retries ?? 3;
    this.retryDelay = options.retryDelayMs ?? 500;
    if (
      ![this.pollInterval, this.retryDelay].every(
        (n) => Number.isFinite(n) && n >= 0,
      ) ||
      !Number.isFinite(this.pollTimeout) ||
      this.pollTimeout <= 0 ||
      !Number.isInteger(this.retries) ||
      this.retries < 0 ||
      this.retries > 10
    ) {
      throw new VideoError(
        "CONFIGURATION",
        "Invalid polling/retry configuration",
      );
    }
    for (const p of this.profiles) {
      profileFor(p.model, this.profiles);
      if (
        p.audio &&
        (!(p.audio.maxSeconds > 0) ||
          !Number.isFinite(p.audio.maxSeconds) ||
          p.audio.format !== "wav")
      ) {
        throw new VideoError(
          "CONFIGURATION",
          "Native profile requires a verified WAV input limit",
        );
      }
    }
  }
  private async catalog(signal?: AbortSignal) {
    try {
      return await this.router.models(signal);
    } catch {
      signal?.throwIfAborted();
      throw new VideoError(
        "DISCOVERY",
        "OpenRouter video model discovery failed",
      );
    }
  }
  async discover(options: OperationOptions = {}) {
    const run = new Run(options);
    try {
      run.emit("discovery");
      return (await this.catalog(options.signal)).map((raw) =>
        normalizeModel(raw, this.profiles, true),
      );
    } catch (error) {
      return run.fail(error);
    }
  }
  private async selected(id: string, signal?: AbortSignal) {
    const raw = (await this.catalog(signal)).find((m) => m.id === id);
    if (!raw) {
      throw new VideoError("UNSUPPORTED_MODEL", `Unknown video model: ${id}`);
    }
    return normalizeModel(raw, this.profiles);
  }
  async plan(input: PlanInput): Promise<VideoPlan> {
    const run = new Run(input);
    try {
      input.signal?.throwIfAborted();
      await this.media.preflight(input.signal);
      run.emit("discovery");
      const model = await this.selected(input.model, input.signal);
      const profile = profileFor(model.id, this.profiles);
      compatibleDurations(model, input.output, profile);
      this.media.dimensions(input.output);
      if (!input.sttModel?.trim()) {
        throw new VideoError("CONFIGURATION", "An STT model is required");
      }
      if (input.initialImage) {
        publicUrl(input.initialImage);
      }
      return await this.media.workspace(async (directory) => {
        run.emit("probing");
        const { pcm, info } = await this.media.decode(
          input.audio,
          directory,
          input.signal,
        );
        const transcript = await transcribe(
          this.router,
          this.media,
          pcm,
          info,
          directory,
          input.sttModel,
          input.transcription,
          input.signal,
          () => run.emit("transcription"),
        );
        run.emit("planning");
        const segments = planSegments(
          info,
          transcript.words,
          model,
          input.output,
          input.initialImage,
          profile,
        );
        // Zero-frame segments cannot retain a decoded ending image; reject before video charges.
        if (
          segments.some(
            (s) => retainedFrameCount(s, info.sampleRate, input.output.fps) < 1,
          )
        ) {
          throw new VideoError(
            "SEGMENTATION",
            "A source segment is shorter than one output frame; choose a higher output fps",
          );
        }
        const source =
          "path" in input.audio
            ? { path: resolve(input.audio.path) }
            : {
                bytes: Uint8Array.from(input.audio.bytes),
                format: input.audio.format,
              };
        return {
          version: 1,
          source,
          sourceInfo: info,
          model,
          sttModel: input.sttModel,
          output: { ...input.output },
          initialImage: input.initialImage,
          transcript: transcript.text,
          words: transcript.words,
          segments,
        };
      });
    } catch (error) {
      return run.fail(error);
    }
  }
  private async retry<T>(
    work: () => Promise<T>,
    signal?: AbortSignal,
    shouldRetry: (error: unknown) => boolean = retryable,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await work();
      } catch (error) {
        if (signal?.aborted || attempt >= this.retries || !shouldRetry(error)) {
          throw error;
        }
        await delay(this.retryDelay * 2 ** attempt, undefined, { signal });
      }
    }
  }
  private async poll(
    job: VideoGenerationResponse,
    run: Run,
    signal?: AbortSignal,
  ): Promise<VideoGenerationResponse> {
    const deadline = Date.now() + this.pollTimeout;
    const timeout = new AbortController();
    const interrupt = () => timeout.abort(signal?.reason);
    signal?.addEventListener("abort", interrupt, { once: true });
    if (signal?.aborted) {
      interrupt();
    }
    const pollingSignal = timeout.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Keep long configured budgets within Node's timer range.
    const expire = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        timeout.abort();
      } else {
        timer = setTimeout(expire, Math.min(remaining, 2_147_483_647));
      }
    };
    expire();
    let failures = 0;
    let lastError: unknown;
    // An accepted job may not yet be visible to the status endpoint. Bound 404
    // retries by this job's deadline, without retrying unrelated GETs or POSTs.
    const retryStatus = (error: unknown) =>
      httpStatus(error) === 404 || retryable(error);
    try {
      while (true) {
        run.emit("polling");
        pollingSignal.throwIfAborted();
        if (job.status === "completed") {
          return job;
        }
        if (["failed", "cancelled", "expired"].includes(job.status)) {
          const jobError = this.router.errorMessage(job.error);
          throw new VideoError(
            "JOB_TERMINAL",
            `OpenRouter job ended as ${job.status}${jobError ? `: ${jobError}` : ""}`,
            { jobError },
          );
        }
        if (!["pending", "in_progress"].includes(job.status)) {
          throw new VideoError("JOB_TERMINAL", "Unknown OpenRouter job state");
        }
        if (Date.now() >= deadline) {
          timeout.abort();
          pollingSignal.throwIfAborted();
        }
        const interval = failures
          ? Math.min(
              30_000,
              Math.max(this.pollInterval, this.retryDelay) *
                2 ** Math.min(failures - 1, 10),
            )
          : this.pollInterval;
        await delay(Math.min(interval, deadline - Date.now()), undefined, {
          signal: pollingSignal,
        });
        if (Date.now() >= deadline) {
          timeout.abort();
        }
        pollingSignal.throwIfAborted();
        try {
          job = await abortable(
            this.retry(async () => {
              try {
                return await this.router.status(run.jobId!, pollingSignal);
              } catch (error) {
                lastError = error;
                throw error;
              }
            }, pollingSignal, retryStatus),
            pollingSignal,
          );
        } catch (error) {
          pollingSignal.throwIfAborted();
          if (!retryStatus(error)) {
            throw new VideoError(
              "POLL_REQUEST",
              "Status request failed with a non-retryable error; remote job may still run",
              { providerError: this.router.errorDetails(error) },
            );
          }
          failures++;
          continue;
        }
        if (job.id !== run.jobId) {
          throw new VideoError(
            "JOB_TERMINAL",
            "Status response changed the job identity",
          );
        }
        run.jobStatus = job.status;
        failures = 0;
        lastError = undefined;
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.signal.aborted || Date.now() >= deadline) {
        throw new VideoError(
          "POLL_TIMEOUT",
          "Polling deadline exceeded; remote job may still run",
          { providerError: this.router.errorDetails(lastError) },
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", interrupt);
    }
  }
  async render(
    supplied: VideoPlan,
    options: RenderOptions,
  ): Promise<GenerationResult> {
    // Isolate the request timeline from caller mutation during awaited callbacks.
    const plan = structuredClone(supplied);
    const run = new Run(options, plan),
      signal = options.signal;
    try {
      signal?.throwIfAborted();
      await this.media.preflight(signal);
      run.emit("discovery");
      let current: ModelCapabilities;
      try {
        current = await this.selected(plan.model.id, signal);
      } catch (error) {
        if (error instanceof VideoError && error.code === "UNSUPPORTED_MODEL") {
          throw new VideoError(
            "STALE_PLAN",
            "The planned model no longer has usable capabilities",
          );
        }
        throw error;
      }
      const profile = profileFor(current.id, this.profiles);
      revalidate(plan, current, profile);
      providerOptions(options, current);
      if (options.generateAudio && !current.generateAudio) {
        throw new VideoError(
          "UNSUPPORTED_MODEL",
          "Model does not advertise generated audio",
        );
      }
      if (options.seed !== undefined && !Number.isSafeInteger(options.seed)) {
        throw new VideoError("CONFIGURATION", "Seed must be an integer");
      }
      if (!options.assets || typeof options.assets.write !== "function") {
        throw new VideoError("CONFIGURATION", "An asset store is required");
      }
      if (plan.initialImage) {
        publicUrl(plan.initialImage);
      }
      const result = await this.media.workspace(async (directory) => {
        run.emit("probing");
        const { pcm, info } = await this.media.decode(
          plan.source,
          directory,
          signal,
        );
        if (plan.version !== 1 || !isDeepStrictEqual(info, plan.sourceInfo)) {
          throw new VideoError(
            "STALE_PLAN",
            "Source media changed since planning",
          );
        }
        const expected = planSegments(
          info,
          plan.words,
          current,
          plan.output,
          plan.initialImage,
          profile,
        );
        if (!isDeepStrictEqual(expected, plan.segments)) {
          throw new VideoError(
            "STALE_PLAN",
            "Plan boundaries or generation modes are inconsistent; replan",
          );
        }
        const publish = async (
          path: string,
          filename: string,
          mimeType: string,
        ) => {
          const key = `runs/${run.id}/${filename}`;
          run.emit("publication");
          const data = fileAsset(path);
          try {
            const asset = await abortable(
              options.assets.write({ key, data, mimeType, signal }),
              signal,
            );
            publicUrl(asset.url);
            run.assets.push(asset);
            signal?.throwIfAborted();
            return asset;
          } catch (error) {
            if (error instanceof VideoError) {
              throw error;
            }
            throw new VideoError("STORAGE", "Asset publication failed", {
              assetKey: key,
            });
          } finally {
            data.destroy();
          }
        };
        const clips: string[] = [];
        for (const segment of plan.segments) {
          run.segmentIndex = segment.index;
          run.jobId = undefined;
          run.jobStatus = undefined;
          const inherited = run.segments[segment.index - 1]?.endingImage;
          let prompt: string;
          try {
            prompt =
              typeof options.prompt === "function"
                ? await abortable(
                    Promise.resolve(
                      options.prompt({
                        ...structuredClone({
                          ...segment,
                          count: plan.segments.length,
                          fullTranscript: plan.transcript,
                          previousText:
                            plan.segments[segment.index - 1]?.transcript,
                          nextText:
                            plan.segments[segment.index + 1]?.transcript,
                          previousEndingImage: inherited,
                        }),
                        signal,
                      }),
                    ),
                    signal,
                  )
                : options.prompt;
            if (typeof prompt !== "string" || !prompt.trim()) {
              throw new Error();
            }
          } catch {
            throw new VideoError(
              "PROMPT",
              "Segment prompt callback failed or returned empty text",
            );
          }
          signal?.throwIfAborted();
          const effectivePrompt =
            segment.mode === "transcript"
              ? `${prompt}\n\n<segment_transcript_context>\n${JSON.stringify(segment.transcript)}\n</segment_transcript_context>`
              : prompt;
          let conditioningAudio: AssetDescriptor | undefined;
          if (segment.mode === "audio") {
            const audio = join(directory, `audio-${segment.index}.wav`);
            await this.media.cutAudio(
              pcm,
              info,
              segment.startSample,
              segment.endSample,
              audio,
              signal,
              profile?.audio?.padToRequest
                ? segment.requestedDuration
                : undefined,
            );
            conditioningAudio = await publish(
              audio,
              `audio-${segment.index}.wav`,
              "audio/wav",
            );
          }
          const image = inherited?.url ?? plan.initialImage;
          const request: VideoGenerationRequest = {
            model: current.id,
            duration: segment.requestedDuration,
            prompt: effectivePrompt,
            size: plan.output.size,
            resolution: plan.output
              .resolution as VideoGenerationRequest["resolution"],
            aspectRatio: plan.output
              .aspectRatio as VideoGenerationRequest["aspectRatio"],
            generateAudio: options.generateAudio ?? false,
            seed: options.seed,
            provider: options.providerOptions
              ? { options: options.providerOptions }
              : undefined,
            frameImages: image
              ? [
                  {
                    type: "image_url",
                    imageUrl: { url: image },
                    frameType: "first_frame",
                  },
                ]
              : undefined,
            inputReferences: conditioningAudio
              ? [
                  {
                    type: "audio_url",
                    audioUrl: { url: conditioningAudio.url },
                  },
                ]
              : undefined,
          };
          run.emit("submission");
          let job: VideoGenerationResponse;
          try {
            job = await this.router.submit(request, signal);
          } catch (error) {
            const status = httpStatus(error);
            const providerError = this.router.errorDetails(error);
            const context: FailureContext = {
              providerError,
              submission: {
                model: current.id,
                duration: segment.requestedDuration,
                size: plan.output.size,
                resolution: plan.output.resolution,
                aspectRatio: plan.output.aspectRatio,
                frameImageUrl: image,
              },
            };
            if (status && status < 500 && status !== 408) {
              const detail =
                providerError?.providerMessage ?? providerError?.message;
              throw new VideoError(
                "SUBMISSION",
                `OpenRouter rejected the submission (HTTP ${status})${detail ? `: ${detail}` : ""}`,
                context,
              );
            }
            throw new VideoError(
              "AMBIGUOUS_SUBMISSION",
              "Submission outcome is unknown; no replacement job was submitted",
              context,
            );
          }
          run.jobId = job.id;
          run.jobStatus = job.status;
          if (!job.id) {
            throw new VideoError(
              "AMBIGUOUS_SUBMISSION",
              "Submission did not return a usable job ID",
            );
          }
          job = await this.poll(job, run, signal);
          run.emit("download");
          const downloaded = join(directory, `download-${segment.index}.mp4`);
          try {
            await this.retry(async () => {
              const stream = await this.router.download(job.id, signal);
              await pipeline(
                dataStream(stream),
                createWriteStream(downloaded),
                { signal },
              );
            }, signal);
          } catch {
            signal?.throwIfAborted();
            throw new VideoError(
              "DOWNLOAD",
              "Authenticated video download failed after bounded retries",
            );
          }
          run.emit("trim");
          const clip = join(directory, `segment-${segment.index}.mp4`),
            frame = join(directory, `frame-${segment.index}.png`);
          const frames = await this.media.normalize(
            downloaded,
            clip,
            frame,
            segment,
            info,
            plan.output,
            options.generateAudio ?? false,
            signal,
          );
          const video = await publish(
            clip,
            `segment-${segment.index}.mp4`,
            "video/mp4",
          );
          run.emit("frame");
          const endingImage = await publish(
            frame,
            `frame-${segment.index}.png`,
            "image/png",
          );
          run.segments.push({
            plan: segment,
            jobId: job.id,
            effectivePrompt,
            mode: segment.mode,
            video,
            endingImage,
            conditioningAudio,
            retainedFrames: frames,
          });
          clips.push(clip);
        }
        run.segmentIndex = undefined;
        run.jobId = undefined;
        run.jobStatus = undefined;
        run.emit("assembly");
        const final = await this.media.assemble(
          clips,
          pcm,
          info,
          plan.output,
          directory,
          signal,
        );
        const finalVideo = await publish(final, "final.mp4", "video/mp4");
        return {
          runId: run.id,
          finalVideo,
          segments: run.segments,
          model: current,
          sourceInfo: info,
          output: plan.output,
        };
      });
      run.emit("completion");
      return result;
    } catch (error) {
      return run.fail(error);
    }
  }
  async generate(input: PlanInput, options: RenderOptions) {
    const effective = {
      ...options,
      signal: options.signal ?? input.signal,
      onProgress: options.onProgress ?? input.onProgress,
    };
    return this.render(
      await this.plan({
        ...input,
        signal: effective.signal,
        onProgress: effective.onProgress,
      }),
      effective,
    );
  }
}
