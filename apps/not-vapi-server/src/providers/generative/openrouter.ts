import type { ChatResult } from "@openrouter/sdk/models";
import { GenerativeProvider } from "./_common";
import type { GenerativeProviderMethods } from "./_types";
import { OpenRouter } from "@openrouter/sdk";

export class OpenRouterProvider
  extends GenerativeProvider
  implements GenerativeProviderMethods
{
  fetchModels = async () => {
    return [
      {
        id: "nvidia/nemotron-3.5-lightning:nitro",
        name: "Nemotron 3.5 Lightning",
      },
      {
        id: "inception/mercury-2.5",
        name: "Mercury 2.5",
      },
      {
        id: "mistralai/mistral-nemo:nitro",
        name: "Mistral Nemo",
      },
      {
        id: "openai/gpt-oss-20b:nitro",
        name: "GPT OSS 20b",
      },
    ];
  };

  async getPromptResponse(
    prompt: string,
    model: string,
    userName: string,
    voiceName: string,
  ): Promise<string> {
    const { OPENROUTER_API_KEY: API_KEY } = this.env;
    const openrouter = new OpenRouter({ apiKey: API_KEY });

    // const response = await fetch("https://api.anthropic.com/v1/messages", {
    //   method: "POST",
    //   headers: {
    //     Accept: "application/json",
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

    const response = await openrouter.chat.send({
      chatRequest: {
        model: model,
        messages: [
          {
            role: "system",
            content: `${prompt}
            
Make sure the phrasing matches the way ${voiceName} speaks such as slang, pauses, and other notable patterns of speech.
            `,
          },
          {
            role: "user",
            content: `The username is ${userName}`,
          },
        ],
        stream: false,
      },
    });

    const message = (response as ChatResult)?.choices[0]?.message;

    if (!message) {
      console.error("No message found on ChatResult", response);
      throw new Error("No message found on ChatResult");
    }

    return `${message.content}`;
  }
}
