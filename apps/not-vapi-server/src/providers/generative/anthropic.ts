import { GenerativeProvider } from "./_common";
import { GenerativeProviderMethods } from "./_types";

import Anthropic from "@anthropic-ai/sdk";

export class AnthropicProvider
  extends GenerativeProvider
  implements GenerativeProviderMethods
{
  fetchModels = async () => {
    return [
      {
        id: "claude-3-opus-20240229",
        name: "Claude 3 Opus",
      },
      {
        id: "claude-3-sonnet-20240229",
        name: "Claude 3 Sonnet",
      },
      {
        id: "claude-3-haiku-20240307",
        name: "Claude 3 Haiku",
      },
    ];
  };

  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string
  ): Promise<string> {
    const { ANTHROPIC_KEY: API_KEY } = this.env;

    // const response = await fetch("https://api.anthropic.com/v1/messages", {
    //   method: "POST",
    //   headers: {
    //     "Content-Type": "application/json",
    //     "x-api-key": API_KEY || "",
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

    // const responseJson: AnthropicPromptResponse =
    //   (await response.json()) as unknown as AnthropicPromptResponse;

    // return responseJson.content[0].text;

    const anthropic = new Anthropic({
      apiKey: API_KEY,
    });

    const msg = await anthropic.messages.create({
      model,
      max_tokens: 4096,
      messages: [
        // {
        //   role: "user",
        //   content: `My name is ${userName}`,
        // },
        {
          role: "user",
          content: `${prompt} The username is ${userName}`,
        },
      ],
    });

    console.log({ msg: msg.content });

    return msg.content
      .map((content) => (content.type === "text" ? content.text : ""))
      .join(" ");
  }
}

interface AnthropicPromptResponse {
  content: Content[];
  id: string;
  model: string;
  role: string;
  stop_reason: string;
  stop_sequence: null;
  type: string;
  usage: Usage;
}

interface Content {
  text: string;
  type: string;
}

interface Usage {
  input_tokens: number;
  output_tokens: number;
}
