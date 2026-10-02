import { parseArgs } from "node:util";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  OpenRouterVideo,
  createLocalFilesystemAdapter,
} from "../dist/index.js";
import { Media } from "../dist/media.js";

if (process.env.OPENROUTER_VIDEO_SMOKE !== "1") {
  console.error(
    "Opt-in required: OPENROUTER_VIDEO_SMOKE=1. This procedure incurs STT and video charges.",
  );
  process.exitCode = 1;
} else {
  const { values } = parseArgs({
    options: {
      audio: { type: "string" },
      model: { type: "string" },
      "stt-model": { type: "string" },
      size: { type: "string" },
      resolution: { type: "string" },
      "aspect-ratio": { type: "string" },
      fps: { type: "string" },
      "asset-dir": { type: "string" },
      "base-url": { type: "string" },
      prompt: { type: "string" },
    },
  });
  for (const field of ["audio", "model", "stt-model", "asset-dir", "base-url"])
    if (!values[field]) throw new Error(`--${field} is required`);
  const directory = resolve(values["asset-dir"]);
  const output = {
    size: values.size,
    resolution: values.resolution,
    aspectRatio: values["aspect-ratio"],
    fps: Number(values.fps ?? 24),
  };
  const tools = {
    ffmpeg: process.env.FFMPEG_PATH,
    ffprobe: process.env.FFPROBE_PATH,
  };
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  const requests = [],
    progress = [];
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  try {
    const client = new OpenRouterVideo({
      apiKey: process.env.OPENROUTER_API_KEY,
      tools,
      fetcher: async (request) => {
        if (
          request.method === "POST" &&
          new URL(request.url).pathname.endsWith("/videos")
        )
          requests.push(await request.clone().json());
        return fetch(request);
      },
    });
    console.error(
      "Paid smoke: planning calls STT; rendering submits sequential video jobs.",
    );
    const plan = await client.plan({
      audio: { path: values.audio },
      model: values.model,
      sttModel: values["stt-model"],
      output,
      signal: controller.signal,
    });
    assert.ok(
      plan.segments.length >= 2,
      "Provide a source requiring at least two segments",
    );
    assert.ok(
      plan.segments.every((s) => s.mode === "transcript"),
      "Default smoke must disclose transcript fallback",
    );
    console.error(
      JSON.stringify(
        plan.segments.map((s) => ({
          start: s.start,
          end: s.end,
          requested: s.requestedDuration,
          retained: s.retainedDuration,
          mode: s.mode,
        })),
        null,
        2,
      ),
    );
    const local = createLocalFilesystemAdapter({
      directory,
      baseUrl: values["base-url"],
    });
    const assets = {
      async write(input) {
        const asset = await local.write(input);
        // Unauthenticated public GET: verify direct bytes before any dependent provider request.
        const response = await fetch(asset.url, { signal: controller.signal });
        assert.equal(
          response.status,
          200,
          "Public asset must be directly downloadable",
        );
        assert.ok(
          response.headers.get("content-type")?.startsWith(asset.mimeType),
          "Public MIME type must match",
        );
        const remoteHash = createHash("sha256");
        for await (const chunk of response.body) remoteHash.update(chunk);
        const localHash = createHash("sha256");
        for await (const chunk of createReadStream(join(directory, asset.key)))
          localHash.update(chunk);
        assert.equal(
          remoteHash.digest("hex"),
          localHash.digest("hex"),
          "Public URL must return exact published asset bytes",
        );
        return asset;
      },
    };
    const result = await client.render(plan, {
      assets,
      prompt:
        values.prompt ??
        "Show a continuous quiet landscape beneath the narration.",
      signal: controller.signal,
      onProgress: (event) => {
        progress.push(event);
        console.error(JSON.stringify(event));
      },
    });
    assert.equal(requests.length, plan.segments.length);
    for (let i = 0; i < requests.length; i++) {
      assert.equal(requests[i].model, plan.model.id);
      assert.equal(requests[i].duration, plan.segments[i].requestedDuration);
      assert.equal(requests[i].input_references, undefined);
      if (i) {
        assert.equal(requests[i].frame_images[0].frame_type, "first_frame");
        assert.equal(
          requests[i].frame_images[0].image_url.url,
          result.segments[i - 1].endingImage.url,
        );
      }
    }
    const media = new Media(tools);
    const probes = [];
    await media.workspace(async (work) => {
      for (const segment of result.segments) {
        const video = join(directory, segment.video.key),
          frame = join(directory, segment.endingImage.key);
        const decoded = join(work, `ending-${segment.plan.index}.rgb`),
          published = join(work, `published-${segment.plan.index}.rgb`);
        await media.ff(
          [
            "-i",
            video,
            "-vf",
            `select=eq(n\\,${segment.retainedFrames - 1})`,
            "-fps_mode",
            "vfr",
            "-frames:v",
            "1",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            decoded,
          ],
          controller.signal,
        );
        await media.ff(
          ["-i", frame, "-pix_fmt", "rgb24", "-f", "rawvideo", published],
          controller.signal,
        );
        assert.equal(
          hash(await readFile(decoded)),
          hash(await readFile(published)),
          "Inherited image must decode to the last retained frame",
        );
        probes.push(await media.probe(video, controller.signal, true));
      }
      const final = await media.probe(
        join(directory, result.finalVideo.key),
        controller.signal,
        true,
      );
      assert.ok(
        Math.abs(Number(final.format.duration) - plan.sourceInfo.duration) <=
          1 / output.fps,
      );
      assert.equal(
        Number(
          final.streams.find((s) => s.codec_type === "video").nb_read_frames,
        ),
        Math.round(
          (plan.sourceInfo.sampleCount * output.fps) /
            plan.sourceInfo.sampleRate,
        ),
      );
      assert.ok(
        final.streams.some((s) => s.codec_type === "audio"),
        "Final soundtrack must exist",
      );
      probes.push(final);
    });
    const report = {
      status: "passed",
      plan,
      requests,
      progress,
      result,
      probes,
      note: "First-frame request identity and retained-frame provenance verified. Inspect visual continuity and listen to source/final soundtrack; transcript fallback does not guarantee lip-sync.",
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
}
