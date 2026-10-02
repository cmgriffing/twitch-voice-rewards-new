import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createCallbackAdapter,
  createLocalFilesystemAdapter,
} from "../dist/index.js";
import { temporary } from "./helpers.mjs";
const bytes = new Uint8Array([1, 2, 3]);
test("callback supports signed URLs and returned keys under a prefixed base", async () => {
  const writer = async (input) => {
    const received = [];
    for await (const part of input.data) received.push(...part);
    assert.deepEqual(received, [1, 2, 3]);
    return { key: "remote", url: "https://cdn.test/remote?signature=test" };
  };
  const direct = createCallbackAdapter(writer);
  assert.equal(
    (
      await direct.write({
        key: "input",
        data: (async function* () {
          yield bytes;
        })(),
        mimeType: "image/png",
      })
    ).url,
    "https://cdn.test/remote?signature=test",
  );
  const base = createCallbackAdapter(
    async () => ({ key: "runs/run-1/frame 2.png" }),
    { baseUrl: "https://example.test/assets/" },
  );
  assert.equal(
    (await base.write({ key: "input", data: bytes, mimeType: "image/png" }))
      .url,
    "https://example.test/assets/runs/run-1/frame%202.png",
  );
  await assert.rejects(
    createCallbackAdapter(async () => ({})).write({
      key: "x",
      data: bytes,
      mimeType: "audio/wav",
    }),
    { code: "ASSET_URL" },
  );
});
test("local adapter publishes complete files atomically and keeps concurrent runs separate", async () =>
  temporary(async (dir) => {
    const store = createLocalFilesystemAdapter({
      directory: dir,
      baseUrl: "https://test.example/assets",
    });
    await Promise.all(
      ["a", "b"].map((id) =>
        store.write({
          key: `runs/${id}/frame 2.png`,
          data: bytes,
          mimeType: "image/png",
        }),
      ),
    );
    assert.deepEqual(
      await readFile(join(dir, "runs/a/frame 2.png")),
      Buffer.from(bytes),
    );
    assert.deepEqual(await readdir(join(dir, "runs")), ["a", "b"]);
    const incomplete = async function* () {
      yield bytes;
      throw new Error("failed stream");
    };
    await assert.rejects(
      store.write({
        key: "runs/a/incomplete.mp4",
        data: incomplete(),
        mimeType: "video/mp4",
      }),
      { code: "STORAGE" },
    );
    assert.deepEqual(await readdir(join(dir, "runs/a")), ["frame 2.png"]);
  }));
test("local confinement rejects traversal, absolute keys, symlinks, and overwrite", async () =>
  temporary(async (dir) => {
    const root = join(dir, "root"),
      outside = join(dir, "outside");
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, "escape"));
    const store = createLocalFilesystemAdapter({
      directory: root,
      baseUrl: "https://test.example",
    });
    for (const key of [
      "../secret",
      "/outside",
      "x/../outside",
      "x\\outside",
      "escape/file.mp4",
      "C:/outside",
    ])
      await assert.rejects(
        store.write({ key, data: bytes, mimeType: "video/mp4" }),
        { code: "STORAGE" },
      );
    await symlink(join(outside, "file"), join(root, "link"));
    await assert.rejects(
      store.write({ key: "link", data: bytes, mimeType: "video/mp4" }),
      { code: "STORAGE" },
    );
    assert.deepEqual(await readdir(outside), []);
    await store.write({ key: "okay", data: bytes, mimeType: "video/mp4" });
    await assert.rejects(
      store.write({ key: "okay", data: bytes, mimeType: "video/mp4" }),
      { code: "STORAGE" },
    );
  }));
test("URL configuration is validated before filesystem mutation", () => {
  assert.throws(
    () =>
      createLocalFilesystemAdapter({
        directory: "/unused",
        baseUrl: "file:///tmp",
      }),
    { code: "ASSET_URL" },
  );
  assert.throws(
    () =>
      createLocalFilesystemAdapter({
        directory: "/unused",
        baseUrl: "https://user:password@example.test",
      }),
    { code: "ASSET_URL" },
  );
});
