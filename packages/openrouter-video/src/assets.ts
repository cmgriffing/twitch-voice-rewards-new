import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, realpath, link, rm, open } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  VideoError,
  type AssetData,
  type AssetDescriptor,
  type AssetStore,
  type AssetWriter,
} from "./types.js";

export function publicUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      throw new Error();
    }
    return url.href;
  } catch {
    throw new VideoError(
      "ASSET_URL",
      "Assets require an absolute HTTP(S) URL without embedded credentials",
    );
  }
}
export function keyParts(key: string) {
  const parts = key.split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[\\\x00-\x1f]/.test(p) ||
        p.startsWith("."),
    ) ||
    /^[A-Za-z]:/.test(key)
  )
    throw new VideoError("STORAGE", "Invalid or escaping asset key", {
      assetKey: key,
    });
  return parts;
}
export function assetUrl(baseUrl: string, key: string) {
  const base = new URL(publicUrl(baseUrl));
  if (base.search || base.hash)
    throw new VideoError(
      "ASSET_URL",
      "A public base URL cannot contain a query or fragment",
    );
  base.pathname =
    base.pathname.replace(/\/?$/, "/") +
    keyParts(key).map(encodeURIComponent).join("/");
  return base.href;
}
export function dataStream(data: AssetData): Readable {
  if (data instanceof Uint8Array) return Readable.from([data]);
  if (data instanceof ReadableStream)
    return Readable.fromWeb(
      data as import("node:stream/web").ReadableStream<Uint8Array>,
    );
  return Readable.from(data);
}
export function createCallbackAdapter(
  writer: AssetWriter,
  options: { baseUrl?: string } = {},
): AssetStore {
  if (options.baseUrl) {
    assetUrl(options.baseUrl, "preflight");
  }
  return {
    async write(input) {
      input.signal?.throwIfAborted();
      const stored = await writer(input);
      const key = stored.key ?? input.key;
      const url = stored.url
        ? publicUrl(stored.url)
        : options.baseUrl
          ? assetUrl(options.baseUrl, key)
          : undefined;
      if (!url) {
        throw new VideoError(
          "ASSET_URL",
          "Writer returned no URL and no public base URL is configured",
          { assetKey: input.key },
        );
      }
      input.signal?.throwIfAborted();
      return { key, url, mimeType: input.mimeType };
    },
  };
}
export function beneath(root: string, target: string) {
  return target.startsWith(root.endsWith(sep) ? root : root + sep);
}
export function createLocalFilesystemAdapter(options: {
  directory: string;
  baseUrl: string;
}): AssetStore {
  assetUrl(options.baseUrl, "preflight");
  const configuredRoot = resolve(options.directory);
  return {
    async write(input): Promise<AssetDescriptor> {
      input.signal?.throwIfAborted();
      const parts = keyParts(input.key);
      await mkdir(configuredRoot, { recursive: true });
      const root = await realpath(configuredRoot);
      let parent = root;
      for (const part of parts.slice(0, -1)) {
        parent = join(parent, part);
        await mkdir(parent).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== "EEXIST") throw e;
        });
        const stat = await lstat(parent);
        if (
          stat.isSymbolicLink() ||
          !stat.isDirectory() ||
          !beneath(root, await realpath(parent))
        ) {
          throw new VideoError(
            "STORAGE",
            "Asset parent is a symlink or escapes the root",
            { assetKey: input.key },
          );
        }
      }
      const target = join(parent, parts[parts.length - 1]!);
      if (!beneath(root, target))
        throw new VideoError("STORAGE", "Asset escapes root", {
          assetKey: input.key,
        });
      const temporary = join(dirname(target), `.upload-${randomUUID()}`);
      try {
        const handle = await open(
          temporary,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        await pipeline(dataStream(input.data), handle.createWriteStream(), {
          signal: input.signal,
        });
        const realParent = await realpath(parent);
        if (
          (realParent !== root && !beneath(root, realParent)) ||
          (await lstat(parent)).isSymbolicLink()
        )
          throw new VideoError("STORAGE", "Asset parent changed while writing");
        // A hard link publishes the completed file atomically without replacing existing files or links.
        await link(temporary, target);
        return {
          key: input.key,
          mimeType: input.mimeType,
          url: assetUrl(options.baseUrl, input.key),
        };
      } catch (error) {
        if (error instanceof VideoError) throw error;
        throw new VideoError("STORAGE", "Asset write failed", {
          assetKey: input.key,
        });
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
export function fileAsset(path: string) {
  return createReadStream(path);
}
