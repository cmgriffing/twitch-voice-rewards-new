# OpenRouter audio-to-video SDK

`@repo/openrouter-video` is a standalone Node.js 24+ ESM library. It uses the official
OpenRouter SDK 1.3.6 for STT and asynchronous video jobs. It does not start the existing
applications, an asset server, or a tunnel.

Build from the repository root:

```sh
pnpm install
pnpm exec turbo build --filter=@repo/openrouter-video-cli
```

FFmpeg and FFprobe must be available on PATH. FFmpeg needs libx264, AAC, PCM, and the
standard audio/video filters. `tools: { ffmpeg, ffprobe }` overrides executable paths.
Preflight runs before paid transcription or video requests. Installed `node-av` 6.1.1
exposes `ffmpegPath()` from `node-av/ffmpeg`, but no FFprobe path export; this package
uses explicit executable paths instead of depending on its native bindings.

## Plan, inspect, render

```ts
import {
  OpenRouterVideo,
  createLocalFilesystemAdapter,
} from "@repo/openrouter-video";

const video = new OpenRouterVideo({ apiKey: process.env.OPENROUTER_API_KEY! });
const models = await video.discover();
const selected = models.find((model) => model.id === "your/model")!;

const plan = await video.plan({
  audio: { path: "/absolute/path/narration.wav" },
  model: selected.id,
  sttModel: "openai/whisper-1",
  output: { resolution: "720p", aspectRatio: "16:9", fps: 24 },
  // Optional caller-supplied, publicly downloadable first-frame image:
  // initialImage: 'https://assets.example/initial.png',
});
console.log(plan.segments); // inspect before video charges

const assets = createLocalFilesystemAdapter({
  directory: "./video-assets",
  baseUrl: "https://public.example/assets/",
});
const result = await video.render(plan, {
  assets,
  prompt: "Show a quiet coastal landscape beneath the narration.",
  onProgress: (event) =>
    console.error(event.stage, event.segmentIndex, event.mode, event.jobId),
});
console.log(result.finalVideo, result.segments);
```

Choose a shape advertised by discovery: `size: 'WIDTHxHEIGHT'` or `resolution` plus
`aspectRatio`. Provide a fixed integer output frame rate. The selected model needs
`first_frame` support for a multi-segment source, and also for an optional initial
image. No initial image is generated automatically. Missing metadata is an error.
Discovery can list catalog entries with an empty duration set; selecting one for
planning fails rather than inventing a duration.

Planning may incur STT charges. It decodes file input or `{ bytes: Uint8Array, format:
'wav' }`, records the actual PCM sample timeline and hash, obtains word timestamps,
and returns contiguous word-safe source ranges. It publishes no assets and submits
no video jobs. Empty STT text with no words is treated as no speech; speech without
usable timings fails. Overlapping speech intervals are merged for safe-cut decisions.
If speech leaves no safe cut under the cap, planning identifies the offending interval.

The largest compatible catalog duration caps segmentation. Each segment requests
the smallest advertised duration covering its integer-sample-derived ceiling. For
`[4, 6, 8]`, 5.2 seconds requests 6, 6.1 requests 8, exactly 6 requests 6, and a final
1.2 seconds requests 4. Generated padding is discarded. Leading, trailing, and
inter-word silence remain on the source timeline.

STT defaults to overlapping 60-second windows, a two-second overlap, and a 20 MB
multipart budget. These are configurable batching policies, not an audio-length limit.
Requests use mono 16 kHz WAV and reserve header space beneath the byte budget.
Overlap reconciliation matches ordered words and timestamps with up to 250 ms
variation. Missing, conflicting, or ambiguous overlap words fail explicitly; the SDK
does not guess. See the [OpenRouter STT guide](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/)
for available formats and timing-capable models.

Rendering rechecks current model capabilities and the decoded source fingerprint.
A stale source, changed required capability, or modified timeline requires replanning.
A plan is an inspectable description, not a durable checkpoint; keep the source
available. Byte-input plans retain their bytes in memory and are not JSON file plans.

## Prompts and soundtracks

Both a shared string and an asynchronous callback are supported:

```ts
const result = await video.render(plan, {
  assets,
  prompt: async (context) => {
    console.log(context.transcript, context.previousText, context.nextText);
    console.log(
      context.start,
      context.end,
      context.requestedDuration,
      context.mode,
    );
    console.log(context.previousEndingImage?.url); // available after preceding publication
    return `Continue a calm landscape sequence. Scene ${context.index + 1}.`;
  },
  generateAudio: true, // only when the catalog advertises generated audio
});
```

Context also includes words, full transcript, segment count, source sample offsets,
fallback reason, and the abort signal. In `transcript` mode, the SDK appends delimited
JSON transcript context to your visual prompt. It does not require a talking-head
scene or promise synchronized lips. `audio` mode requires evidence for supplied-audio
conditioning together with the segment's frame requirement. An output-audio flag is
insufficient. This release ships **no verified native audio profiles**; see
[integration notes](docs/integrations.md).

Every later request uses the last decoded frame of the preceding **retained** clip
as `frame_images` with `frame_type: first_frame`. The next job is submitted only
after that clip is downloaded, normalized, trimmed, and its ending image published.
Reference-image guidance is insufficient. This enforces the requested starting frame;
it does not guarantee character identity or seamless motion throughout a provider clip.

Clips are normalized to H.264/yuv420p with fixed dimensions and frame rate. Frame counts
come from cumulative source boundaries, preventing rounding drift. A segment too short
for one scheduled output frame is rejected. Short provider clips fail instead of
stretching audio. Assembly muxes the complete source soundtrack once; a single AAC
transcode preserves content and timing, not compressed byte identity. Final duration
is checked within one output frame.

With `generateAudio`, retained segment MP4 artifacts keep available generated audio.
The assembled final MP4 still uses only the source soundtrack. Sound separation,
generated speech suppression, and automatic effects mixing are outside this release.
Provider options use SDK provider keys, must appear in the catalog's allowed passthrough
fields, and cannot override model, duration, shape, prompt, audio mode, or frame inputs.

## Storage and public serving

The SDK writes run-scoped keys through `AssetStore.write({ key, data, mimeType, signal })`.
It publishes conditioning WAVs when audio mode needs them, ending PNGs, retained MP4s,
and the final MP4. Temporary processing files live in a separate per-operation directory
and are cleaned on success, failure, or cancellation. Published artifacts remain.

Remote writers use a callback without implementing a read operation:

```ts
import { createCallbackAdapter } from "@repo/openrouter-video";

const remoteAssets = createCallbackAdapter(
  async ({ key, data, mimeType, signal }) => {
    // Consume the entire byte stream and await complete publication.
    const uploaded = await yourUploader({
      key,
      data,
      contentType: mimeType,
      signal,
    });
    return { key: uploaded.key, url: uploaded.signedDownloadUrl };
  },
);

const commonBaseAssets = createCallbackAdapter(
  async (input) => {
    await yourUploader(input);
    return { key: input.key };
  },
  { baseUrl: "https://cdn.example/assets/" },
);
```

Return an explicit HTTP(S) URL, or configure a base URL for returned keys. The local
adapter maps `runs/run-1/frame 2.png` beneath `https://example.test/assets/` to
`https://example.test/assets/runs/run-1/frame%202.png`. It atomically publishes complete
files, rejects traversal and symlink escapes, and refuses overwrite. It starts no server.

URLs must be directly downloadable without authentication or an interactive interstitial,
and remain valid through the entire provider job. Signed URLs are supported. Syntax
validation does not prove external reachability. Callers own serving, tunnels, and URL
lifetimes. [The CLI](../openrouter-video-cli/README.md) can serve the local asset directory.

## Progress, cancellation, and failures

Pass `signal` and `onProgress` to planning, rendering, or `generate(input, renderOptions)`.
Callbacks must consume streams completely and should honor the signal. Progress
includes operation run ID, stage, segment index/count, completed count, mode, and known
job ID/status. No provider percentage is invented. Completion occurs after final
publication and temporary cleanup.

Catch `VideoError` and inspect `code` and safe `context`: stage, run/segment/job IDs,
published assets, completed segments, and relevant source intervals. Submission failures
also include `submission` (model, requested duration, output shape, first-frame URL) and
`providerError` (HTTP status, error code/message, and available upstream provider
code/message). Provider messages are bounded and credentials are redacted; SDK transport
objects, headers, and complete response bodies are excluded. Your prompt/transcript
and asset URLs are part of results; signed URL query parameters should be treated as
access grants when sharing results.

Terminal jobs (`failed`, `cancelled`, `expired`) stop the run as `JOB_TERMINAL`.
When the status response includes an `error` string, its bounded, credential-redacted
explanation is included in the error message and `context.jobError`. A terminal job
with no explanation retains the status-only message. No replacement job is submitted.

Polling defaults to a **20-minute budget per segment** (`pollTimeoutMs`), including
status requests and retry delays. Pending/in-progress jobs and transient status failures
(network errors, request timeouts, HTTP 408/429/5xx) continue within that budget. A 404
from the status endpoint for an accepted job is also retried within the same budget,
allowing for delayed job visibility. If it stays missing, the timeout preserves the
job ID and last 404 in `context.providerError`. This does not retry 404s on other endpoints.
Each status burst uses `retries` (default 3); exhausted bursts back off up to 30 seconds and
continue checking the same job. Successful status responses restore `pollIntervalMs`
(default 2 seconds). The deadline also stops an in-flight status request or retry wait.
`POLL_TIMEOUT` means the budget expired; non-retryable status errors stop immediately
as `POLL_REQUEST`, with available redacted details in `context.providerError`.
To allow 30 minutes per segment, use `new OpenRouterVideo({ apiKey, pollTimeoutMs: 30 * 60_000 })`.

Authenticated content-download retries are bounded and target the same job.
Submission POSTs have SDK retries disabled. A lost or undecodable submission response
is `AMBIGUOUS_SUBMISSION`; investigate the provider before intentionally starting a new
run. Cancellation stops local processes and future submissions, with known job context;
an accepted remote job may still run. There is no automatic replacement POST or resume.

## Verification

```sh
pnpm exec turbo build typecheck test --filter=@repo/openrouter-video --filter=@repo/openrouter-video-cli
```

Tests use credential-free controlled OpenRouter responses and deterministic FFmpeg
fixtures. The CLI tests bind temporary localhost ports. Fixture coverage includes
retained/discarded frame colors, WAV/MP3/WebM inputs, fractional timing, an original
soundtrack frequency marker, bounded STT windows, storage failures, retries, and abort.
For paid provider verification, use the explicit [smoke procedure](docs/smoke.md).
