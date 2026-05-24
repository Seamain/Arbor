import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Modal } from "@heroui/react";
import { Palette, GitBranch, Code2, Bell, RefreshCw, RotateCcw, X, Download, CheckCircle, AlertCircle, Sparkles, Cpu } from "lucide-react";
import {
  AppSettings, DEFAULT_SETTINGS, Theme, PullStrategy, GlassIntensity, Language,
} from "../settings";
import { useT } from "../i18n";
import { LOCALE_LABELS, LOCALES } from "../i18n";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
  onSave: (s: AppSettings) => void;
}

type Section = "appearance" | "git" | "editor" | "ai" | "notifications" | "updates";

// ── small primitives ──────────────────────────────────────────────────────────
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-label">
        <span className="settings-label">{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Select<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      className="settings-select"
      value={value}
      onChange={e => onChange(e.target.value as T)}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`settings-toggle ${checked ? "settings-toggle-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

function TextInput({
  value, onChange, placeholder,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <input
      className="settings-input"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
    />
  );
}

function NumberInput({
  value, onChange, min, max, step = 1,
}: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number;
}) {
  return (
    <div className="settings-number-wrap">
      <input
        type="range"
        className="settings-range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
      <span className="settings-number-value">{value}</span>
    </div>
  );
}

// ── section panels ────────────────────────────────────────────────────────────
function AppearanceSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const t = useT();
  return (
    <div className="settings-section-body">
      <Row label={t.settingsLanguage} hint={t.settingsLanguageHint}>
        <Select<Language>
          value={s.language ?? "en"}
          onChange={v => set({ language: v })}
          options={LOCALES.map(l => ({ value: l, label: LOCALE_LABELS[l] }))}
        />
      </Row>
      <Row label={t.settingsTheme} hint={t.settingsThemeHint}>
        <Select<Theme>
          value={s.theme}
          onChange={v => set({ theme: v })}
          options={[
            { value: "system", label: t.settingsThemeSystem },
            { value: "light",  label: t.settingsThemeLight },
            { value: "dark",   label: t.settingsThemeDark },
          ]}
        />
      </Row>
      <Row label={t.settingsFontSize} hint={t.settingsFontSizePx(s.fontSize)}>
        <NumberInput value={s.fontSize} onChange={v => set({ fontSize: v })} min={12} max={18} />
      </Row>
      <Row label={t.settingsGlassIntensity} hint={t.settingsGlassHint}>
        <Select<GlassIntensity>
          value={s.glassIntensity}
          onChange={v => set({ glassIntensity: v })}
          options={[
            { value: "none",   label: t.settingsGlassNone },
            { value: "low",    label: t.settingsGlassLow },
            { value: "medium", label: t.settingsGlassMedium },
            { value: "high",   label: t.settingsGlassHigh },
          ]}
        />
      </Row>
    </div>
  );
}

function GitSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const t = useT();
  return (
    <div className="settings-section-body">
      <Row label={t.settingsPullStrategy} hint={t.settingsPullHint}>
        <Select<PullStrategy>
          value={s.pullStrategy}
          onChange={v => set({ pullStrategy: v })}
          options={[
            { value: "merge",   label: t.settingsPullMerge },
            { value: "rebase",  label: t.settingsPullRebase },
            { value: "ff-only", label: t.settingsPullFF },
          ]}
        />
      </Row>
      <Row label={t.settingsAutoPrune} hint={t.settingsAutoPruneHint}>
        <Toggle checked={s.autoPruneOnFetch} onChange={v => set({ autoPruneOnFetch: v })} />
      </Row>
      <Row label={t.settingsCommitTemplate} hint={t.settingsCommitTemplateHint}>
        <TextInput
          value={s.commitMsgTemplate}
          onChange={v => set({ commitMsgTemplate: v })}
          placeholder={t.settingsCommitTemplatePlaceholder}
        />
      </Row>
    </div>
  );
}

function EditorSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const t = useT();
  return (
    <div className="settings-section-body">
      <Row label={t.settingsExternalEditor} hint={t.settingsExternalEditorHint}>
        <TextInput
          value={s.externalEditor}
          onChange={v => set({ externalEditor: v })}
          placeholder={t.settingsExternalEditorPlaceholder}
        />
      </Row>
      <Row label={t.settingsExternalDiff} hint={t.settingsExternalDiffHint}>
        <TextInput
          value={s.externalDiffTool}
          onChange={v => set({ externalDiffTool: v })}
          placeholder={t.settingsExternalDiffPlaceholder}
        />
      </Row>
    </div>
  );
}

function NotificationsSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const t = useT();
  return (
    <div className="settings-section-body">
      <Row label={t.settingsFileWatcher} hint={t.settingsFileWatcherHint}>
        <Toggle checked={s.fileWatcherEnabled} onChange={v => set({ fileWatcherEnabled: v })} />
      </Row>
      <Row label={t.settingsWatcherDebounce} hint={t.settingsWatcherDebounceHint(s.fileWatcherDebounceMs)}>
        <NumberInput
          value={s.fileWatcherDebounceMs}
          onChange={v => set({ fileWatcherDebounceMs: v })}
          min={200} max={5000} step={100}
        />
      </Row>
      <Row label={t.settingsNotifyPush} hint={t.settingsNotifyPushHint}>
        <Toggle checked={s.notifyOnPush} onChange={v => set({ notifyOnPush: v })} />
      </Row>
      <Row label={t.settingsNotifyPull} hint={t.settingsNotifyPullHint}>
        <Toggle checked={s.notifyOnPull} onChange={v => set({ notifyOnPull: v })} />
      </Row>
    </div>
  );
}

// ── Updates section ───────────────────────────────────────────────────────────
type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; version: string; body: string | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

function UpdatesSection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const t = useT();
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [appVersion, setAppVersion] = useState<string>("");

  // Load current version once on mount
  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => setAppVersion("—"));
  }, []);

  async function handleCheck() {
    setStatus({ kind: "checking" });
    try {
      const info = await invoke<{ version: string; body: string | null } | null>("check_for_updates");
      if (info) {
        setStatus({ kind: "available", version: info.version, body: info.body });
      } else {
        setStatus({ kind: "upToDate" });
      }
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }

  async function handleInstall() {
    setStatus({ kind: "installing" });
    try {
      await invoke("install_update");
      // install_update calls app.restart(), so this line won't be reached on success
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }

  return (
    <div className="settings-section-body">
      {/* Current version row */}
      <Row label={t.settingsCurrentVersion}>
        <span className="settings-version-badge">{appVersion || "—"}</span>
      </Row>

      {/* Auto-check toggle */}
      <Row label={t.settingsAutoCheckUpdates} hint={t.settingsAutoCheckUpdatesHint}>
        <Toggle checked={s.autoCheckUpdates} onChange={v => set({ autoCheckUpdates: v })} />
      </Row>

      {/* Manual check area */}
      <div className="settings-update-card">
        {status.kind === "idle" && (
          <button className="settings-check-btn" onClick={handleCheck}>
            <RefreshCw size={13} />
            {t.settingsCheckNow}
          </button>
        )}

        {status.kind === "checking" && (
          <div className="settings-update-state settings-update-checking">
            <RefreshCw size={14} className="settings-spin" />
            {t.settingsChecking}
          </div>
        )}

        {status.kind === "upToDate" && (
          <div className="settings-update-state settings-update-ok">
            <CheckCircle size={14} />
            {t.settingsUpToDate}
            <button className="settings-check-again-btn" onClick={handleCheck}>
              <RefreshCw size={11} />
            </button>
          </div>
        )}

        {status.kind === "available" && (
          <div className="settings-update-available">
            <div className="settings-update-header">
              <Sparkles size={14} className="settings-update-sparkle" />
              <span className="settings-update-version">{t.settingsUpdateAvailable(status.version)}</span>
            </div>
            {status.body && (
              <details className="settings-update-notes">
                <summary>{t.settingsUpdateNotes}</summary>
                <pre className="settings-update-body">{status.body}</pre>
              </details>
            )}
            <button className="settings-install-btn" onClick={handleInstall}>
              <Download size={13} />
              {t.settingsInstallUpdate}
            </button>
          </div>
        )}

        {status.kind === "installing" && (
          <div className="settings-update-state settings-update-checking">
            <RefreshCw size={14} className="settings-spin" />
            {t.settingsInstalling}
          </div>
        )}

        {status.kind === "error" && (
          <div className="settings-update-state settings-update-error">
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{t.settingsUpdateError}</div>
              <div className="settings-update-errormsg">
                {/* Show a friendly hint for the most common errors */}
                {status.message.toLowerCase().includes("fetch") ||
                 status.message.toLowerCase().includes("network") ||
                 status.message.toLowerCase().includes("remote") ||
                 status.message.toLowerCase().includes("404") ||
                 status.message.toLowerCase().includes("json")
                  ? t.settingsUpdateNetworkError
                  : status.message}
              </div>
            </div>
            <button className="settings-check-again-btn" onClick={handleCheck} style={{ flexShrink: 0 }}>
              <RefreshCw size={11} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI section ────────────────────────────────────────────────────────────────
const RECOMMENDED_MODELS = [
  {
    name: "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf",
    label: "Qwen2.5 0.5B (Q4_K_M, ~400MB)",
  },
  {
    name: "tinyllama-1.1b-chat-v1.0.q4_k_m.gguf",
    url: "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
    label: "TinyLlama 1.1B Chat (Q4_K_M, ~670MB)",
  },
];

function AISection({ s, set }: { s: AppSettings; set: (p: Partial<AppSettings>) => void }) {
  const t = useT();
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [modelsDir, setModelsDir] = useState<string>("");
  const [downloading, setDownloading] = useState<boolean>(false);
  const [downloadStatus, setDownloadStatus] = useState<string>("");

  useEffect(() => {
    invoke<string[]>("ai_list_local_models").then(setLocalModels).catch(() => {});
    invoke<string>("ai_models_dir").then(setModelsDir).catch(() => {});
  }, []);

  async function handleDownload(url: string, filename: string) {
    setDownloading(true);
    setDownloadStatus(t.aiDownloading);
    try {
      await invoke("ai_download_model", { url, filename });
      setDownloadStatus(t.aiDownloadSuccess);
      const models = await invoke<string[]>("ai_list_local_models");
      setLocalModels(models);
      set({ aiLocalModel: filename });
    } catch (e) {
      setDownloadStatus(`${t.aiDownloadError}: ${e}`);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="settings-section-body">
      <Row label={t.aiUseLocalModel} hint={t.aiUseLocalModelHint}>
        <Toggle checked={s.aiUseLocalModel} onChange={v => set({ aiUseLocalModel: v })} />
      </Row>

      {s.aiUseLocalModel ? (
        <>
          <Row label={t.aiLocalModelLabel} hint={t.aiLocalModelHint}>
            {localModels.length > 0 ? (
              <Select
                value={s.aiLocalModel}
                onChange={v => set({ aiLocalModel: v })}
                options={localModels.map(m => ({ value: m, label: m }))}
              />
            ) : (
              <span className="text-xs text-default-500">{t.aiNoLocalModel}</span>
            )}
          </Row>
          <Row label={t.aiModelsDir} hint={t.aiModelsDirHint}>
            <span className="text-xs text-default-500 font-mono">{modelsDir || "…"}</span>
          </Row>
          <div className="settings-row">
            <div className="settings-row-label">
              <span className="settings-label">{t.aiDownloadModel}</span>
              <span className="settings-hint">{t.aiDownloadModelHint}</span>
            </div>
            <div className="settings-control flex flex-col gap-2">
              {RECOMMENDED_MODELS.map(m => (
                <button
                  key={m.name}
                  className="toolbar-button px-3 py-1.5 text-xs rounded-lg"
                  disabled={downloading || localModels.includes(m.name)}
                  onClick={() => handleDownload(m.url, m.name)}
                >
                  {localModels.includes(m.name) ? "✓ " : ""}{m.label}
                </button>
              ))}
              {downloadStatus && (
                <span className="text-xs text-default-500">{downloadStatus}</span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          <Row label={t.aiEndpoint} hint={t.aiEndpointHint}>
            <TextInput value={s.aiEndpoint} onChange={v => set({ aiEndpoint: v })} placeholder="https://api.openai.com/v1" />
          </Row>
          <Row label={t.aiApiKeyLabel} hint={t.aiApiKeyHint}>
            <TextInput value={s.aiApiKey} onChange={v => set({ aiApiKey: v })} placeholder="sk-..." />
          </Row>
          <Row label={t.aiModelLabel} hint={t.aiModelHint}>
            <TextInput value={s.aiModel} onChange={v => set({ aiModel: v })} placeholder="gpt-4o-mini" />
          </Row>
        </>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────
export function SettingsModal({ isOpen, onClose, settings, onSave }: Props) {
  const t = useT();
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [activeSection, setActiveSection] = useState<Section>("appearance");

  const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
    { id: "appearance",    label: t.settingsAppearance,    icon: <Palette size={15} /> },
    { id: "git",          label: t.settingsGitBehaviour,   icon: <GitBranch size={15} /> },
    { id: "editor",       label: t.settingsEditorTools,    icon: <Code2 size={15} /> },
    { id: "ai",           label: t.aiCommitMessage,        icon: <Cpu size={15} /> },
    { id: "notifications",label: t.settingsNotifications,  icon: <Bell size={15} /> },
    { id: "updates",      label: t.settingsUpdates,        icon: <RefreshCw size={15} /> },
  ];

  function handleOpen() {
    setDraft(settings);
    setActiveSection("appearance");
  }

  function patch(partial: Partial<AppSettings>) {
    setDraft(prev => ({ ...prev, ...partial }));
  }

  function handleSave() {
    onSave(draft);
    onClose();
  }

  function handleReset() {
    if (confirm(t.settingsResetConfirm)) {
      setDraft({ ...DEFAULT_SETTINGS });
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={open => { if (!open) onClose(); else handleOpen(); }}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="app-modal settings-modal">
            {/* Header */}
            <div className="settings-header">
              <span className="settings-title">{t.settingsTitle}</span>
              <button className="settings-close-btn" onClick={onClose} aria-label={t.close}>
                <X size={16} />
              </button>
            </div>

            <div className="settings-body">
              {/* Sidebar nav */}
              <nav className="settings-nav">
                {SECTIONS.map(sec => (
                  <button
                    key={sec.id}
                    className={`settings-nav-item ${activeSection === sec.id ? "settings-nav-item-active" : ""}`}
                    onClick={() => setActiveSection(sec.id)}
                  >
                    <span className="settings-nav-icon">{sec.icon}</span>
                    {sec.label}
                  </button>
                ))}
              </nav>

              {/* Content */}
              <div className="settings-content">
                {activeSection === "appearance"    && <AppearanceSection    s={draft} set={patch} />}
                {activeSection === "git"           && <GitSection           s={draft} set={patch} />}
                {activeSection === "editor"        && <EditorSection        s={draft} set={patch} />}
                {activeSection === "ai"            && <AISection            s={draft} set={patch} />}
                {activeSection === "notifications" && <NotificationsSection s={draft} set={patch} />}
                {activeSection === "updates"       && <UpdatesSection       s={draft} set={patch} />}
              </div>
            </div>

            {/* Footer */}
            <div className="settings-footer">
              <button className="settings-reset-btn" onClick={handleReset}>
                <RotateCcw size={13} />
                {t.settingsResetDefaults}
              </button>
              <div className="flex gap-2">
                <button className="toolbar-button px-4 py-2 text-sm rounded-lg text-default-600" onClick={onClose}>
                  {t.cancel}
                </button>
                <button className="settings-save-btn" onClick={handleSave}>
                  {t.save}
                </button>
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
