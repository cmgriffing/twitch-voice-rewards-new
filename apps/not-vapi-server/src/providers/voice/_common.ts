import { AiProvider } from "../_common";
import { Voice } from "./_types";

export class VoiceProvider extends AiProvider {
  voices: Voice[] = [];

  async init() {
    await this.syncVoices();
    return this;
  }

  fetchVoices: () => Promise<Voice[]> = async () => {
    throw new Error("fetchVoices not implemented for VoiceProvider");
  };

  syncVoices: () => Promise<void> = async () => {
    this.voices = await this.fetchVoices();
  };

  getVoiceById(voiceId: string): Voice {
    const voice = this.voices.find((voice) => voice.id === voiceId);

    if (!voice) {
      throw new Error(`Voice ${voiceId} not found`);
    }

    return voice;
  }
}
