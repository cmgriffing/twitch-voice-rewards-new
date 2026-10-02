import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  OpenRouterVideo,
  createLocalFilesystemAdapter,
} from "../dist/index.js";
import {
  temporary,
  source,
  clip,
  output,
  fixture,
  transport,
} from "./helpers.mjs";
let fixtures, audio, video;
before(async () => {
  fixtures = await mkdtemp(join(tmpdir(), "orchestration-fixture-"));
  audio = await source(fixtures);
  video = await readFile(await clip(fixtures));
});
after(async () => rm(fixtures, { recursive: true, force: true }));
const client = (dir, t, extra = {}) =>
  new OpenRouterVideo({
    apiKey: "TEST_KEY",
    fetcher: t.fetcher,
    tools: { temporaryDirectory: dir },
    pollIntervalMs: 0,
    retryDelayMs: 0,
    pollTimeoutMs: 10000,
    ...extra,
  });
const input = () => ({
  audio: { path: audio },
  model: "fixture/video",
  sttModel: "fixture/stt",
  output,
});
const store = (dir) =>
  createLocalFilesystemAdapter({
    directory: join(dir, "published"),
    baseUrl: "https://assets.example/prefix/",
  });
test("callback cancellation and generate input signal stop before video submission", async () =>
  temporary(async (dir) => {
    const t = transport(),
      c = client(dir, t),
      plan = await c.plan(input());
    const controller = new AbortController();
    await assert.rejects(
      c.render(plan, {
        assets: store(dir),
        signal: controller.signal,
        prompt: async (context) => {
          assert.equal(context.signal, controller.signal);
          controller.abort();
          return new Promise(() => {});
        },
      }),
      { code: "CANCELLED" },
    );
    const generateController = new AbortController();
    await assert.rejects(
      c.generate(
        { ...input(), signal: generateController.signal },
        {
          assets: store(dir),
          prompt: () => {
            generateController.abort();
            return "Scene";
          },
        },
      ),
      { code: "CANCELLED" },
    );
    assert.equal(t.submissions.length, 0);
    assert.deepEqual(await readdir(dir), []);
  }));
test("discovery lists incomplete catalog entries while selected-model planning rejects them", async () =>
  temporary(async (dir) => {
    const t = transport({
      catalog: {
        data: [{ ...fixture.catalog.data[0], supported_durations: null }],
      },
    });
    const c = client(dir, t);
    assert.deepEqual((await c.discover())[0].durations, []);
    await assert.rejects(c.plan(input()), { code: "UNSUPPORTED_MODEL" });
  }));
test("paid smoke requires explicit opt-in before network or transcription", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await assert.rejects(
    promisify(execFile)(
      process.execPath,
      [new URL("../scripts/smoke.mjs", import.meta.url).pathname],
      {
        env: {
          ...process.env,
          OPENROUTER_VIDEO_SMOKE: "0",
          OPENROUTER_API_KEY: "",
        },
      },
    ),
    (error) => error.code === 1 && error.stderr.includes("Opt-in required"),
  );
});
test("official SDK fixture verifies authenticated methods; planning publishes/submits nothing", async () =>
  temporary(async (dir) => {
    const t = transport(),
      c = client(dir, t);
    assert.equal((await c.discover())[0].nativeAudio, "unknown");
    const plan = await c.plan(input());
    assert.deepEqual(
      plan.segments.map((s) => [s.requestedDuration, s.mode]),
      [
        [2, "transcript"],
        [1, "transcript"],
      ],
    );
    assert.ok(
      t.calls.every((call) => call.authorization === "Bearer TEST_KEY"),
    );
    assert.equal(t.submissions.length, 0);
    assert.deepEqual(await readdir(dir), []);
  }));
test("delayed sequential jobs inherit published retained frames; bounded GET retries never repeat POST", async () =>
  temporary(async (dir) => {
    const published = [],
      events = [],
      prompts = [];
    const assets = store(dir);
    const t = transport({
      video,
      transientPoll: true,
      transientDownload: true,
      pendingPolls: 2,
      onSubmit: (body, n) => {
        if (n === 2) {
          assert.ok(published.includes("frame-0.png"));
          assert.equal(body.frame_images[0].frame_type, "first_frame");
          assert.ok(
            body.frame_images[0].image_url.url.endsWith("/frame-0.png"),
          );
        }
      },
    });
    const c = client(dir, t),
      plan = await c.plan(input());
    const result = await c.render(plan, {
      assets: {
        write: async (write) => {
          const a = await assets.write(write);
          published.push(write.key.split("/").at(-1));
          return a;
        },
      },
      prompt: async (context) => {
        prompts.push(context);
        return "Scenery under narration";
      },
      generateAudio: true,
      onProgress: (e) => events.push(e),
    });
    assert.equal(t.submissions.length, 2);
    assert.ok(
      t.submissions.every(
        (body) =>
          body.prompt.includes("<segment_transcript_context>") &&
          !body.input_references,
      ),
    );
    assert.equal(t.submissions[0].frame_images, undefined);
    assert.equal(prompts[0].nextText, "world");
    assert.equal(
      prompts[1].previousEndingImage.url,
      result.segments[0].endingImage.url,
    );
    assert.equal(prompts[1].fullTranscript, "hello world");
    assert.equal(result.segments.length, 2);
    assert.equal(events.at(-1).stage, "completion");
    assert.ok(
      events.some((e) => e.stage === "polling" && e.jobId === "fixture-1"),
    );
    assert.ok(
      t.calls.some(
        (call) =>
          call.path.endsWith("/content") &&
          call.authorization === "Bearer TEST_KEY",
      ),
    );
    assert.deepEqual(await readdir(dir), ["published"]);
    assert.ok(
      (await readFile(join(dir, "published", result.finalVideo.key))).length >
        1000,
    );
  }));
test("verified fixture audio route publishes padded input and combines it with first_frame", async () =>
  temporary(async (dir) => {
    const profile = {
      model: "fixture/video",
      scope: "all-model-routes",
      evidence: "Controlled test transport only; no real provider claim",
      audio: {
        firstFrame: true,
        requiresImage: false,
        maxSeconds: 2,
        padToRequest: true,
        format: "wav",
      },
    };
    const t = transport({ video }),
      c = client(dir, t, { compatibilityProfiles: [profile] });
    const plan = await c.plan(input());
    assert.ok(plan.segments.every((s) => s.mode === "audio"));
    const result = await c.render(plan, {
      assets: store(dir),
      prompt: "Landscape",
    });
    assert.equal(t.submissions[1].input_references[0].type, "audio_url");
    assert.equal(t.submissions[1].frame_images[0].frame_type, "first_frame");
    assert.equal(result.segments[1].conditioningAudio.mimeType, "audio/wav");
  }));
test("unknown model/missing metadata/toolchain failure stop before transcription", async () =>
  temporary(async (dir) => {
    const t = transport(),
      c = client(dir, t);
    await assert.rejects(c.plan({ ...input(), model: "missing" }), {
      code: "UNSUPPORTED_MODEL",
    });
    const broken = transport({
      catalog: {
        data: [{ ...fixture.catalog.data[0], supported_durations: null }],
      },
    });
    await assert.rejects(client(dir, broken).plan(input()), {
      code: "UNSUPPORTED_MODEL",
    });
    await assert.rejects(
      client(dir, t, {
        tools: {
          ffmpeg: "/missing-ffmpeg",
          ffprobe: "ffprobe",
          temporaryDirectory: dir,
        },
      }).plan(input()),
      { code: "TOOLCHAIN" },
    );
    assert.ok(!t.calls.some((call) => call.path.includes("transcription")));
  }));
test("render rejects stale metadata and changed source without video requests", async () =>
  temporary(async (dir) => {
    const t = transport(),
      plan = await client(dir, t).plan(input());
    const stale = transport({
      catalog: {
        data: [{ ...fixture.catalog.data[0], supported_durations: [1] }],
      },
    });
    await assert.rejects(
      client(dir, stale).render(plan, { assets: store(dir), prompt: "Scene" }),
      { code: "STALE_PLAN" },
    );
    const changed = await source(dir, 1.1);
    await assert.rejects(
      client(dir, t).render(
        { ...plan, source: { path: changed } },
        { assets: store(dir), prompt: "Scene" },
      ),
      { code: "STALE_PLAN" },
    );
    assert.equal(t.submissions.length + stale.submissions.length, 0);
  }));
test("provider options cannot override pipeline fields; invalid prompt stops submission", async () =>
  temporary(async (dir) => {
    const t = transport(),
      c = client(dir, t),
      plan = await c.plan(input());
    await assert.rejects(
      c.render(plan, {
        assets: store(dir),
        prompt: "Scene",
        providerOptions: { byteplus: { duration: 100 } },
      }),
      { code: "CONFIGURATION" },
    );
    await assert.rejects(
      c.render(plan, {
        assets: store(dir),
        prompt: () => {
          throw new Error("private secret");
        },
      }),
      { code: "PROMPT" },
    );
    assert.equal(t.submissions.length, 0);
  }));
test("terminal job states stop future segments and retain job context", async () =>
  temporary(async (dir) => {
    const plan = await client(dir, transport()).plan(input());
    for (const terminal of ["failed", "cancelled", "expired"]) {
      const t = transport({ terminal }),
        c = client(dir, t);
      await assert.rejects(
        c.render(plan, { assets: store(dir), prompt: "Scene" }),
        (error) =>
          error.code === "JOB_TERMINAL" &&
          error.context.jobId === "fixture-1" &&
          error.context.jobStatus === terminal,
      );
      assert.equal(t.submissions.length, 1);
    }
    assert.deepEqual(await readdir(dir), []);
  }));
test("lost submission response is ambiguous and is never replaced", async () =>
  temporary(async (dir) => {
    const t = transport({ lostSubmission: true }),
      c = client(dir, t),
      plan = await c.plan(input());
    await assert.rejects(
      c.render(plan, { assets: store(dir), prompt: "Scene" }),
      (error) =>
        error.code === "AMBIGUOUS_SUBMISSION" &&
        !JSON.stringify(error).includes("TEST_KEY"),
    );
    assert.equal(t.submissions.length, 1);
    assert.deepEqual(await readdir(dir), []);
  }));
test("failed frame publication stops the dependent request and retains published video context", async () =>
  temporary(async (dir) => {
    const t = transport({ video }),
      c = client(dir, t),
      plan = await c.plan(input()),
      assets = store(dir);
    await assert.rejects(
      c.render(plan, {
        prompt: "Scene",
        assets: {
          write: (write) => {
            if (write.key.endsWith("frame-0.png"))
              {throw new Error("storage failed");}
            return assets.write(write);
          },
        },
      }),
      (error) =>
        error.code === "STORAGE" &&
        error.context.publishedAssets.some((a) =>
          a.key.endsWith("segment-0.mp4"),
        ),
    );
    assert.equal(t.submissions.length, 1);
    assert.deepEqual(await readdir(dir), ["published"]);
  }));
test("abort stops local work, cleans workspace, retains accepted job ID and published assets", async () =>
  temporary(async (dir) => {
    const t = transport({ video }),
      c = client(dir, t),
      plan = await c.plan(input()),
      controller = new AbortController();
    await assert.rejects(
      c.render(plan, {
        assets: store(dir),
        prompt: "Scene",
        signal: controller.signal,
        onProgress: (e) => {
          if (e.segmentIndex === 1 && e.jobId) {controller.abort();}
        },
      }),
      (error) =>
        error.code === "CANCELLED" &&
        error.context.jobId === "fixture-2" &&
        error.context.completedSegments.length === 1,
    );
    assert.equal(t.submissions.length, 2);
    assert.deepEqual(await readdir(dir), ["published"]);
  }));
test("final write failure emits no completion and retains completed assets", async () =>
  temporary(async (dir) => {
    const t = transport({ video }),
      c = client(dir, t),
      plan = await c.plan(input()),
      assets = store(dir),
      events = [];
    await assert.rejects(
      c.render(plan, {
        prompt: "Scene",
        onProgress: (e) => events.push(e),
        assets: {
          write: (write) => {
            if (write.key.endsWith("/final.mp4")) {throw new Error("disk full");}
            return assets.write(write);
          },
        },
      }),
      (error) =>
        error.code === "STORAGE" &&
        error.context.completedSegments.length === 2,
    );
    assert.ok(!events.some((e) => e.stage === "completion"));
    assert.equal(events.at(-1).stage, "failure");
    assert.deepEqual(await readdir(dir), ["published"]);
  }));
test("bounded STT windows enforce byte limits and reconcile overlap before source segmentation", async () =>
  temporary(async (dir) => {
    const t = transport({
      transcriptions: [
        { text: "hello", words: [{ word: "hello", start: 1.3, end: 1.6 }] },
        {
          text: "hello world",
          words: [
            { word: "hello", start: 0.7, end: 1 },
            { word: "world", start: 1.5, end: 1.7 },
          ],
        },
      ],
      onStt: (form) => assert.ok(form.get("file").size < 60000),
    });
    const c = client(dir, t),
      plan = await c.plan({
        ...input(),
        transcription: {
          windowSeconds: 3,
          overlapSeconds: 1.2,
          maxBytes: 60000,
        },
      });
    assert.deepEqual(
      plan.words.map((w) => w.word),
      ["hello", "world"],
    );
    assert.equal(
      t.calls.filter((call) => call.path.endsWith("/audio/transcriptions"))
        .length,
      2,
    );
    assert.equal(plan.segments.at(-1).endSample, plan.sourceInfo.sampleCount);
  }));
