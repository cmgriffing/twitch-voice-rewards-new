import dotenv from "dotenv";
dotenv.config();
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";

// nodeJS specific
import { Readable } from "node:stream";
import path from "path";
import fs from "fs";
import { glob } from "glob";

import z from "zod";

import {
  generativeAiProviders,
  getAiProviders,
  voiceAiProviders,
} from "./providers/index";
import { env } from "hono/adapter";
import { GenerativeModel } from "./providers/generative/_types";

const app = new Hono();

app.use("/*", cors());

const promptRequestSchema = z.object({
  initialMessage: z.string(),
  prompt: z.string(),
  username: z.string(),
  voiceProvider: voiceAiProviders,
  voiceId: z.string(),
  generativeProvider: generativeAiProviders,
  generativeModel: z.string(),
});

app.get("/providers", async (c) => {
  const aiProviders = await getAiProviders(env(c as any));

  const response = new Response(
    JSON.stringify({
      voice: Object.keys(aiProviders.voice),
      generative: Object.keys(aiProviders.generative),
    }),
  );

  return response;
});

app.get("/models", async (c) => {
  const aiProviders = await getAiProviders(env(c as any));

  const response = new Response(
    JSON.stringify(
      Object.entries(aiProviders.generative).reduce(
        (result, [providerKey, provider]) => {
          result[providerKey] = provider.models;

          return result;
        },
        {} as Record<string, GenerativeModel[]>,
      ),
    ),
  );

  return response;
});

app.get("/voices", async (c) => {
  const aiProviders = await getAiProviders(env(c as any));

  const response = new Response(
    JSON.stringify(
      Object.entries(aiProviders.voice).reduce(
        (result, [providerKey, provider]) => {
          result[providerKey] = provider.voices;

          return result;
        },
        {} as Record<string, GenerativeModel[]>,
      ),
    ),
  );

  return response;
});

app.post("/prompt", async (c) => {
  try {
    const aiProviders = await getAiProviders(env(c as any));

    const requestJson = await c.req.json();

    const validationResult = promptRequestSchema.safeParse(requestJson);

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

    const voiceProvider = aiProviders.voice[validatedRequest.voiceProvider];

    if (!voiceProvider) {
      throw new HTTPException(400, {
        message: `Invalid request: Voice provider (${validatedRequest.voiceProvider}) does not exist`,
      });
    }

    const voice = voiceProvider.getVoiceById(validatedRequest.voiceId);

    const generativeResponse = await generativeProvider.getPromptResponse(
      `When I tell you a username, ${validatedRequest.prompt}

      Limit the description to 30 seconds. Make sure to always reference them as they or their.`,
      validatedRequest.generativeModel,
      validatedRequest.username,
      voice.name,
    );

    console.log({ generativeResponse });

    // TODO: See why this times out? or if it even does?
    const voiceResponse = await voiceProvider.textToSpeech(
      `${validatedRequest.initialMessage} ${generativeResponse}`,
      validatedRequest.voiceId,
    );

    const today = new Date();
    const year = today.getFullYear() + "";
    const monthNumber = today.getMonth() + 1;
    const month = monthNumber < 10 ? `0${monthNumber}` : `${monthNumber}`;

    const fileDir = path.resolve(__dirname, "../archives/voice/", year, month);
    await fs.promises.mkdir(fileDir, { recursive: true });

    const existingFiles = await glob(
      path.resolve(fileDir, `${validatedRequest.username}-*`),
    );
    const increment = existingFiles.length;
    const fileName = `${validatedRequest.username}-${increment}.mp3`;
    const fileStream = fs.createWriteStream(path.resolve(fileDir, fileName));
    console.log("voiceResponse", Object.keys(voiceResponse));
    Readable.fromWeb(voiceResponse as any).pipe(fileStream);

    const response = c.body(voiceResponse);

    return response;
  } catch (e: any) {
    console.log(e.message);

    if (!(e instanceof HTTPException)) {
      throw new HTTPException(500, {
        message: "An unknown error has occurred",
      });
    } else {
      throw e;
    }
  }
});

app.onError((err, c) => {
  // 1. Log the full stack trace to your server stdout/stderr
  console.error("=== Unhandled Exception ===");
  console.error(err); // Passing the error object itself logs the full stack trace

  // 2. Safely forward HTTPException details if thrown explicitly
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  // 3. Return a generic 500 error to the client (to avoid leaking internal info)
  // Optional: In development, you can return c.json({ error: err.message, stack: err.stack }, 500)
  return c.text("Internal Server Error", 500);
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});
