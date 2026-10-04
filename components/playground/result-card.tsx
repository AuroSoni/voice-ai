"use client";

import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, CopyIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getModel, PROVIDERS } from "@/lib/models/registry";
import type { CardState, CardStatus } from "@/lib/run/store";
import { finalText, fullText, partialText } from "@/lib/stream/transcript";
import { detectScript } from "@/lib/text/script";
import { cn } from "@/lib/utils";
import { formatMs, TRANSPORT_LABEL } from "./format";

const STATUS: Record<CardStatus, { label: string; className: string; spin?: boolean }> = {
  queued: { label: "waiting for recording", className: "bg-muted text-muted-foreground" },
  connecting: { label: "connecting", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300", spin: true },
  listening: { label: "listening", className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300" },
  finalizing: { label: "finalizing", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300", spin: true },
  transcribing: { label: "transcribing", className: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300", spin: true },
  done: { label: "done", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  error: { label: "error", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

const ERROR_LABEL: Record<string, string> = {
  "not-configured": "Not configured",
  token: "Couldn't get a session token",
  connect: "Connection failed",
  "relay-unavailable": "Relay unavailable",
  upstream: "Provider error",
  timeout: "Timed out",
  "no-speech": "No speech",
  cancelled: "Cancelled",
};

const EMPTY_TEXT: Partial<Record<CardStatus, string>> = {
  queued: "Transcribed after you press Stop.",
  connecting: "Connecting…",
  listening: "Listening…",
  finalizing: "Waiting for the final transcript…",
  transcribing: "Transcribing…",
  done: "(empty transcript)",
};

export function ResultCard({ card }: { card: CardState }) {
  const model = getModel(card.modelId)!;
  const status = STATUS[card.status];
  const finals = finalText(card.segments);
  const partial = partialText(card.segments);
  const text = fullText(card.segments);
  const script = detectScript(text);
  const [copied, setCopied] = useState(false);
  const metrics = [
    ["connect", formatMs(card.metrics.connectMs)],
    ["first text", formatMs(card.metrics.firstTextMs)],
    ["stop → final", formatMs(card.metrics.finalizeMs)],
    ["provider", formatMs(card.metrics.upstreamMs)],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <Card className="gap-3 py-4" data-testid={`card-${card.modelId}`} data-status={card.status}>
      <CardHeader className="px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {PROVIDERS[model.provider].label} · {TRANSPORT_LABEL[model.transport]}
            </div>
            <div className="truncate font-semibold">{model.label}</div>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", status.className)} data-testid="status">
            {status.spin && <Loader2Icon className="size-3 animate-spin" />}
            {status.label}
          </span>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-2 px-4">
        <div className="min-h-20 rounded-lg bg-muted/40 p-3 text-[15px] leading-relaxed whitespace-pre-wrap" lang="hi" data-testid="transcript">
          {text ? (
            <>
              {finals && <span data-testid="final-text">{finals}</span>}
              {finals && partial && " "}
              {partial && <span className="text-muted-foreground italic" data-testid="partial-text">{partial}</span>}
            </>
          ) : (
            <span className="text-sm text-muted-foreground">{EMPTY_TEXT[card.status]}</span>
          )}
        </div>
        {card.error && (
          <div className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-300" data-testid="error">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 break-words">
              <span className="font-medium">{ERROR_LABEL[card.error.kind] ?? "Error"}:</span> {card.error.message}
            </div>
          </div>
        )}
        {card.warning && !card.error && (
          <div className="flex gap-2 rounded-lg bg-amber-50 p-2.5 text-sm text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{card.warning}</span>
          </div>
        )}
        {model.note && <p className="text-xs text-muted-foreground">{model.note}</p>}
      </CardContent>

      <CardFooter className="flex flex-col items-stretch gap-2 px-4">
        <div className="flex flex-wrap gap-1.5 text-xs">
          {card.languageSent && <Badge variant="outline">sent: {card.languageSent}</Badge>}
          {card.detectedLanguage && <Badge variant="outline">detected: {card.detectedLanguage}</Badge>}
          {script.dominant && (
            <Badge variant="secondary" data-testid="script">
              {script.mixed ? "mixed script" : script.dominant}
            </Badge>
          )}
        </div>
        {metrics.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="metrics">
            {metrics.map(([k, v]) => (
              <span key={k}>
                {k} <span className="font-mono text-foreground">{v}</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={!text}
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />} Copy
          </Button>
          <Collapsible className="flex-1">
            <CollapsibleTrigger
              render={
                <Button variant="ghost" size="xs" className="group" disabled={card.raw.length === 0}>
                  <ChevronDownIcon className="transition-transform group-data-panel-open:rotate-180" /> Raw ({card.raw.length})
                </Button>
              }
            />
            <CollapsibleContent>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-snug">
                {card.raw.map((r) => JSON.stringify(r)).join("\n")}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardFooter>
    </Card>
  );
}
