import { describe, expect, it } from "vitest";
import { resolveLanguage, transcriptionPrompt } from "./languages";
import { getModel } from "./models/registry";

const m = (id: string) => getModel(id)!;

describe("resolveLanguage", () => {
  it("uses each provider's code format", () => {
    expect(resolveLanguage(m("sarvam/saaras-v4"), "gu").code).toBe("gu-IN");
    expect(resolveLanguage(m("gemini/transcribe-live"), "mr").code).toBe("mr-IN");
    expect(resolveLanguage(m("openai/gpt-transcribe"), "hi").code).toBe("hi");
    expect(resolveLanguage(m("elevenlabs/scribe-v2"), "en").code).toBe("en");
  });

  it("sends auto as null", () => {
    expect(resolveLanguage(m("sarvam/saaras-v4"), "auto")).toEqual({ code: null, sentLabel: "auto" });
  });

  it("maps Marwari to Hindi, with a dialect hint only for promptable models", () => {
    const sarvam = resolveLanguage(m("sarvam/saaras-v3-realtime"), "mwr");
    expect(sarvam.code).toBe("hi-IN");
    expect(sarvam.prompt).toBeUndefined();

    const openai = resolveLanguage(m("openai/gpt-live-transcribe"), "mwr");
    expect(openai.code).toBe("hi");
    expect(openai.prompt).toMatch(/Marwari/);
    expect(openai.sentLabel).toBe("hi + Marwari hint");
  });

  it("builds LLM prompts that forbid translation", () => {
    expect(transcriptionPrompt("mwr")).toMatch(/Marwari.*Devanagari/);
    expect(transcriptionPrompt("auto")).toMatch(/native script/);
    expect(transcriptionPrompt("gu")).toMatch(/Gujarati script/);
  });
});
