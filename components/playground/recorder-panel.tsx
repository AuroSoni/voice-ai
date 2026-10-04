"use client";

import { DownloadIcon, Loader2Icon, MicIcon, RotateCcwIcon, SquareIcon, UploadIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { MAX_RECORDING_SECONDS } from "@/lib/audio/bus";
import type { RunState } from "@/lib/run/store";
import { cn } from "@/lib/utils";
import { formatClock } from "./format";

interface Props {
  run: RunState;
  canStart: boolean;
  canRerun: boolean;
  onStart: () => void;
  onStop: () => void;
  onRerun: () => void;
  onUpload: (file: File) => void;
}

export function RecorderPanel({ run, canStart, canRerun, onStart, onStop, onRerun, onUpload }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const recording = run.phase === "recording";
  const busy = run.phase === "starting" || run.phase === "finalizing";
  const progress = Math.min(1, run.elapsed / MAX_RECORDING_SECONDS);
  const remaining = MAX_RECORDING_SECONDS - run.elapsed;

  let label = "Start";
  if (run.phase === "starting") label = run.source === "mic" ? "Allow microphone…" : "Starting…";
  else if (recording) label = run.source === "mic" ? "Stop" : "Playing clip…";
  else if (run.phase === "finalizing") label = "Transcribing…";

  return (
    <section className="rounded-xl border bg-card p-5 shadow-xs" aria-label="Recorder">
      <div className="flex flex-col items-center gap-5 sm:flex-row">
        <button
          type="button"
          data-testid="record-button"
          onClick={recording ? onStop : onStart}
          disabled={busy || (!recording && !canStart) || (recording && run.source !== "mic")}
          className={cn(
            "relative flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-full text-white shadow-md transition-all outline-none focus-visible:ring-4 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50",
            recording ? "bg-red-600 hover:bg-red-700" : "bg-primary hover:bg-primary/85",
          )}
          aria-label={label}
        >
          {recording && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />}
          {busy ? (
            <Loader2Icon className="size-9 animate-spin" />
          ) : recording ? (
            <SquareIcon className="size-8 fill-current" />
          ) : (
            <MicIcon className="size-10" />
          )}
        </button>

        <div className="flex w-full flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <div className="text-lg font-semibold">{label}</div>
              <div className="text-sm text-muted-foreground">
                {recording
                  ? remaining <= 10
                    ? `Stops automatically in ${Math.ceil(remaining)}s`
                    : "Speak now. Recording stops automatically at 1:00."
                  : canStart
                    ? "Press Start and speak (up to 60 seconds)."
                    : "Pick at least one model to start."}
              </div>
            </div>
            <div className="font-mono text-2xl tabular-nums" data-testid="timer">
              {formatClock(run.elapsed)}
              <span className="text-base text-muted-foreground"> / {formatClock(MAX_RECORDING_SECONDS)}</span>
            </div>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn("h-full rounded-full transition-[width] duration-200", remaining <= 10 ? "bg-red-500" : "bg-primary")}
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-10">Level</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                data-testid="level-meter"
                data-level={recording ? run.level.toFixed(3) : "0"}
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                style={{ width: `${recording ? Math.min(100, run.level * 400) : 0}%` }}
              />
            </div>
            {recording && run.speechAt !== null && <span className="text-emerald-600">speech detected</span>}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
        {run.recording && (
          <>
            <audio controls src={run.recording.url} className="h-9 max-w-full" data-testid="playback" />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={run.recording.url} download={`recording-${run.runId}.wav`} data-testid="download" />}
            >
              <DownloadIcon /> WAV
            </Button>
            <Button variant="outline" size="sm" onClick={onRerun} disabled={!canRerun} data-testid="rerun">
              <RotateCcwIcon /> Re-run on this recording
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInput.current?.click()}
          disabled={busy || recording || !canStart}
          data-testid="upload"
        >
          <UploadIcon /> Upload a clip
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/webm"
          className="hidden"
          data-testid="upload-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUpload(file);
          }}
        />
      </div>
    </section>
  );
}
