import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { runCli, serveAssets } from "../dist/index.js";
import { VideoError } from "@repo/openrouter-video";
const env = { OPENROUTER_API_KEY: "SECRET_KEY" };
const args = [
  "--audio",
  "source.wav",
  "--model",
  "fixture/video",
  "--stt-model",
  "fixture/stt",
  "--size",
  "160x90",
];
function capture() {
  let stdout = "",
    stderr = "";
  return {
    io: { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s) },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}
const fake = (overrides) => ({
  discover: async () => [
    {
      id: "test",
      durations: [4, 6, 8],
      frameRoles: ["first_frame"],
      sizes: ["160x90"],
      resolutions: [],
      aspectRatios: [],
      nativeAudio: "unknown",
    },
  ],
  plan: async (input) => ({
    input,
    model: { id: "test", frameRoles: ["first_frame"] },
    sourceInfo: { duration: 1 },
    segments: [
      {
        index: 0,
        startSample: 0,
        endSample: 48000,
        start: 0,
        end: 1,
        requestedDuration: 4,
        retainedDuration: 1,
        mode: "transcript",
        transcript: "Hi",
      },
    ],
  }),
  generate: async () => ({
    finalVideo: {
      key: "runs/test/final.mp4",
      url: "https://test.example/final.mp4",
    },
    segments: [],
  }),
  ...overrides,
});
test("models and plan dispatch through SDK public API and emit parseable JSON", async () => {
  const out = capture(),
    client = fake();
  let key;
  assert.equal(
    await runCli(["models", "--json"], env, out.io, undefined, {
      createClient: (options) => {
        key = options.apiKey;
        return client;
      },
    }),
    0,
  );
  assert.equal(JSON.parse(out.stdout)[0].nativeAudio, "unknown");
  assert.equal(key, "SECRET_KEY");
  assert.ok(!out.stdout.includes(key));
  const plan = capture();
  assert.equal(
    await runCli(["plan", ...args, "--json"], env, plan.io, undefined, {
      createClient: () => client,
    }),
    0,
  );
  assert.equal(JSON.parse(plan.stdout).segments[0].mode, "transcript");
  assert.ok(plan.stderr.includes("charges"));
});
test("polling timeout option reaches the client and rejects invalid budgets before creation", async () => {
  for (const [flags, timeout] of [
    [[], undefined],
    [["--poll-timeout-seconds", "1800"], 1_800_000],
    [["--poll-timeout-seconds", "0.5"], 500],
  ]) {
    const out = capture();
    assert.equal(await runCli(["models", "--json", ...flags], env, out.io, undefined, {
      createClient: (options) => {
        assert.equal(options.pollTimeoutMs, timeout);
        return fake();
      },
    }), 0);
  }
  for (const value of ["0", "-1", "", "NaN", "Infinity"]) {
    const out = capture();
    let created = false;
    assert.equal(await runCli(["models", "--poll-timeout-seconds", value], env, out.io, undefined, {
      createClient: () => {
        created = true;
        return fake();
      },
    }), 1);
    assert.equal(created, false);
    assert.match(out.stderr, /--poll-timeout-seconds/);
  }
});
test("prompt-file generation prints progress on stderr, final JSON on stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-prompt-"));
  try {
    const promptFile = join(dir, "prompt.txt");
    await writeFile(promptFile, "Narrated scenery");
    const out = capture();
    let called = false;
    const client = fake({
      generate: async (input, options) => {
        called = true;
        assert.equal(options.prompt, "Narrated scenery");
        assert.equal(input.model, "fixture/video");
        assert.equal(typeof options.assets.write, "function");
        options.onProgress({
          stage: "polling",
          segmentIndex: 0,
          segmentCount: 2,
          jobId: "job-1",
          mode: "transcript",
        });
        return {
          finalVideo: {
            key: "runs/test/final.mp4",
            url: "https://test.example/final.mp4",
          },
          segments: [],
        };
      },
    });
    const code = await runCli(
      [
        "generate",
        ...args,
        "--prompt-file",
        promptFile,
        "--asset-dir",
        dir,
        "--base-url",
        "https://test.example/assets/",
        "--json",
      ],
      env,
      out.io,
      undefined,
      { createClient: () => client },
    );
    assert.equal(code, 0);
    assert.ok(called);
    assert.equal(JSON.parse(out.stdout).finalVideo.key, "runs/test/final.mp4");
    assert.ok(out.stderr.includes("job-1"));
    assert.ok(!out.stdout.includes("SECRET_KEY"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("configuration errors are nonzero and stop before generation", async () => {
  for (const argv of [
    ["unknown"],
    ["models", "--bogus"],
    ["generate", ...args, "--prompt", "Scene"],
    ["generate", ...args, "--prompt", "x", "--prompt-file", "x"],
  ]) {
    const out = capture();
    let calls = 0;
    assert.equal(
      await runCli(argv, env, out.io, undefined, {
        createClient: () =>
          fake({
            generate: async () => {
              calls++;
            },
          }),
      }),
      1,
    );
    assert.equal(calls, 0);
    assert.equal(out.stdout, "");
  }
  const out = capture();
  assert.equal(await runCli(["models"], {}, out.io), 1);
  assert.ok(out.stderr.includes("OPENROUTER_API_KEY"));
});
test("interruption propagates signal and reports accepted job without claiming remote cancellation", async () => {
  const controller = new AbortController(),
    out = capture();
  const client = fake({
    plan: async (input) => {
      assert.equal(input.signal, controller.signal);
      controller.abort();
      throw new VideoError(
        "CANCELLED",
        "Local work stopped; remote job may still run",
        { jobId: "accepted-job" },
      );
    },
  });
  assert.equal(
    await runCli(["plan", ...args, "--json"], env, out.io, controller.signal, {
      createClient: () => client,
    }),
    130,
  );
  assert.ok(out.stderr.includes("accepted-job"));
  assert.ok(out.stderr.includes("remote job may still run"));
  assert.equal(out.stdout, "");
});
test("JSON-mode submission failures report provider details on stderr", async () => {
  const out = capture();
  const context = {
    segmentIndex: 2,
    providerError: { status: 400, message: "Input image rejected" },
    submission: { model: "fixture/video", duration: 4 },
  };
  const code = await runCli([
    "generate", ...args, "--prompt", "Scene", "--asset-dir", "/tmp/assets",
    "--base-url", "https://assets.example/", "--json",
  ], env, out.io, undefined, {
    createClient: () => fake({ generate: async () => {
      throw new VideoError("SUBMISSION", "OpenRouter rejected the submission (HTTP 400): Input image rejected", context);
    } }),
  });
  assert.equal(code, 1);
  const failure = JSON.parse(out.stderr);
  assert.equal(failure.code, "SUBMISSION");
  assert.deepEqual(failure.context, context);
  assert.equal(out.stdout, "");
  assert.ok(!out.stderr.includes(env.OPENROUTER_API_KEY));
});
function get(port, path, headers = {}) {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        done({
          status: res.statusCode,
          headers: res.headers,
          bytes: Buffer.concat(chunks),
        }),
      );
    });
    req.on("error", fail);
    req.end();
  });
}
test("static server serves complete media/ranges beneath route prefix and denies escapes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-server-")),
    controller = new AbortController();
  try {
    const assets = join(dir, "assets");
    await mkdir(assets);
    await writeFile(join(assets, "clip.mp4"), Buffer.from([1, 2, 3, 4]));
    await writeFile(join(assets, "frame 2.png"), "png");
    await writeFile(join(dir, "secret"), "private");
    await symlink(join(dir, "secret"), join(assets, "escape"));
    await mkdir(join(dir, "outside"));
    await writeFile(join(dir, "outside/file"), "private");
    await symlink(join(dir, "outside"), join(assets, "directory-link"));
    const server = await serveAssets({
      directory: assets,
      port: 0,
      prefix: "/assets",
      signal: controller.signal,
    });
    const port = server.address().port;
    const response = await get(port, "/assets/clip.mp4");
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "video/mp4");
    assert.deepEqual(response.bytes, Buffer.from([1, 2, 3, 4]));
    const range = await get(port, "/assets/clip.mp4", { Range: "bytes=1-2" });
    assert.equal(range.status, 206);
    assert.deepEqual(range.bytes, Buffer.from([2, 3]));
    assert.equal(
      (await get(port, "/assets/frame%202.png")).headers["content-type"],
      "image/png",
    );
    for (const path of [
      "/assets/../secret",
      "/assets/%2e%2e/secret",
      "/assets/%2f..%2fsecret",
      "/assets/escape",
      "/assets/directory-link/file",
      "/assets/.upload-pending",
      "/wrong/clip.mp4",
    ])
      {assert.ok([403, 404].includes((await get(port, path)).status), path);}
    controller.abort();
    await new Promise((done) => server.once("close", done));
  } finally {
    controller.abort();
    await rm(dir, { recursive: true, force: true });
  }
});
test("real CLI binary runs standalone and SIGINT closes serve with exit 130", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cli-sigint-"));
  try {
    const child = spawn(
      process.execPath,
      [
        new URL("../dist/bin.js", import.meta.url).pathname,
        "serve",
        "--asset-dir",
        dir,
        "--port",
        "0",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    await new Promise((done, fail) => {
      child.once("error", fail);
      child.once("close", (code) =>
        fail(new Error(`CLI exited before readiness (${code}): ${stderr}`)),
      );
      child.stdout.once("data", () => {
        child.kill("SIGINT");
        done();
      });
    });
    const code = await new Promise((done) => child.once("close", done));
    assert.equal(code, 130, stderr);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
