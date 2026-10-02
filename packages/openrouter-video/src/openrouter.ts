import { OpenRouter } from "@openrouter/sdk";
import { HTTPClient, type Fetcher } from "@openrouter/sdk/lib/http.js";
import type { VideoGenerationRequest } from "@openrouter/sdk/models";
import type { RequestOptions } from "@openrouter/sdk/lib/sdks.js";

export class Router {
  private readonly sdk: OpenRouter;
  constructor(apiKey: string, fetcher?: Fetcher) {
    this.sdk = new OpenRouter({
      apiKey,
      httpClient: fetcher ? new HTTPClient({ fetcher }) : undefined,
    });
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
