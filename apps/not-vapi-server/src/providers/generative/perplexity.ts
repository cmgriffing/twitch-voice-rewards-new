import { GenerativeProvider } from "./_common";
import type { OpenaiPromptResponse, GenerativeProviderMethods } from "./_types";

export class PerplexityProvider
  extends GenerativeProvider
  implements GenerativeProviderMethods
{
  fetchModels = async () => {
    return [
      {
        id: "llama-3-sonar-small-32k-chat",
        name: "llama-3-sonar-small-32k-chat",
      },
      {
        id: "llama-3-sonar-small-32k-online",
        name: "llama-3-sonar-small-32k-online",
      },
      {
        id: "llama-3-sonar-large-32k-chat",
        name: "llama-3-sonar-large-32k-chat",
      },
      {
        id: "llama-3-sonar-large-32k-online",
        name: "llama-3-sonar-large-32k-online",
      },
      { id: "llama-3-8b-instruct", name: "llama-3-8b-instruct" },
      { id: "llama-3-70b-instruct", name: "llama-3-70b-instruct" },
      { id: "mixtral-8x7b-instruct", name: "mixtral-8x7b-instruct" },
    ];
  };

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
