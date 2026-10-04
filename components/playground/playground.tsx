"use client";

import { AudioLinesIcon, InfoIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_MIC, preloadWorklet } from "@/lib/audio/engine";
import { isLanguageId, LANGUAGES } from "@/lib/languages";
import { MODELS } from "@/lib/models/registry";
import type { ProviderId } from "@/lib/models/types";
import { RunController } from "@/lib/run/controller";
import { createPrefsStore } from "@/lib/run/prefs";
import { RunStore } from "@/lib/run/store";
import { MicSettings } from "./mic-settings";
import { ModelPicker } from "./model-picker";
import { RecorderPanel } from "./recorder-panel";
import { ResultCard } from "./result-card";

export function Playground({ configured }: { configured: Record<ProviderId, boolean> }) {
  const store = useMemo(() => new RunStore(), []);
  const controller = useMemo(() => new RunController(store), [store]);
  const run = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  const prefsStore = useMemo(
    () =>
      createPrefsStore({
        language: "hi",
        selected: MODELS.filter((m) => configured[m.provider]).map((m) => m.id),
        options: {},
        mic: DEFAULT_MIC,
      }),
    [configured],
  );
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, prefsStore.getServerSnapshot);
  const setPrefs = prefsStore.set;
  useEffect(() => {
    void preloadWorklet();
    return () => controller.cancel();
  }, [controller]);

  const activeIds = prefs.selected.filter((id) => {
    const m = MODELS.find((x) => x.id === id);
    return m && configured[m.provider];
  });
  const busy = run.phase === "starting" || run.phase === "recording" || run.phase === "finalizing";
  const request = useCallback(
    () => ({ modelIds: activeIds, language: prefs.language, options: prefs.options, mic: prefs.mic }),
    [activeIds, prefs],
  );

  const anyConfigured = Object.values(configured).some(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <AudioLinesIcon className="size-5" /> STT Playground
          </h1>
          <p className="text-sm text-muted-foreground">
            Speak once, compare every speech-to-text model on the same audio — English, Hindi, Gujarati, Marathi and Marwari.
          </p>
        </div>
      </header>

      {!anyConfigured && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <InfoIcon className="mt-0.5 size-4 shrink-0" /> No provider keys are configured. Add them to .env and restart.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6 lg:self-start">
          <section className="flex flex-col gap-2" aria-label="Language">
            <h2 className="text-sm font-semibold">Language spoken</h2>
            <Select
              items={LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
              value={prefs.language}
              onValueChange={(v) => isLanguageId(v) && setPrefs((p) => ({ ...p, language: v }))}
              disabled={busy}
            >
              <SelectTrigger className="w-full" data-testid="language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANGUAGES.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {prefs.language === "mwr" && (
              <p className="text-xs text-muted-foreground">
                No provider has a Marwari code. Code-based models get Hindi; models that accept prompts also get a Marwari hint.
              </p>
            )}
          </section>

          <ModelPicker
            configured={configured}
            selected={prefs.selected}
            options={prefs.options}
            disabled={busy}
            onToggle={(id, on) =>
              setPrefs((p) => ({ ...p, selected: on ? [...new Set([...p.selected, id])] : p.selected.filter((x) => x !== id) }))
            }
            onSetAll={(ids) => setPrefs((p) => ({ ...p, selected: ids }))}
            onOption={(id, key, value) => setPrefs((p) => ({ ...p, options: { ...p.options, [id]: { ...p.options[id], [key]: value } } }))}
          />

          <MicSettings value={prefs.mic} disabled={busy} capture={run.capture} onChange={(mic) => setPrefs((p) => ({ ...p, mic }))} />
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          <RecorderPanel
            run={run}
            canStart={activeIds.length > 0}
            canRerun={!busy && controller.hasRecording && activeIds.length > 0}
            onStart={() => void controller.startMic(request())}
            onStop={() => void controller.stop()}
            onRerun={() => void controller.rerun(request())}
            onUpload={(file) => void controller.startClip(request(), file)}
          />

          {run.error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300" data-testid="run-error">
              {run.error}
            </div>
          )}

          {run.order.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="results">
              {run.order.map((id) => (
                <ResultCard key={`${run.runId}:${id}`} card={run.cards[id]} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Results from each selected model appear here, side by side.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
