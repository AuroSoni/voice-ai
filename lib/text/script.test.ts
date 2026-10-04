import { describe, expect, it } from "vitest";
import { detectScript } from "./script";

describe("detectScript", () => {
  it("identifies scripts", () => {
    expect(detectScript("नमस्ते, आप कैसे हैं?").dominant).toBe("Devanagari");
    expect(detectScript("કેમ છો?").dominant).toBe("Gujarati");
    expect(detectScript("hello there").dominant).toBe("Latin");
    expect(detectScript("123 ...").dominant).toBeNull();
  });

  it("flags mixed output", () => {
    const r = detectScript("मेरा phone नंबर है");
    expect(r.dominant).toBe("Devanagari");
    expect(r.mixed).toBe(true);
  });
});
