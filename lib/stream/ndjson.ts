/**
 * Incremental NDJSON decoder. Keeps partial lines (and partial UTF-8 sequences, via
 * TextDecoder stream mode) between chunks — Devanagari/Gujarati characters are 3
 * bytes and regularly straddle network chunk boundaries.
 */
export class NdjsonDecoder<T = unknown> {
  private readonly decoder = new TextDecoder();
  private carry = "";

  push(bytes: Uint8Array): T[] {
    return this.lines(this.decoder.decode(bytes, { stream: true }));
  }

  end(): T[] {
    const out = this.lines(this.decoder.decode());
    if (this.carry.trim()) out.push(JSON.parse(this.carry) as T);
    this.carry = "";
    return out;
  }

  private lines(text: string): T[] {
    const parts = (this.carry + text).split("\n");
    this.carry = parts.pop() ?? "";
    return parts.filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
  }
}

export async function readNdjson<T>(body: ReadableStream<Uint8Array>, onItem: (item: T) => void): Promise<void> {
  const decoder = new NdjsonDecoder<T>();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const item of decoder.push(value)) onItem(item);
  }
  for (const item of decoder.end()) onItem(item);
}

export function ndjsonLine(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value) + "\n");
}
