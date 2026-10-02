import test from "node:test";
import assert from "node:assert/strict";
import { Router } from "../dist/openrouter.js";

test("SDK HTTP errors expose selected JSON diagnostics, including untyped error codes", async () => {
  for (const code of [400, "invalid_request"]) {
    const router = new Router(
      "TEST_KEY",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code,
              message:
                "Rejected TEST_KEY and sk-or-v1-other-key with Bearer another-key",
              metadata: {
                provider_name: "Example provider",
                raw: JSON.stringify({
                  code: "invalid_duration",
                  message: "Duration must be at least 4 seconds",
                  request: { api_key: "TEST_KEY" },
                }),
                authorization: "Bearer TEST_KEY",
              },
            },
            user_id: "private-user",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    );
    await assert.rejects(
      router.submit({ model: "test", prompt: "Scene" }),
      (error) => {
        assert.deepEqual(router.errorDetails(error), {
          status: 400,
          code,
          message: "Rejected [REDACTED] and [REDACTED] with Bearer [REDACTED]",
          providerName: "Example provider",
          providerCode: "invalid_duration",
          providerMessage: "Duration must be at least 4 seconds",
        });
        return true;
      },
    );
  }
});

test("non-JSON responses and transport errors never expose raw bodies or transport messages", async () => {
  const router = new Router(
    "TEST_KEY",
    async () =>
      new Response("<html>Authorization: Bearer TEST_KEY</html>", {
        status: 400,
        headers: { "Content-Type": "text/html" },
      }),
  );
  await assert.rejects(
    router.submit({ model: "test", prompt: "Scene" }),
    (error) => {
      assert.deepEqual(JSON.parse(JSON.stringify(router.errorDetails(error))), {
        status: 400,
      });
      return true;
    },
  );
  assert.equal(
    router.errorDetails(new TypeError("network error TEST_KEY")),
    undefined,
  );
});

test("Seedance provider JSON embedded in OpenRouter's message exposes its code and reason", async () => {
  const provider = {
    error: {
      code: "InputImageSensitiveContentDetected.PrivacyInformation",
      message:
        "The request failed because the input image 'content[1]' may contain real person. Request id: fixture-request",
      param: "",
      type: "BadRequest",
    },
  };
  const wrappedMessage = `HTTP 400: ${JSON.stringify(provider)}`;
  const router = new Router(
    "TEST_KEY",
    async () =>
      new Response(
        JSON.stringify({
          error: { code: 400, message: wrappedMessage },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
  );
  await assert.rejects(
    router.submit({ model: "test", prompt: "Scene" }),
    (error) => {
      assert.deepEqual(router.errorDetails(error), {
        status: 400,
        code: 400,
        message: wrappedMessage,
        providerName: undefined,
        providerCode: provider.error.code,
        providerMessage: provider.error.message,
      });
      return true;
    },
  );
});

test("provider messages are bounded after redaction", () => {
  const router = new Router("TEST_KEY");
  const details = router.errorDetails({
    statusCode: 400,
    error: { code: 400, message: "x".repeat(2040) + "TEST_KEY".repeat(1000) },
  });
  assert.equal(details.message.length, 2048);
  assert.ok(!JSON.stringify(details).includes("TEST_KEY"));
});
