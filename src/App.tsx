import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { Spinner, Modal, Dropdown } from "@heroui/react";
import {
  FolderGit2, RefreshCw, ArrowDownToLine, ArrowUpFromLine,
  Terminal, FolderOpen, FileCode, GitBranch, Plus, Check,
  MoreVertical, History, X, GitCommitHorizontal, Clock,
} from "lucide-react";
import "./App.css";
import { GitGraphViewer } from "./components/GitGraphViewer";

// ─── persistence ────────────────────────────────────────────────────────────
const HISTORY_KEY = "git-client-repo-history";
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

// ─── types ──────────────────────────────────────────────────────────────────
interface LogEntry {
  id: number;
  type: "info" | "success" | "error" | "command";
  message: string;
}

interface RepoTab {
  path: string;
  label: string;           // last path segment
  status: string;
  branches: string[];
  modifiedFiles: string[];
  historyLogs: string[];
  logs: LogEntry[];
  loading: Record<string, boolean>;
  selectedFile: string | null;
  fileDiff: string;
  selectedTab: "history" | "console" | "diff";
}

function makeTab(path: string): RepoTab {
  return {
    path,
    label: path.split("/").filter(Boolean).pop() ?? path,
    status: "",
    branches: [],
    modifiedFiles: [],
    historyLogs: [],
    logs: [],
    loading: {},
    selectedFile: null,
    fileDiff: "",
    selectedTab: "console",
  };
}

// ─── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [tabs, setTabs] = useState<RepoTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");

  const activeTab = tabs.find(t => t.path === activeTabPath) ?? null;

  // keep a ref so the file-watcher closure can read the latest tabs
  const tabsRef = useRef(tabs);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);

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

  // ── watcher ─────────────────────────────────────────────────────────────
  const silentRefresh = useCallback(async (path: string) => {
    try {
      const [status, modifiedFiles, branches, historyLogs] = await Promise.all([
        invoke<string>("git_status", { path }),
        invoke<string[]>("git_modified_files", { path }),
        invoke<string[]>("git_get_branches", { path }),
        invoke<string[]>("git_log_graph", { path }),
      ]);
      patchTab(path, { status, modifiedFiles, branches, historyLogs });
    } catch { /* ignore transient fs errors */ }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("repo-changed", (event) => {
      const path = event.payload as string;
      if (tabsRef.current.some(t => t.path === path)) {
        silentRefresh(path);
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [silentRefresh]);

  // ── open repo ────────────────────────────────────────────────────────────
  async function openRepo(path: string) {
    // if already open, just focus it
    if (tabs.some(t => t.path === path)) {
      setActiveTabPath(path);
      return;
    }
    const isValid = await invoke<boolean>("git_check_repo", { path }).catch(() => false);
    if (!isValid) {
      // show error in a temporary toast-like log — we'll just alert for now
      alert(`Not a valid Git repository:\n${path}`);
      return;
    }
    const tab = makeTab(path);
    setTabs(prev => [...prev, tab]);
    setActiveTabPath(path);
    pushHistory(path);
    setHistory(loadHistory());
    // start watching
    invoke("watch_repo", { path }).catch(() => {});
    // load initial data
    await fullRefresh(path);
  }

  async function fullRefresh(path: string) {
    patchTabLoading(path, "Status", true);
    addLog(path, "command", "Running Status...");
    try {
      const [status, modifiedFiles, branches, historyLogs] = await Promise.all([
        invoke<string>("git_status", { path }),
        invoke<string[]>("git_modified_files", { path }),
        invoke<string[]>("git_get_branches", { path }),
        invoke<string[]>("git_log_graph", { path }),
      ]);
      patchTab(path, { status, modifiedFiles, branches, historyLogs });
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
    if (activeTabPath === path) {
      setActiveTabPath(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  }

  // ── folder picker ────────────────────────────────────────────────────────
  async function pickFolder() {
    const selected = await open({ directory: true, multiple: false }).catch(() => null);
    if (selected && typeof selected === "string") openRepo(selected);
  }

  // ── git commands ─────────────────────────────────────────────────────────
  async function runCommand(path: string, command: string, name: string, args: Record<string, unknown>) {
    patchTabLoading(path, name, true);
    addLog(path, "command", `Running ${name}...`);
    try {
      const result = await invoke<string>(command, args);
      addLog(path, "success", result || `Success: ${name}`);
      if (!["Status", "History"].includes(name)) fullRefresh(path);
      return result;
    } catch (e) {
      addLog(path, "error", `Error: ${e}`);
      throw e;
    } finally {
      patchTabLoading(path, name, false);
    }
  }

  async function handleCheckout(path: string, branch: string) {
    let target = branch.trim();
    if (target.startsWith("remotes/origin/")) target = target.replace("remotes/origin/", "");
    else if (target.startsWith("* ")) return;
    await runCommand(path, "git_checkout", `Checkout ${target}`, { path, branch: target });
  }

  async function handleBranchAction(path: string, action: string, branchName: string) {
    const strategies: Record<string, [string, string, Record<string, unknown>]> = {
      "checkout":   ["git_checkout", `Checkout ${branchName}`, { path, branch: branchName }],
      "merge-ff":   ["git_merge",    `Merge (FF) ${branchName}`,    { path, branch: branchName, strategy: "ff-only" }],
      "merge-noff": ["git_merge",    `Merge (No-FF) ${branchName}`, { path, branch: branchName, strategy: "no-ff" }],
      "rebase":     ["git_rebase",   `Rebase onto ${branchName}`,   { path, branch: branchName }],
      "delete":     ["git_delete_branch", `Delete ${branchName}`,   { path, branch: branchName, force: false }],
    };
    const def = strategies[action];
    if (!def) return;
    if (action === "checkout") { await handleCheckout(path, branchName); return; }
    await runCommand(path, def[0], def[1], def[2]).catch(() => {});
  }

  async function handleCreateBranch() {
    if (!activeTab || !newBranchName) return;
    await runCommand(activeTab.path, "git_create_branch", `Create Branch ${newBranchName}`, { path: activeTab.path, branch: newBranchName }).catch(() => {});
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

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  const t = activeTab;
  const isAnyLoading = t ? Object.values(t.loading).some(Boolean) : false;

  return (
    <div className="h-screen w-screen flex bg-background text-foreground overflow-hidden">

      {/* ── Left sidebar: tab list ── */}
      <div className="w-52 shrink-0 border-r border-default-200 bg-default-50 flex flex-col">
        {/* App title */}
        <div className="p-4 border-b border-default-200 flex items-center gap-2">
          <FolderGit2 size={18} className="text-primary shrink-0" />
          <span className="font-semibold text-sm truncate">Git Client</span>
        </div>

        {/* Open buttons */}
        <div className="p-2 border-b border-default-200 flex gap-1">
          <button
            onClick={pickFolder}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <FolderOpen size={13} />
            Open Folder
          </button>
        </div>

        {/* Tabs */}
        <div className="flex-1 overflow-y-auto py-1">
          {tabs.length === 0 && (
            <p className="text-xs text-default-400 text-center mt-6 px-4">No repositories open</p>
          )}
          {tabs.map(tab => {
            const isActive = tab.path === activeTabPath;
            const tabLoading = Object.values(tab.loading).some(Boolean);
            return (
              <div
                key={tab.path}
                className={`group flex items-center gap-2 mx-1 px-2 py-2 rounded-lg cursor-pointer transition-colors ${isActive ? "bg-primary/10 text-primary" : "text-default-600 hover:bg-default-100"}`}
                onClick={() => setActiveTabPath(tab.path)}
                title={tab.path}
              >
                {tabLoading
                  ? <Spinner size="sm" color="current" className="shrink-0" />
                  : <GitCommitHorizontal size={14} className="shrink-0" />
                }
                <span className="flex-1 truncate text-xs font-medium">{tab.label}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-default-200 transition-all shrink-0"
                  onClick={e => { e.stopPropagation(); closeTab(tab.path); }}
                  aria-label="Close tab"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Recent history at the bottom */}
        {history.length > 0 && (
          <div className="border-t border-default-200">
            <div className="px-3 py-2 flex items-center gap-1.5 text-xs font-semibold text-default-400 uppercase tracking-wider">
              <Clock size={11} />
              Recent
            </div>
            <div className="pb-2">
              {history.map(p => {
                const label = p.split("/").filter(Boolean).pop() ?? p;
                const alreadyOpen = tabs.some(t => t.path === p);
                return (
                  <div key={p} className="group flex items-center mx-1 px-2 py-1.5 rounded-lg hover:bg-default-100 transition-colors">
                    <button
                      className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      onClick={() => openRepo(p)}
                      title={p}
                    >
                      <FolderGit2 size={12} className={`shrink-0 ${alreadyOpen ? "text-primary" : "text-default-400"}`} />
                      <span className="truncate text-xs text-default-600">{label}</span>
                    </button>
                    <button
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-default-200 transition-all shrink-0"
                      onClick={e => { e.stopPropagation(); deleteHistory(p); setHistory(loadHistory()); }}
                      aria-label="Remove from history"
                    >
                      <X size={11} className="text-default-400 hover:text-danger" />
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

        {/* No repo open → welcome/home screen */}
        {!t && (
          <div className="flex-1 flex flex-col items-center justify-center gap-8 p-12 text-center">
            <div className="flex flex-col items-center gap-3">
              <FolderGit2 size={48} className="text-default-300" />
              <h2 className="text-xl font-semibold text-default-600">Open a Git Repository</h2>
              <p className="text-sm text-default-400 max-w-xs">
                Click <strong>Open Folder</strong> in the sidebar, or pick a recent repository below.
              </p>
            </div>
            {history.length > 0 && (
              <div className="w-full max-w-md">
                <p className="text-xs font-semibold text-default-400 uppercase tracking-wider mb-3 text-left">Recent Repositories</p>
                <ul className="space-y-1">
                  {history.map(p => {
                    const label = p.split("/").filter(Boolean).pop() ?? p;
                    return (
                      <li key={p}>
                        <button
                          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-default-50 hover:bg-default-100 border border-default-200 transition-colors text-left group"
                          onClick={() => openRepo(p)}
                        >
                          <FolderGit2 size={16} className="text-default-400 shrink-0 group-hover:text-primary transition-colors" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-default-700 truncate">{label}</p>
                            <p className="text-xs text-default-400 truncate">{p}</p>
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

        {/* Repo is open */}
        {t && (
          <>
            {/* Top bar */}
            <header className="shrink-0 border-b border-default-200 bg-default-50/50">
              {/* Loading bar */}
              {isAnyLoading && (
                <div className="h-0.5 w-full bg-primary/20">
                  <div className="h-full bg-primary animate-pulse w-full" />
                </div>
              )}
              {/* Path + actions */}
              <div className="flex items-center gap-3 px-4 py-2">
                <p className="flex-1 text-xs text-default-500 font-mono truncate" title={t.path}>{t.path}</p>
                <div className="flex gap-1 shrink-0">
                  {[
                    { cmd: "git_fetch", name: "Fetch",  icon: <RefreshCw size={14} /> },
                    { cmd: "git_pull",  name: "Pull",   icon: <ArrowDownToLine size={14} /> },
                    { cmd: "git_push",  name: "Push",   icon: <ArrowUpFromLine size={14} /> },
                  ].map(({ cmd, name, icon }) => (
                    <button
                      key={name}
                      disabled={!!t.loading[name]}
                      onClick={() => runCommand(t.path, cmd, name, { path: t.path })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-default-200 bg-content1 hover:bg-default-100 disabled:opacity-50 transition-colors"
                    >
                      {t.loading[name] ? <Spinner size="sm" color="current" /> : icon}
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            </header>

            <div className="flex-1 flex min-h-0">
              {/* Branch panel */}
              <div className="w-44 shrink-0 border-r border-default-200 flex flex-col bg-content2/30">
                <div className="p-2 border-b border-default-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-default-500 uppercase tracking-wider">Branches</span>
                  <button
                    onClick={() => setIsBranchModalOpen(true)}
                    className="p-0.5 rounded hover:bg-default-200 transition-colors"
                    aria-label="New Branch"
                  >
                    <Plus size={13} className="text-default-500" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold text-default-400 uppercase tracking-wider mb-1 px-1">Local</p>
                    {t.branches.filter(b => !b.includes("remotes/")).map(b => {
                      const isCurrent = b.startsWith("* ");
                      const name = b.replace("* ", "");
                      return (
                        <div key={name} className="group relative flex items-center">
                          <button
                            className={`flex-1 flex items-center gap-2 px-2 py-1 rounded-md text-xs transition-colors text-left hover:bg-default-100 ${isCurrent ? "text-primary font-semibold" : "text-default-600"}`}
                            onClick={() => handleCheckout(t.path, name)}
                            title={name}
                          >
                            {isCurrent
                              ? <Check size={11} strokeWidth={3} className="shrink-0 text-primary" />
                              : <GitBranch size={11} className="shrink-0 text-default-400" />}
                            <span className="truncate pr-5">{name}</span>
                          </button>
                          <Dropdown>
                            <Dropdown.Trigger>
                              <button className="opacity-0 group-hover:opacity-100 absolute right-1 p-0.5 rounded hover:bg-default-200 transition-all" aria-label="Branch Actions">
                                <MoreVertical size={12} className="text-default-400" />
                              </button>
                            </Dropdown.Trigger>
                            <Dropdown.Popover>
                              <Dropdown.Menu onAction={key => handleBranchAction(t.path, key as string, name)}>
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
                  <div>
                    <p className="text-[10px] font-semibold text-default-400 uppercase tracking-wider mb-1 px-1">Remote</p>
                    {t.branches.filter(b => b.includes("remotes/") && !b.includes("->")).map(b => {
                      const name = b.trim().replace("remotes/", "");
                      return (
                        <button
                          key={b}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-xs text-default-500 hover:bg-default-100 transition-colors text-left"
                          onClick={() => handleCheckout(t.path, b.trim())}
                          title={name}
                        >
                          <RefreshCw size={11} className="shrink-0 text-default-400" />
                          <span className="truncate">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Status / changes panel */}
              <div className="w-56 shrink-0 border-r border-default-200 flex flex-col bg-content2/20">
                <div className="p-3 border-b border-default-200">
                  <p className="text-[10px] font-semibold text-default-400 uppercase tracking-wider mb-1.5">Status</p>
                  <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-content1 p-2 rounded-lg border border-default-200 max-h-36 overflow-auto">
                    {t.status || "No status"}
                  </pre>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  <p className="text-[10px] font-semibold text-default-400 uppercase tracking-wider mb-1.5">Changes</p>
                  {t.modifiedFiles.length === 0
                    ? <p className="text-xs text-default-400">No changes</p>
                    : t.modifiedFiles.map(file => (
                      <button
                        key={file}
                        className={`text-xs w-full text-left px-2 py-1 rounded-md transition-colors break-all mb-0.5 ${t.selectedFile === file ? "bg-primary text-primary-foreground" : "hover:bg-default-100 text-default-600"}`}
                        onClick={() => selectFile(t.path, file)}
                      >
                        {file}
                      </button>
                    ))
                  }
                </div>
              </div>

              {/* Main panel */}
              <div className="flex-1 flex flex-col min-w-0">
                {/* Tabs */}
                <div className="flex border-b border-default-200 bg-content2 px-2 pt-1.5 gap-1 shrink-0">
                  {[
                    { key: "history", icon: <History size={13} />, label: "History" },
                    { key: "console", icon: <Terminal size={13} />, label: "Console" },
                    { key: "diff",    icon: <FileCode size={13} />,  label: "Diff", disabled: !t.selectedFile },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      disabled={tab.disabled}
                      onClick={() => patchTab(t.path, { selectedTab: tab.key as RepoTab["selectedTab"] })}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${tab.disabled ? "opacity-40 cursor-not-allowed" : ""} ${t.selectedTab === tab.key ? "border-primary text-primary" : "border-transparent text-default-400 hover:text-default-600"}`}
                    >
                      {tab.icon}{tab.label}
                    </button>
                  ))}
                </div>

                {/* History */}
                {t.selectedTab === "history" && (
                  <div className="flex-1 overflow-hidden">
                    <GitGraphViewer logs={t.historyLogs} />
                  </div>
                )}

                {/* Console */}
                {t.selectedTab === "console" && (
                  <ConsolePanel logs={t.logs} />
                )}

                {/* Diff */}
                {t.selectedTab === "diff" && (
                  <DiffPanel
                    file={t.selectedFile}
                    diff={t.fileDiff}
                    loading={!!t.loading["Diff"]}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create branch modal */}
      <Modal isOpen={isBranchModalOpen} onOpenChange={setIsBranchModalOpen}>
        <Modal.Backdrop>
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-sm">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>Create New Branch</Modal.Heading></Modal.Header>
              <Modal.Body className="p-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium text-default-700">Branch Name</label>
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
                <button className="px-4 py-2 text-sm rounded-lg border border-default-200 text-default-600 hover:bg-default-100 transition-colors" onClick={() => setIsBranchModalOpen(false)}>
                  Cancel
                </button>
                <button className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium" onClick={handleCreateBranch}>
                  Create & Checkout
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function ConsolePanel({ logs }: { logs: LogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);
  return (
    <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1.5">
      {logs.map(log => (
        <div key={log.id} className={`
          ${log.type === "error"   ? "text-danger"  : ""}
          ${log.type === "success" ? "text-success" : ""}
          ${log.type === "command" ? "text-primary font-bold" : ""}
          ${log.type === "info"    ? "text-default-400" : ""}
        `}>
          <span className="opacity-40 mr-2">[{new Date(log.id).toLocaleTimeString()}]</span>
          <span className="whitespace-pre-wrap">{log.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

function DiffPanel({ file, diff, loading }: { file: string | null; diff: string; loading: boolean }) {
  if (loading) return <div className="flex-1 flex items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-default-200 bg-default-50">
        <p className="text-xs font-mono text-default-600 truncate">{file}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {diff ? (
          <div className="text-xs font-mono py-1">
            {diff.split("\n").map((line, i) => {
              let color = "text-default-600";
              let bg = "";
              if (line.startsWith("+") && !line.startsWith("+++")) { color = "text-success-600"; bg = "bg-success-50 dark:bg-success-900/20"; }
              else if (line.startsWith("-") && !line.startsWith("---")) { color = "text-danger-600"; bg = "bg-danger-50 dark:bg-danger-900/20"; }
              else if (line.startsWith("@@")) { color = "text-primary-500"; bg = "bg-primary-50/50"; }
              return <div key={i} className={`px-4 py-px ${color} ${bg} hover:bg-default-50`}>{line || " "}</div>;
            })}
          </div>
        ) : (
          <p className="p-6 text-sm text-default-400">No differences found.</p>
        )}
      </div>
    </div>
  );
}
