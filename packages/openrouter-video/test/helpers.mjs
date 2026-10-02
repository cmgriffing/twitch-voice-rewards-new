import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Media } from "../dist/media.js";
export const fixture = JSON.parse(
  await readFile(
    new URL("./fixtures/openrouter.json", import.meta.url),
    "utf8",
  ),
);
export const output = { size: "160x90", fps: 24 };
export const media = new Media();
export async function temporary(work) {
  const dir = await mkdtemp(join(tmpdir(), "video-test-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
export async function source(dir, seconds = 2.4, extension = "wav") {
  const path = join(dir, `audio.${extension}`);
  await media.ff([
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=733:sample_rate=48000:duration=${seconds}`,
    ...(extension === "mp3" ? ["-c:a", "libmp3lame"] : []),
    path,
  ]);
  return path;
}
export async function clip(dir, extension = "mp4") {
  const path = join(dir, `provider.${extension}`);
  // Red retained content, blue discarded ending; generated soundtrack differs from source.
  await media.ff([
    "-f",
    "lavfi",
    "-i",
    "color=red:size=160x90:rate=24:duration=1.5",
    "-f",
    "lavfi",
    "-i",
    "color=blue:size=160x90:rate=24:duration=0.5",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=199:sample_rate=48000:duration=2",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-map",
    "2:a",
    "-c:v",
    extension === "webm" ? "libvpx-vp9" : "libx264",
    "-c:a",
    extension === "webm" ? "libopus" : "aac",
    path,
  ]);
  return path;
}
export function transport(options = {}) {
  const calls = [],
    submissions = [],
    polls = new Map();
  let sttIndex = 0,
    lost = false,
    pollingError = false,
    downloadError = false;
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetcher = async (request) => {
    const url = new URL(request.url);
    calls.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get("Authorization"),
    });
    if (url.pathname.endsWith("/videos/models"))
      {return json(options.catalog ?? fixture.catalog);}
    if (url.pathname.endsWith("/audio/transcriptions")) {
      const form = await request.formData();
      if (
        form.get("response_format") !== "verbose_json" ||
        form.get("timestamp_granularities[]") !== "word"
      )
        {throw new Error("Missing timing fields");}
      options.onStt?.(form);
      return json(
        options.transcriptions?.[sttIndex++] ?? fixture.transcription,
      );
    }
    if (request.method === "POST" && url.pathname.endsWith("/videos")) {
      const body = await request.json();
      submissions.push(body);
      const response = await options.onSubmit?.(body, submissions.length);
      if (response instanceof Response) {return response;}
      if (options.lostSubmission && !lost) {
        lost = true;
        throw new TypeError("lost response with secret TEST_KEY");
      }
      const id = `fixture-${submissions.length}`;
      return json({ ...fixture.submission, id }, 202);
    }
    if (url.pathname.endsWith("/content")) {
      if (options.transientDownload && !downloadError) {
        downloadError = true;
        return json({ error: { code: 503, message: "temporary" } }, 503);
      }
      if (!options.video) {throw new Error("No fixture video");}
      return new Response(options.video, {
        headers: { "Content-Type": "video/mp4" },
      });
    }
    if (/\/videos\/fixture-\d+$/.test(url.pathname)) {
      if (options.transientPoll && !pollingError) {
        pollingError = true;
        return json({ error: { code: 429, message: "temporary" } }, 429);
      }
      const id = url.pathname.split("/").at(-1),
        count = (polls.get(id) ?? 0) + 1;
      polls.set(id, count);
      const status =
        options.terminal ??
        (count <= (options.pendingPolls ?? 1) ? "in_progress" : "completed");
      options.onPoll?.(id, status);
      return json({ ...fixture.completed, id, status });
    }
    throw new Error(`Unexpected request: ${request.method} ${url}`);
  };
  return { fetcher, calls, submissions, polls };
}
