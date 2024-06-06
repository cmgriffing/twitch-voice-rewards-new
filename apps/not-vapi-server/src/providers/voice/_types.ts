import { VoiceProvider } from "./_common";

export type VoiceProviderMethods = VoiceProvider & {
  textToSpeech: (text: string, voice: string) => Promise<ReadableStream>;
};

export interface Voice {
  id: string;
  name: string;
  gender?: "male" | "female" | string;
  language?: string;
  accent?: string;
}
