import { cookies } from "next/headers";
import { connection } from "next/server";
import { Playground } from "@/components/playground/playground";
import type { ProviderId } from "@/lib/models/types";
import { configuredProviders } from "@/lib/server/env";
import { overridesAllowed } from "@/lib/server/upstreams";

export default async function Home() {
  // Read keys at request time, not build time (only the booleans reach the client).
  await connection();
  const configured = configuredProviders();

  // E2E hook (local test runs only): a cookie can mark providers as unconfigured.
  if (process.env.STT_E2E === "1" && overridesAllowed()) {
    const disabled = (await cookies()).get("stt_e2e_disable")?.value.split(",") ?? [];
    for (const p of disabled) if (p in configured) configured[p as ProviderId] = false;
  }

  return <Playground configured={configured} />;
}
