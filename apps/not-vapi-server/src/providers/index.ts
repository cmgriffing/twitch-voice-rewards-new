import { GenerativeProvider } from "./generative/_common";
import z from "zod";
import { VoiceProviderMethods } from "./voice/_types";
import { GenerativeProviderMethods } from "./generative/_types";

// import { AnthropicProvider } from "./generative/anthropic";
// import { OpenaiProvider } from "./generative/openai";
// import { PerplexityProvider } from "./generative/perplexity";
import { OpenRouterProvider as GenerativeOpenRouterProvider } from "./generative/openrouter";
// import { DeepgramProvider } from "./voice/deepgram";
// import { ElevenLabsProvider } from "./voice/elevenlabs";
// import { PlayhtProvider } from "./voice/playht";
import { OpenRouterFishProvider } from "./voice/openrouter-fish";
import { VoiceProvider } from "./voice/_common";

export const generativeAiProviders = z.enum([
  // "anthropic",
  // "openai",
  // "perplexity",
  "openrouter",
]);

export const voiceAiProviders = z.enum([
  "deepgram",
  "elevenlabs",
  "playht",
  "openRouterFish",
]);

export async function getAiProviders(env: Record<string, string>) {
  const [
    // openai,
    // anthropic,
    // perplexity,
    openrouter,
  ] = await Promise.all([
    // new OpenaiProvider(env).init(),
    // new AnthropicProvider(env).init(),
    // new PerplexityProvider(env).init(),
    new GenerativeOpenRouterProvider(env).init(),
  ]);

  const [
    // deepgram,
    // elevenlabs,
    // playht,
    openRouterFish,
  ] = await Promise.all([
    // new DeepgramProvider(env).init(),
    // new ElevenLabsProvider(env).init(),
    // new PlayhtProvider(env).init(),
    new OpenRouterFishProvider(env).init(),
  ]);

  return {
    generative: {
      // openai,
      // anthropic,
      // perplexity,
      openrouter,
    } as Record<
      z.infer<typeof generativeAiProviders>,
      GenerativeProvider & GenerativeProviderMethods
    >,
    voice: {
      // deepgram,
      // elevenlabs,
      // playht,
      openRouterFish,
    } as Record<
      z.infer<typeof voiceAiProviders>,
      VoiceProvider & VoiceProviderMethods
    >,
  };
}
