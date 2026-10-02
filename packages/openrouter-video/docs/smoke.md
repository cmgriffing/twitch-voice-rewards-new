# Opt-in paid OpenRouter smoke procedure

Status at implementation: **not run**. Controlled SDK and media tests are not a live
provider result. This procedure requires credentials, credits, an audio recording
longer than the chosen model's maximum compatible clip duration, and your own public
asset hosting. Running it incurs STT and video charges.

1. Build both packages and discover live capabilities. Select a model supporting
   `first_frame`, word-timing STT, and an advertised output shape. Use a short recording
   requiring two segments; retain the input for soundtrack comparison.
2. Start the CLI static server for an empty asset directory, and establish a tunnel
   yourself. Verify the resulting hostname serves bytes without authentication or an
   interstitial. Keep it alive throughout all jobs. The public base must include your
   route prefix, such as `/assets/`.
3. Run the opt-in script from the repository root:

   ```sh
   export OPENROUTER_API_KEY='your-key'
   OPENROUTER_VIDEO_SMOKE=1 node packages/openrouter-video/scripts/smoke.mjs \
     --audio narration.wav --model your/model --stt-model openai/whisper-1 \
     --resolution 720p --aspect-ratio 16:9 --fps 24 \
     --asset-dir ./video-assets --base-url https://your-public-host/assets/ \
     > smoke-report.json
   ```

   Without `OPENROUTER_VIDEO_SMOKE=1`, the script exits without network calls.
   It plans first and refuses video generation if fewer than two segments result.
   STT can already have been charged at that point. It uses default transcript fallback
   and records the requested versus retained durations and modes.

4. The script independently checks unauthenticated public GETs, MIME types, and asset
   hashes before returning stored descriptors. It records credential-free video bodies
   and verifies the selected model and duration for every request. Every later request
   must use the preceding retained ending PNG as an enforced `first_frame` and omit
   unverified audio references. It independently decodes the last retained frame from
   each published segment and compares its RGB pixels to the inherited PNG. Final
   decoded frame count must match the cumulative schedule, duration must be within one
   output frame, and a final audio stream must exist.
5. Download the final public URL, play source and output, and listen for complete speech,
   leading/trailing silence, and seam timing. Inspect each segment's initial frame against
   its inherited ending PNG and view the final video. Provider encoding can change pixels;
   record measured/perceptual differences and your acceptance tolerance. The automated
   red/blue fixture tolerates encoded color differences (red >230, other channels <20);
   that fixture does not establish a universal tolerance for real generated images.
6. Keep the report with the date, SDK/model IDs, request durations, asset reachability,
   frame comparisons, audio observations, and outcome. Share carefully: transcripts,
   prompts, and public/signed asset URLs are included. No Authorization header is recorded.
   Update the integration notes only with actual observed evidence. A successful transcript
   smoke does not establish native supplied-audio compatibility.

SIGINT stops local work. Accepted remote jobs can continue. On an ambiguous submission
outcome, investigate the account's existing job before intentionally issuing a new paid
run. Completed published files remain. There is no automatic checkpoint or resume.
