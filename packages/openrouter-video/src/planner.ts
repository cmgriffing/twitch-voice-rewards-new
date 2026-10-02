import { resolveMode, compatibleDurations } from "./capabilities.js";
import {
  VideoError,
  type CompatibilityProfile,
  type ModelCapabilities,
  type OutputConfig,
  type SegmentPlan,
  type SourceInfo,
  type Word,
} from "./types.js";

export function validateWords(
  text: string,
  words: Word[] | undefined,
  duration: number,
): Word[] {
  if (text.trim() && !words?.length) {
    throw new VideoError(
      "TRANSCRIPTION_TIMING",
      "Speech text has no usable word timings",
    );
  }
  let previousStart = -1;
  for (const w of words ?? []) {
    if (
      !w.word.trim() ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < 0 ||
      // Zero-length intervals are harmless to word-safe cutting; only inverted ones are invalid.
      w.end < w.start ||
      w.end > duration ||
      w.start < previousStart
    ) {
      throw new VideoError(
        "TRANSCRIPTION_TIMING",
        "Invalid or unordered word interval",
        { interval: { start: w.start, end: w.end } },
      );
    }
    previousStart = w.start;
  }
  if (!text.trim() && words?.length) {
    throw new VideoError(
      "TRANSCRIPTION_TIMING",
      "Word timings contradict the empty transcript",
    );
  }
  return words ?? [];
}
export function planSegments(
  source: SourceInfo,
  words: Word[],
  model: ModelCapabilities,
  output: OutputConfig,
  initialImage?: string,
  profile?: CompatibilityProfile,
): SegmentPlan[] {
  const { sampleCount, sampleRate } = source;
  if (
    !Number.isSafeInteger(sampleCount) ||
    sampleCount <= 0 ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate <= 0
  ) {
    throw new VideoError(
      "SEGMENTATION",
      "Source audio must contain a positive sample timeline",
    );
  }
  validateWords(
    words.map((w) => w.word).join(" "),
    words,
    sampleCount / sampleRate,
  );
  const durations = compatibleDurations(model, output, profile);
  if (initialImage && !model.frameRoles.includes("first_frame")) {
    throw new VideoError(
      "UNSUPPORTED_MODEL",
      "Model cannot accept the supplied first-frame image",
    );
  }
  const max = durations[durations.length - 1]! * sampleRate;
  // Union genuinely overlapping words. Compare raw sample positions so that
  // rounding outwards cannot turn back-to-back words into a fake chain of
  // overlaps across continuous speech.
  const intervals: { start: number; end: number }[] = [];
  for (const w of words) {
    const start = w.start * sampleRate;
    const end = w.end * sampleRate;
    const last = intervals[intervals.length - 1];
    if (last && start < last.end) {
      last.end = Math.max(last.end, end);
    } else {
      intervals.push({ start, end });
    }
  }
  const result: SegmentPlan[] = [];
  let startSample = 0;
  while (startSample < sampleCount) {
    let endSample = Math.min(sampleCount, startSample + max);
    const crossing = intervals.find(
      (w) => w.start < endSample && w.end > endSample,
    );
    if (crossing) {
      endSample = Math.floor(crossing.start);
    }
    if (endSample <= startSample) {
      throw new VideoError(
        "SEGMENTATION",
        "No word-safe cut exists beneath the model cap",
        {
          interval: {
            start: crossing!.start / sampleRate,
            end: crossing!.end / sampleRate,
          },
        },
      );
    }
    const requestedDuration = durations.find(
      (d) => d >= Math.ceil((endSample - startSample) / sampleRate),
    )!;
    const segmentWords = words.filter(
      (w) =>
        Math.floor(w.start * sampleRate) >= startSample &&
        Math.ceil(w.end * sampleRate) <= endSample,
    );
    const index = result.length;
    const requiresFrame = index > 0 || !!initialImage;
    result.push({
      index,
      startSample,
      endSample,
      start: startSample / sampleRate,
      end: endSample / sampleRate,
      retainedDuration: (endSample - startSample) / sampleRate,
      requestedDuration,
      words: segmentWords,
      transcript: segmentWords.map((w) => w.word).join(" "),
      requiresFrame,
      ...resolveMode(
        model,
        profile,
        requiresFrame,
        requiresFrame,
        requestedDuration,
      ),
    });
    startSample = endSample;
  }
  return result;
}
export function retainedFrameCount(
  segment: SegmentPlan,
  sampleRate: number,
  fps: number,
) {
  return (
    Math.round((segment.endSample * fps) / sampleRate) -
    Math.round((segment.startSample * fps) / sampleRate)
  );
}
