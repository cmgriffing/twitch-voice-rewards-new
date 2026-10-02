import test from "node:test";
import assert from "node:assert/strict";
import { planSegments, retainedFrameCount } from "../dist/index.js";
import {
  compatibleDurations,
  normalizeModel,
  resolveMode,
  revalidate,
} from "../dist/capabilities.js";
import { validateWords } from "../dist/planner.js";
import { reconcile } from "../dist/transcription.js";
const output = { size: "160x90", fps: 24 };
const model = {
  id: "test",
  name: "test",
  durations: [4, 6, 8],
  sizes: ["160x90"],
  resolutions: ["720p"],
  aspectRatios: ["16:9"],
  frameRoles: ["first_frame"],
  generateAudio: true,
  passthrough: [],
  nativeAudio: "unknown",
};
const info = (seconds) => ({
  sampleRate: 48000,
  sampleCount: Math.round(seconds * 48000),
  duration: seconds,
  channels: 1,
  format: "wav",
  sha256: "test",
});
test("word-safe coverage includes all silence and uses discrete minimum duration", () => {
  const words = [
    { word: "one", start: 0.5, end: 0.8 },
    { word: "crossing", start: 7.6, end: 8.4 },
    { word: "last", start: 16, end: 16.4 },
  ];
  const segments = planSegments(info(17), words, model, output);
  assert.deepEqual(
    segments.map((s) => [s.start, s.end]),
    [
      [0, 7.6],
      [7.6, 15.6],
      [15.6, 17],
    ],
  );
  assert.deepEqual(
    segments.map((s) => s.requestedDuration),
    [8, 8, 4],
  );
  assert.equal(segments.flatMap((s) => s.words).length, words.length);
  assert.equal(
    segments.reduce((n, s) => n + s.endSample - s.startSample, 0),
    17 * 48000,
  );
  assert.ok(segments.every((s) => s.mode === "transcript"));
});
test("ceiling from integer samples handles fractional and exact boundaries", () => {
  for (const [seconds, expected] of [
    [5.2, 6],
    [6.1, 8],
    [1.2, 4],
    [6, 6],
  ])
    assert.equal(
      planSegments(info(seconds), [], model, output)[0].requestedDuration,
      expected,
    );
  assert.deepEqual(
    planSegments(info(9.2), [], model, output).map((s) => s.requestedDuration),
    [8, 4],
  );
});
test("long word and overlapping speech without a gap fail explicitly", () => {
  assert.throws(
    () =>
      planSegments(
        info(10),
        [{ word: "long", start: 0, end: 9 }],
        model,
        output,
      ),
    { code: "SEGMENTATION" },
  );
  assert.throws(
    () =>
      planSegments(
        info(10),
        [
          { word: "a", start: 0, end: 5 },
          { word: "b", start: 4, end: 9 },
        ],
        model,
        output,
      ),
    { code: "SEGMENTATION" },
  );
});
test("overlapping speech with a later gap preserves complete words", () => {
  const words = [
    { word: "a", start: 1, end: 4 },
    { word: "b", start: 3, end: 5 },
    { word: "c", start: 7, end: 9 },
  ];
  assert.equal(planSegments(info(10), words, model, output)[0].end, 7);
});
test("empty source and unusable speech timings are rejected; confirmed silence is accepted", () => {
  assert.throws(() => planSegments(info(0), [], model, output), {
    code: "SEGMENTATION",
  });
  assert.throws(() => validateWords("speech", [], 1), {
    code: "TRANSCRIPTION_TIMING",
  });
  assert.deepEqual(validateWords("", undefined, 1), []);
  for (const words of [
    [{ word: "a", start: NaN, end: 1 }],
    [{ word: "a", start: 0, end: 2 }],
    [
      { word: "a", start: 0.5, end: 0.8 },
      { word: "b", start: 0.1, end: 0.4 },
    ],
  ])
    assert.throws(() => validateWords("speech", words, 1), {
      code: "TRANSCRIPTION_TIMING",
    });
});
test("cumulative frame counts avoid independent rounding drift", () => {
  const segments = planSegments(
    info(24.031),
    [],
    { ...model, durations: [1] },
    output,
  );
  const frames = segments.reduce(
    (n, s) => n + retainedFrameCount(s, 48000, 24),
    0,
  );
  assert.equal(frames, Math.round(24.031 * 24));
});
test("discovery normalizes durations and rejects missing metadata and output incompatibility", () => {
  const raw = {
    id: "test",
    name: "test",
    supportedDurations: [8, 4, 6, 4, 0],
    supportedSizes: ["160x90"],
  };
  assert.deepEqual(normalizeModel(raw, []).durations, [4, 6, 8]);
  assert.throws(
    () => normalizeModel({ ...raw, supportedDurations: null }, []),
    { code: "UNSUPPORTED_MODEL" },
  );
  assert.throws(
    () => compatibleDurations(model, { size: "1280x720", fps: 24 }),
    { code: "UNSUPPORTED_MODEL" },
  );
  assert.throws(
    () =>
      compatibleDurations(model, {
        size: "160x90",
        resolution: "720p",
        fps: 24,
      }),
    { code: "UNSUPPORTED_MODEL" },
  );
  assert.deepEqual(
    compatibleDurations(model, output, {
      constraints: [{ size: "160x90", durations: [4, 6] }],
    }),
    [4, 6],
  );
});
test("audio output flag is insufficient; verified routes respect combined frame/image constraints", () => {
  const profile = {
    model: "test",
    scope: "all-model-routes",
    evidence: "Controlled fixture only",
    audio: {
      firstFrame: false,
      requiresImage: false,
      maxSeconds: 8,
      padToRequest: true,
      format: "wav",
    },
  };
  assert.equal(
    resolveMode(model, undefined, false, false, 4).mode,
    "transcript",
  );
  assert.equal(resolveMode(model, profile, false, false, 4).mode, "audio");
  assert.equal(resolveMode(model, profile, true, true, 4).mode, "transcript");
  assert.equal(
    resolveMode(
      model,
      { ...profile, audio: { ...profile.audio, firstFrame: true } },
      true,
      true,
      4,
    ).mode,
    "audio",
  );
  assert.equal(
    resolveMode(
      model,
      { ...profile, audio: { ...profile.audio, requiresImage: true } },
      false,
      false,
      4,
    ).mode,
    "transcript",
  );
  assert.throws(
    () =>
      resolveMode(model, { transcriptRequiresImage: true }, false, false, 4),
    { code: "UNSUPPORTED_MODEL" },
  );
});
test("first segment can use a model with no frames; multi-segment plan cannot", () => {
  const noFrames = { ...model, frameRoles: [] };
  assert.equal(planSegments(info(1), [], noFrames, output).length, 1);
  assert.throws(() => planSegments(info(9), [], noFrames, output), {
    code: "UNSUPPORTED_MODEL",
  });
  assert.throws(
    () =>
      planSegments(
        info(1),
        [],
        noFrames,
        output,
        "https://image.test/first.png",
      ),
    { code: "UNSUPPORTED_MODEL" },
  );
});
test("revalidation reports changed durations/frame roles/modes as stale", () => {
  const plan = {
    model,
    output,
    segments: planSegments(info(9), [], model, output),
  };
  revalidate(plan, model);
  for (const changed of [
    { ...model, durations: [4, 6] },
    { ...model, frameRoles: [] },
  ])
    assert.throws(() => revalidate(plan, changed), { code: "STALE_PLAN" });
});
test("overlap reconciliation retains each word once and rejects ambiguous repetition", () => {
  const a = [
    { word: "one", start: 1, end: 1.5 },
    { word: "two", start: 3, end: 3.5 },
  ];
  const b = [
    { word: "two", start: 3.02, end: 3.49 },
    { word: "three", start: 5, end: 5.5 },
  ];
  assert.deepEqual(
    reconcile(a, b, 2, 4).map((w) => w.word),
    ["one", "two", "three"],
  );
  assert.throws(
    () => reconcile(a, [{ word: "too", start: 3, end: 3.5 }], 2, 4),
    { code: "RECONCILIATION" },
  );
  assert.throws(() => reconcile(a, [], 2, 4), { code: "RECONCILIATION" });
});
