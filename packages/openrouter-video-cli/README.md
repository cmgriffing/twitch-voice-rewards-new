# OpenRouter video CLI

Standalone consumer of `@repo/openrouter-video` for Node.js 24+. It starts no existing
server or web application. Build from the repository root:

```sh
pnpm install
pnpm exec turbo build --filter=@repo/openrouter-video-cli
```

## Environment

`packages/openrouter-video-cli/.env.schema` declares `OPENROUTER_API_KEY` as required
and sensitive, plus optional `FFMPEG_PATH` / `FFPROBE_PATH` tool overrides. Put the key
in the gitignored `packages/openrouter-video-cli/.env`:

```sh
OPENROUTER_API_KEY=sk-or-…
```

Invoke the built CLI through `varlock run --inject vars` so the schema is validated and
the resolved variables are injected before the CLI starts. Varlock is a devDependency;
run it with `pnpm exec varlock`, or plain `varlock` where the package's
`node_modules/.bin` is on PATH. From the package directory:

```sh
varlock run --inject vars -- node dist/bin.js --help
```

From the repository root, `--path` points varlock at the package so it finds the
package-local schema and `.env`:

```sh
varlock run --inject vars --path packages/openrouter-video-cli/ -- \
  node packages/openrouter-video-cli/dist/bin.js --help
```

`--inject vars` omits varlock's serialized `__VARLOCK_ENV` config blob, so the
ffmpeg/ffprobe subprocesses the CLI spawns cannot inherit it. Because the key is
`@required`, every wrapped command — including `serve` and `--help` — needs a resolvable
key; varlock exits non-zero before the CLI starts otherwise. Direct
`node dist/bin.js` invocation keeps working with the key exported in the shell, and the
CLI's existing `Set OPENROUTER_API_KEY` check still guards paid commands.

Set `FFMPEG_PATH` / `FFPROBE_PATH` in `.env` when the tools are not on PATH. Pass
`--json` to `models`, `plan`, or `generate` for parseable stdout. Human progress and
errors go to stderr. Errors exit 1; SIGINT aborts local work and exits 130, preserving
known provider job context. It does not claim to cancel an accepted remote job.

## Discover and plan

```sh
varlock run --inject vars --path packages/openrouter-video-cli/ -- \
  node packages/openrouter-video-cli/dist/bin.js models --json
varlock run --inject vars --path packages/openrouter-video-cli/ -- \
  node packages/openrouter-video-cli/dist/bin.js plan \
  --audio narration.wav --model your/model --stt-model openai/whisper-1 \
  --resolution 720p --aspect-ratio 16:9 --fps 24 --json > plan.json
```

Choose advertised shapes, durations, and frame roles from discovery. `--size WIDTHxHEIGHT`
is an alternative to resolution/aspect ratio. Multi-segment sources require `first_frame`.
The plan shows source samples/times, transcript, retained/requested duration, and mode.
Planning calls paid STT and submits no video jobs. `plan.json` is an inspection artifact;
this CLI does not implement render-from-file checkpoints or resume.

For durations `[4,6,8]`, a 5.2-second segment requests 6 seconds, 6.1 requests 8, and a
final 1.2-second segment requests 4. The final segment's extra footage is trimmed; source
silence and original soundtrack timing remain intact. Unknown supplied-audio behavior
uses `transcript` mode, which does not guarantee lip-sync.

Optional STT controls: `--window-seconds 60 --overlap-seconds 2 --max-stt-bytes 20000000
--language en`. Word timings and consistent overlapping transcripts are required.

## Serve assets and establish your tunnel

Start local serving in one terminal:

```sh
varlock run --inject vars --path packages/openrouter-video-cli/ -- \
  node packages/openrouter-video-cli/dist/bin.js serve \
  --asset-dir ./video-assets --port 8080 --prefix /assets
```

In another terminal, use your own tunnel provider to expose port 8080. For example,
an already installed/configured `cloudflared tunnel --url http://127.0.0.1:8080` can
provide a public hostname. The CLI neither installs nor manages the tunnel. Append
`/assets/` to that hostname and verify it serves actual asset bytes without an interstitial.
Keep serving and the tunnel running through every provider job; remote writers can use
signed URLs valid for that lifetime instead. The server supports GET/HEAD, MIME types,
and byte ranges, and confines requests to the asset directory.

## Generate

```sh
varlock run --inject vars --path packages/openrouter-video-cli/ -- \
  node packages/openrouter-video-cli/dist/bin.js generate \
  --audio narration.wav --model your/model --stt-model openai/whisper-1 \
  --resolution 720p --aspect-ratio 16:9 --fps 24 \
  --prompt 'A calm landscape beneath narration.' \
  --asset-dir ./video-assets --base-url https://your-public-host/assets/ \
  --json > result.json
```

Use `--prompt-file prompt.txt` instead of `--prompt` for a file. Optional
`--initial-image https://.../first.png` supplies a publicly reachable initial frame;
the CLI never generates one. `--generate-audio` retains available generated audio in
segment artifacts when supported; the final assembled soundtrack remains the source
audio. `--output final.mp4` copies the final asset to a new caller-selected file and
refuses overwrite. The JSON result includes the final URL, local path, segment assets,
ending frames, effective prompts, and selected modes. It excludes the API key.

Generation replans the source, so STT and video charges may both apply. Submission
responses lost in transit are reported as ambiguous without an automatic replacement
POST. Completed assets remain available after later failures. There is no application
integration or cross-process resume.

Submission errors include OpenRouter's rejection message and selected upstream provider
details in `context.providerError`. `context.submission` identifies the failed request's
model, duration, output shape, and inherited frame URL. Errors remain on stderr even with
`--json`: append `2> generate.log` to capture them separately from `result.json`.
Rerunning `generate` starts a new run and can charge again for completed segments.

Polling allows **20 minutes per segment** by default, including transient status failures
and retry delays. Use `--poll-timeout-seconds 1800` on `generate` to allow 30 minutes per
segment. Temporary network errors, request timeouts, and HTTP 408/429/5xx responses are
retried on the same job with backoff within that budget. Permanent status errors are
reported as `POLL_REQUEST`; `POLL_TIMEOUT` means the per-segment deadline expired.
A status 404 for an accepted job is also retried within that deadline; a persistent
404 is included with the known job ID in the timeout diagnostics.

When an accepted job ends as `failed`, `cancelled`, or `expired`, `JOB_TERMINAL` reports
the status response's error explanation in both the message and `context.jobError`
when available. For example, a no-output/content-filtering failure is reported directly
instead of only saying that the job failed. The explanation is bounded and credentials
are redacted. A terminal job failure does not trigger another paid submission.

For Seedance 2.0, a later submission can reject a photorealistic face in the inherited
frame even when earlier text-to-video generation succeeded. BytePlus documents
[portrait input restrictions](https://docs.byteplus.com/en/docs/modelark/seedance-portrait-asset-guide)
and requires original provider outputs for its trusted-output path. Locally extracted,
re-encoded ending PNGs should not be assumed to qualify. Check the provider error before
changing the prompt or model; an advertised duration alone does not explain a rejection.

See [SDK usage](../openrouter-video/README.md),
[integration evidence](../openrouter-video/docs/integrations.md), and the
[opt-in paid smoke procedure](../openrouter-video/docs/smoke.md).
