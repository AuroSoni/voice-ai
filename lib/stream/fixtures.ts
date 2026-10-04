// Readers for the provider traffic recorded by `npm run smoke` (fixtures/upstream/).
// Used by unit tests and by the keyless E2E mock server.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const UPSTREAM_FIXTURES = join(process.cwd(), "fixtures/upstream");

export const fixtureName = (modelId: string) => modelId.replace(/\//g, "__");

export interface WsFixtureLine {
  t: number;
  phase: "stream" | "finish";
  data: string;
}

export function readWsFixture(modelId: string, dir = UPSTREAM_FIXTURES): WsFixtureLine[] {
  return readFileSync(join(dir, `${fixtureName(modelId)}.ws.jsonl`), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((l) => !("meta" in l)) as WsFixtureLine[];
}

export interface RestFixture {
  model: string;
  responses: { status: number; contentType: string; body: string }[];
}

export function readRestFixture(modelId: string, dir = UPSTREAM_FIXTURES): RestFixture {
  return JSON.parse(readFileSync(join(dir, `${fixtureName(modelId)}.rest.json`), "utf8")) as RestFixture;
}
