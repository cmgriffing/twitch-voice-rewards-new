import { GenerativeProvider } from "./_common";
import { GenerativeProviderMethods } from "./_types";

import OpenAI from "openai";

export class OpenaiProvider
  extends GenerativeProvider
  implements GenerativeProviderMethods
{
  fetchModels = async () => {
    const { OPENAI_KEY: API_KEY } = this.env;
    const openai = new OpenAI({
      apiKey: API_KEY,
    });

    return (await openai.models.list()).data
      .map((model) => ({
        id: model.id,
        name: model.id,
      }))
      .filter((model) => model.id.startsWith("gpt-"));
  };

  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string
  ): Promise<string> {
    const { OPENAI_KEY: API_KEY } = this.env;

    // const response = await fetch("https://api.openai.com/v1/chat/completions", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     Authorization: `Bearer ${API_KEY}`,
    //   },
    //   body: JSON.stringify({
    //     model,
    //     messages: [
    //       {
    //         role: "system",
    //         content: prompt,
    //       },
    //       {
    //         role: "user",
    //         content: `My name is ${userName}`,
    //       },
    //     ],
    //   }),
    // });

    // if (!response.ok) {
    //   throw new Error((await response.text()) || "error");
    // }

    // const responseJson: OpenaiPromptResponse =
    //   (await response.json()) as unknown as OpenaiPromptResponse;

    // return responseJson.choices[0].message.content;

    const openai = new OpenAI({
      apiKey: API_KEY,
    });

    const chatCompletion = await openai.chat.completions.create({
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
      model,
    });

    return chatCompletion.choices[0].message.content || "";
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
