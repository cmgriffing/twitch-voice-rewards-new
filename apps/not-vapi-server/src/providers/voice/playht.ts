import { Voice, VoiceProviderMethods } from "./_types";
import { VoiceProvider } from "./_common";

export class PlayhtProvider
  extends VoiceProvider
  implements VoiceProviderMethods
{
  voices: Voice[] = [];

  fetchVoices = async () => {
    const { PLAYHT_KEY: API_KEY, PLAYHT_CLIENT_ID: CLIENT_ID } = this.env;

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
  };

  syncVoices = async () => {
    const voices = await this.fetchVoices();
    this.voices = voices;
  };

  async textToSpeech(text: string, voiceId: string) {
    const { PLAYHT_KEY: API_KEY, PLAYHT_CLIENT_ID: CLIENT_ID } = this.env;

    const voice = this.getVoiceById(voiceId);

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
