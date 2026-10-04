"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MODELS, PROVIDERS } from "@/lib/models/registry";
import type { ModelOptions, ProviderId } from "@/lib/models/types";
import { TRANSPORT_LABEL } from "./format";

interface Props {
  configured: Record<ProviderId, boolean>;
  selected: string[];
  options: Record<string, ModelOptions>;
  disabled: boolean;
  onToggle: (modelId: string, on: boolean) => void;
  onSetAll: (ids: string[]) => void;
  onOption: (modelId: string, key: string, value: string) => void;
}

export function ModelPicker({ configured, selected, options, disabled, onToggle, onSetAll, onOption }: Props) {
  const available = MODELS.filter((m) => configured[m.provider]).map((m) => m.id);
  return (
    <section aria-label="Models" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Models</h2>
        <div className="flex gap-2 text-xs">
          <button type="button" className="cursor-pointer text-primary hover:underline disabled:opacity-50" disabled={disabled} onClick={() => onSetAll(available)}>
            All
          </button>
          <button type="button" className="cursor-pointer text-primary hover:underline disabled:opacity-50" disabled={disabled} onClick={() => onSetAll([])}>
            None
          </button>
        </div>
      </div>
      {(Object.keys(PROVIDERS) as ProviderId[]).map((p) => {
        const provider = PROVIDERS[p];
        const ok = configured[p];
        return (
          <div key={p} className="flex flex-col gap-1.5" data-testid={`provider-${p}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{provider.label}</span>
              {!ok && (
                <Badge variant="outline" className="font-mono text-[10px]" data-testid={`missing-${p}`}>
                  set {provider.envVar}
                </Badge>
              )}
            </div>
            {MODELS.filter((m) => m.provider === p).map((m) => {
              const checked = ok && selected.includes(m.id);
              return (
                <div key={m.id} className="flex flex-col gap-1 rounded-lg border px-2.5 py-2 has-data-checked:border-primary/40 has-data-checked:bg-primary/5">
                  <label className="flex cursor-pointer items-start gap-2.5 text-sm has-disabled:cursor-not-allowed has-disabled:opacity-50">
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={!ok || disabled}
                      onCheckedChange={(on) => onToggle(m.id, on)}
                      data-testid={`model-${m.id}`}
                      aria-label={`${provider.label} ${m.label}`}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="leading-tight">{m.label}</span>
                      <span className="text-[11px] text-muted-foreground">{TRANSPORT_LABEL[m.transport]}</span>
                    </span>
                  </label>
                  {checked &&
                    m.options?.map((opt) => (
                      <div key={opt.key} className="flex items-center gap-2 pl-6.5 text-xs text-muted-foreground">
                        <span>{opt.label}</span>
                        <Select
                          items={opt.choices}
                          value={options[m.id]?.[opt.key] ?? opt.default}
                          onValueChange={(v) => v && onOption(m.id, opt.key, v)}
                          disabled={disabled}
                        >
                          <SelectTrigger size="sm" className="h-7 flex-1 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {opt.choices.map((c) => (
                              <SelectItem key={c.value} value={c.value}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
