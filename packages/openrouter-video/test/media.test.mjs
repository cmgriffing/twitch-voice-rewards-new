import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { planSegments, retainedFrameCount } from "../dist/index.js";
import { temporary, media, source, clip, output } from "./helpers.mjs";
const model = {
  id: "test",
  durations: [1],
  sizes: ["160x90"],
  frameRoles: ["first_frame"],
};
test("decoded byte/file input and padded audio preserve reliable source sample offsets", async () =>
  temporary(async (dir) => {
    await media.preflight();
    const file = await source(dir, 2.431);
    const decoded = await media.decode({ path: file }, dir);
    assert.equal(decoded.info.sampleCount, 116688);
    const bytes = await readFile(file);
    const other = await media.workspace((work) =>
      media.decode({ bytes, format: "wav" }, work),
    );
    assert.deepEqual(other.info, decoded.info);
    const cut = join(dir, "cut.wav");
    await media.cutAudio(
      decoded.pcm,
      decoded.info,
      4800,
      28800,
      cut,
      undefined,
      1,
    );
    const probe = await media.probe(cut);
    assert.equal(Number(probe.format.duration), 1);
    const samples = join(dir, "cut.pcm");
    await media.ff(["-i", cut, "-f", "s16le", samples]);
    const cutBytes = await readFile(samples),
      sourceBytes = await readFile(decoded.pcm);
    assert.deepEqual(
      cutBytes.subarray(0, 48000),
      sourceBytes.subarray(9600, 57600),
    );
    assert.ok(cutBytes.subarray(48000).every((n) => n === 0));
  }));
test("ending frame comes from retained red footage, never the blue discarded ending", async () =>
  temporary(async (dir) => {
    const input = await clip(dir, "webm");
    const info = { sampleRate: 48000, sampleCount: 62400, duration: 1.3 };
    const segment = { startSample: 0, endSample: 62400 };
    const retained = join(dir, "segment-0.mp4"),
      ending = join(dir, "ending.png");
    const frames = await media.normalize(
      input,
      retained,
      ending,
      segment,
      info,
      output,
      true,
    );
    assert.equal(frames, 31);
    const pixels = join(dir, "pixels.rgb");
    await media.ff([
      "-i",
      ending,
      "-pix_fmt",
      "rgb24",
      "-f",
      "rawvideo",
      pixels,
    ]);
    const rgb = await readFile(pixels);
    assert.ok(
      rgb[0] > 230 && rgb[1] < 20 && rgb[2] < 20,
      `Expected red, got ${rgb.subarray(0, 3)}`,
    );
    assert.ok(
      (await media.probe(retained)).streams.some(
        (s) => s.codec_type === "audio",
      ),
    );
    await assert.rejects(
      media.normalize(
        input,
        join(dir, "too-long.mp4"),
        join(dir, "long.png"),
        { startSample: 0, endSample: 3 * 48000 },
        { sampleRate: 48000 },
        output,
        false,
      ),
      { code: "MEDIA_DURATION" },
    );
  }));
test("fractional clips assemble to cumulative frame count and original soundtrack once", async () =>
  temporary(async (dir) => {
    const file = await source(dir, 2.431, "mp3");
    const { pcm, info } = await media.decode({ path: file }, dir);
    const words = [{ word: "crossing", start: 0.73, end: 1.1 }];
    const segments = planSegments(info, words, model, output);
    const input = await clip(dir);
    const clips = [];
    for (const segment of segments) {
      const path = join(dir, `segment-${segment.index}.mp4`);
      await media.normalize(
        input,
        path,
        join(dir, `frame-${segment.index}.png`),
        segment,
        info,
        output,
        true,
      );
      clips.push(path);
    }
    assert.equal(segments[1].startSample, segments[0].endSample);
    const final = await media.assemble(clips, pcm, info, output, dir);
    const probe = await media.probe(final, undefined, true);
    const expected = segments.reduce(
      (n, s) => n + retainedFrameCount(s, info.sampleRate, output.fps),
      0,
    );
    assert.equal(
      Number(
        probe.streams.find((s) => s.codec_type === "video").nb_read_frames,
      ),
      expected,
    );
    assert.ok(
      Math.abs(Number(probe.format.duration) - info.duration) < 1 / output.fps,
    );
    const soundtrack = join(dir, "final.pcm");
    await media.ff(["-i", final, "-map", "0:a:0", "-f", "s16le", soundtrack]);
    const a = await readFile(pcm),
      b = await readFile(soundtrack);
    const count = Math.min(a.length, b.length) / 2;
    let dot = 0,
      aa = 0,
      bb = 0;
    for (let i = 2048; i < count - 2048; i++) {
      const x = a.readInt16LE(i * 2),
        y = b.readInt16LE(i * 2);
      dot += x * y;
      aa += x * x;
      bb += y * y;
    }
    assert.ok(
      dot / Math.sqrt(aa * bb) > 0.98,
      "Final soundtrack must match the original 733Hz source, not the provider 199Hz audio",
    );
    assert.ok(
      Math.abs(b.length / 2 / info.sampleRate - info.duration) < 0.025,
      "No duplicated per-segment audio",
    );
  }));
