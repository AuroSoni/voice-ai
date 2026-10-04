"use client";

import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { MicSettings as Settings } from "@/lib/audio/engine";

interface Props {
  value: Settings;
  disabled: boolean;
  onChange: (value: Settings) => void;
  capture?: { contextSampleRate: number; track?: MediaTrackSettings };
}

const TOGGLES: { key: "echoCancellation" | "noiseSuppression" | "autoGainControl"; label: string }[] = [
  { key: "echoCancellation", label: "Echo cancellation" },
  { key: "noiseSuppression", label: "Noise suppression" },
  { key: "autoGainControl", label: "Auto gain" },
];

export function MicSettings({ value, disabled, onChange, capture }: Props) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((all) => setDevices(all.filter((d) => d.kind === "audioinput" && d.deviceId)))
        .catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", load);
  }, [capture]);

  const items = [{ value: "default", label: "System default" }, ...devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }))];

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center justify-between text-sm font-semibold">
        Microphone
        <ChevronDownIcon className="size-4 transition-transform group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 pt-3 text-sm">
        <Select
          items={items}
          value={value.deviceId ?? "default"}
          onValueChange={(v) => onChange({ ...value, deviceId: !v || v === "default" ? undefined : v })}
          disabled={disabled}
        >
          <SelectTrigger className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center justify-between gap-2 text-xs">
            {t.label}
            <Switch checked={value[t.key]} disabled={disabled} onCheckedChange={(on) => onChange({ ...value, [t.key]: on })} />
          </label>
        ))}
        <p className="text-[11px] text-muted-foreground">
          Browser processing can help or hurt recognition; turn it off to send the raw mic signal.
          {capture && ` Last capture: ${capture.contextSampleRate} Hz${capture.track?.sampleRate ? `, mic ${capture.track.sampleRate} Hz` : ""}.`}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
