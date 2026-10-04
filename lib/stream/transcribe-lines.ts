/** NDJSON lines streamed by POST /api/transcribe. */
export type TranscribeLine =
  | { modelId: string; type: "accepted"; languageSent: string }
  | { modelId: string; type: "delta"; text: string; t: number }
  | { modelId: string; type: "final"; text: string; language?: string; upstreamMs: number; raw?: unknown }
  | { modelId: string; type: "error"; message: string; status?: number }
  | { type: "end" };
