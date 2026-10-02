export type GenerationMode = "audio" | "transcript";
export type AudioInput =
  | { path: string }
  | { bytes: Uint8Array; format: string };
export interface Word {
  word: string;
  start: number;
  end: number;
}
export interface OutputConfig {
  /** Choose size OR resolution + aspectRatio. */
  size?: string;
  resolution?: string;
  aspectRatio?: string;
  fps: number;
}
export interface ModelCapabilities {
  id: string;
  name: string;
  durations: number[];
  sizes: string[];
  resolutions: string[];
  aspectRatios: string[];
  frameRoles: string[];
  generateAudio: boolean;
  passthrough: string[];
  nativeAudio: "verified" | "unknown";
}
/** Evidence must cover every route available for this model: the video API cannot pin a provider. */
export interface CompatibilityProfile {
  model: string;
  evidence: string;
  scope: "all-model-routes";
  transcriptRequiresImage?: boolean;
  audio?: {
    firstFrame: boolean;
    requiresImage: boolean;
    durations?: number[];
    maxSeconds: number;
    padToRequest: boolean;
    format: "wav";
  };
  constraints?: {
    resolution?: string;
    size?: string;
    aspectRatio?: string;
    durations: number[];
  }[];
}
export interface SourceInfo {
  sampleRate: number;
  channels: number;
  sampleCount: number;
  duration: number;
  format: string;
  /** Hash of decoded PCM; verifies that rendering uses the planned source. */
  sha256: string;
}
export interface SegmentPlan {
  index: number;
  startSample: number;
  endSample: number;
  start: number;
  end: number;
  retainedDuration: number;
  requestedDuration: number;
  words: Word[];
  transcript: string;
  mode: GenerationMode;
  fallbackReason?: string;
  requiresFrame: boolean;
}
export interface VideoPlan {
  version: 1;
  source: AudioInput;
  sourceInfo: SourceInfo;
  model: ModelCapabilities;
  sttModel: string;
  output: OutputConfig;
  initialImage?: string;
  transcript: string;
  words: Word[];
  segments: SegmentPlan[];
}
export type AssetData =
  | Uint8Array
  | AsyncIterable<Uint8Array>
  | ReadableStream<Uint8Array>;
export interface AssetWrite {
  key: string;
  data: AssetData;
  mimeType: string;
  signal?: AbortSignal;
}
export interface AssetDescriptor {
  key: string;
  url: string;
  mimeType: string;
}
export interface AssetStore {
  write(input: AssetWrite): Promise<AssetDescriptor>;
}
export type AssetWriter = (
  input: AssetWrite,
) => Promise<{ key?: string; url?: string }>;
export interface SegmentPromptContext extends SegmentPlan {
  signal?: AbortSignal;
  count: number;
  fullTranscript: string;
  previousText?: string;
  nextText?: string;
  previousEndingImage?: AssetDescriptor;
}
export type Prompt =
  | string
  | ((context: SegmentPromptContext) => string | Promise<string>);
export type Stage =
  | "discovery"
  | "probing"
  | "transcription"
  | "planning"
  | "publication"
  | "submission"
  | "polling"
  | "download"
  | "trim"
  | "frame"
  | "assembly"
  | "completion"
  | "failure";
export interface ProgressEvent {
  runId: string;
  stage: Stage;
  completedSegments: number;
  segmentIndex?: number;
  segmentCount?: number;
  mode?: GenerationMode;
  fallbackReason?: string;
  requestedDuration?: number;
  jobId?: string;
  jobStatus?: string;
}
export interface OperationOptions {
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}
export interface TranscriptionOptions {
  windowSeconds?: number;
  overlapSeconds?: number;
  maxBytes?: number;
  language?: string;
}
export interface PlanInput extends OperationOptions {
  audio: AudioInput;
  model: string;
  sttModel: string;
  output: OutputConfig;
  initialImage?: string;
  transcription?: TranscriptionOptions;
}
export interface RenderOptions extends OperationOptions {
  assets: AssetStore;
  prompt: Prompt;
  generateAudio?: boolean;
  /** Provider SDK keys; fields must be advertised by the catalog and cannot override pipeline inputs. */
  providerOptions?: Record<string, Record<string, unknown>>;
  seed?: number;
}
export interface SegmentResult {
  plan: SegmentPlan;
  jobId: string;
  effectivePrompt: string;
  mode: GenerationMode;
  video: AssetDescriptor;
  endingImage: AssetDescriptor;
  conditioningAudio?: AssetDescriptor;
  retainedFrames: number;
}
export interface GenerationResult {
  runId: string;
  finalVideo: AssetDescriptor;
  segments: SegmentResult[];
  model: ModelCapabilities;
  sourceInfo: SourceInfo;
  output: OutputConfig;
}
export type ErrorCode =
  | "CONFIGURATION"
  | "TOOLCHAIN"
  | "DISCOVERY"
  | "UNSUPPORTED_MODEL"
  | "TRANSCRIPTION"
  | "TRANSCRIPTION_TIMING"
  | "RECONCILIATION"
  | "SEGMENTATION"
  | "STALE_PLAN"
  | "ASSET_URL"
  | "STORAGE"
  | "MEDIA"
  | "MEDIA_DURATION"
  | "PROMPT"
  | "SUBMISSION"
  | "AMBIGUOUS_SUBMISSION"
  | "JOB_TERMINAL"
  | "POLL_TIMEOUT"
  | "DOWNLOAD"
  | "CANCELLED";
export interface FailureContext {
  runId?: string;
  stage?: Stage;
  segmentIndex?: number;
  jobId?: string;
  jobStatus?: string;
  assetKey?: string;
  interval?: { start: number; end: number };
  completedSegments?: SegmentResult[];
  publishedAssets?: AssetDescriptor[];
}
export class VideoError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly context: FailureContext = {},
  ) {
    super(message);
    this.name = "VideoError";
  }
}
