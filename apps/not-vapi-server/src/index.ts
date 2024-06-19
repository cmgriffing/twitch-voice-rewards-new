import dotenv from "dotenv";
dotenv.config();
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";

// CF specific
// import { H } from "@highlight-run/cloudflare";
import { H } from "@highlight-run/node";
import * as traceloop from "@traceloop/node-server-sdk";

import z from "zod";

import {
  generativeAiProviders,
  getAiProviders,
  voiceAiProviders,
} from "./providers/index";
import { env } from "hono/adapter";
import { GenerativeModel } from "./providers/generative/_types";

const HIGHLIGHT_PROJECT_ID = "lgxrjr4g";

// CF specific
// const highlightMetaData = { HIGHLIGHT_PROJECT_ID };

const app = new Hono();

app.use("/*", cors() as any);

const telemetryMiddleware = async (c: any, next: any) => {
  H.init(
    { projectID: HIGHLIGHT_PROJECT_ID }
    // CF specific
    // c.req.raw, highlightMetaData, c.executionCtx
  );
  traceloop.initialize({ appName: "twitch_voice_rewards" });

  await next();
};
app.use("/*", telemetryMiddleware as any);

const promptRequestSchema = z.object({
  prompt: z.string(),
  userName: z.string(),
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
    })
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
        {} as Record<string, GenerativeModel[]>
      )
    )
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
        {} as Record<string, GenerativeModel[]>
      )
    )
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

    const generativeResponse = await generativeProvider.getPromptResponse(
      `When I tell you a username, ${validatedRequest.prompt}

      Limit the description to 30 seconds. Make sure to always reference them as they or their.`,
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

    const response = c.body(voiceResponse);

    // CF specific
    // H.sendResponse(response);

    return response;
  } catch (e: any) {
    console.log(e.message);
    throw e;
  }
});

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

// CF specific
// export default app;
