import { authMode } from "@/lib/auth/session";
import { configuredProviders } from "@/lib/server/env";
import { overridesAllowed } from "@/lib/server/upstreams";

export function GET() {
  return Response.json({
    ok: true,
    providers: configuredProviders(),
    auth: authMode(),
    env: process.env.VERCEL_ENV ?? "local",
    region: process.env.VERCEL_REGION ?? "local",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    // True only when every provider points at the local E2E mock (never on deployments).
    mockUpstreams:
      overridesAllowed() &&
      ["SARVAM", "GEMINI", "OPENAI", "ELEVENLABS"].every((p) => process.env[`STT_UPSTREAM_${p}`]?.startsWith("http://127.0.0.1")),
  });
}
