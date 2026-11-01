import { describe, expect, test } from "bun:test";
import { createElevenLabsSpeech, createTranscriptionSpeech } from "../src/index.ts";

const audio = { data: new Uint8Array([1, 2, 3]), mimeType: "audio/wav" };

describe("transcription API speech provider", () => {
  test("uploads the recording and returns the transcript", async () => {
    let seen: { url: string; auth: string | null; form: FormData } | undefined;
    const speech = createTranscriptionSpeech({
      apiKey: "stt-secret",
      baseUrl: "https://stt.example.com/v1/",
      model: "stt-model",
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, auth: new Headers(init.headers).get("Authorization"), form: init.body as FormData };
        return Response.json({ text: " I need help with my bill " });
      }) as typeof fetch,
    });

    const text = await speech.transcribe(audio, new AbortController().signal);

    expect(text).toBe(" I need help with my bill ");
    expect(seen?.url).toBe("https://stt.example.com/v1/audio/transcriptions");
    expect(seen?.auth).toBe("Bearer stt-secret");
    expect(seen?.form.get("model")).toBe("stt-model");
    expect((seen?.form.get("file") as File).name).toBe("utterance.wav");
  });

  test("reports HTTP failures without leaking the API key", async () => {
    const speech = createTranscriptionSpeech({
      apiKey: "stt-secret",
      baseUrl: "https://stt.example.com/v1",
      model: "stt-model",
      fetch: (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
    });

    const error = await speech.transcribe(audio, new AbortController().signal).catch((e: Error) => e);

    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain("stt-secret");
  });
});

describe("ElevenLabs speech provider", () => {
  test("uploads the recording and returns the transcript", async () => {
    let seen:
      | { url: string; apiKey: string | null; auth: string | null; form: FormData }
      | undefined;
    const speech = createElevenLabsSpeech({
      apiKey: "xi-secret",
      baseUrl: "https://stt.example.com",
      model: "scribe_v2",
      language: "en",
      fetch: (async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        seen = {
          url,
          apiKey: headers.get("xi-api-key"),
          auth: headers.get("Authorization"),
          form: init.body as FormData,
        };
        return Response.json({ text: " I need help with my bill " });
      }) as typeof fetch,
    });

    const text = await speech.transcribe(audio, new AbortController().signal);

    expect(text).toBe(" I need help with my bill ");
    expect(seen?.url).toBe("https://stt.example.com/v1/speech-to-text");
    expect(seen?.apiKey).toBe("xi-secret");
    expect(seen?.auth).toBeNull();
    expect(seen?.form.get("model_id")).toBe("scribe_v2");
    expect(seen?.form.get("language_code")).toBe("en");
    expect((seen?.form.get("file") as File).name).toBe("utterance.wav");
  });

  test("appends the API path when the base URL has a trailing slash", async () => {
    let seenUrl: string | undefined;
    const speech = createElevenLabsSpeech({
      apiKey: "xi-secret",
      baseUrl: "https://stt.example.com/",
      model: "scribe_v2",
      fetch: (async (url: string) => {
        seenUrl = url;
        return Response.json({ text: "hello" });
      }) as typeof fetch,
    });

    await speech.transcribe(audio, new AbortController().signal);

    expect(seenUrl).toBe("https://stt.example.com/v1/speech-to-text");
  });

  test("omits language_code when no language is configured", async () => {
    let seenForm: FormData | undefined;
    const speech = createElevenLabsSpeech({
      apiKey: "xi-secret",
      baseUrl: "https://stt.example.com",
      model: "scribe_v2",
      fetch: (async (_url: string, init: RequestInit) => {
        seenForm = init.body as FormData;
        return Response.json({ text: "hello" });
      }) as typeof fetch,
    });

    await speech.transcribe(audio, new AbortController().signal);

    expect(seenForm?.get("model_id")).toBe("scribe_v2");
    expect(seenForm?.has("language_code")).toBe(false);
  });

  test("reports HTTP failures without leaking the API key", async () => {
    const speech = createElevenLabsSpeech({
      apiKey: "xi-secret",
      baseUrl: "https://stt.example.com",
      model: "scribe_v2",
      fetch: (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch,
    });

    const error = await speech.transcribe(audio, new AbortController().signal).catch((e: Error) => e);

    expect(String(error)).toContain("HTTP 401");
    expect(String(error)).not.toContain("xi-secret");
  });
});
