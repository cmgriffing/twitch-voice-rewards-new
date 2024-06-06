import { AiProvider } from "../_common";
import { GenerativeProviderMethods } from "./_types";

export class AnthropicProvider
  extends AiProvider
  implements GenerativeProviderMethods
{
  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string
  ): Promise<string> {
    const { ANTHROPIC_KEY: API_KEY } = this.env;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY || "",
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

    const responseJson: AnthropicPromptResponse =
      (await response.json()) as unknown as AnthropicPromptResponse;

    return responseJson.content[0].text;
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
