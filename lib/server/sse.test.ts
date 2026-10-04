import { describe, expect, it } from "vitest";
import { sseData } from "./sse";

function streamOf(...parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) c.enqueue(enc.encode(p));
      c.close();
    },
  });
}

describe("sseData", () => {
  it("yields data payloads across chunk boundaries", async () => {
    const out: string[] = [];
    for await (const d of sseData(streamOf('data: {"a"', ':1}\n\nevent: x\ndata: two\r\n\r\n', "data: [DONE]"))) out.push(d);
    expect(out).toEqual(['{"a":1}', "two", "[DONE]"]);
  });
});
