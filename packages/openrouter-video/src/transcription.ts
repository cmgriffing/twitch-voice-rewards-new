import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  VideoError,
  type SourceInfo,
  type TranscriptionOptions,
  type Word,
} from "./types.js";
import { validateWords } from "./planner.js";
import type { Media } from "./media.js";
import type { Router } from "./openrouter.js";

const token = (word: string) =>
  word
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .trim();
export function reconcile(
  previous: Word[],
  next: Word[],
  windowStart: number,
  previousEnd: number,
): Word[] {
  const left = previous.filter((w) => w.end > windowStart);
  const right = next.filter((w) => w.start < previousEnd);
  if (
    left.length !== right.length ||
    left.some(
      (w, i) =>
        token(w.word) !== token(right[i]!.word) ||
        Math.abs(w.start - right[i]!.start) > 0.25 ||
        Math.abs(w.end - right[i]!.end) > 0.25,
    )
  ) {
    throw new VideoError(
      "RECONCILIATION",
      "Overlapping transcription words cannot be reconciled unambiguously",
      { interval: { start: windowStart, end: previousEnd } },
    );
  }
  const merged = [...previous, ...next.slice(right.length)];
  for (let i = 1; i < merged.length; i++)
    if (merged[i]!.start < merged[i - 1]!.start)
      throw new VideoError(
        "RECONCILIATION",
        "Reconciled timings are unordered",
      );
  return merged;
}
export async function transcribe(
  router: Router,
  media: Media,
  pcm: string,
  info: SourceInfo,
  directory: string,
  model: string,
  options: TranscriptionOptions = {},
  signal?: AbortSignal,
  onWindow?: () => void,
) {
  const windowSeconds = options.windowSeconds ?? 60,
    overlapSeconds = options.overlapSeconds ?? 2,
    maxBytes = options.maxBytes ?? 20_000_000;
  if (
    !Number.isFinite(windowSeconds) ||
    windowSeconds <= 0 ||
    !Number.isFinite(overlapSeconds) ||
    overlapSeconds < 0 ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 4096 ||
    maxBytes > 24_000_000
  )
    throw new VideoError(
      "CONFIGURATION",
      "Invalid transcription window or multipart byte budget",
    );
  // Mono 16kHz PCM WAV: reserve space for WAV and multipart headers.
  const seconds = Math.min(windowSeconds, (maxBytes - 2048) / 32000);
  const windowSamples = Math.floor(seconds * info.sampleRate),
    overlapSamples = Math.floor(overlapSeconds * info.sampleRate);
  if (windowSamples <= overlapSamples || windowSamples < 1)
    throw new VideoError(
      "CONFIGURATION",
      "Transcription budget must exceed its overlap",
    );
  let start = 0,
    previousEnd = 0,
    words: Word[] = [],
    batch = 0;
  while (start < info.sampleCount) {
    signal?.throwIfAborted();
    const end = Math.min(start + windowSamples, info.sampleCount);
    const path = join(directory, `stt-${batch}.wav`);
    await media.cutAudio(pcm, info, start, end, path, signal, undefined, true);
    if ((await stat(path)).size + 1024 > maxBytes)
      throw new VideoError(
        "CONFIGURATION",
        "Transcription payload exceeds its configured budget",
      );
    onWindow?.();
    let response;
    try {
      response = await router.transcribe(
        await readFile(path),
        model,
        options.language,
        signal,
      );
    } catch {
      signal?.throwIfAborted();
      throw new VideoError("TRANSCRIPTION", "OpenRouter transcription failed");
    }
    const local = validateWords(
      response.text,
      response.words,
      (end - start) / info.sampleRate,
    );
    const offset = start / info.sampleRate;
    const shifted = local.map((w) => ({
      ...w,
      start: w.start + offset,
      end: w.end + offset,
    }));
    words = batch
      ? reconcile(words, shifted, offset, previousEnd / info.sampleRate)
      : shifted;
    if (end === info.sampleCount) break;
    previousEnd = end;
    start = end - overlapSamples;
    batch++;
  }
  const text = words.map((w) => w.word).join(" ");
  validateWords(text, words, info.duration);
  return { text, words };
}
