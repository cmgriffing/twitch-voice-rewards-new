import { Voice, VoiceProviderMethods } from "./_types";
import { VoiceProvider } from "./_common";
import { OpenRouter } from "@openrouter/sdk";

export class OpenRouterFishProvider
  extends VoiceProvider
  implements VoiceProviderMethods
{
  voices: Voice[] = [];

  fetchVoices = async () => {
    return [
      {
        id: "a6773a9361fb43d38756620c1c3e2be8",
        name: "Bob Uecker",
        gender: "male",
        language: "en",
        accent: "us",
      },
      {
        id: "8589c9bb49c5444f9443d3d39ecc8370",
        name: "John Madden",
        gender: "male",
        language: "en",
        accent: "us",
      },

      {
        id: "5708bc04f8184a2b8f1d7d5843d7ad5a",
        name: "Rick Sanchez",
        gender: "male",
        language: "en",
        accent: "us",
      },

      {
        id: "1c19986f43744a84b2ade439be177de6",
        name: "Steve Irwin",
        gender: "male",
        language: "en",
        accent: "au",
      },

      {
        id: "84daeb2b28bd489f8525b89638e44e4c",
        name: "Ozzy Osbourne",
        gender: "male",
        language: "en",
        accent: "uk",
      },

      {
        id: "8db55023819c4ed184d8b29c2c20aef5",
        name: "Professor Farnsworth",
        gender: "male",
        language: "en",
        accent: "us",
      },

      {
        id: "cc66efededda4bd88a2b950f691a7c9f",
        name: "Bob Belcher",
        gender: "male",
        language: "en",
        accent: "us",
      },

      {
        id: "a39c0fb2010144168ea91ce33f53c20b",
        name: "Eric Cartman",
        gender: "male",
        language: "en",
        accent: "us",
      },

      {
        id: "e532ea9ba2e74f15bcdb5544c2a6e7f7",
        name: "Margot Robbie",
        gender: "female",
        language: "en",
        accent: "au",
      },

      {
        id: "c4adfd6bd1fe4e59ae18ce19dbce2c14",
        name: "Gilbert Gottfried",
        gender: "male",
        language: "en",
        accent: "us",
      },

      {
        id: "eabac87f2d8b47f1b174e7d2f685618a",
        name: "David Attenborough",
        gender: "male",
        language: "en",
        accent: "uk",
      },

      {
        id: "29509e20f1a14a8698ffb42134fc944d",
        name: "Irish Woman",
        gender: "female",
        language: "en",
        accent: "uk",
      },

      {
        id: "a343b7ae99a8402aa00c175ffd81d287",
        name: "Matt Berry",
        gender: "male",
        language: "en",
        accent: "uk",
      },
    ];
  };

  syncVoices = async () => {
    const voices = await this.fetchVoices();
    this.voices = voices;
  };

  async textToSpeech(text: string, voiceId: string) {
    const { OENROUTER_API_KEY: API_KEY } = this.env;

    const voice = this.getVoiceById(voiceId);

    const openrouter = new OpenRouter({ apiKey: API_KEY });

    const response = await openrouter.tts.createSpeech({
      speechRequest: {
        input: text,
        model: "fish-audio/s2.1-pro",
        voice: voice.id,
        speed: 1,
        responseFormat: "mp3",
      },
    });

    return response;
  }
}
