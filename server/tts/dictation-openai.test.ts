import { expect, it, vi } from "vitest";
import { transcribeOpenAiDictation } from "./dictation-openai.ts";

it("uploads WAV bytes with a server-side key and preserves punctuation", async () => {
  const fake = vi.fn(async (_url: unknown, _init: unknown) => new Response(JSON.stringify({ text: "Hello, team!" })));
  expect(await transcribeOpenAiDictation(Buffer.from("RIFF"), "synthetic-secret", fake as typeof fetch)).toBe("Hello, team!");
  const [url, init] = fake.mock.calls[0]!;
  expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
  const request = init as RequestInit;
  expect(request.redirect).toBe("error");
  expect((request.headers as Record<string, string>).authorization).toBe("Bearer synthetic-secret");
  expect((request.body as FormData).get("model")).toBe("whisper-1");
  expect(await ((request.body as FormData).get("file") as Blob).text()).toBe("RIFF");
});

it("does not expose provider error bodies or keys", async () => {
  const fake = vi.fn(async () => new Response("synthetic-secret transcript", { status: 429 }));
  await expect(transcribeOpenAiDictation(Buffer.from("RIFF"), "synthetic-secret", fake as typeof fetch)).rejects.toThrow("OpenAI transcription failed (429)");
});

it("rejects malformed success responses and network failures", async () => {
  await expect(transcribeOpenAiDictation(Buffer.from("RIFF"), "test", (async () => new Response("{}")) as typeof fetch)).rejects.toThrow("invalid transcription");
  await expect(transcribeOpenAiDictation(Buffer.from("RIFF"), "test", (async () => { throw Error("secret"); }) as typeof fetch)).rejects.toThrow("Could not reach OpenAI");
});
