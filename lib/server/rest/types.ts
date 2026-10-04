import type { LanguageId, ModelDef, ModelOptions } from "@/lib/models/types";

export interface RestContext {
  model: ModelDef;
  /** 16kHz mono PCM16 WAV of the whole recording. */
  wav: Uint8Array;
  /** The same audio as samples (for providers that need splitting). */
  pcm: Int16Array;
  language: LanguageId;
  options: ModelOptions;
  key: string;
  signal?: AbortSignal;
  /** Injectable so smoke scripts can record raw upstream responses. */
  fetch?: typeof fetch;
}

export type RestEvent =
  | { type: "delta"; text: string }
  | { type: "final"; text: string; language?: string; raw?: unknown };

export type RestAdapter = (ctx: RestContext) => AsyncGenerator<RestEvent>;

export function wavBlob(wav: Uint8Array): Blob {
  return new Blob([wav as BlobPart], { type: "audio/wav" });
}
