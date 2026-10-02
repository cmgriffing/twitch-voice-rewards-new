# Verified integration boundaries

Checked against installed `@openrouter/sdk` **1.3.6** and `node-av` **6.1.1**.
The request/response fixture in [openrouter.json](../test/fixtures/openrouter.json)
is synthetic and contains no credentials or real provider job IDs.

| Operation | SDK call                                                        | Request / response contract                                                                                                |
| --------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Catalog   | `videoGeneration.listVideosModels({}, options)`                 | `GET /videos/models`; `data` uses camelCase SDK properties converted from snake_case JSON                                  |
| STT       | `stt.createTranscriptionMultipart({ requestBody }, options)`    | WAV `file`, model, `responseFormat: 'verbose_json'`, `timestampGranularities: ['word']`; `text`, `words[{word,start,end}]` |
| Submit    | `videoGeneration.generate({ videoGenerationRequest }, options)` | `POST /videos`; model, duration, prompt, shape; frame/audio fields; returns `id`, `pollingUrl`, `status`                   |
| Poll      | `videoGeneration.getGeneration({ jobId }, options)`             | `GET /videos/{jobId}`; pending/in_progress/completed/failed/cancelled/expired                                              |
| Download  | `videoGeneration.getVideoContent({ jobId }, options)`           | Authenticated `GET /videos/{jobId}/content`; `ReadableStream<Uint8Array>`                                                  |

The SDK serializes `frameImages[{type:'image_url', imageUrl:{url}, frameType:'first_frame'}]`
as `frame_images` with `image_url` and `frame_type`. A verified audio route uses
`inputReferences[{type:'audio_url', audioUrl:{url}}]`. Authenticated download uses the
content endpoint rather than trusting an arbitrary provider URL.

SDK retries are disabled for all calls. The library implements bounded GET retries;
it never retries a video POST. Synthetic transport tests inspect authentication,
multipart timing fields, exact serialized frame/audio fields, and job ordering.

Authoritative references:

- [Video model catalog](https://openrouter.ai/docs/api/api-reference/video-generation/list-all-video-generation-models)
- [Submission and input fields](https://openrouter.ai/docs/api/api-reference/video-generation/submit-a-video-generation-request)
- [Job status](https://openrouter.ai/docs/api/api-reference/video-generation/poll-video-generation-status)
- [Authenticated download](https://openrouter.ai/docs/api/api-reference/video-generation/download-generated-video-content)
- [Transcription](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/)

## Native supplied-audio compatibility

No production native profile is enabled. Unknown behavior selects transcript fallback.
Generated audio and supplied audio are distinct capabilities. Catalog frame support
does not establish that audio references and enforced frame images work together.
The [Seedance guide](https://openrouter.ai/blog/insights/seedance-2-5-review/) describes
frame-image precedence over references; it does not justify enabling that combination.

`CompatibilityProfile` permits caller evidence scoped to `all-model-routes`, since the
video API's provider options do not pin routing. Evidence must cover the model's available
routes, enforced first-frame combinations, image requirements, WAV input acceptance,
duration list, maximum reference seconds, and whether request-length silence padding is
required. Output-dependent known duration constraints can restrict the catalog list.
Do not use a provider-specific observation to enable a model with unverified alternate
routes. Runtime provider rejection stops the run and does not trigger a fallback POST.

The test-only `fixture/video` profile proves orchestration mechanics against a controlled
transport. It is not evidence of any real model's lip-sync behavior. `scope` and `evidence`
are caller assertions; the library cannot validate them independently.

## Media toolchain

Local verification uses FFmpeg/FFprobe **7.1.1**. `node-av/ffmpeg` exports `ffmpegPath`,
`isFfmpegAvailable`, and `ffmpegVersion`, with no FFprobe path export in this installation.
Configured paths or PATH are therefore the chosen integration. Argument arrays are
passed to spawned executables without a shell. Preflight verifies executable FFprobe,
required FFmpeg encoders, and filters before paid work.

The fixture with red retained footage and blue discarded padding verifies last-frame
provenance after VP9-to-H.264 conversion. Decoded red pixels remain above 230 in the red
channel and below 20 in green/blue. This is an encoding-tolerant synthetic assertion,
not a byte-equality test or a universal real-provider visual threshold.

Live-smoke status: **not run**. Automated tests consume no OpenRouter credits.
