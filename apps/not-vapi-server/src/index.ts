import dotenv from "dotenv";
dotenv.config();
console.log("FOOOOOOOOOO", process.env);

// const dotenv = require('dotenv')
// const buf = Buffer.from('BASIC=basic')
// const config = dotenv.parse(buf)

import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";

import z from "zod";
import { ReadableWebToNodeStream } from "readable-web-to-node-stream";

import { generativeProviders, voiceProviders } from "./providers/index";

const app = new Hono();

app.use("/*", cors());

const promptRequestSchema = z.object({
  prompt: z.string(),
  userName: z.string(),
  voiceProvider: z.string(),
  voiceId: z.string(),
  generativeProvider: z.string(),
  generativeModel: z.string(),
});

app.post("/prompt", async (c) => {
  try {
    console.log("env", env(c));
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
      generativeProviders[validatedRequest.generativeProvider];

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

    const voiceProvider = voiceProviders[validatedRequest.voiceProvider];

    if (!voiceProvider) {
      throw new HTTPException(400, {
        message: `Invalid request: Voice provider (${validatedRequest.voiceProvider}) does not exist`,
      });
    }

    const voiceResponse = await voiceProvider.textToSpeech(
      generativeResponse,
      validatedRequest.voiceId
    );

    const stream = new ReadableWebToNodeStream(
      voiceResponse as ReadableStream
    ) as unknown as ReadableStream;

    return c.body(stream);
  } catch (e: any) {
    console.log(e.message);
    throw e;
  }
});

export default app;
