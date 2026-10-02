import { constants, createReadStream } from "node:fs";
import { mkdir, open, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";

const mime: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
};
export async function serveAssets(options: {
  directory: string;
  port: number;
  prefix?: string;
  host?: string;
  signal?: AbortSignal;
}) {
  if (
    !Number.isInteger(options.port) ||
    options.port < 0 ||
    options.port > 65535
  ) {
    throw new Error("Port must be an integer from 0 through 65535");
  }
  const prefix =
    "/" + (options.prefix ?? "").split("/").filter(Boolean).join("/");
  // eslint-disable-next-line no-control-regex -- control characters are intentionally rejected in route prefixes
  if (prefix.includes("..") || /[\\?#%\x00-\x1f]/.test(prefix)) {
    throw new Error("Invalid route prefix");
  }
  const route = prefix === "/" ? "/" : prefix + "/";
  await mkdir(resolve(options.directory), { recursive: true });
  const root = await realpath(resolve(options.directory));
  const inside = (path: string) =>
    path.startsWith(root.endsWith(sep) ? root : root + sep);
  const server = createServer(async (request, response) => {
    let handle;
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const path = (request.url ?? "").split("?")[0]!;
      if (!path.startsWith(route)) {
        response.writeHead(404).end();
        return;
      }
      const parts = path.slice(route.length).split("/").map(decodeURIComponent);
      if (
        // eslint-disable-next-line no-control-regex -- control characters are intentionally rejected in asset paths
        parts.some((p) => !p || p.startsWith(".") || /[/\\\x00-\x1f]/.test(p))
      ) {
        response.writeHead(403).end();
        return;
      }
      const target = resolve(root, ...parts);
      if (!inside(target) || !inside(await realpath(target))) {
        response.writeHead(403).end();
        return;
      }
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      // Recheck parents after opening and never serve directories or in-progress dotfiles.
      if (!inside(await realpath(target))) {
        response.writeHead(403).end();
        return;
      }
      const info = await handle.stat();
      if (!info.isFile()) {
        response.writeHead(403).end();
        return;
      }
      let start = 0,
        end = info.size - 1;
      const headers: Record<string, string | number> = {
        "Content-Type":
          mime[extname(target).toLowerCase()] ?? "application/octet-stream",
        "Accept-Ranges": "bytes",
        "X-Content-Type-Options": "nosniff",
      };
      if (request.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
        if (!range || (!range[1] && !range[2])) {
          response.writeHead(416).end();
          return;
        }
        if (!range[1]) {
          start = Math.max(0, info.size - Number(range[2]));
        } else {
          start = Number(range[1]);
          if (range[2]) {
            end = Math.min(Number(range[2]), end);
          }
        }
        if (
          start > end ||
          start >= info.size ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end)
        ) {
          response
            .writeHead(416, { "Content-Range": `bytes */${info.size}` })
            .end();
          return;
        }
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
      }
      headers["Content-Length"] = Math.max(0, end - start + 1);
      response.writeHead(request.headers.range ? 206 : 200, headers);
      if (request.method === "HEAD" || !info.size) {
        response.end();
        return;
      }
      await pipeline(
        createReadStream(target, {
          fd: handle.fd,
          autoClose: false,
          start,
          end,
        }),
        response,
      );
    } catch {
      if (!response.headersSent) {
        response.writeHead(404).end();
      } else {
        response.destroy();
      }
    } finally {
      await handle?.close();
    }
  });
  options.signal?.throwIfAborted();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      server.removeListener("error", fail);
      done();
    });
  });
  const close = () => {
    server.close();
    server.closeAllConnections();
  };
  options.signal?.addEventListener("abort", close, { once: true });
  server.once("close", () =>
    options.signal?.removeEventListener("abort", close),
  );
  if (options.signal?.aborted) {
    close();
  }
  return server;
}
