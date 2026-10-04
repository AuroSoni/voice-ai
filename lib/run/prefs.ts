// User preferences persisted in localStorage, read through useSyncExternalStore so the
// server render (defaults) and the first client render match, then switch to saved values.
import { DEFAULT_MIC, type MicSettings } from "@/lib/audio/engine";
import { isLanguageId } from "@/lib/languages";
import { MODELS } from "@/lib/models/registry";
import type { LanguageId, ModelOptions } from "@/lib/models/types";

const KEY = "stt-playground:prefs:v1";

export interface Prefs {
  language: LanguageId;
  selected: string[];
  options: Record<string, ModelOptions>;
  mic: MicSettings;
}

export interface PrefsStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => Prefs;
  getServerSnapshot: () => Prefs;
  set: (update: (p: Prefs) => Prefs) => void;
}

function sanitize(raw: string | null, defaults: Prefs): Prefs {
  try {
    const saved = JSON.parse(raw ?? "null") as Partial<Prefs> | null;
    if (!saved) return defaults;
    return {
      language: isLanguageId(saved.language) ? saved.language : defaults.language,
      selected: Array.isArray(saved.selected) ? saved.selected.filter((id) => MODELS.some((m) => m.id === id)) : defaults.selected,
      options: saved.options && typeof saved.options === "object" ? saved.options : {},
      mic: { ...DEFAULT_MIC, ...saved.mic },
    };
  } catch {
    return defaults;
  }
}

export function createPrefsStore(defaults: Prefs): PrefsStore {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: Prefs } | null = null;
  const read = () => {
    const raw = localStorage.getItem(KEY);
    if (!cache || cache.raw !== raw) cache = { raw, value: sanitize(raw, defaults) };
    return cache.value;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    getSnapshot: read,
    getServerSnapshot: () => defaults,
    set(update) {
      localStorage.setItem(KEY, JSON.stringify(update(read())));
      listeners.forEach((l) => l());
    },
  };
}
