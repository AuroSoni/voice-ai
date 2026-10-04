// Replays real provider traffic (recorded by `npm run smoke` on fixtures/audio/hi-4s.wav)
// through each protocol and checks the transcript comes out right.
import { describe, expect, it } from "vitest";
import { MODELS, isStreaming } from "@/lib/models/registry";
import { readWsFixture } from "./fixtures";
import { protocolFor, type ProtocolEvent } from "./protocols";
import { applyEvent, finalText, type Segment } from "./transcript";

function replay(modelId: string) {
  const model = MODELS.find((m) => m.id === modelId)!;
  const proto = protocolFor(model);
  let segments: Segment[] = [];
  const events: ProtocolEvent[] = [];
  let finished = false;
  for (const line of readWsFixture(modelId)) {
    if (line.phase === "finish" && !finished) {
      proto.finish();
      finished = true;
    }
    for (const e of proto.parse(line.data)) {
      events.push(e);
      segments = applyEvent(segments, e);
    }
  }
  return { segments, events };
}

const streamingModels = MODELS.filter(isStreaming).map((m) => m.id);

describe.each(streamingModels)("%s protocol", (modelId) => {
  it("turns recorded traffic into the spoken sentence", () => {
    const { segments, events } = replay(modelId);
    const text = finalText(segments);
    expect(text).toMatch(/नमस्ते/);
    expect(text).toMatch(/मौसम/);
    expect(text).toMatch(/बाज़?ार/);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("signals ready and done", () => {
    const { events } = replay(modelId);
    expect(events.some((e) => e.type === "done")).toBe(true);
    const model = MODELS.find((m) => m.id === modelId)!;
    if (!protocolFor(model).readyOnOpen) expect(events[0]?.type).toBe("ready");
  });

  it("shows partial text before the final", () => {
    const { events } = replay(modelId);
    const firstPartial = events.findIndex((e) => e.type === "partial");
    const firstFinal = events.findIndex((e) => e.type === "final");
    expect(firstPartial).toBeGreaterThanOrEqual(0);
    expect(firstPartial).toBeLessThan(firstFinal);
  });
});

describe("protocol edge cases", () => {
  it("OpenAI: empty-buffer commit counts as done, other errors are fatal", () => {
    const p = protocolFor(MODELS.find((m) => m.id === "openai/gpt-live-transcribe")!);
    p.finish();
    expect(
      p.parse(JSON.stringify({ type: "error", error: { code: "input_audio_buffer_commit_empty", message: "buffer too small" } })),
    ).toEqual([{ type: "done" }]);
    expect(p.parse(JSON.stringify({ type: "error", error: { message: "bad" } }))[0]).toMatchObject({ type: "error", fatal: true });
  });

  it("Sarvam: relay errors surface as fatal errors", () => {
    const p = protocolFor(MODELS.find((m) => m.id === "sarvam/saaras-v3-realtime")!);
    expect(p.parse(JSON.stringify({ event: "relay_error", status: 403, body: "invalid key" }))[0]).toMatchObject({
      type: "error",
      fatal: true,
      message: "invalid key (403)",
    });
  });

  it("ElevenLabs: too little audio after the final commit is not an error", () => {
    const p = protocolFor(MODELS.find((m) => m.id === "elevenlabs/scribe-v2-realtime")!);
    p.finish();
    expect(p.parse(JSON.stringify({ message_type: "insufficient_audio_activity" }))).toEqual([{ type: "done" }]);
  });
});

describe("applyEvent", () => {
  it("orders segments by anchor and ignores late partials", () => {
    let s: Segment[] = [];
    s = applyEvent(s, { type: "final", key: "b", text: "two" });
    s = applyEvent(s, { type: "final", key: "a", text: "one" });
    s = applyEvent(s, { type: "order", key: "b", after: "a" });
    expect(finalText(s)).toBe("one two");
    s = applyEvent(s, { type: "partial", key: "a", text: "late", mode: "replace" });
    expect(finalText(s)).toBe("one two");
  });
});
