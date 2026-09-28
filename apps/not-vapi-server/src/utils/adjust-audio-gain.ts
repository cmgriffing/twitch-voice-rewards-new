import { ffmpegPath, isFfmpegAvailable } from "node-av/ffmpeg";
import { exec } from "node:child_process";

export function adjustAudioGain(
  inputArrayBuffer: Uint8Array<ArrayBufferLike>,
  multiplier: number,
): Promise<ArrayBufferLike> {
  return new Promise((resolve, reject) => {
    if (!isFfmpegAvailable()) {
      console.log("FFmpeg is not available");
      reject(new Error("FFmpeg is not available"));
    }

    // Spawn standard system FFmpeg, telling it to accept input via stdin and output via stdout
    const ffmpegProcess = exec(
      `${ffmpegPath()} -i pipe:0 -filter:a volume=${multiplier} -f mp3 pipe:1`,
      { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 }, // 100MB buffer limit
      (error, stdout, stderr) => {
        if (error) {
          return reject(error);
        }

        // Convert the returned native Buffer back into a clean ArrayBuffer
        resolve(
          stdout.buffer.slice(
            stdout.byteOffset,
            stdout.byteOffset + stdout.byteLength,
          ),
        );
      },
    );

    if (ffmpegProcess?.stdin) {
      // Push your input ArrayBuffer straight into FFmpeg's standard input stream
      ffmpegProcess?.stdin?.write(Buffer.from(inputArrayBuffer));
      ffmpegProcess?.stdin?.end();
    } else {
      console.log("FFmpeg process stdin is not available");
      reject(new Error("FFmpeg process stdin is not available"));
    }
  });
}
