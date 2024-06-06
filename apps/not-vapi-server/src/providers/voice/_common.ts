import { Voice } from "./_types";

export function getVoiceById(voiceId: string, voices: Voice[]): Voice {
  const voice = voices.find((voice) => voice.id === voiceId);

  if (!voice) {
    throw new Error(`Voice ${voiceId} not found`);
  }

  return voice;
}
