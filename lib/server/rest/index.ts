import "server-only";
import type { ModelDef } from "@/lib/models/types";
import { elevenlabsRest } from "./elevenlabs";
import { geminiPromptedRest, geminiTranscribeRest } from "./gemini";
import { openaiRest } from "./openai";
import { sarvamRest } from "./sarvam";
import type { RestAdapter } from "./types";

export function restAdapterFor(model: ModelDef): RestAdapter {
  switch (model.provider) {
    case "sarvam":
      return sarvamRest;
    case "openai":
      return openaiRest;
    case "elevenlabs":
      return elevenlabsRest;
    case "gemini":
      return model.promptable ? geminiPromptedRest : geminiTranscribeRest;
  }
}
