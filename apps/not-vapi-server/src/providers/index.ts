import { GenerativeProvider } from "./generative/_types";
import { AnthropicProvider } from "./generative/anthropic";
import { OpenaiProvider } from "./generative/openai";
import { PerplexityProvider } from "./generative/perplexity";
import { VoiceProvider } from "./voice/_types";
import { DeepgramProvider } from "./voice/deepgram";
import { ElevenLabsProvider } from "./voice/elevenlabs";
import { PlayhtProvider } from "./voice/playht";

export const generativeProviders: Record<string, GenerativeProvider> = {
  openai: new OpenaiProvider(),
  anthropic: new AnthropicProvider(),
  perplexity: new PerplexityProvider(),
};

export const voiceProviders: Record<string, VoiceProvider> = {
  deepgram: new DeepgramProvider(),
  elevenlapps: new ElevenLabsProvider(),
  playht: new PlayhtProvider(),
};
