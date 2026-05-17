import { useState, useEffect, useRef } from "react";
import { Modal } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Search, FolderOpen, Lock, Globe, GitBranch, RefreshCw, Download, X } from "lucide-react";
import { GitProvider, ProviderRepo, searchRepos, authenticatedCloneUrl, PROVIDER_META } from "../providers";
import { useT } from "../i18n";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  providers: GitProvider[];
  onCloned: (repoPath: string) => void;
}

export function CloneModal({ isOpen, onClose, providers, onCloned }: Props) {
  const t = useT();
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<ProviderRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<ProviderRepo | null>(null);
  const [destDir, setDestDir] = useState("");
  const [searching, setSearching] = useState(false);
  const [loaded, setLoaded] = useState(false);   // true once first search completes
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cloneLog, setCloneLog] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-select first provider when modal opens; reset loaded flag on provider change
  useEffect(() => {
    if (isOpen && providers.length > 0 && !selectedProviderId) {
      setSelectedProviderId(providers[0].id);
    }
  }, [isOpen, providers, selectedProviderId]);

  // Reset loaded flag when switching providers
  useEffect(() => {
    setLoaded(false);
    setRepos([]);
  }, [selectedProviderId]);

  // Trigger search when provider or query changes
  useEffect(() => {
    if (!selectedProviderId) return;
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => runSearch(), 350);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProviderId, query]);

  const activeProvider = providers.find(p => p.id === selectedProviderId) ?? null;

  async function runSearch() {
    if (!activeProvider) return;
    setSearching(true);
    setError(null);
    try {
      const results = await searchRepos(activeProvider, query);
      setRepos(results);
    } catch (e) {
      setError(String(e).replace("Error: ", ""));
      setRepos([]);
    } finally {
      setSearching(false);
      setLoaded(true);
    }
  }

  async function pickDestDir() {
    const selected = await open({ directory: true, multiple: false }).catch(() => null);
    if (selected && typeof selected === "string") setDestDir(selected);
  }

  async function handleClone() {
    if (!selectedRepo || !destDir || !activeProvider) return;
    setCloning(true);
    setCloneLog(null);
    setError(null);
    try {
      const authUrl = authenticatedCloneUrl(activeProvider, selectedRepo.cloneUrl);
      const repoPath = await invoke<string>("git_clone", { cloneUrl: authUrl, destDir });
      setCloneLog(t.cloneSuccess(repoPath));
      setTimeout(() => {
        onCloned(repoPath);
        handleClose();
      }, 800);
    } catch (e) {
      setError(String(e));
    } finally {
      setCloning(false);
    }
  }

  function handleClose() {
    setQuery("");
    setRepos([]);
    setSelectedRepo(null);
    setError(null);
    setCloneLog(null);
    setCloning(false);
    setLoaded(false);
    setSelectedProviderId("");
    onClose();
  }

  function formatDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch { return ""; }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={open => !open && handleClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="app-modal clone-modal">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t.cloneRepository}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="clone-modal-body">

              {providers.length === 0 ? (
                <div className="clone-no-providers">
                  <GitBranch size={28} className="clone-no-providers-icon" />
                  <p className="clone-no-providers-text">{t.cloneNoProviders}</p>
                  <p className="clone-no-providers-hint">{t.cloneNoProvidersHint}</p>
                </div>
              ) : (
                <>
                  {/* Provider tabs */}
                  {providers.length > 1 && (
                    <div className="clone-provider-tabs">
                      {providers.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedProviderId(p.id); setSelectedRepo(null); }}
                          className={`clone-provider-tab ${selectedProviderId === p.id ? "clone-provider-tab-active" : ""}`}
                        >
                          {p.avatarUrl
                            ? <img src={p.avatarUrl} alt="" className="clone-tab-avatar" />
                            : <span style={{ color: PROVIDER_META[p.kind].color }}>●</span>
                          }
                          <span className="clone-tab-label">{p.label}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Search bar */}
                  <div className="clone-search-wrap">
                    <Search size={14} className="clone-search-icon" />
                    <input
                      className="clone-search-input"
                      placeholder={t.cloneSearchPlaceholder(activeProvider?.username ?? "")}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                      autoFocus
                    />
                    {searching && <RefreshCw size={13} className="clone-search-spinner animate-spin" />}
                    {query && !searching && (
                      <button className="clone-search-clear" onClick={() => setQuery("")}>
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Repo list */}
                  {error && <div className="provider-error">{error}</div>}

                  <div className="clone-repo-list">
                    {repos.length === 0 && !searching && (
                      <div className="clone-repo-empty">
                        {!loaded
                          ? t.cloneLoading
                          : query
                            ? t.cloneNoReposQuery(query)
                            : t.cloneNoRepos
                        }
                      </div>
                    )}
                    {repos.map(repo => (
                      <button
                        key={repo.id}
                        onClick={() => setSelectedRepo(r => r?.id === repo.id ? null : repo)}
                        className={`clone-repo-row ${selectedRepo?.id === repo.id ? "clone-repo-row-selected" : ""}`}
                      >
                        <div className="clone-repo-row-top">
                          <span className="clone-repo-name">{repo.fullName}</span>
                          {repo.private
                            ? <span className="clone-repo-badge clone-repo-badge-private"><Lock size={10} /> {t.clonePrivate}</span>
                            : <span className="clone-repo-badge clone-repo-badge-public"><Globe size={10} /> {t.clonePublic}</span>
                          }
                        </div>
                        {repo.description && (
                          <div className="clone-repo-desc">{repo.description}</div>
                        )}
                        <div className="clone-repo-meta">{t.cloneUpdated(formatDate(repo.updatedAt))}</div>
                      </button>
                    ))}
                  </div>

                  {/* Destination */}
                  {selectedRepo && (
                    <div className="clone-dest-section">
                      <div className="clone-dest-label">{t.cloneRepository}</div>
                      <div className="clone-dest-row">
                        <input
                          readOnly
                          className="clone-dest-input"
                          placeholder={t.cloneDestPlaceholder}
                          value={destDir}
                          onClick={pickDestDir}
                        />
                        <button className="clone-dest-browse" onClick={pickDestDir}>
                          <FolderOpen size={14} />
                        </button>
                      </div>
                      {destDir && (
                        <div className="clone-dest-preview">
                          {t.cloneInto(`${destDir}/${selectedRepo.fullName.split("/").pop()}`)}
                        </div>
                      )}
                    </div>
                  )}

                  {cloneLog && <div className="clone-success-msg"><Download size={13} /> {cloneLog}</div>}
                </>
              )}
            </Modal.Body>

            {providers.length > 0 && (
              <Modal.Footer>
                <button
                  className="toolbar-button px-4 py-2 text-sm rounded-lg text-default-600"
                  onClick={handleClose}
                >
                  {t.cancel}
                </button>
                <button
                  disabled={!selectedRepo || !destDir || cloning}
                  onClick={handleClone}
                  className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-semibold disabled:opacity-40 flex items-center gap-2"
                >
                  {cloning
                    ? <><RefreshCw size={13} className="animate-spin" /> {t.loading}</>
                    : <><Download size={13} /> {t.cloneButton}</>
                  }
                </button>
              </Modal.Footer>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
