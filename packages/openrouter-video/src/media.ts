import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  VideoError,
  type AudioInput,
  type OutputConfig,
  type SegmentPlan,
  type SourceInfo,
} from "./types.js";
import { retainedFrameCount } from "./planner.js";

export interface ToolPaths {
  ffmpeg?: string;
  ffprobe?: string;
  temporaryDirectory?: string;
}
interface Probe {
  format: { duration?: string; format_name: string };
  streams: {
    codec_type: string;
    sample_rate?: string;
    channels?: number;
    duration?: string;
    nb_read_frames?: string;
  }[];
}
export async function runTool(
  executable: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((done, fail) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let out = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.length > 8_000_000) {
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.on("error", fail);
    child.on("close", (code) =>
      code === 0
        ? done(out)
        : fail(
            new VideoError(
              "MEDIA",
              `Media tool failed (${code}): ${stderr.slice(-2000)}`,
            ),
          ),
    );
  });
}
export class Media {
  readonly ffmpeg: string;
  readonly ffprobe: string;
  constructor(readonly paths: ToolPaths = {}) {
    this.ffmpeg = paths.ffmpeg ?? "ffmpeg";
    this.ffprobe = paths.ffprobe ?? "ffprobe";
  }
  async preflight(signal?: AbortSignal) {
    try {
      await runTool(this.ffprobe, ["-version"], signal);
      const encoders = await runTool(
        this.ffmpeg,
        ["-hide_banner", "-encoders"],
        signal,
      );
      if (
        !encoders.includes("libx264") ||
        !encoders.includes(" pcm_s16le ") ||
        !encoders.includes(" aac ")
      ) {
        throw new Error();
      }
      const filters = await runTool(
        this.ffmpeg,
        ["-hide_banner", "-filters"],
        signal,
      );
      for (const name of [
        "atrim",
        "apad",
        "fps",
        "scale",
        "trim",
        "select",
        "concat",
      ]) {
        if (!filters.includes(` ${name} `)) {
          throw new Error();
        }
      }
    } catch {
      if (signal?.aborted) {
        signal.throwIfAborted();
      }
      throw new VideoError(
        "TOOLCHAIN",
        "FFmpeg with libx264/AAC/PCM and required filters, plus FFprobe, must be executable before paid requests",
      );
    }
  }
  async workspace<T>(work: (directory: string) => Promise<T>): Promise<T> {
    const directory = await mkdtemp(
      join(this.paths.temporaryDirectory ?? tmpdir(), "openrouter-video-"),
    );
    try {
      return await work(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
  ff(args: string[], signal?: AbortSignal) {
    return runTool(
      this.ffmpeg,
      ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args],
      signal,
    );
  }
  async probe(
    path: string,
    signal?: AbortSignal,
    countFrames = false,
  ): Promise<Probe> {
    return JSON.parse(
      await runTool(
        this.ffprobe,
        [
          "-v",
          "error",
          ...(countFrames ? ["-count_frames"] : []),
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ],
        signal,
      ),
    );
  }
  async decode(input: AudioInput, directory: string, signal?: AbortSignal) {
    let path: string;
    if ("path" in input) {
      path = resolve(input.path);
    } else {
      if (!/^[a-zA-Z0-9]{1,10}$/.test(input.format) || !input.bytes.length) {
        throw new VideoError(
          "CONFIGURATION",
          "Audio bytes need a nonempty payload and a format extension",
        );
      }
      path = join(directory, `source.${input.format}`);
      await writeFile(path, input.bytes, { signal });
    }
    const probe = await this.probe(path, signal);
    const audio = probe.streams.find((s) => s.codec_type === "audio");
    const sampleRate = Number(audio?.sample_rate),
      channels = audio?.channels ?? 0;
    if (
      !Number.isSafeInteger(sampleRate) ||
      sampleRate < 1 ||
      !Number.isInteger(channels) ||
      channels < 1
    ) {
      throw new VideoError("MEDIA", "Source has no usable audio stream");
    }
    const pcm = join(directory, "source.pcm");
    await this.ff(
      [
        "-i",
        path,
        "-map",
        "0:a:0",
        "-vn",
        "-c:a",
        "pcm_s16le",
        "-f",
        "s16le",
        pcm,
      ],
      signal,
    );
    const sampleCount = (await stat(pcm)).size / (2 * channels);
    if (!Number.isSafeInteger(sampleCount) || sampleCount < 1) {
      throw new VideoError("SEGMENTATION", "Source audio is empty");
    }
    const hash = createHash("sha256");
    for await (const bytes of createReadStream(pcm)) {
      signal?.throwIfAborted();
      hash.update(bytes);
    }
    const info: SourceInfo = {
      sampleRate,
      channels,
      sampleCount,
      duration: sampleCount / sampleRate,
      format: probe.format.format_name,
      sha256: hash.digest("hex"),
    };
    return { pcm, info };
  }
  pcmInput(pcm: string, info: SourceInfo) {
    return [
      "-f",
      "s16le",
      "-ar",
      String(info.sampleRate),
      "-ac",
      String(info.channels),
      "-i",
      pcm,
    ];
  }
  async cutAudio(
    pcm: string,
    info: SourceInfo,
    start: number,
    end: number,
    output: string,
    signal?: AbortSignal,
    paddedSeconds?: number,
    stt = false,
  ) {
    const filter =
      `atrim=start_sample=${start}:end_sample=${end},asetpts=PTS-STARTPTS` +
      (paddedSeconds ? `,apad=whole_dur=${paddedSeconds}` : "");
    await this.ff(
      [
        ...this.pcmInput(pcm, info),
        "-af",
        filter,
        ...(paddedSeconds ? ["-t", String(paddedSeconds)] : []),
        ...(stt ? ["-ar", "16000", "-ac", "1"] : []),
        "-c:a",
        "pcm_s16le",
        output,
      ],
      signal,
    );
  }
  dimensions(output: OutputConfig): [number, number] {
    if (output.size) {
      return output.size.split("x").map(Number) as [number, number];
    }
    const heights: Record<string, number> = {
      "480p": 480,
      "720p": 720,
      "768p": 768,
      "1080p": 1080,
      "1K": 1024,
      "2K": 2048,
      "4K": 4096,
    };
    const shorter = heights[output.resolution!];
    const [a, b] = output.aspectRatio!.split(":").map(Number);
    if (!shorter || !a || !b) {
      throw new VideoError(
        "CONFIGURATION",
        "Unknown output pixel configuration",
      );
    }
    return a >= b
      ? [2 * Math.round((shorter * a) / b / 2), shorter]
      : [shorter, 2 * Math.round((shorter * b) / a / 2)];
  }
  async normalize(
    input: string,
    output: string,
    ending: string,
    segment: SegmentPlan,
    info: SourceInfo,
    config: OutputConfig,
    retainAudio: boolean,
    signal?: AbortSignal,
  ) {
    const frames = retainedFrameCount(segment, info.sampleRate, config.fps);
    if (frames < 1) {
      throw new VideoError(
        "MEDIA_DURATION",
        "Segment is shorter than one scheduled output frame",
      );
    }
    const probe = await this.probe(input, signal);
    const video = probe.streams.find((s) => s.codec_type === "video");
    const duration = Number(video?.duration ?? probe.format.duration);
    if (
      !video ||
      !Number.isFinite(duration) ||
      duration + 1 / config.fps < frames / config.fps
    ) {
      throw new VideoError(
        "MEDIA_DURATION",
        "Provider clip cannot cover its retained timeline",
      );
    }
    const [width, height] = this.dimensions(config);
    const filter = `setpts=PTS-STARTPTS,fps=${config.fps},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=end_frame=${frames},setpts=N/(${config.fps}*TB)`;
    await this.ff(
      [
        "-i",
        input,
        "-map",
        "0:v:0",
        ...(retainAudio
          ? [
              "-map",
              "0:a:0?",
              "-af",
              `atrim=duration=${frames / config.fps},asetpts=PTS-STARTPTS`,
              "-c:a",
              "aac",
            ]
          : ["-an"]),
        "-vf",
        filter,
        "-r",
        String(config.fps),
        "-fps_mode",
        "cfr",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        output,
      ],
      signal,
    );
    const normalized = await this.probe(output, signal, true);
    const count = Number(
      normalized.streams.find((s) => s.codec_type === "video")?.nb_read_frames,
    );
    if (count !== frames) {
      throw new VideoError(
        "MEDIA_DURATION",
        "Decoded provider clip has too few retained frames",
      );
    }
    await this.ff(
      [
        "-i",
        output,
        "-vf",
        `select=eq(n\\,${frames - 1})`,
        "-fps_mode",
        "vfr",
        "-frames:v",
        "1",
        ending,
      ],
      signal,
    );
    return frames;
  }
  async assemble(
    clips: string[],
    pcm: string,
    info: SourceInfo,
    config: OutputConfig,
    directory: string,
    signal?: AbortSignal,
  ) {
    // All names are internal relative basenames; no caller paths enter the concat manifest.
    const manifest = join(directory, "clips.txt");
    const entries: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const probe = await this.probe(clips[i]!, signal, true);
      const frames = Number(
        probe.streams.find((s) => s.codec_type === "video")?.nb_read_frames,
      );
      if (!Number.isSafeInteger(frames) || frames < 1) {
        throw new VideoError(
          "MEDIA_DURATION",
          "Cannot schedule an empty retained clip",
        );
      }
      entries.push(`file 'segment-${i}.mp4'\nduration ${frames / config.fps}`);
    }
    // Generated audio packet rounding must not shift the next clip's video timestamps.
    await writeFile(manifest, entries.join("\n"));
    const joined = join(directory, "joined.mp4");
    await this.ff(
      [
        "-f",
        "concat",
        "-safe",
        "1",
        "-i",
        manifest,
        "-map",
        "0:v:0",
        "-an",
        "-c:v",
        "copy",
        joined,
      ],
      signal,
    );
    const final = join(directory, "final.mp4");
    await this.ff(
      [
        "-i",
        joined,
        ...this.pcmInput(pcm, info),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        final,
      ],
      signal,
    );
    const probe = await this.probe(final, signal, true);
    const video = probe.streams.find((s) => s.codec_type === "video");
    if (
      Number(video?.nb_read_frames) !==
        Math.round((info.sampleCount * config.fps) / info.sampleRate) ||
      Math.abs(Number(probe.format.duration) - info.duration) > 1 / config.fps
    ) {
      throw new VideoError(
        "MEDIA_DURATION",
        "Assembled video differs from source by more than one output frame",
      );
    }
    return final;
  }
}
