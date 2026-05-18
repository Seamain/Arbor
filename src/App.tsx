import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Spinner, Modal, Dropdown } from "@heroui/react";
import {
  FolderGit2, RefreshCw, ArrowDownToLine, ArrowUpFromLine,
  Terminal, FolderOpen, FileCode, GitBranch, Plus, Check,
  MoreVertical, History, X, GitCommitHorizontal, Clock, TriangleAlert,
  ChevronDown, ChevronUp, RotateCcw, Trash2, PanelLeftClose, PanelLeftOpen,
  ArchiveRestore, Eye, GitMerge, Settings, UserCircle2, Download,
} from "lucide-react";
import "./App.css";
import { GitGraphViewer } from "./components/GitGraphViewer";
import { ConflictModal } from "./components/ConflictModal";
import { LocalChangesModal } from "./components/LocalChangesModal";
import { ContextMenu } from "./components/ContextMenu";
import { SettingsModal } from "./components/SettingsModal";
import { AppSettings, loadSettings, saveSettings } from "./settings";
import { ensureNotificationPermission, notify } from "./notify";
import { GitProvider, loadProviders, saveProviders, matchRemoteToProvider, createPrUrl } from "./providers";
import { ProvidersModal } from "./components/ProvidersModal";
import { CloneModal } from "./components/CloneModal";
import { PullRequestsPanel } from "./components/PullRequestsPanel";
import { I18nContext, getTranslations } from "./i18n";

// ─── persistence ────────────────────────────────────────────────────────────
const HISTORY_KEY = "arbor-repo-history";
const PENDING_AUTO_STASHES_KEY = "arbor-pending-auto-stashes";
const MAX_HISTORY = 12;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); }
  catch { return []; }
}
function pushHistory(path: string) {
  const next = [path, ...loadHistory().filter(p => p !== path)].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
}
function deleteHistory(path: string) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(loadHistory().filter(p => p !== path)));
}
function loadPendingAutoStashes(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(PENDING_AUTO_STASHES_KEY) ?? "{}"); }
  catch { return {}; }
}
function savePendingAutoStashes(stashes: Record<string, string>) {
  localStorage.setItem(PENDING_AUTO_STASHES_KEY, JSON.stringify(stashes));
}

// ─── types ──────────────────────────────────────────────────────────────────
interface LogEntry {
  id: number;
  type: "info" | "success" | "error" | "command";
  message: string;
}

interface RepoTab {
  path: string;
  label: string;
  status: string;
  headOid: string;
  headBranch: string;
  behindCount: number;  // how many commits HEAD is behind remote
  hasConflicts: boolean; // whether there are unmerged files
  branches: string[];
  modifiedFiles: string[];
  historyLogs: string[];
  logs: LogEntry[];
  loading: Record<string, boolean>;
  selectedFile: string | null;
  fileDiff: string;
  selectedTab: "history" | "diff";
  consoleOpen: boolean;
  remoteUrl: string | null;  // origin remote URL, fetched once on open
}

function makeTab(path: string): RepoTab {
  return {
    path,
    label: path.split("/").filter(Boolean).pop() ?? path,
    status: "", headOid: "", headBranch: "", behindCount: 0, hasConflicts: false,
    branches: [], modifiedFiles: [], historyLogs: [],
    logs: [], loading: {}, selectedFile: null, fileDiff: "",
    selectedTab: "history", consoleOpen: false, remoteUrl: null,
  };
}

// Parse "branch.ab +A -B" from git status to get behind count
function parseBehindCount(status: string): number {
  for (const line of status.split("\n")) {
    if (line.startsWith("# branch.ab ")) {
      const m = line.match(/-(\d+)/);
      if (m) return parseInt(m[1]);
    }
  }
  return 0;
}

// Check for unmerged files (starts with "u ") in git status v2
function parseHasConflicts(status: string): boolean {
  for (const line of status.split("\n")) {
    if (line.startsWith("u ")) return true;
  }
  return false;
}

// Parse the "sha~|~branch" response from git_head_oid
function parseHeadOid(raw: string): { headOid: string; headBranch: string } {
  const [headOid = "", headBranch = ""] = raw.split("~|~");
  return { headOid: headOid.trim(), headBranch: headBranch.trim() };
}

// Fallback: parse branch.oid and branch.head from git status --porcelain=v2 --branch
function parseHeadFromStatus(status: string): { headOid: string; headBranch: string } {
  let headOid = "";
  let headBranch = "";
  for (const line of status.split("\n")) {
    if (line.startsWith("# branch.oid ")) headOid = line.slice(13).trim();
    if (line.startsWith("# branch.head ")) headBranch = line.slice(14).trim();
  }
  return { headOid, headBranch };
}

// ─── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [tabs, setTabs] = useState<RepoTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [pendingAutoStashes, setPendingAutoStashes] = useState<Record<string, string>>(loadPendingAutoStashes);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [localChangesState, setLocalChangesState] = useState<{isOpen: boolean, files: string[], command: string}>({ isOpen: false, files: [], command: "" });
  const [newBranchName, setNewBranchName] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [providers, setProviders] = useState<GitProvider[]>(loadProviders);
  const [isProvidersOpen, setIsProvidersOpen] = useState(false);
  const [isCloneOpen, setIsCloneOpen] = useState(false);

  function handleSaveSettings(s: AppSettings) {
    setSettings(s);
    saveSettings(s);
    // Apply font size immediately
    document.documentElement.style.fontSize = `${s.fontSize}px`;
    // Apply glass intensity
    document.documentElement.setAttribute("data-glass", s.glassIntensity);
    // Apply theme
    const theme = s.theme === "system"
      ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : s.theme;
    document.documentElement.setAttribute("data-theme", theme);
  }

  // Apply settings on first render
  useEffect(() => {
    handleSaveSettings(settings);
    // Request notification permission early so the macOS system dialog
    // appears at startup rather than mid-operation.
    ensureNotificationPermission().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Context menu state ──────────────────────────────────────────────────
  type CtxMenuItem = { label: string; icon?: React.ReactNode; danger?: boolean; divider?: boolean; onClick: () => void };
  type CtxMenuState = { x: number; y: number; items: CtxMenuItem[] } | null;
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null);

  // ── File list context menu ───────────────────────────────────────────────
  function openFileCtxMenu(e: React.MouseEvent, path: string, file: string) {
    e.preventDefault();
    const items: CtxMenuItem[] = [
      {
        label: "View Diff",
        icon: <Eye size={13} />,
        onClick: () => selectFile(path, file),
      },
    ];
    // "Open in Editor" — only show when an editor is configured
    if (settings.externalEditor) {
      items.push({
        label: `Open in ${settings.externalEditor}`,
        icon: <FileCode size={13} />,
        onClick: () => invoke("open_in_editor", {
          editor: settings.externalEditor,
          filePath: `${path}/${file}`,
        }).catch(() => {}),
      });
    }
    items.push({ divider: true, label: "", onClick: () => {} });
    items.push({
      label: "Discard Changes",
      icon: <RotateCcw size={13} />,
      danger: true,
      onClick: () => discardFile(path, file),
    });
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }

  // ── Branch context menu ──────────────────────────────────────────────────
  function openBranchCtxMenu(e: React.MouseEvent, path: string, branchName: string, isCurrent: boolean) {
    e.preventDefault();
    const items: CtxMenuItem[] = [];

    // Copy branch name is always available
    items.push({
      label: "Copy branch name",
      icon: <Check size={13} />,
      onClick: () => navigator.clipboard.writeText(branchName).catch(() => {}),
    });

    if (!isCurrent) {
      items.push({ divider: true, label: "", onClick: () => {} });
      items.push({
        label: "Checkout",
        icon: <GitBranch size={13} />,
        onClick: () => handleCheckout(path, branchName),
      });
      items.push({
        label: "Merge (Fast-Forward) into current",
        icon: <GitMerge size={13} />,
        onClick: () => handleBranchAction(path, "merge-ff", branchName),
      });
      items.push({
        label: "Merge (No-FF) into current",
        icon: <GitMerge size={13} />,
        onClick: () => handleBranchAction(path, "merge-noff", branchName),
      });
      items.push({
        label: `Rebase current onto ${branchName}`,
        icon: <ArchiveRestore size={13} />,
        onClick: () => handleBranchAction(path, "rebase", branchName),
      });
      items.push({ divider: true, label: "", onClick: () => {} });
      items.push({
        label: "Delete Branch",
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => handleBranchAction(path, "delete", branchName),
      });
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }

  // ── Tab strip context menu ───────────────────────────────────────────────
  function openTabCtxMenu(e: React.MouseEvent, tabPath: string) {
    e.preventDefault();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: "Refresh",
          icon: <RefreshCw size={13} />,
          onClick: () => fullRefresh(tabPath),
        },
        {
          label: "Fetch",
          icon: <ArrowDownToLine size={13} />,
          onClick: () => runCommand(tabPath, "git_fetch", "Fetch", { path: tabPath }),
        },
        { divider: true, label: "", onClick: () => {} },
        {
          label: "Close Tab",
          icon: <X size={13} />,
          danger: true,
          onClick: () => closeTab(tabPath),
        },
      ],
    });
  }

  // ── History graph context menu ───────────────────────────────────────────
  function openHistoryCtxMenu(e: React.MouseEvent, path: string) {
    e.preventDefault();
    setCtxMenu({
      x: e.clientX, y: e.clientY,
      items: [
        {
          label: "Refresh History",
          icon: <History size={13} />,
          onClick: () => fullRefresh(path),
        },
        {
          label: "Fetch All",
          icon: <RefreshCw size={13} />,
          onClick: () => runCommand(path, "git_fetch", "Fetch", { path }),
        },
      ],
    });
  }

  const activeTab = tabs.find(t => t.path === activeTabPath) ?? null;
  const tabsRef = useRef(tabs);
  const pendingAutoStashesRef = useRef(pendingAutoStashes);
  const activeTabPathRef = useRef(activeTabPath);
  const settingsRef = useRef(settings);
  const providersRef = useRef(providers);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { pendingAutoStashesRef.current = pendingAutoStashes; }, [pendingAutoStashes]);
  useEffect(() => { activeTabPathRef.current = activeTabPath; }, [activeTabPath]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { providersRef.current = providers; }, [providers]);

  // After a fullRefresh completes, block silentRefresh for this many ms
  // so file-watcher events triggered by the git operation itself can't
  // overwrite the freshly-fetched data with stale results.
  const silentRefreshBlockedUntil = useRef<Record<string, number>>({});

  // ── tab helpers ─────────────────────────────────────────────────────────
  function patchTab(path: string, patch: Partial<RepoTab>) {
    setTabs(prev => prev.map(t => t.path === path ? { ...t, ...patch } : t));
  }
  function patchTabLoading(path: string, key: string, value: boolean) {
    setTabs(prev => prev.map(t =>
      t.path === path ? { ...t, loading: { ...t.loading, [key]: value } } : t
    ));
  }
  function addLog(path: string, type: LogEntry["type"], message: string) {
    const entry: LogEntry = { id: Date.now() + Math.random(), type, message };
    setTabs(prev => prev.map(t =>
      t.path === path ? { ...t, logs: [...t.logs, entry] } : t
    ));
  }
  function rememberPendingAutoStash(path: string, stashOid: string) {
    const next = { ...pendingAutoStashesRef.current, [path]: stashOid };
    pendingAutoStashesRef.current = next;
    savePendingAutoStashes(next);
    setPendingAutoStashes(next);
    addLog(path, "info", "Auto stash saved; it will be released after recovery.");
  }
  function clearPendingAutoStash(path: string) {
    const next = { ...pendingAutoStashesRef.current };
    delete next[path];
    pendingAutoStashesRef.current = next;
    savePendingAutoStashes(next);
    setPendingAutoStashes(next);
  }
  async function releasePendingAutoStash(path: string) {
    const stashOid = pendingAutoStashesRef.current[path];
    if (!stashOid) return;

    try {
      const result = await invoke<string>("git_stash_drop", { path, stashOid });
      addLog(path, "success", result || "Auto stash released.");
      clearPendingAutoStash(path);
    } catch (e) {
      addLog(path, "error", `Failed to release auto stash: ${e}`);
    }
  }
  async function handleConflictResolved(path: string) {
    await releasePendingAutoStash(path);
    await fullRefresh(path);
  }

  // ── watcher ─────────────────────────────────────────────────────────────
  const silentRefresh = useCallback(async (path: string) => {
    // Skip if we're inside the post-fullRefresh protection window
    if (Date.now() < (silentRefreshBlockedUntil.current[path] ?? 0)) return;
    try {
      const [status, modifiedFiles, branches, historyLogs, headRaw] = await Promise.all([
        invoke<string>("git_status", { path }),
        invoke<string[]>("git_modified_files", { path }),
        invoke<string[]>("git_get_branches", { path }),
        invoke<string[]>("git_log_graph", { path }),
        invoke<string>("git_head_oid", { path }).catch(() => ""),
      ]);
      // Check again after the async calls complete — a fullRefresh may have
      // started while we were waiting
      if (Date.now() < (silentRefreshBlockedUntil.current[path] ?? 0)) return;
      const { headOid, headBranch } = headRaw
        ? parseHeadOid(headRaw)
        : parseHeadFromStatus(status);
      const behindCount = parseBehindCount(status);
      const hasConflicts = parseHasConflicts(status);
      patchTab(path, { status, headOid, headBranch, behindCount, hasConflicts, modifiedFiles, branches, historyLogs });
    } catch { /* ignore transient fs errors */ }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("repo-changed", (event) => {
      const path = event.payload as string;
      if (tabsRef.current.some(t => t.path === path)) silentRefresh(path);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [silentRefresh]);

  // ── Native menu bar event listener ──────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("menu-action", (event) => {
      const id = event.payload;
      const active = tabsRef.current.find(t => t.path === activeTabPathRef.current) ?? null;
      switch (id) {
        case "file_open":
          pickFolder();
          break;
        case "file_close":
          if (active) closeTab(active.path);
          break;
        case "repo_fetch":
          if (active) runCommand(active.path, "git_fetch", "Fetch", { path: active.path });
          break;
        case "repo_pull":
          if (active) runCommand(active.path, "git_pull", "Pull", { path: active.path });
          break;
        case "repo_push":
          if (active) runCommand(active.path, "git_push", "Push", { path: active.path });
          break;
        case "repo_refresh":
          if (active) fullRefresh(active.path);
          break;
        case "repo_new_branch":
          setIsBranchModalOpen(true);
          break;
        case "repo_stash":
          if (active) runCommand(active.path, "git_stash", "Stash", { path: active.path });
          break;
        case "view_history":
          if (active) patchTab(active.path, { selectedTab: "history" });
          break;
        case "view_diff":
          if (active && active.selectedFile) patchTab(active.path, { selectedTab: "diff" });
          break;
        case "view_console":
          if (active) patchTab(active.path, { consoleOpen: !active.consoleOpen });
          break;
        case "view_sidebar":
          setSidebarCollapsed(prev => !prev);
          break;
        case "app_settings":
          setIsSettingsOpen(true);
          break;
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── open / close repo ────────────────────────────────────────────────────
  async function openRepo(path: string) {
    if (tabs.some(t => t.path === path)) { setActiveTabPath(path); return; }
    const isValid = await invoke<boolean>("git_check_repo", { path }).catch(() => false);
    if (!isValid) { alert(`Not a valid Git repository:\n${path}`); return; }
    setTabs(prev => [...prev, makeTab(path)]);
    setActiveTabPath(path);
    pushHistory(path);
    setHistory(loadHistory());
    invoke("watch_repo", { path }).catch(() => {});
    // Fetch remote URL in background for PR panel
    invoke<string>("git_remote_url", { path })
      .then(url => patchTab(path, { remoteUrl: url }))
      .catch(() => {});
    await fullRefresh(path);
  }

  async function fullRefresh(path: string) {
    patchTabLoading(path, "Status", true);
    addLog(path, "command", "Running Status...");
    try {
      const [status, modifiedFiles, branches, historyLogs, headRaw] = await Promise.all([
        invoke<string>("git_status", { path }).catch(() => ""),
        invoke<string[]>("git_modified_files", { path }).catch(() => [] as string[]),
        invoke<string[]>("git_get_branches", { path }).catch(() => [] as string[]),
        invoke<string[]>("git_log_graph", { path }).catch(() => [] as string[]),
        invoke<string>("git_head_oid", { path }).catch(() => ""),
      ]);
      // Block silentRefresh for 2s after fullRefresh completes, so any
      // file-watcher events fired by the git operation itself are ignored.
      silentRefreshBlockedUntil.current[path] = Date.now() + 2000;
      const { headOid, headBranch } = headRaw
        ? parseHeadOid(headRaw)
        : parseHeadFromStatus(status);
      const behindCount = parseBehindCount(status);
      const hasConflicts = parseHasConflicts(status);
      patchTab(path, { status, headOid, headBranch, behindCount, hasConflicts, modifiedFiles, branches, historyLogs });
      addLog(path, "success", "Repository loaded successfully.");
    } catch (e) {
      addLog(path, "error", `Error: ${e}`);
    } finally {
      patchTabLoading(path, "Status", false);
    }
  }

  function closeTab(path: string) {
    invoke("unwatch_repo", { path }).catch(() => {});
    const remaining = tabs.filter(t => t.path !== path);
    setTabs(remaining);
    if (activeTabPath === path)
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
  }

  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false }).catch(() => null);
    if (selected && typeof selected === "string") openRepo(selected);
  }

  // ── git commands ─────────────────────────────────────────────────────────
  async function runCommand(path: string, command: string, name: string, args: Record<string, unknown>) {
    // Block silentRefresh for the entire duration of the command + 2s after
    silentRefreshBlockedUntil.current[path] = Date.now() + 30000; // extended while running
    patchTabLoading(path, name, true);
    addLog(path, "command", `Running ${name}...`);
    try {
      const result = await invoke<string>(command, args);
      addLog(path, "success", result || `Success: ${name}`);
      // Send system notification for push/pull if enabled in settings
      const repoName = path.split("/").filter(Boolean).pop() ?? path;
      if (name === "Push") {
        if (settingsRef.current.notifyOnPush) {
          notify("Push successful", `${repoName} pushed to remote`).catch(() => {});
        }
        // Show "Create PR" link if this repo is connected to a provider
        const tab = tabsRef.current.find(t => t.path === path);
        if (tab?.remoteUrl && tab.headBranch) {
          const match = matchRemoteToProvider(tab.remoteUrl, providersRef.current);
          if (match) {
            const prUrl = createPrUrl(match.provider, match.repoFullName, tab.headBranch);
            addLog(path, "info", `Create PR → ${prUrl}`);
          }
        }
      } else if (name === "Pull" && settingsRef.current.notifyOnPull) {
        notify("Pull successful", `${repoName} pulled from remote`).catch(() => {});
      }
      if (!["Status", "History"].includes(name)) fullRefresh(path);
      return result;
    } catch (e) {
      addLog(path, "error", `Error: ${e}`);
      if (!["Status", "History"].includes(name)) fullRefresh(path);
      const errStr = String(e);
      if (errStr.includes("CONFLICT") || errStr.includes("Fix conflicts")) {
        setIsConflictModalOpen(true);
      } else if (errStr.includes("would be overwritten by merge") || errStr.includes("would be overwritten by checkout")) {
        const files: string[] = [];
        const lines = errStr.split('\n');
        let inFiles = false;
        for (const line of lines) {
          if (line.includes("would be overwritten by")) {
            inFiles = true;
            continue;
          }
          if (inFiles) {
            if (line.trim().startsWith("Please commit") || line.trim() === "Aborting") break;
            if (line.trim()) files.push(line.trim());
          }
        }
        setLocalChangesState({ isOpen: true, files, command });
      }
      throw e;
    } finally {
      patchTabLoading(path, name, false);
      // Reset block: only 2s from now (fullRefresh will extend this further)
      silentRefreshBlockedUntil.current[path] = Date.now() + 2000;
    }
  }

  async function handleCheckout(path: string, branch: string) {
    let target = branch.trim();
    if (target.startsWith("remotes/origin/")) target = target.replace("remotes/origin/", "");
    else if (target.startsWith("* ")) return;
    await runCommand(path, "git_checkout", `Checkout ${target}`, { path, branch: target });
    // After checkout, auto-fetch to get accurate behind count for the new branch
    try {
      addLog(path, "info", `Fetching remote info for ${target}...`);
      await invoke("git_fetch", { path });
      await fullRefresh(path);
    } catch { /* fetch may fail if offline, that's ok */ }
  }

  async function handleBranchAction(path: string, action: string, branchName: string) {
    if (action === "checkout") { await handleCheckout(path, branchName); return; }
    const map: Record<string, [string, string, Record<string, unknown>]> = {
      "merge-ff":   ["git_merge",         `Merge (FF) ${branchName}`,    { path, branch: branchName, strategy: "ff-only" }],
      "merge-noff": ["git_merge",         `Merge (No-FF) ${branchName}`, { path, branch: branchName, strategy: "no-ff" }],
      "rebase":     ["git_rebase",        `Rebase onto ${branchName}`,   { path, branch: branchName }],
      "delete":     ["git_delete_branch", `Delete ${branchName}`,        { path, branch: branchName, force: false }],
    };
    const def = map[action];
    if (def) await runCommand(path, def[0], def[1], def[2]).catch(() => {});
  }

  async function handleCreateBranch() {
    if (!activeTab || !newBranchName) return;
    await runCommand(activeTab.path, "git_create_branch", `Create Branch ${newBranchName}`,
      { path: activeTab.path, branch: newBranchName }).catch(() => {});
    setIsBranchModalOpen(false);
    setNewBranchName("");
  }

  async function selectFile(path: string, file: string) {
    patchTab(path, { selectedFile: file, selectedTab: "diff" });
    patchTabLoading(path, "Diff", true);
    try {
      const diff = await invoke<string>("git_diff", { path, filePath: file });
      patchTab(path, { fileDiff: diff });
    } catch {
      addLog(path, "error", `Failed to get diff for ${file}`);
    } finally {
      patchTabLoading(path, "Diff", false);
    }
  }

  async function discardFile(path: string, file: string) {
    const confirmed = window.confirm(`Discard all changes in ${file}?`);
    if (!confirmed) return;

    patchTabLoading(path, "Discard", true);
    addLog(path, "command", `Discarding ${file}...`);
    try {
      await invoke<string>("git_discard_file", { path, filePath: file });
      addLog(path, "success", `Discarded changes in ${file}.`);
      const current = tabsRef.current.find(tab => tab.path === path);
      if (current?.selectedFile === file) {
        patchTab(path, { selectedFile: null, fileDiff: "", selectedTab: "history" });
      }
      await fullRefresh(path);
    } catch (e) {
      addLog(path, "error", `Failed to discard ${file}: ${e}`);
    } finally {
      patchTabLoading(path, "Discard", false);
    }
  }

  async function discardAllChanges(path: string) {
    const confirmed = window.confirm("Discard all local changes and untracked files?");
    if (!confirmed) return;

    patchTabLoading(path, "Discard All", true);
    addLog(path, "command", "Discarding all changes...");
    try {
      await invoke<string>("git_discard_all_changes", { path });
      addLog(path, "success", "Discarded all local changes.");
      patchTab(path, { selectedFile: null, fileDiff: "", selectedTab: "history" });
      await fullRefresh(path);
    } catch (e) {
      addLog(path, "error", `Failed to discard all changes: ${e}`);
    } finally {
      patchTabLoading(path, "Discard All", false);
    }
  }

  // ─── render ──────────────────────────────────────────────────────────────
  const tab = activeTab;
  const isAnyLoading = tab ? Object.values(tab.loading).some(Boolean) : false;
  const localBranches = tab ? tab.branches.filter(b => !b.includes("remotes/")) : [];
  const remoteBranches = tab ? tab.branches.filter(b => b.includes("remotes/") && !b.includes("->")) : [];
  const currentBranchLabel = tab?.headBranch && tab.headBranch !== "HEAD" ? tab.headBranch : "detached";

  // Derive the connected provider + repo name for the active tab
  const activeProviderMatch = tab?.remoteUrl
    ? matchRemoteToProvider(tab.remoteUrl, providers)
    : null;

  const tr = getTranslations(settings.language ?? "en");

  return (
    <I18nContext.Provider value={tr}>
    <div className="h-screen w-screen flex text-foreground overflow-hidden liquid-glass-base">

      {/* ── Left sidebar ── */}
      <div
        className={`sidebar-shell shrink-0 flex flex-col liquid-glass-sidebar z-20 ${sidebarCollapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}
      >
        {/* Title / brand row */}
        {sidebarCollapsed ? (
          /* Collapsed: only the expand button, centered */
          <div className="app-brand border-b border-default-200/50 flex items-center justify-center" style={{ minHeight: 56 }}>
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="sidebar-toggle-btn p-1.5 rounded-md hover:bg-default-200 transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <PanelLeftOpen size={16} className="text-default-500" />
            </button>
          </div>
        ) : (
          /* Expanded: brand mark + title + collapse button */
          <div className="app-brand px-3 py-3 border-b border-default-200/50 flex items-center gap-2.5">
            <div className="app-brand-mark shrink-0" title="Arbor">
              <FolderGit2 size={17} />
            </div>
            <div className="min-w-0 flex-1">
              <span className="block font-semibold text-base text-default-900 truncate">Arbor</span>
              <span className="block text-xs text-default-400 truncate">Git repository client</span>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="sidebar-toggle-btn shrink-0 p-1 rounded-md hover:bg-default-200 transition-colors"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={15} className="text-default-500" />
            </button>
          </div>
        )}

        {/* Open / Clone buttons */}
        <div className="p-2.5 border-b border-default-200/50 flex flex-col gap-1.5">
          {sidebarCollapsed ? (
            <>
              <button
                onClick={pickFolder}
                className="primary-action w-full flex items-center justify-center p-2 rounded-lg"
                title="Open Folder"
                aria-label="Open Folder"
              >
                <FolderOpen size={16} />
              </button>
              <button
                onClick={() => setIsCloneOpen(true)}
                className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-default-200 transition-colors text-default-500"
                title="Clone Repository"
                aria-label="Clone Repository"
              >
                <Download size={15} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={pickFolder}
                className="primary-action w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-default-800"
              >
                <FolderOpen size={15} />
                {tr.openFolder}
              </button>
              <button
                onClick={() => setIsCloneOpen(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-default-600 hover:bg-default-200 transition-colors border border-default-200/70"
              >
                <Download size={14} />
                {tr.clone}
              </button>
            </>
          )}
        </div>

        {/* Open tabs */}
        <div className="flex-1 overflow-y-auto py-2">
          {!sidebarCollapsed && tabs.length === 0 && (
            <p className="text-sm text-default-400 text-center mt-8 px-4">No repositories open</p>
          )}
          {tabs.map(tab => {
            const isActive = tab.path === activeTabPath;
            const tabLoading = Object.values(tab.loading).some(Boolean);
            return (
              <div
                key={tab.path}
                className={`repo-tab group flex items-center gap-2 mx-2 px-2.5 py-2 rounded-lg cursor-pointer ${isActive ? "repo-tab-active text-default-900" : "text-default-600"}`}
                onClick={() => setActiveTabPath(tab.path)}
                onContextMenu={e => openTabCtxMenu(e, tab.path)}
                title={tab.path}
              >
                {tabLoading
                  ? <Spinner size="sm" color="current" className="shrink-0" />
                  : <GitCommitHorizontal size={15} className="shrink-0" />
                }
                {!sidebarCollapsed && (
                  <>
                    <span className="flex-1 truncate text-sm font-medium">{tab.label}</span>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-default-200 transition-all shrink-0"
                      onClick={e => { e.stopPropagation(); closeTab(tab.path); }}
                      aria-label="Close tab"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Accounts + Settings — pinned to bottom of sidebar */}
        <div className="border-t border-default-200/50 p-2 flex flex-col gap-0.5">
          {sidebarCollapsed ? (
            <>
              <button
                onClick={() => setIsProvidersOpen(true)}
                className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-default-200 transition-colors text-default-500 relative"
                title="Git Accounts"
                aria-label="Git Accounts"
              >
                <UserCircle2 size={15} />
                {providers.length > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-success" />
                )}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-full flex items-center justify-center p-2 rounded-lg hover:bg-default-200 transition-colors text-default-500"
                title="Settings"
                aria-label="Settings"
              >
                <Settings size={15} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setIsProvidersOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-default-200 transition-colors text-default-500 text-sm"
              >
                <UserCircle2 size={15} />
                <span className="flex-1 text-left">{tr.gitAccounts}</span>
                {providers.length > 0 && (
                  <span className="text-xs font-medium text-success">{providers.length}</span>
                )}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-default-200 transition-colors text-default-500 text-sm"
              >
                <Settings size={15} />
                {tr.settings}
              </button>
            </>
          )}
        </div>

        {/* Recent history — hidden when collapsed */}
        {!sidebarCollapsed && history.length > 0 && (
          <div className="border-t border-default-200/70">
            <div className="px-3 py-2 flex items-center gap-1.5 panel-title">
              <Clock size={13} />
              Recent
            </div>
            <div className="pb-2">
              {history.map(p => {
                const label = p.split("/").filter(Boolean).pop() ?? p;
                const alreadyOpen = tabs.some(tab => tab.path === p);
                return (
                  <div key={p} className="recent-row group flex items-center mx-1.5 px-2 py-1.5 rounded-lg">
                    <button
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      onClick={() => openRepo(p)}
                      title={p}
                    >
                      <FolderGit2 size={14} className={`shrink-0 ${alreadyOpen ? "text-primary" : "text-default-400"}`} />
                      <span className="truncate text-sm text-default-600">{label}</span>
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-default-200 transition-all shrink-0"
                      onClick={e => { e.stopPropagation(); deleteHistory(p); setHistory(loadHistory()); }}
                      aria-label="Remove from history"
                    >
                      <X size={13} className="text-default-400 hover:text-danger" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Welcome screen */}
        {!tab && (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 p-12 text-center">
            <div className="welcome-surface w-full max-w-xl p-8 flex flex-col items-center gap-4">
              <div className="welcome-icon">
                <FolderGit2 size={30} />
              </div>
              <div>
                <h2 className="text-2xl font-semibold text-default-800">{tr.welcomeTitle}</h2>
                <p className="text-base text-default-500 max-w-sm mt-2">
                  {tr.welcomeOpen}
                </p>
              </div>
            </div>
            {history.length > 0 && (
              <div className="w-full max-w-lg">
                <p className="panel-title mb-3 text-left">{tr.gitGraph}</p>
                <ul className="space-y-1.5">
                  {history.map(p => {
                    const label = p.split("/").filter(Boolean).pop() ?? p;
                    return (
                      <li key={p}>
                        <button
                          className="welcome-repo w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left group"
                          onClick={() => openRepo(p)}
                        >
                          <FolderGit2 size={18} className="text-default-400 shrink-0 group-hover:text-primary transition-colors" />
                          <div className="flex-1 min-w-0">
                            <p className="text-base font-medium text-default-700 truncate">{label}</p>
                            <p className="text-sm text-default-400 truncate">{p}</p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Repo view */}
        {tab && (
          <>
            {/* Top bar */}
            <header className="repo-toolbar shrink-0">
              {isAnyLoading && (
                <div className="h-0.5 w-full bg-primary/15">
                  <div className="h-full bg-primary animate-pulse w-full shadow-[0_0_16px_rgba(10,132,255,0.45)]" />
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  <p className="repo-path truncate" title={tab.path}>{tab.path}</p>
                  <span className="status-chip status-chip-branch">
                    <GitBranch size={13} />
                    {currentBranchLabel}
                  </span>
                  <span className={`status-chip ${tab.modifiedFiles.length > 0 ? "status-chip-warning" : ""}`}>
                    <FileCode size={13} />
                    {tab.modifiedFiles.length} changed
                  </span>
                  {tab.behindCount > 0 && (
                    <span className="status-chip status-chip-warning">
                      <ArrowDownToLine size={13} />
                      {tab.behindCount} behind
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {tab.hasConflicts && (
                    <button
                      onClick={() => setIsConflictModalOpen(true)}
                      className="toolbar-button toolbar-button-danger flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold"
                    >
                      <TriangleAlert size={15} />
                      {tr.resolveConflicts}
                    </button>
                  )}
                  {[
                    { cmd: "git_fetch", name: "Fetch",  label: tr.fetch,  icon: <RefreshCw size={15} /> },
                    { cmd: "git_pull",  name: "Pull",   label: tr.pull,   icon: <ArrowDownToLine size={15} /> },
                    { cmd: "git_push",  name: "Push",   label: tr.push,   icon: <ArrowUpFromLine size={15} /> },
                  ].map(({ cmd, name, label, icon }) => (
                    <button
                      key={name}
                      disabled={!!tab.loading[name]}
                      onClick={() => runCommand(tab.path, cmd, name, { path: tab.path })}
                      className="toolbar-button flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50"
                    >
                      {tab.loading[name] ? <Spinner size="sm" color="current" /> : icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <div className="flex-1 flex min-h-0">

              {/* Branch panel */}
              <div className="side-panel w-52 shrink-0 flex flex-col">
                <div className="panel-header px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="panel-title">{tr.branches}</span>
                    <span className="count-pill">{localBranches.length + remoteBranches.length}</span>
                  </div>
                  <button
                    onClick={() => setIsBranchModalOpen(true)}
                    className="icon-button p-1 rounded hover:bg-default-200 transition-colors"
                    aria-label="New Branch"
                  >
                    <Plus size={15} className="text-default-500" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto py-2">
                  {/* Local branches */}
                  <div className="mb-1">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 mb-0.5">
                      <span className="panel-title">Local</span>
                      <span className="count-pill">{localBranches.length}</span>
                    </div>
                    {localBranches.map(b => {
                      const isCurrent = b.startsWith("* ");
                      const name = b.replace("* ", "");
                      return (
                        <div
                          key={name}
                          className="group relative flex items-center mx-1.5 mb-0.5"
                          onContextMenu={e => openBranchCtxMenu(e, tab.path, name, isCurrent)}
                        >
                          <button
                            className={`branch-row flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm text-left ${isCurrent ? "branch-row-current font-semibold" : "text-default-600"}`}
                            onClick={() => handleCheckout(tab.path, name)}
                            title={name}
                          >
                            {isCurrent
                              ? <Check size={12} strokeWidth={3} className="shrink-0 text-primary" />
                              : <GitBranch size={12} className="shrink-0 text-default-400" />}
                            <span className="truncate pr-5 text-xs">{name}</span>
                          </button>
                          <Dropdown>
                            <Dropdown.Trigger>
                              <button className="opacity-0 group-hover:opacity-100 absolute right-1 p-0.5 rounded hover:bg-default-200 transition-all" aria-label="Branch Actions">
                                <MoreVertical size={13} className="text-default-400" />
                              </button>
                            </Dropdown.Trigger>
                            <Dropdown.Popover>
                              <Dropdown.Menu onAction={key => handleBranchAction(tab.path, key as string, name)}>
                                <Dropdown.Item key="checkout" textValue="Checkout">Checkout</Dropdown.Item>
                                <Dropdown.Item key="merge-ff" textValue="Merge (Fast-Forward)">Merge (FF) into current</Dropdown.Item>
                                <Dropdown.Item key="merge-noff" textValue="Merge (No-FF)">Merge (No-FF) into current</Dropdown.Item>
                                <Dropdown.Item key="rebase" textValue="Rebase">Rebase current onto {name}</Dropdown.Item>
                                <Dropdown.Item key="delete" variant="danger" className="text-danger" textValue="Delete">Delete Branch</Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown.Popover>
                          </Dropdown>
                        </div>
                      );
                    })}
                  </div>

                  {/* Remote branches */}
                  {remoteBranches.length > 0 && (
                    <div className="mt-2">
                      <div className="flex items-center gap-1.5 px-3 py-1.5 mb-0.5">
                        <span className="panel-title">Remote</span>
                        <span className="count-pill">{remoteBranches.length}</span>
                      </div>
                      {remoteBranches.map(b => {
                        const name = b.trim().replace("remotes/", "");
                        return (
                          <button
                            key={b}
                            className="branch-row w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left mx-1.5 mb-0.5"
                            style={{ width: "calc(100% - 12px)" }}
                            onClick={() => handleCheckout(tab.path, b.trim())}
                            title={name}
                          >
                            <RefreshCw size={12} className="shrink-0 text-default-400" />
                            <span className="truncate text-xs text-default-500">{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* PR / MR panel — only shown when a provider is matched */}
                {activeProviderMatch && (
                  <PullRequestsPanel
                    repoPath={tab.path}
                    remoteUrl={tab.remoteUrl}
                    provider={activeProviderMatch.provider}
                    repoFullName={activeProviderMatch.repoFullName}
                  />
                )}
              </div>

              {/* Changes panel */}
              <div className="w-64 shrink-0 flex flex-col liquid-glass-panel z-10">
                <div className="panel-header px-3 py-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="panel-title">{tr.localChanges}</span>
                    <span className="count-pill">{tab.modifiedFiles.length}</span>
                  </div>
                  {tab.modifiedFiles.length > 0 && (
                    <button
                      className="discard-all-button"
                      onClick={() => discardAllChanges(tab.path)}
                      disabled={!!tab.loading["Discard All"]}
                      title={tr.discardAll}
                      aria-label={tr.discardAll}
                    >
                      {tab.loading["Discard All"] ? <Spinner size="sm" color="current" /> : <Trash2 size={13} />}
                      <span>{tr.discardAll}</span>
                    </button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {tab.modifiedFiles.length === 0
                    ? <p className="empty-state text-sm text-center">{tr.noChanges}</p>
                    : tab.modifiedFiles.map(file => (
                      <div
                        key={file}
                        className={`change-row text-sm w-full text-left rounded-md mb-1.5 ${tab.selectedFile === file ? "change-row-active" : "text-default-600"}`}
                        onContextMenu={e => openFileCtxMenu(e, tab.path, file)}
                      >
                        <button
                          className="change-row-select"
                          onClick={() => selectFile(tab.path, file)}
                          title={file}
                        >
                          <span className="change-row-label truncate">{file}</span>
                        </button>
                        <button
                          className="change-discard-button"
                          onClick={() => discardFile(tab.path, file)}
                          disabled={!!tab.loading["Discard"]}
                          aria-label={`Discard changes in ${file}`}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </div>
                    ))
                  }
                </div>
              </div>

              {/* Main panel */}
              <div className="flex-1 flex flex-col min-w-0">

                {/* Behind-remote banner */}
                {tab.behindCount > 0 && (
                  <div className="behind-banner shrink-0 flex items-center gap-3 px-4 py-2">
                    <ArrowDownToLine size={14} className="shrink-0 opacity-70" />
                    <span className="flex-1">
                      Your branch is <strong>{tab.behindCount} commit{tab.behindCount > 1 ? "s" : ""}</strong> behind the remote.
                    </span>
                    <button
                      onClick={() => runCommand(tab.path, "git_pull", "Pull", { path: tab.path })}
                      disabled={!!tab.loading["Pull"]}
                      className="behind-pull-button shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-semibold disabled:opacity-50 transition-colors"
                    >
                      {tab.loading["Pull"] ? <Spinner size="sm" color="current" /> : <ArrowDownToLine size={13} />}
                      {tr.pull}
                    </button>
                  </div>
                )}

                {/* Tab bar — History + Diff only, Console moved to bottom */}
                <div className="workspace-tabs flex px-5 pt-3 gap-6 shrink-0 liquid-glass-header z-10 relative">
                  {[
                    { key: "history", icon: <History size={16} />, label: tr.gitGraph },
                    { key: "diff",    icon: <FileCode size={16} />, label: "Diff", disabled: !tab.selectedFile },
                  ].map(wtab => (
                    <button
                      key={wtab.key}
                      disabled={(wtab as {disabled?: boolean}).disabled}
                      onClick={() => patchTab(tab.path, { selectedTab: wtab.key as RepoTab["selectedTab"] })}
                      className={`workspace-tab flex items-center gap-2 px-1 pb-3 text-sm font-semibold ${(wtab as {disabled?: boolean}).disabled ? "opacity-40 cursor-not-allowed" : ""} ${tab.selectedTab === wtab.key ? "workspace-tab-active" : "text-default-500 hover:text-default-800"}`}
                    >
                      {wtab.icon}
                      <span>{wtab.label}</span>
                    </button>
                  ))}
                </div>

                {tab.selectedTab === "history" && (
                  <div className="flex-1 overflow-hidden" onContextMenu={e => openHistoryCtxMenu(e, tab.path)}>
                    <GitGraphViewer logs={tab.historyLogs} headOid={tab.headOid} headBranch={tab.headBranch} />
                  </div>
                )}
                {tab.selectedTab === "diff" && (
                  <DiffPanel file={tab.selectedFile} diff={tab.fileDiff} loading={!!tab.loading["Diff"]} />
                )}
              </div>
            </div>

            {/* ── Bottom Console Panel ── */}
            <div
              className="shrink-0 flex flex-col liquid-glass-console z-20 relative"
              style={{
                height: tab.consoleOpen ? 200 : 34,
                transition: "height 200ms cubic-bezier(0.4,0,0.2,1)",
              }}
            >
              {/* Console header / toggle */}
              <div
                className="console-toggle flex items-center gap-2 px-3 cursor-pointer select-none shrink-0"
                style={{ height: 34 }}
                onClick={() => patchTab(tab.path, { consoleOpen: !tab.consoleOpen })}
              >
                <Terminal size={12} className="text-default-500 shrink-0" />
                <span className="panel-title flex-1">Console</span>
                {tab.logs.length > 0 && (
                  <span className="console-count-badge">{tab.logs.length}</span>
                )}
                <div className="console-chevron-btn">
                  {tab.consoleOpen
                    ? <ChevronDown size={13} />
                    : <ChevronUp size={13} />}
                </div>
              </div>
              {tab.consoleOpen && (
                <div className="flex-1 overflow-hidden">
                  <ConsolePanel logs={tab.logs} />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Create branch modal */}
      <Modal isOpen={isBranchModalOpen} onOpenChange={setIsBranchModalOpen}>
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="app-modal sm:max-w-sm">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>{tr.branches}</Modal.Heading></Modal.Header>
              <Modal.Body className="p-5">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-default-700">{tr.branches}</label>
                  <input
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg border border-default-200 bg-content1 text-sm outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition"
                    placeholder="feature/new-feature"
                    value={newBranchName}
                    onChange={e => setNewBranchName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleCreateBranch()}
                  />
                </div>
              </Modal.Body>
              <Modal.Footer>
                <button className="toolbar-button px-4 py-2 text-sm rounded-lg text-default-600" onClick={() => setIsBranchModalOpen(false)}>
                  {tr.cancel}
                </button>
                <button className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-semibold" onClick={handleCreateBranch}>
                  {tr.commit}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Conflict resolution modal */}
      {activeTab && (
        <ConflictModal
          isOpen={isConflictModalOpen}
          onClose={() => setIsConflictModalOpen(false)}
          repoPath={activeTab.path}
          onResolved={() => handleConflictResolved(activeTab.path)}
        />
      )}

      {/* Local changes overwritten modal */}
      {activeTab && (
        <LocalChangesModal
          isOpen={localChangesState.isOpen}
          onClose={() => setLocalChangesState(prev => ({ ...prev, isOpen: false }))}
          repoPath={activeTab.path}
          files={localChangesState.files}
          command={localChangesState.command}
          onResolved={() => fullRefresh(activeTab.path)}
          onAutoStashCreated={(stashOid) => rememberPendingAutoStash(activeTab.path, stashOid)}
          onAutoStashReleased={() => {
            clearPendingAutoStash(activeTab.path);
            addLog(activeTab.path, "success", "Auto stash applied and released.");
          }}
          onNeedsConflictResolution={() => setIsConflictModalOpen(true)}
        />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* Settings modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />

      {/* Git Accounts modal */}
      <ProvidersModal
        isOpen={isProvidersOpen}
        onClose={() => setIsProvidersOpen(false)}
        providers={providers}
        onProvidersChange={next => { setProviders(next); saveProviders(next); }}
      />

      {/* Clone modal */}
      <CloneModal
        isOpen={isCloneOpen}
        onClose={() => setIsCloneOpen(false)}
        providers={providers}
        onCloned={repoPath => openRepo(repoPath)}
      />
    </div>
    </I18nContext.Provider>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
const URL_RE = /(https?:\/\/[^\s]+)/g;

function ConsolePanel({ logs }: { logs: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  function renderMessage(msg: string) {
    const parts = msg.split(URL_RE);
    return parts.map((part, i) =>
      URL_RE.test(part)
        ? <a key={i} href={part} target="_blank" rel="noreferrer" className="console-link underline">{part}</a>
        : <span key={i}>{part}</span>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 font-mono text-sm space-y-1.5">
      {logs.map(log => (
        <div key={log.id} className={`leading-relaxed
          ${log.type === "error"   ? "text-danger"  : ""}
          ${log.type === "success" ? "text-success" : ""}
          ${log.type === "command" ? "text-primary font-bold" : ""}
          ${log.type === "info"    ? "text-default-400" : ""}
        `}>
          <span className="opacity-40 mr-2">[{new Date(log.id).toLocaleTimeString()}]</span>
          <span className="whitespace-pre-wrap">{renderMessage(log.message)}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ── Diff line parser ────────────────────────────────────────────────────────
interface DiffLine {
  type: "header" | "hunk" | "add" | "remove" | "context" | "noNewline";
  content: string;
  oldLineNo: number | null;
  newLineNo: number | null;
}

function parseDiff(raw: string): DiffLine[] {
  const lines = raw.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git") || line.startsWith("index ") ||
        line.startsWith("--- ") || line.startsWith("+++ ")) {
      result.push({ type: "header", content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith("@@")) {
      // Parse @@ -a,b +c,d @@
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1]); newLine = parseInt(m[2]); }
      result.push({ type: "hunk", content: line, oldLineNo: null, newLineNo: null });
    } else if (line.startsWith("+")) {
      result.push({ type: "add", content: line.slice(1), oldLineNo: null, newLineNo: newLine++ });
    } else if (line.startsWith("-")) {
      result.push({ type: "remove", content: line.slice(1), oldLineNo: oldLine++, newLineNo: null });
    } else if (line.startsWith("\\")) {
      result.push({ type: "noNewline", content: line, oldLineNo: null, newLineNo: null });
    } else if (line.length > 0) {
      result.push({ type: "context", content: line.slice(1), oldLineNo: oldLine++, newLineNo: newLine++ });
    }
  }
  return result;
}

function DiffPanel({ file, diff, loading }: { file: string | null; diff: string; loading: boolean }) {
  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;

  const parsed = diff ? parseDiff(diff) : [];
  const hasContent = parsed.some(l => l.type !== "header");

  return (
    <div className="diff-shell flex-1 flex flex-col min-h-0">
      {/* File header */}
      <div className="px-4 py-2.5 liquid-glass-header flex items-center gap-2 shrink-0">
        <FileCode size={15} className="text-default-400 shrink-0" />
        <p className="text-sm font-mono text-default-700 truncate">{file}</p>
      </div>

      <div className="flex-1 overflow-auto">
        {!diff || !hasContent ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-default-400">
            <FileCode size={32} className="opacity-30" />
            <p className="text-base">No differences found</p>
            <p className="text-sm">The file matches the last commit</p>
          </div>
        ) : (
          <table className="diff-table w-full border-collapse text-sm font-mono">
            <tbody>
              {parsed.map((line, i) => {
                if (line.type === "header") return null; // skip git header lines

                if (line.type === "hunk") {
                  return (
                    <tr key={i} style={{ backgroundColor: "#eef4ff", borderTop: "1px solid #c7d9ff", borderBottom: "1px solid #c7d9ff" }}>
                      <td style={{ width: 48, textAlign: "center", fontSize: "0.75rem", color: "#6b9bfa", userSelect: "none", padding: "2px 0", borderRight: "1px solid #c7d9ff", backgroundColor: "#ddeaff" }}>···</td>
                      <td style={{ width: 48, textAlign: "center", fontSize: "0.75rem", color: "#6b9bfa", userSelect: "none", padding: "2px 0", borderRight: "1px solid #c7d9ff", backgroundColor: "#ddeaff" }}>···</td>
                      <td style={{ padding: "2px 16px", color: "#3b6ef0", fontSize: "0.8rem" }}>{line.content}</td>
                    </tr>
                  );
                }

                if (line.type === "noNewline") {
                  return (
                    <tr key={i} style={{ backgroundColor: "#f5f5f5" }}>
                      <td style={{ width: 48, borderRight: "1px solid #e0e0e0", backgroundColor: "#ebebeb" }} />
                      <td style={{ width: 48, borderRight: "1px solid #e0e0e0", backgroundColor: "#ebebeb" }} />
                      <td style={{ padding: "1px 16px", color: "#999", fontStyle: "italic", fontSize: "0.75rem" }}>{line.content}</td>
                    </tr>
                  );
                }

                const isAdd = line.type === "add";
                const isRemove = line.type === "remove";

                const rowStyle: React.CSSProperties = {
                  backgroundColor: isAdd ? "rgba(26, 127, 55, 0.1)" : isRemove ? "rgba(207, 34, 46, 0.1)" : "transparent",
                };
                const gutterStyle: React.CSSProperties = {
                  width: 48, textAlign: "right", paddingRight: 10,
                  fontSize: "0.75rem", userSelect: "none", padding: "1px 10px 1px 0",
                  borderRight: "1px solid rgba(0, 0, 0, 0.1)",
                  backgroundColor: isAdd ? "rgba(26, 127, 55, 0.15)" : isRemove ? "rgba(207, 34, 46, 0.15)" : "rgba(0, 0, 0, 0.05)",
                  color: isAdd ? "#1a7f37" : isRemove ? "#cf222e" : "#999",
                  minWidth: 48,
                };
                const contentStyle: React.CSSProperties = {
                  padding: "1px 16px 1px 8px",
                  whiteSpace: "pre",
                  color: isAdd ? "#1a7f37" : isRemove ? "#82071e" : "#24292f",
                };
                const prefix = isAdd ? "+" : isRemove ? "−" : " ";
                const prefixStyle: React.CSSProperties = {
                  marginRight: 8,
                  fontWeight: "bold",
                  color: isAdd ? "#1a7f37" : isRemove ? "#cf222e" : "#ccc",
                };

                return (
                  <tr key={i} style={rowStyle}>
                    <td style={gutterStyle}>{line.oldLineNo ?? ""}</td>
                    <td style={gutterStyle}>{line.newLineNo ?? ""}</td>
                    <td style={contentStyle}>
                      <span style={prefixStyle}>{prefix}</span>
                      {line.content}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
