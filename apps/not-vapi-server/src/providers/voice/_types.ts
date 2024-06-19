import { VoiceProvider } from "./_common";

export type VoiceProviderMethods = VoiceProvider & {
  textToSpeech: (text: string, voice: string) => Promise<ReadableStream>;
};

// TODO: dedupe this type since we also use it on the frontend
export interface Voice {
  id: string;
  name: string;
  gender?: "male" | "female" | string;
  language?: string;
  accent?: string;
}
