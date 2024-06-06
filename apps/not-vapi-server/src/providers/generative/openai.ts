import { GenerativeProvider } from "./_types";

const API_KEY = process.env.OPENAI_KEY;

console.log(process.env);

export class OpenaiProvider implements GenerativeProvider {
  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string
  ): Promise<string> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: prompt,
          },
          {
            role: "user",
            content: `My name is ${userName}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error((await response.text()) || "error");
    }

    const responseJson: OpenaiPromptResponse =
      (await response.json()) as unknown as OpenaiPromptResponse;

    return responseJson.choices[0].message.content;
  }
}

interface OpenaiPromptResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  system_fingerprint: string;
  choices: Choice[];
  usage: Usage;
}

interface Choice {
  index: number;
  message: Message;
  logprobs: null;
  finish_reason: string;
}

interface Message {
  role: string;
  content: string;
}

interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}
