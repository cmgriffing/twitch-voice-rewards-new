import { AiProvider } from "../_common";

// TODO: dedupe this type since we also use it on the frontend
export interface GenerativeModel {
  id: string;
  name: string;
}

export type GenerativeProviderMethods = AiProvider & {
  getPromptResponse: (
    prompt: string,
    model: string,
    userName: string
  ) => Promise<string>;
};

export interface OpenaiPromptResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Choice[];
  usage: Usage;
}

export interface Choice {
  index: number;
  message: Message;
  logprobs: null;
  finish_reason: string;
}

export interface Message {
  role: string;
  content: string;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
