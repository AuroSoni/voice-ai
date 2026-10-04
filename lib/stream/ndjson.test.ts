import { describe, expect, it } from "vitest";
import { NdjsonDecoder } from "./ndjson";

describe("NdjsonDecoder", () => {
  it("reassembles lines and multibyte characters split across chunks", () => {
    const text = '{"t":"नमस्ते"}\n{"t":"કેમ છો"}\n';
    const bytes = new TextEncoder().encode(text);
    const d = new NdjsonDecoder<{ t: string }>();
    const out: { t: string }[] = [];
    // Feed one byte at a time — every 3-byte character gets split.
    for (const b of bytes) out.push(...d.push(Uint8Array.of(b)));
    out.push(...d.end());
    expect(out.map((o) => o.t)).toEqual(["नमस्ते", "કેમ છો"]);
  });

  it("parses a final line without a trailing newline", () => {
    const d = new NdjsonDecoder();
    expect(d.push(new TextEncoder().encode('{"a":1}\n{"a":2}'))).toEqual([{ a: 1 }]);
    expect(d.end()).toEqual([{ a: 2 }]);
  });
});
