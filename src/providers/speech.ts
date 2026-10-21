import type { CallerAudio, SpeechToText } from "../types.ts";

export interface TranscriptionOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  language?: string;
  fetch?: typeof fetch;
}

export type TranscriptionApiOptions = TranscriptionOptions;

export function createTranscriptionSpeech(options: TranscriptionOptions): SpeechToText {
  const send = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
  return {
    async transcribe(audio, signal) {
      const response = await send(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: buildOpenAiForm(audio, options),
        signal,
      });
      if (!response.ok) {
        throw new Error(`Transcription request failed with HTTP ${response.status}`);
      }
      const body: unknown = await response.json();
      return readText(body);
    },
  };
}

export const createTranscriptionApiSpeech = createTranscriptionSpeech;

export function createElevenLabsSpeech(options: TranscriptionOptions): SpeechToText {
  const send = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, "")}/v1/speech-to-text`;

  return {
    async transcribe(audio, signal) {
      const response = await send(url, {
        method: "POST",
        headers: { "xi-api-key": options.apiKey },
        body: buildElevenLabsForm(audio, options),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Transcription request failed with HTTP ${response.status}`);
      }

      const body: unknown = await response.json();
      return readText(body);
    },
  };
}

// OpenAI-compatible transcription API form (fields: model, language)
function buildOpenAiForm(audio: CallerAudio, options: TranscriptionApiOptions): FormData {
  const form = new FormData();
  form.append("file", new Blob([audio.data], { type: audio.mimeType }), fileNameFor(audio.mimeType));
  form.append("model", options.model);
  if (options.language) {
    form.append("language", options.language);
  }
  return form;
}

// ElevenLabs Scribe v2 transcription API form (fields: model_id, language_code)
function buildElevenLabsForm(audio: CallerAudio, options: TranscriptionApiOptions): FormData {
  const form = new FormData();
  form.append("file", new Blob([audio.data], { type: audio.mimeType }), fileNameFor(audio.mimeType));
  form.append("model_id", options.model);
  if (options.language) {
    form.append("language_code", options.language);
  }
  return form;
}

function fileNameFor(mimeType: string): string {
  if (mimeType.includes("wav")) {
    return "utterance.wav";
  }
  if (mimeType.includes("mpeg")) {
    return "utterance.mp3";
  }
  return "utterance.bin";
}

function readText(body: unknown): string {
  if (typeof body === "object" && body !== null && "text" in body && typeof body.text === "string") {
    return body.text;
  }
  throw new Error("Transcription response did not contain text");
}
