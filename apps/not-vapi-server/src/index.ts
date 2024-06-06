import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";

import z from "zod";

import {
  generativeAiProviders,
  getAiProviders,
  voiceAiProviders,
} from "./providers/index";
import { env } from "hono/adapter";

const app = new Hono();

app.use("/*", cors());

const promptRequestSchema = z.object({
  prompt: z.string(),
  userName: z.string(),
  voiceProvider: voiceAiProviders,
  voiceId: z.string(),
  generativeProvider: generativeAiProviders,
  generativeModel: z.string(),
});

app.post("/prompt", async (c) => {
  try {
    const aiProviders = await getAiProviders(env(c));

    const requestJson = await c.req.json();
    console.log({ requestJson });

    const validationResult = promptRequestSchema.safeParse(requestJson);

    console.log({ validationResult });

    if (!validationResult.success) {
      throw new HTTPException(400, {
        message: "Invalid request",
        cause: validationResult.error,
      });
    }

    const validatedRequest = validationResult.data;

    console.log({ validatedRequest });

    const generativeProvider =
      aiProviders.generative[validatedRequest.generativeProvider];

    if (!generativeProvider) {
      throw new HTTPException(400, {
        message: `Invalid request: Generative provider (${validatedRequest.generativeProvider}) does not exist`,
      });
    }

    const generativeResponse = await generativeProvider.getPromptResponse(
      validatedRequest.prompt,
      validatedRequest.generativeModel,
      validatedRequest.userName
    );

    console.log({ generativeResponse });

    const voiceProvider = aiProviders.voice[validatedRequest.voiceProvider];

    if (!voiceProvider) {
      throw new HTTPException(400, {
        message: `Invalid request: Voice provider (${validatedRequest.voiceProvider}) does not exist`,
      });
    }

    const voiceResponse = await voiceProvider.textToSpeech(
      generativeResponse,
      validatedRequest.voiceId
    );

    return c.body(voiceResponse);
  } catch (e: any) {
    console.log(e.message);
    throw e;
  }
});

export default app;
