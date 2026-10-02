import type { VideoModel } from "@openrouter/sdk/models";
import {
  VideoError,
  type CompatibilityProfile,
  type ModelCapabilities,
  type OutputConfig,
  type SegmentPlan,
  type VideoPlan,
} from "./types.js";

// No native profiles ship until combined input behavior has been verified across available routes.
export const compatibilityProfiles: readonly CompatibilityProfile[] = [];
export function profileFor(
  id: string,
  profiles: readonly CompatibilityProfile[],
) {
  const profile = profiles.find((p) => p.model === id);
  if (
    profile &&
    (!profile.evidence.trim() || profile.scope !== "all-model-routes")
  ) {
    throw new VideoError(
      "CONFIGURATION",
      "Compatibility evidence must cover every model route",
    );
  }
  return profile;
}
export function normalizeModel(
  raw: VideoModel,
  profiles: readonly CompatibilityProfile[],
  allowMissingDurations = false,
): ModelCapabilities {
  const durations = [
    ...new Set(
      (raw.supportedDurations ?? []).filter(
        (n) => Number.isSafeInteger(n) && n > 0,
      ),
    ),
  ].sort((a, b) => a - b);
  if (!durations.length && !allowMissingDurations) {
    throw new VideoError(
      "UNSUPPORTED_MODEL",
      `No usable duration metadata for ${raw.id}`,
    );
  }
  const profile = profileFor(raw.id, profiles);
  return {
    id: raw.id,
    name: raw.name,
    durations,
    sizes: raw.supportedSizes ?? [],
    resolutions: raw.supportedResolutions ?? [],
    aspectRatios: raw.supportedAspectRatios ?? [],
    frameRoles: raw.supportedFrameImages ?? [],
    generateAudio: raw.generateAudio === true,
    passthrough: raw.allowedPassthroughParameters ?? [],
    nativeAudio: profile?.audio ? "verified" : "unknown",
  };
}
export function compatibleDurations(
  model: ModelCapabilities,
  output: OutputConfig,
  profile?: CompatibilityProfile,
): number[] {
  if (!Number.isInteger(output.fps) || output.fps < 1 || output.fps > 120) {
    throw new VideoError(
      "CONFIGURATION",
      "Output fps must be an integer from 1 through 120",
    );
  }
  if (output.size) {
    if (
      output.resolution ||
      output.aspectRatio ||
      !model.sizes.includes(output.size)
    ) {
      throw new VideoError(
        "UNSUPPORTED_MODEL",
        "Unsupported or conflicting output size",
      );
    }
    const dimensions = output.size
      .match(/^(\d+)x(\d+)$/)
      ?.slice(1)
      .map(Number);
    if (!dimensions || dimensions.some((n) => !n || n % 2)) {
      throw new VideoError(
        "CONFIGURATION",
        "Output size must use positive even dimensions",
      );
    }
  } else if (
    !output.resolution ||
    !output.aspectRatio ||
    !model.resolutions.includes(output.resolution) ||
    !model.aspectRatios.includes(output.aspectRatio)
  ) {
    throw new VideoError(
      "UNSUPPORTED_MODEL",
      "Output resolution and aspect ratio need usable catalog metadata",
    );
  }
  let durations = model.durations;
  for (const rule of profile?.constraints ?? []) {
    if (
      (!rule.size || rule.size === output.size) &&
      (!rule.resolution || rule.resolution === output.resolution) &&
      (!rule.aspectRatio || rule.aspectRatio === output.aspectRatio)
    ) {
      durations = durations.filter((d) => rule.durations.includes(d));
    }
  }
  if (!durations.length) {
    throw new VideoError(
      "UNSUPPORTED_MODEL",
      "No durations compatible with output configuration",
    );
  }
  return durations;
}
export function resolveMode(
  model: ModelCapabilities,
  profile: CompatibilityProfile | undefined,
  requiresFrame: boolean,
  hasImage: boolean,
  requested: number,
): Pick<SegmentPlan, "mode" | "fallbackReason"> {
  if (requiresFrame && !model.frameRoles.includes("first_frame")) {
    throw new VideoError(
      "UNSUPPORTED_MODEL",
      "Model lacks enforced first-frame continuity",
    );
  }
  const native = profile?.audio;
  if (
    native &&
    requested <= native.maxSeconds &&
    (!native.durations || native.durations.includes(requested)) &&
    (!requiresFrame || native.firstFrame) &&
    (!native.requiresImage || hasImage)
  ) {
    return { mode: "audio" };
  }
  if (profile?.transcriptRequiresImage && !hasImage) {
    throw new VideoError(
      "UNSUPPORTED_MODEL",
      "Selected route requires an initial image",
    );
  }
  return {
    mode: "transcript",
    fallbackReason: native
      ? "Native input constraints do not support this segment with its required frame and duration"
      : "Supplied-audio compatibility is unverified; transcript context does not guarantee lip-sync",
  };
}
export function revalidate(
  plan: VideoPlan,
  current: ModelCapabilities,
  profile?: CompatibilityProfile,
) {
  try {
    if (current.id !== plan.model.id) {
      throw new Error("model");
    }
    const durations = compatibleDurations(current, plan.output, profile);
    for (const segment of plan.segments) {
      if (!durations.includes(segment.requestedDuration)) {
        throw new Error("duration");
      }
      const mode = resolveMode(
        current,
        profile,
        segment.requiresFrame,
        segment.index > 0 || !!plan.initialImage,
        segment.requestedDuration,
      );
      if (mode.mode !== segment.mode) {
        throw new Error("mode");
      }
    }
  } catch {
    throw new VideoError(
      "STALE_PLAN",
      "Current model capabilities no longer support the plan; replan the source",
    );
  }
}
