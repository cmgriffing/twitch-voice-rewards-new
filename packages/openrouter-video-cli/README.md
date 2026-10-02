# OpenRouter video CLI

Standalone consumer of `@repo/openrouter-video` for Node.js 24+. It starts no existing
server or web application. Build from the repository root:

```sh
pnpm install
pnpm exec turbo build --filter=@repo/openrouter-video-cli
export OPENROUTER_API_KEY='your-key'
node packages/openrouter-video-cli/dist/bin.js --help
```

Set `FFMPEG_PATH` / `FFPROBE_PATH` when the tools are not on PATH. Pass `--json` to
`models`, `plan`, or `generate` for parseable stdout. Human progress and errors go to
stderr. Errors exit 1; SIGINT aborts local work and exits 130, preserving known provider
job context. It does not claim to cancel an accepted remote job.

## Discover and plan

```sh
node packages/openrouter-video-cli/dist/bin.js models --json
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

See [SDK usage](../openrouter-video/README.md),
[integration evidence](../openrouter-video/docs/integrations.md), and the
[opt-in paid smoke procedure](../openrouter-video/docs/smoke.md).
