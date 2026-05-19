// ─── Settings types & persistence ───────────────────────────────────────────

export type Theme = "system" | "light" | "dark";
export type PullStrategy = "merge" | "rebase" | "ff-only";
export type GlassIntensity = "none" | "low" | "medium" | "high";
export type Language = "en" | "zh-CN" | "zh-TW";

export interface AppSettings {
  // Appearance
  language: Language;
  theme: Theme;
  fontSize: number;           // px, 12–18
  glassIntensity: GlassIntensity;

  // Git behaviour
  pullStrategy: PullStrategy;
  autoPruneOnFetch: boolean;
  commitMsgTemplate: string;

  // Editor / tools
  externalEditor: string;     // e.g. "code", "cursor", "vim"
  externalDiffTool: string;   // e.g. "vimdiff", "meld", ""

  // Notifications / auto-refresh
  fileWatcherEnabled: boolean;
  fileWatcherDebounceMs: number;  // 200–5000
  notifyOnPush: boolean;
  notifyOnPull: boolean;

  // Updates
  autoCheckUpdates: boolean;  // check on app launch
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: "en",
  theme: "system",
  fontSize: 14,
  glassIntensity: "medium",

  pullStrategy: "merge",
  autoPruneOnFetch: true,
  commitMsgTemplate: "",

  externalEditor: "code",
  externalDiffTool: "",

  fileWatcherEnabled: true,
  fileWatcherDebounceMs: 500,
  notifyOnPush: false,
  notifyOnPull: false,

  autoCheckUpdates: true,
};

const SETTINGS_KEY = "arbor-settings";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}
