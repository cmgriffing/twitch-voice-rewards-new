import { parseArgs } from "node:util";
import { readFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import {
  OpenRouterVideo,
  VideoError,
  createLocalFilesystemAdapter,
  type ClientOptions,
  type ProgressEvent,
} from "@repo/openrouter-video";
import { serveAssets } from "./server.js";
export { serveAssets } from "./server.js";

const help = `openrouter-video models|plan|generate|serve [options]
Node.js 24+, FFmpeg and FFprobe are required for plan/generate.
Credentials: OPENROUTER_API_KEY. Tool paths: FFMPEG_PATH / FFPROBE_PATH.
Planning calls paid STT but submits no video jobs. Generation also incurs video charges.

models    --json
plan      --audio FILE --model ID --stt-model ID --size WIDTHxHEIGHT
generate  (plan options) --prompt TEXT | --prompt-file FILE
          --asset-dir DIR --base-url https://public.example/assets/ [--output FILE]
serve     --asset-dir DIR [--port 8080] [--prefix /assets] [--host 127.0.0.1]

Output: --size WIDTHxHEIGHT OR --resolution 720p --aspect-ratio 16:9; --fps 24
Optional: --initial-image HTTPS_URL --generate-audio --json
STT: --window-seconds 60 --overlap-seconds 2 --max-stt-bytes 20000000 --language en
Hosting and tunnels are caller-managed. Public asset URLs must be directly downloadable
and valid through each provider job. Transcript mode does not guarantee lip-sync.
SIGINT stops local work; accepted remote jobs may continue.
`;
export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
}
export interface CliDependencies {
  createClient?: (
    options: ClientOptions,
  ) => Pick<OpenRouterVideo, "discover" | "plan" | "generate">;
  serve?: typeof serveAssets;
}
export async function runCli(
  args: string[],
  environment: NodeJS.ProcessEnv,
  io: CliIO,
  signal?: AbortSignal,
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
        "generate-audio": { type: "boolean" },
        audio: { type: "string" },
        model: { type: "string" },
        "stt-model": { type: "string" },
        prompt: { type: "string" },
        "prompt-file": { type: "string" },
        "asset-dir": { type: "string" },
        "base-url": { type: "string" },
        output: { type: "string" },
        size: { type: "string" },
        resolution: { type: "string" },
        "aspect-ratio": { type: "string" },
        fps: { type: "string" },
        "initial-image": { type: "string" },
        port: { type: "string" },
        prefix: { type: "string" },
        host: { type: "string" },
        "window-seconds": { type: "string" },
        "overlap-seconds": { type: "string" },
        "max-stt-bytes": { type: "string" },
        language: { type: "string" },
      },
    });
    const v = parsed.values,
      command = parsed.positionals[0];
    if (v.help || !command) {
      io.stdout(help);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      !["models", "plan", "generate", "serve"].includes(command)
    ) {
      throw new Error(
        "Choose models, plan, generate, or serve; use --help for options",
      );
    }
    const required = (key: keyof typeof v): string => {
      const value = v[key];
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`--${key} is required`);
      }
      return value;
    };
    const number = (key: keyof typeof v, fallback: number) => {
      const value = v[key] === undefined ? fallback : Number(v[key]);
      if (!Number.isFinite(value)) {
        throw new Error(`--${key} must be numeric`);
      }
      return value;
    };
    const print = (value: unknown) =>
      io.stdout(JSON.stringify(value, null, 2) + "\n");
    if (command === "serve") {
      const server = await (dependencies.serve ?? serveAssets)({
        directory: required("asset-dir"),
        port: number("port", 8080),
        prefix: v.prefix,
        host: v.host,
        signal,
      });
      const address = server.address();
      print({ directory: v["asset-dir"], address, prefix: v.prefix ?? "/" });
      await new Promise<void>((done) => {
        if (!server.listening) {
          done();
        } else {
          server.once("close", done);
        }
      });
      return signal?.aborted ? 130 : 0;
    }
    const apiKey = environment.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("Set OPENROUTER_API_KEY");
    }
    const client = (
      dependencies.createClient ?? ((options) => new OpenRouterVideo(options))
    )({
      apiKey,
      tools: {
        ffmpeg: environment.FFMPEG_PATH,
        ffprobe: environment.FFPROBE_PATH,
      },
    });
    const onProgress = (event: ProgressEvent) =>
      io.stderr(
        `${event.stage}${event.segmentIndex === undefined ? "" : ` segment ${event.segmentIndex + 1}/${event.segmentCount}`} ${event.mode ?? ""} ${event.jobId ?? ""} ${event.jobStatus ?? ""}\n`,
      );
    if (command === "models") {
      const models = await client.discover({ signal, onProgress });
      if (v.json) {
        print(models);
      } else {
        for (const model of models) {
          io.stdout(
            `${model.id}: durations=${model.durations.join(",")} frames=${model.frameRoles.join(",")} sizes=${model.sizes.join(",")} resolutions=${model.resolutions.join(",")} aspectRatios=${model.aspectRatios.join(",")} nativeAudio=${model.nativeAudio}\n`,
          );
        }
      }
      return 0;
    }
    const input = {
      audio: { path: required("audio") },
      model: required("model"),
      sttModel: required("stt-model"),
      output: {
        size: v.size,
        resolution: v.resolution,
        aspectRatio: v["aspect-ratio"],
        fps: number("fps", 24),
      },
      initialImage: v["initial-image"],
      transcription: {
        windowSeconds: number("window-seconds", 60),
        overlapSeconds: number("overlap-seconds", 2),
        maxBytes: number("max-stt-bytes", 20_000_000),
        language: v.language,
      },
      signal,
      onProgress,
    };
    if (command === "plan") {
      io.stderr(
        "Planning calls OpenRouter STT and can incur transcription charges; no video jobs are submitted.\n",
      );
      const plan = await client.plan(input);
      if (v.json) {
        print(plan);
      } else {
        io.stdout(
          `${plan.model.id}: ${plan.sourceInfo.duration}s; frames=${plan.model.frameRoles.join(",")}\n`,
        );
        for (const segment of plan.segments) {
          io.stdout(
            `${segment.index + 1}: samples ${segment.startSample}..${segment.endSample}; ${segment.start}..${segment.end}s; request=${segment.requestedDuration}s retained=${segment.retainedDuration}s mode=${segment.mode}\n${segment.transcript}\n${segment.fallbackReason ?? ""}\n`,
          );
        }
      }
      return 0;
    }
    if (!!v.prompt === !!v["prompt-file"]) {
      throw new Error("Supply exactly one of --prompt or --prompt-file");
    }
    const prompt = v["prompt-file"]
      ? await readFile(v["prompt-file"], "utf8")
      : v.prompt!;
    if (!prompt.trim()) {
      throw new Error("Prompt cannot be empty");
    }
    const directory = required("asset-dir");
    const assets = createLocalFilesystemAdapter({
      directory,
      baseUrl: required("base-url"),
    });
    const result = await client.generate(input, {
      prompt,
      assets,
      generateAudio: v["generate-audio"],
      signal,
      onProgress,
    });
    const path = join(directory, ...result.finalVideo.key.split("/"));
    if (v.output) {
      await copyFile(path, v.output, constants.COPYFILE_EXCL);
    }
    if (v.json) {
      print({ ...result, localPath: v.output ?? path });
    } else {
      io.stdout(`Final video: ${v.output ?? path}\n${result.finalVideo.url}\n`);
    }
    return 0;
  } catch (error) {
    const interrupted = signal?.aborted;
    if (error instanceof VideoError) {
      io.stderr(
        JSON.stringify({
          code: error.code,
          message: error.message,
          context: error.context,
        }) + "\n",
      );
    } else {
      io.stderr(
        (error instanceof Error ? error.message : "Command failed") + "\n",
      );
    }
    return interrupted ? 130 : 1;
  }
}
