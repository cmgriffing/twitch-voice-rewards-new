#!/usr/bin/env node
import { runCli } from "./index.js";
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on("SIGINT", interrupt);
try {
  process.exitCode = await runCli(
    process.argv.slice(2),
    process.env,
    {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    },
    controller.signal,
  );
} finally {
  process.removeListener("SIGINT", interrupt);
}
