export async function transcribeOpenAiDictation(audio: Buffer, key: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), "dictation.wav");
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", redirect: "error", headers: { authorization: `Bearer ${key}` }, body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("Could not reach OpenAI transcription. Your draft has not been sent.");
  }
  if (!response.ok) throw new Error(`OpenAI transcription failed (${response.status}). Check the API key, quota and connection in Settings.`);
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || !("text" in body) || typeof body.text !== "string") {
    throw new Error("OpenAI returned an invalid transcription response.");
  }
  return body.text;
}
