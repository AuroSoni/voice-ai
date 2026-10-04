export function formatMs(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms)) return null;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const TRANSPORT_LABEL = {
  "ws-direct": "WebSocket",
  "ws-relay": "WebSocket · relay",
  "rest-stream": "REST · streamed",
  rest: "REST",
} as const;
