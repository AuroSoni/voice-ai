// Runs each REST adapter against the provider response recorded by `npm run smoke`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWav } from "@/lib/audio/wav";
import { MODELS, isStreaming } from "@/lib/models/registry";
import { readRestFixture } from "@/lib/stream/fixtures";
import { restAdapterFor } from ".";
import type { RestEvent } from "./types";

const clip = readFileSync(join(process.cwd(), "fixtures/audio/hi-4s.wav"));
const pcm = parseWav(clip).pcm;

async function run(modelId: string, respond: (url: string) => Response) {
  const model = MODELS.find((m) => m.id === modelId)!;
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    calls.push(String(input));
    return respond(String(input));
  };
  const events: RestEvent[] = [];
  for await (const e of restAdapterFor(model)({
    model,
    wav: new Uint8Array(clip),
    pcm,
    language: "hi",
    options: {},
    key: "test-key",
    fetch: fakeFetch,
  })) {
    events.push(e);
  }
  return { events, calls };
}

const restModels = MODELS.filter((m) => !isStreaming(m)).map((m) => m.id);

describe.each(restModels)("%s REST adapter", (modelId) => {
  it("parses the recorded response", async () => {
    const fx = readRestFixture(modelId).responses[0];
    const { events } = await run(
      modelId,
      () => new Response(fx.body, { status: fx.status, headers: { "content-type": fx.contentType } }),
    );
    const final = events.at(-1)!;
    expect(final.type).toBe("final");
    expect(final.text).toMatch(/नमस्ते.*मौसम/);
    if (MODELS.find((m) => m.id === modelId)!.transport === "rest-stream") {
      expect(events.filter((e) => e.type === "delta").length).toBeGreaterThan(0);
    }
  });

  it("throws on upstream errors", async () => {
    await expect(run(modelId, () => new Response("nope", { status: 401 }))).rejects.toThrow(/401/);
  });
});

describe("Sarvam REST chunking", () => {
  it("splits audio longer than 29s into ordered requests", async () => {
    const model = MODELS.find((m) => m.id === "sarvam/saaras-v4")!;
    const long = new Int16Array(16000 * 45);
    let n = 0;
    const fakeFetch: typeof fetch = async () => {
      const i = n++;
      // Second piece answers first; output must still be in order.
      await new Promise((r) => setTimeout(r, i === 0 ? 20 : 0));
      return Response.json({ transcript: `piece${i}`, language_code: "hi-IN" });
    };
    const events: RestEvent[] = [];
    for await (const e of restAdapterFor(model)({
      model,
      wav: new Uint8Array(),
      pcm: long,
      language: "hi",
      options: {},
      key: "k",
      fetch: fakeFetch,
    })) {
      events.push(e);
    }
    expect(n).toBe(2);
    expect(events.at(-1)).toMatchObject({ type: "final", text: "piece0 piece1", language: "hi-IN" });
  });
});
