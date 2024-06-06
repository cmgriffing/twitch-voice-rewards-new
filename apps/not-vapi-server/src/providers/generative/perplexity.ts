import { AiProvider } from "../_common";
import type { OpenaiPromptResponse, GenerativeProviderMethods } from "./_types";

export class PerplexityProvider
  extends AiProvider
  implements GenerativeProviderMethods
{
  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string
  ): Promise<string> {
    const { PERPLEXITY_KEY: API_KEY } = this.env;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        Accept: "application/json",
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
