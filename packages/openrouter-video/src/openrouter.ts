import { OpenRouter } from "@openrouter/sdk";
import { HTTPClient, type Fetcher } from "@openrouter/sdk/lib/http.js";
import type { VideoGenerationRequest } from "@openrouter/sdk/models";
import type { RequestOptions } from "@openrouter/sdk/lib/sdks.js";
import type { ProviderErrorDetails } from "./types.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function jsonRecord(value: unknown) {
  if (typeof value !== "string") {
    return record(value);
  }
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export class Router {
  private readonly sdk: OpenRouter;
  constructor(
    private readonly apiKey: string,
    fetcher?: Fetcher,
  ) {
    this.sdk = new OpenRouter({
      apiKey,
      httpClient: fetcher ? new HTTPClient({ fetcher }) : undefined,
    });
  }
  errorMessage(value: unknown): string | undefined {
    return typeof value === "string"
      ? value
          .split(this.apiKey)
          .join("[REDACTED]")
          .replace(/\bsk-or-[\w-]+/g, "[REDACTED]")
          .replace(/\bBearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2048) || undefined
      : undefined;
  }
  errorDetails(error: unknown): ProviderErrorDetails | undefined {
    const status = httpStatus(error);
    if (status === undefined) {
      return undefined;
    }
    const failure = record(error);
    const body = jsonRecord(failure?.body);
    const data = record(failure?.error) ?? record(body?.error) ?? body;
    const metadata = record(data?.metadata);
    const raw = jsonRecord(metadata?.raw);
    // Some routes wrap the upstream JSON in "HTTP 400: {...}" instead of metadata.raw.
    const embedded =
      typeof data?.message === "string"
        ? jsonRecord(data.message.replace(/^HTTP \d{3}:\s*/, ""))
        : undefined;
    const provider =
      record(raw?.error) ?? raw ?? record(embedded?.error) ?? embedded;
    const message = (value: unknown) => this.errorMessage(value);
    const code = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value)
        ? value
        : message(value)?.slice(0, 256);
    return {
      status,
      code: code(data?.code),
      message: message(data?.message),
      providerName: message(metadata?.provider_name),
      providerCode: code(provider?.code),
      providerMessage: message(provider?.message),
    };
  }
  options(signal?: AbortSignal): RequestOptions {
    return { signal, retries: { strategy: "none" }, timeoutMs: 60_000 };
  }
  async models(signal?: AbortSignal) {
    return (
      await this.sdk.videoGeneration.listVideosModels({}, this.options(signal))
    ).data;
  }
  transcribe(
    bytes: Uint8Array,
    model: string,
    language?: string,
    signal?: AbortSignal,
  ) {
    return this.sdk.stt.createTranscriptionMultipart(
      {
        requestBody: {
          model,
          file: { fileName: "window.wav", content: bytes },
          responseFormat: "verbose_json",
          timestampGranularities: ["word"],
          language,
        },
      },
      this.options(signal),
    );
  }
  submit(request: VideoGenerationRequest, signal?: AbortSignal) {
    return this.sdk.videoGeneration.generate(
      { videoGenerationRequest: request },
      this.options(signal),
    );
  }
  status(jobId: string, signal?: AbortSignal) {
    return this.sdk.videoGeneration.getGeneration(
      { jobId },
      this.options(signal),
    );
  }
  download(jobId: string, signal?: AbortSignal) {
    return this.sdk.videoGeneration.getVideoContent(
      { jobId },
      this.options(signal),
    );
  }
}
export function httpStatus(error: unknown): number | undefined {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
  ) {
    return error.statusCode;
  }
  return undefined;
}
export function retryable(error: unknown) {
  const status = httpStatus(error);
  if (status !== undefined) {
    return status === 408 || status === 429 || status >= 500;
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      [
        "ConnectionError",
        "RequestTimeoutError",
        "UnexpectedClientError",
      ].includes(error.name))
  );
}
