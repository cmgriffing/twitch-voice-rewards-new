import { GenerativeProvider } from "./generative/_common";
import z from "zod";
import { VoiceProviderMethods } from "./voice/_types";
import { GenerativeProviderMethods } from "./generative/_types";

import { AnthropicProvider } from "./generative/anthropic";
import { OpenaiProvider } from "./generative/openai";
import { PerplexityProvider } from "./generative/perplexity";
import { DeepgramProvider } from "./voice/deepgram";
import { ElevenLabsProvider } from "./voice/elevenlabs";
import { PlayhtProvider } from "./voice/playht";
import { VoiceProvider } from "./voice/_common";

export const generativeAiProviders = z.enum([
  "anthropic",
  "openai",
  "perplexity",
]);

export const voiceAiProviders = z.enum(["deepgram", "elevenlabs", "playht"]);

export async function getAiProviders(env: Record<string, string>) {
  const [openai, anthropic, perplexity] = await Promise.all([
    new OpenaiProvider(env).init(),
    new AnthropicProvider(env).init(),
    new PerplexityProvider(env).init(),
  ]);

  const [deepgram, elevenlabs, playht] = await Promise.all([
    new DeepgramProvider(env).init(),
    new ElevenLabsProvider(env).init(),
    new PlayhtProvider(env).init(),
  ]);

  return {
    generative: {
      openai,
      anthropic,
      perplexity,
    } as Record<
      z.infer<typeof generativeAiProviders>,
      GenerativeProvider & GenerativeProviderMethods
    >,
    voice: {
      deepgram,
      elevenlabs,
      playht,
    } as Record<
      z.infer<typeof voiceAiProviders>,
      VoiceProvider & VoiceProviderMethods
    >,
  };
}
