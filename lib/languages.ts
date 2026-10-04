// Maps the playground's language choice onto what each provider accepts.
// No provider has a Marwari code: code-only models get Hindi (same script, closest
// language); promptable models also get a dialect hint so they keep Marwari words.
import type { LanguageId, ModelDef, ProviderId } from "./models/types";

export interface LanguageDef {
  id: LanguageId;
  label: string;
  /** BCP-47 code with India region, used by Sarvam and Gemini. */
  bcp47?: string;
  /** ISO 639-1 code, used by OpenAI and ElevenLabs. */
  iso1?: string;
  /** Language whose code is sent when the provider has no code for this one. */
  fallback?: LanguageId;
  /** Name and script used in prompts. */
  promptName?: string;
  script?: string;
}

export const LANGUAGES: LanguageDef[] = [
  { id: "auto", label: "Auto-detect" },
  { id: "en", label: "English", bcp47: "en-IN", iso1: "en", promptName: "English (Indian accent)", script: "Latin" },
  { id: "hi", label: "Hindi", bcp47: "hi-IN", iso1: "hi", promptName: "Hindi", script: "Devanagari" },
  { id: "gu", label: "Gujarati", bcp47: "gu-IN", iso1: "gu", promptName: "Gujarati", script: "Gujarati" },
  { id: "mr", label: "Marathi", bcp47: "mr-IN", iso1: "mr", promptName: "Marathi", script: "Devanagari" },
  {
    id: "mwr",
    label: "Marwari",
    fallback: "hi",
    promptName: "Marwari (a Rajasthani language closely related to Hindi)",
    script: "Devanagari",
  },
];

export const LANGUAGES_BY_ID = Object.fromEntries(LANGUAGES.map((l) => [l.id, l])) as Record<LanguageId, LanguageDef>;

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === "string" && value in LANGUAGES_BY_ID;
}

export interface ResolvedLanguage {
  /** Code to send upstream; null means "let the provider detect". */
  code: string | null;
  /** Dialect or language hint, only for promptable models. */
  prompt?: string;
  /** Short human label of what was actually sent, shown on the card. */
  sentLabel: string;
}

function codeFor(provider: ProviderId, lang: LanguageDef): string | undefined {
  switch (provider) {
    case "sarvam":
    case "gemini":
      return lang.bcp47;
    case "openai":
    case "elevenlabs":
      return lang.iso1;
  }
}

export function resolveLanguage(model: ModelDef, languageId: LanguageId): ResolvedLanguage {
  const lang = LANGUAGES_BY_ID[languageId];
  if (lang.id === "auto") return { code: null, sentLabel: "auto" };

  const codeLang = lang.fallback ? LANGUAGES_BY_ID[lang.fallback] : lang;
  const code = codeFor(model.provider, codeLang) ?? null;
  const prompt = model.promptable && lang.fallback ? dialectHint(lang) : undefined;
  const sentLabel = [code ?? "auto", prompt ? `+ ${lang.label} hint` : null].filter(Boolean).join(" ");
  return { code, prompt, sentLabel };
}

function dialectHint(lang: LanguageDef): string {
  return `The speaker is speaking ${lang.promptName}. Transcribe in ${lang.script} script, keeping ${lang.label} words and grammar as spoken; do not translate into Hindi.`;
}

/** Full instruction for general LLMs (Gemini prompted models) that transcribe from a prompt. */
export function transcriptionPrompt(languageId: LanguageId): string {
  const lang = LANGUAGES_BY_ID[languageId];
  const base =
    "Transcribe this audio verbatim. Output only the transcript text — no translation, summary, labels, timestamps or commentary. If there is no speech, output nothing.";
  if (lang.id === "auto") return `${base} Write each language in its native script.`;
  return `${base} The speaker is speaking ${lang.promptName}; write it in ${lang.script} script${
    lang.fallback ? `, keeping ${lang.label} words and grammar as spoken rather than converting them to Hindi` : ""
  }.`;
}
