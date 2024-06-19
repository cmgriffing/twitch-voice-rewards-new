import type { Voice, VoiceProviderMethods } from "./_types";
import { VoiceProvider } from "./_common";

export class DeepgramProvider
  extends VoiceProvider
  implements VoiceProviderMethods
{
  voices: Voice[] = [];
  fetchVoices = async () => {
    return deepgramVoices;
  };

  syncVoices = async () => {
    const voices = await this.fetchVoices();
    this.voices = voices;
  };

  async textToSpeech(text: string, voiceId: string) {
    const { DEEPGRAM_KEY: API_KEY } = this.env;

    const voice = this.getVoiceById(voiceId);

    const response = await fetch(
      `https://api.deepgram.com/v1/speak?model=${voice.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
        }),
      }
    );
    if (!response.ok) {
      throw new Error((await response.text()) || "error synthesizing voice");
    }

    if (!response.body) {
      throw new Error("voice response body empty");
    }

    return response.body as ReadableStream<Uint8Array>;
  }
}

const deepgramVoices: Voice[] = [
  {
    id: "aura-asteria-en",
    name: "Asteria",
    gender: "female",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-luna-en",
    name: "Luna",
    gender: "female",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-stella-en",
    name: "Stella",
    gender: "female",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-athena-en",
    name: "Athena",
    gender: "female",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-hera-en",
    name: "Hera",
    gender: "female",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-orion-en",
    name: "Orion",
    gender: "male",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-arcas-en",
    name: "Arcas",
    gender: "male",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-perseus-en",
    name: "Perseus",
    gender: "male",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-angus-en",
    name: "Angus",
    gender: "male",
    language: "en",
    accent: "ie",
  },
  {
    id: "aura-orpheus-en",
    name: "Orpheus",
    gender: "male",
    language: "en",
    accent: "us",
  },
  {
    id: "aura-helios-en",
    name: "Helios",
    gender: "male",
    language: "en",
    accent: "uk",
  },
  {
    id: "aura-zeus-en",
    name: "Zeus",
    gender: "male",
    language: "en",
    accent: "us",
  },
];
