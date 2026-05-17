import { useState, useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { RefreshCw, GitPullRequest, ExternalLink, ChevronDown, ChevronUp, GitMerge, X } from "lucide-react";
import { GitProvider, PullRequest, fetchPullRequests, PROVIDER_META } from "../providers";
import { useT } from "../i18n";

interface Props {
  repoPath: string;
  remoteUrl: string | null;
  provider: GitProvider | null;
  repoFullName: string | null;
}

export function PullRequestsPanel({ repoPath: _repoPath, remoteUrl: _remoteUrl, provider, repoFullName }: Props) {
  const t = useT();
  const [prs, setPrs] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (provider && repoFullName) {
      loadPRs();
    } else {
      setPrs([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider?.id, repoFullName]);

  async function loadPRs() {
    if (!provider || !repoFullName) return;
    setLoading(true);
    setError(null);
    try {
      const results = await fetchPullRequests(provider, repoFullName);
      setPrs(results);
    } catch (e) {
      setError(String(e).replace("Error: ", ""));
    } finally {
      setLoading(false);
    }
  }

  function openPR(url: string) {
    openUrl(url).catch(() => {});
  }

  function relativeTime(iso: string): string {
    try {
      const diff = Date.now() - new Date(iso).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      const days = Math.floor(hrs / 24);
      if (days < 30) return `${days}d ago`;
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch { return ""; }
  }

  if (!provider || !repoFullName) return null;

  const meta = PROVIDER_META[provider.kind];
  const label = provider.kind === "gitlab" ? t.mergeRequests : t.pullRequests;

  return (
    <div className="pr-panel">
      {/* Header */}
      <div
        className="pr-panel-header"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="pr-panel-title">
          <GitPullRequest size={13} />
          <span>{label}</span>
          {!loading && prs.length > 0 && (
            <span className="count-pill">{prs.length}</span>
          )}
          {loading && <RefreshCw size={11} className="animate-spin text-default-400" />}
        </div>
        <div className="pr-panel-actions">
          <button
            className="icon-button p-1 rounded hover:bg-default-200 transition-colors"
            onClick={e => { e.stopPropagation(); loadPRs(); }}
            title={t.refresh}
            aria-label={t.refreshPullRequests}
          >
            <RefreshCw size={12} className="text-default-400" />
          </button>
          {expanded ? <ChevronUp size={13} className="text-default-400" /> : <ChevronDown size={13} className="text-default-400" />}
        </div>
      </div>

      {expanded && (
        <div className="pr-panel-body">
          {error && (
            <div className="pr-error">
              <X size={12} />
              <span>{error}</span>
            </div>
          )}

          {!loading && prs.length === 0 && !error && (
            <div className="pr-empty">
              <GitMerge size={18} className="pr-empty-icon" />
              <span>{provider.kind === "gitlab" ? t.noOpenMergeRequests : t.noOpenPullRequests}</span>
            </div>
          )}

          {prs.map(pr => (
            <button
              key={pr.id}
              className="pr-row"
              onClick={() => openPR(pr.webUrl)}
              title={`Open in ${meta.label}`}
            >
              <div className="pr-row-top">
                <span className="pr-number">#{pr.number}</span>
                {pr.draft && <span className="pr-badge pr-badge-draft">{t.draft}</span>}
                <span className="pr-title">{pr.title}</span>
                <ExternalLink size={11} className="pr-external-icon" />
              </div>
              <div className="pr-row-meta">
                {pr.authorAvatarUrl && (
                  <img src={pr.authorAvatarUrl} alt={pr.author} className="pr-author-avatar" />
                )}
                <span className="pr-author">@{pr.author}</span>
                <span className="pr-branch">{pr.sourceBranch}</span>
                <span className="pr-arrow">→</span>
                <span className="pr-branch">{pr.targetBranch}</span>
                <span className="pr-time">{relativeTime(pr.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
