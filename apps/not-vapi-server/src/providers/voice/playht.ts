import { getVoiceById } from "./_common";
import { Voice, VoiceProvider } from "./_types";
import type { ReadableStream } from "node:stream/web";

const CLIENT_ID = process.env.PLAYHT_CLIENT_ID || "";
const API_KEY = process.env.PLAYHT_KEY || "";

export class PlayhtProvider implements VoiceProvider {
  voices: Voice[] = [];
  async getVoices() {
    const response = await fetch("https://api.play.ht/api/v2/voices", {
      headers: {
        AUTHORIZATION: API_KEY,
        "X-USER-ID": CLIENT_ID,
        "Content-Type": "application/json",
      },
    });
    const rawVoices = (await response.json()) as PlayhtVoice[];

    return rawVoices.map(({ id, name, language_code, gender, accent }) => ({
      id,
      name,
      gender: gender || "unknown",
      accent: accent || "unknown",
      language: language_code,
    }));
  }

  async syncVoices() {
    const voices = await this.getVoices();
    this.voices = voices;
  }

  async textToSpeech(text: string, voiceId: string) {
    const voice = getVoiceById(voiceId, this.voices);

    const response = await fetch(`https://api.play.ht/api/v2/tts/stream`, {
      method: "POST",
      headers: {
        AUTHORIZATION: API_KEY,
        "X-USER-ID": CLIENT_ID,
        "Content-Type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        voice: voice.id,
      }),
    });
    if (!response.ok) {
      throw new Error((await response.text()) || "error synthesizing voice");
    }

    if (!response.body) {
      throw new Error("voice response body empty");
    }

    return response.body as ReadableStream<Uint8Array>;
  }
}

interface PlayhtVoice {
  id: string;
  name: string;
  sample: string;
  accent: string | null;
  age: string | null;
  gender: string | null;
  language: string;
  language_code: string;
  loudness: string | null;
  style: string | null;
  tempo: string | null;
  texture: string | null;
}
