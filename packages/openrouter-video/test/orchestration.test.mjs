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
          error.message === `OpenRouter job ended as ${terminal}` &&
          error.context.jobId === "fixture-1" &&
          error.context.jobStatus === terminal &&
          error.context.jobError === undefined,
      );
      assert.equal(t.submissions.length, 1);
    }
    assert.deepEqual(await readdir(dir), []);
  }));
test("terminal job explanations preserve provider reasons with credential-redacted context", async () =>
  temporary(async (dir) => {
    const plan = await client(dir, transport()).plan(input());
    const reason = "Video generation completed with no output (content may have been filtered)";
    for (const terminal of ["failed", "cancelled", "expired"]) {
      const t = transport();
      let polls = 0;
      const c = client(dir, t, {
        fetcher: (request) => {
          if (request.url.endsWith("/videos/fixture-1")) {
            polls++;
            return Promise.resolve(new Response(JSON.stringify({
              ...fixture.completed,
              id: "fixture-1",
              status: terminal,
              error: ` ${reason}\nTEST_KEY sk-or-v1-other-key Bearer another-key `,
            }), { headers: { "Content-Type": "application/json" } }));
          }
          return t.fetcher(request);
        },
      });
      await assert.rejects(c.render(plan, { assets: store(dir), prompt: "Scene" }), (error) => {
        const expected = `${reason} [REDACTED] [REDACTED] Bearer [REDACTED]`;
        assert.equal(error.code, "JOB_TERMINAL");
        assert.equal(error.message, `OpenRouter job ended as ${terminal}: ${expected}`);
        assert.equal(error.context.jobError, expected);
        assert.equal(error.context.jobId, "fixture-1");
        assert.equal(error.context.jobStatus, terminal);
        assert.equal(error.context.providerError, undefined);
        assert.deepEqual(error.context.completedSegments, []);
        assert.deepEqual(error.context.publishedAssets, []);
        assert.ok(!JSON.stringify(error).includes("TEST_KEY"));
        return true;
      });
      assert.equal(polls, 1);
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
test("status failures beyond the retry burst recover on the same pending second-segment job", async () =>
  temporary(async (dir) => {
    const t = transport({ video }),
      events = [];
    let failures = 0;
    const c = client(dir, t, {
      fetcher: (request) => {
        const attempt = request.url.endsWith("/videos/fixture-2") ? failures++ : -1;
        if (attempt === 3) {
          return Promise.reject(new TypeError("temporary connection failure TEST_KEY"));
        }
        if (attempt >= 0 && attempt < 3) {
          const status = [503, 429, 408][attempt];
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: status, message: "temporary status outage" },
          }), { status, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    const result = await c.render(plan, {
      assets: store(dir),
      prompt: "Scene",
      onProgress: (event) => events.push(event),
    });
    assert.equal(result.segments.length, 2);
    assert.equal(result.segments[1].jobId, "fixture-2");
    assert.equal(t.submissions.length, 2);
    assert.equal(failures, 6);
    assert.ok(events.some((event) =>
      event.segmentIndex === 1 && event.jobStatus === "pending"));
    assert.equal(events.at(-1).stage, "completion");
  }));
test("accepted jobs missing from initial status requests recover without a replacement POST", async () =>
  temporary(async (dir) => {
    const t = transport({ video });
    let requests = 0;
    const c = client(dir, t, {
      fetcher: (request) => {
        if (request.url.endsWith("/videos/fixture-1") && requests++ < 5) {
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 404, message: "Job fixture-1 not found" },
          }), { status: 404, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    const result = await c.render(plan, { assets: store(dir), prompt: "Scene" });
    assert.equal(result.segments.length, 2);
    assert.equal(result.segments[0].jobId, "fixture-1");
    assert.equal(t.submissions.length, 2);
    assert.equal(requests, 7);
  }));
test("accepted jobs that remain missing time out with the last 404 and original job ID", async () =>
  temporary(async (dir) => {
    const t = transport();
    let requests = 0;
    const c = client(dir, t, {
      pollTimeoutMs: 200,
      fetcher: (request) => {
        if (request.url.endsWith("/videos/fixture-1")) {
          requests++;
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 404, message: "Job fixture-1 not found" },
          }), { status: 404, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    await assert.rejects(c.render(plan, { assets: store(dir), prompt: "Scene" }), (error) => {
      assert.equal(error.code, "POLL_TIMEOUT");
      assert.equal(error.context.stage, "polling");
      assert.equal(error.context.jobId, "fixture-1");
      assert.equal(error.context.jobStatus, "pending");
      assert.equal(error.context.providerError.status, 404);
      assert.equal(error.context.providerError.message, "Job fixture-1 not found");
      return true;
    });
    assert.ok(requests > 4);
    assert.equal(t.submissions.length, 1);
    assert.deepEqual(await readdir(dir), []);
  }));
test("missing video content still fails without retrying or resubmitting", async () =>
  temporary(async (dir) => {
    const t = transport({ pendingPolls: 0 });
    let downloads = 0;
    const c = client(dir, t, {
      fetcher: (request) => {
        if (new URL(request.url).pathname.endsWith("/content")) {
          downloads++;
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 404, message: "Content not found" },
          }), { status: 404, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    await assert.rejects(c.render(plan, { assets: store(dir), prompt: "Scene" }), (error) => {
      assert.equal(error.code, "DOWNLOAD");
      assert.equal(error.context.jobId, "fixture-1");
      assert.equal(error.context.jobStatus, "completed");
      return true;
    });
    assert.equal(downloads, 1);
    assert.equal(t.submissions.length, 1);
  }));
test("polling deadline bounds long intervals, retry backoff, and stalled requests", async () =>
  temporary(async (dir) => {
    const plan = await client(dir, transport()).plan(input());
    for (const scenario of ["interval", "backoff", "request"]) {
      const t = transport({ pendingPolls: Infinity });
      let requestSignal;
      const c = client(dir, t, {
        pollTimeoutMs: 50,
        pollIntervalMs: scenario === "interval" ? 1000 : 0,
        retryDelayMs: scenario === "backoff" ? 1000 : 0,
        fetcher: (request) => {
          if (!request.url.endsWith("/videos/fixture-1")) {
            return t.fetcher(request);
          }
          if (scenario === "backoff") {
            return Promise.resolve(new Response(JSON.stringify({
              error: { code: 503, message: "temporary outage" },
            }), { status: 503, headers: { "Content-Type": "application/json" } }));
          }
          if (scenario === "request") {
            requestSignal = request.signal;
            return new Promise(() => {});
          }
          return t.fetcher(request);
        },
      });
      await assert.rejects(c.render(plan, {
        assets: store(dir),
        prompt: "Scene",
        // Also bounds the repro before the polling deadline is enforced in these paths.
        signal: AbortSignal.timeout(2000),
      }), (error) => {
        assert.equal(error.code, "POLL_TIMEOUT", scenario);
        assert.equal(error.message, "Polling deadline exceeded; remote job may still run");
        assert.equal(error.context.jobId, "fixture-1");
        assert.equal(error.context.jobStatus, "pending");
        return true;
      });
      if (requestSignal) {assert.ok(requestSignal.aborted);}
      assert.equal(t.submissions.length, 1);
    }
    assert.deepEqual(await readdir(dir), []);
  }));
test("persistent transient status failures continue until the polling deadline", async () =>
  temporary(async (dir) => {
    const t = transport();
    let requests = 0;
    const c = client(dir, t, {
      pollTimeoutMs: 200,
      retries: 0,
      fetcher: (request) => {
        if (request.url.endsWith("/videos/fixture-1")) {
          requests++;
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 503, message: "temporary outage TEST_KEY" },
          }), { status: 503, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    await assert.rejects(c.render(plan, { assets: store(dir), prompt: "Scene" }), (error) => {
      assert.equal(error.code, "POLL_TIMEOUT");
      assert.equal(error.message, "Polling deadline exceeded; remote job may still run");
      assert.equal(error.context.providerError.status, 503);
      assert.equal(error.context.providerError.message, "temporary outage [REDACTED]");
      return true;
    });
    assert.ok(requests > 4);
    assert.equal(t.submissions.length, 1);
  }));
test("caller cancellation interrupts status retry backoff and preserves the accepted job", async () =>
  temporary(async (dir) => {
    const controller = new AbortController();
    const t = transport();
    let timer, requests = 0;
    const c = client(dir, t, {
      retryDelayMs: 1000,
      fetcher: (request) => {
        if (request.url.endsWith("/videos/fixture-1")) {
          requests++;
          timer = setTimeout(() => controller.abort(), 20);
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 503, message: "temporary outage" },
          }), { status: 503, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    try {
      await assert.rejects(c.render(plan, {
        assets: store(dir), prompt: "Scene", signal: controller.signal,
      }), (error) => {
        assert.equal(error.code, "CANCELLED");
        assert.equal(error.context.jobId, "fixture-1");
        assert.equal(error.context.jobStatus, "pending");
        return true;
      });
      assert.equal(requests, 1);
      assert.equal(t.submissions.length, 1);
      assert.deepEqual(await readdir(dir), []);
    } finally {
      clearTimeout(timer);
    }
  }));
test("permanent status errors report polling diagnostics without retrying or resubmitting", async () =>
  temporary(async (dir) => {
    const t = transport();
    let requests = 0;
    const c = client(dir, t, {
      fetcher: (request) => {
        if (request.url.endsWith("/videos/fixture-1")) {
          requests++;
          return Promise.resolve(new Response(JSON.stringify({
            error: { code: 401, message: "Invalid key TEST_KEY" },
          }), { status: 401, headers: { "Content-Type": "application/json" } }));
        }
        return t.fetcher(request);
      },
    });
    const plan = await c.plan(input());
    await assert.rejects(c.render(plan, { assets: store(dir), prompt: "Scene" }), (error) => {
      assert.equal(error.code, "POLL_REQUEST");
      assert.equal(error.context.stage, "polling");
      assert.equal(error.context.jobId, "fixture-1");
      assert.equal(error.context.providerError.status, 401);
      assert.equal(error.context.providerError.message, "Invalid key [REDACTED]");
      assert.ok(!JSON.stringify(error).includes("TEST_KEY"));
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(t.submissions.length, 1);
  }));
test("third-segment rejection preserves provider diagnostics and completed assets without retrying POST", async () =>
  temporary(async (dir) => {
    const provider = {
      code: "InputImageSensitiveContentDetected.PrivacyInformation",
      message: "The input image may contain a real person. TEST_KEY",
      param: "",
      type: "BadRequest",
    };
    const wrappedMessage = `HTTP 400: ${JSON.stringify({ error: provider })}`;
    const t = transport({
      video,
      onSubmit: (_body, n) => {
        if (n !== 3) {return;}
        return new Response(JSON.stringify({
          error: {
            code: 400,
            message: wrappedMessage,
          },
        }), { status: 400, headers: { "Content-Type": "application/json" } });
      },
    });
    const c = client(dir, t);
    const plan = await c.plan({ ...input(), audio: { path: await source(dir, 4.4) } });
    assert.equal(plan.segments.length, 3);
    await assert.rejects(
      c.render(plan, { assets: store(dir), prompt: "Scene" }),
      (error) => {
        assert.equal(error.code, "SUBMISSION");
        assert.equal(error.message,
          "OpenRouter rejected the submission (HTTP 400): The input image may contain a real person. [REDACTED]");
        assert.equal(error.context.stage, "submission");
        assert.equal(error.context.segmentIndex, 2);
        assert.equal(error.context.completedSegments.length, 2);
        assert.equal(error.context.publishedAssets.length, 4);
        assert.deepEqual(error.context.providerError, {
          status: 400,
          code: 400,
          message: wrappedMessage.replaceAll("TEST_KEY", "[REDACTED]"),
          providerName: undefined,
          providerCode: "InputImageSensitiveContentDetected.PrivacyInformation",
          providerMessage: "The input image may contain a real person. [REDACTED]",
        });
        assert.equal(error.context.submission.model, "fixture/video");
        assert.equal(error.context.submission.duration, 1);
        assert.equal(error.context.submission.size, output.size);
        assert.equal(error.context.submission.frameImageUrl,
          error.context.completedSegments[1].endingImage.url);
        assert.ok(!JSON.stringify(error).includes("TEST_KEY"));
        return true;
      },
    );
    assert.equal(t.submissions.length, 3);
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
