import { OpenaiPromptResponse, type GenerativeProvider } from "./_types";

const API_KEY = process.env.PERPLEXITY_KEY;

export class PerplexityProvider implements GenerativeProvider {
  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string
  ): Promise<string> {
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
