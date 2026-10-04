import "server-only";
import { PROVIDERS } from "@/lib/models/registry";
import type { ProviderId } from "@/lib/models/types";

export function providerKey(provider: ProviderId): string | undefined {
  const value = process.env[PROVIDERS[provider].envVar];
  return value && value.trim() ? value.trim() : undefined;
}

export function configuredProviders(): Record<ProviderId, boolean> {
  return Object.fromEntries(
    (Object.keys(PROVIDERS) as ProviderId[]).map((p) => [p, Boolean(providerKey(p))]),
  ) as Record<ProviderId, boolean>;
}
