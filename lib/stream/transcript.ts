// Transcript state shared by every model card: an ordered list of segments, each either
// final or a still-changing partial. Immutable updates so React can diff cheaply.
import type { ProtocolEvent } from "./protocols";

export interface Segment {
  key: string;
  text: string;
  final: boolean;
}

export function applyEvent(segments: Segment[], e: ProtocolEvent): Segment[] {
  switch (e.type) {
    case "partial": {
      const i = segments.findIndex((s) => s.key === e.key);
      if (i < 0) return [...segments, { key: e.key, text: e.text, final: false }];
      if (segments[i].final) return segments;
      const text = e.mode === "append" ? segments[i].text + e.text : e.text;
      return replaceAt(segments, i, { ...segments[i], text });
    }
    case "final": {
      const i = segments.findIndex((s) => s.key === e.key);
      const seg = { key: e.key, text: e.text, final: true };
      return i < 0 ? [...segments, seg] : replaceAt(segments, i, seg);
    }
    case "order": {
      const existing = segments.find((s) => s.key === e.key) ?? { key: e.key, text: "", final: false };
      const rest = segments.filter((s) => s.key !== e.key);
      const at = e.after === null ? 0 : rest.findIndex((s) => s.key === e.after) + 1;
      if (e.after !== null && at === 0) return segments; // unknown anchor: keep arrival order
      return [...rest.slice(0, at), existing, ...rest.slice(at)];
    }
    default:
      return segments;
  }
}

function replaceAt(segments: Segment[], i: number, seg: Segment): Segment[] {
  const next = segments.slice();
  next[i] = seg;
  return next;
}

const joinText = (segs: Segment[]) =>
  segs
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");

export const finalText = (segments: Segment[]) => joinText(segments.filter((s) => s.final));
export const partialText = (segments: Segment[]) => joinText(segments.filter((s) => !s.final));
export const fullText = (segments: Segment[]) => joinText(segments);
