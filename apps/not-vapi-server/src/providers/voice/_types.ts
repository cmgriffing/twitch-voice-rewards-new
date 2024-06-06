import type { ReadableStream } from "node:stream/web";

export interface VoiceProvider {
  voices: Voice[];

  getVoices: () => Promise<Voice[]>;
  syncVoices: () => Promise<void>;

  textToSpeech: (text: string, voice: string) => Promise<ReadableStream>;
}

export interface Voice {
  id: string;
  name: string;
  gender?: "male" | "female" | string;
  language?: string;
  accent?: string;
}
