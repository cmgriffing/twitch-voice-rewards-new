import { OpenRouter } from "@openrouter/sdk";

export type CustomReadableStream = Awaited<
  ReturnType<OpenRouter["tts"]["createSpeech"]>
>;

export async function consumeCustomStream(customStream: CustomReadableStream) {
  const chunks = [];
  let totalLength = 0;

  // Since the library declares [Symbol.asyncIterator], you can use for await...of
  for await (const chunk of customStream) {
    // Assuming 'chunk' arrives as a Uint8Array or Buffer
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  // Combine all chunks into one continuous Uint8Array
  const combinedBuffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combinedBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  return combinedBuffer;
}
