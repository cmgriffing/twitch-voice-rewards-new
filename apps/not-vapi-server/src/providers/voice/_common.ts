import { AiProvider } from "../_common";
import { Voice } from "./_types";

export class VoiceProvider extends AiProvider {
  voices: Voice[];

  constructor(env: Record<string, string>) {
    super(env);
    this.voices = [];
  }

  async init() {
    await this.syncVoices();
    return this;
  }

  getVoices: () => Promise<Voice[]> = async () => {
    throw new Error("getVoices not implemented for VoiceProvider");
  };

  syncVoices: () => Promise<void> = async () => {
    const voices = await this.getVoices();
    this.voices = voices;
  };

  getVoiceById(voiceId: string): Voice {
    const voice = this.voices.find((voice) => voice.id === voiceId);

    if (!voice) {
      throw new Error(`Voice ${voiceId} not found`);
    }

    return voice;
  }
}
