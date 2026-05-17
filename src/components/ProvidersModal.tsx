import { useState } from "react";
import { Modal } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import {
  Trash2, ExternalLink, Check, RefreshCw,
  Lock, Globe, KeyRound, Fingerprint,
} from "lucide-react";
import {
  GitProvider, ProviderKind, PROVIDER_META,
  saveProviders, verifyProvider,
} from "../providers";
import { useT } from "../i18n";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  providers: GitProvider[];
  onProvidersChange: (providers: GitProvider[]) => void;
}

// ── Provider SVG icons ────────────────────────────────────────────────────────
function GithubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}
function GitlabIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}
function GiteeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.984 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.016 0zm6.09 5.333c.328 0 .593.266.592.593v1.482a.594.594 0 0 1-.593.592H9.777c-.982 0-1.778.796-1.778 1.778v5.63c0 .327.266.592.593.592h5.63c.982 0 1.778-.796 1.778-1.778v-.296a.593.593 0 0 0-.592-.593h-4.15a.592.592 0 0 1-.592-.592v-1.482a.593.593 0 0 1 .593-.592h6.815c.327 0 .593.265.593.592v3.408a4 4 0 0 1-4 4H5.926a.593.593 0 0 1-.593-.593V9.778a4.444 4.444 0 0 1 4.445-4.444h8.296Z" />
    </svg>
  );
}
function ProviderIcon({ kind, size = 16 }: { kind: ProviderKind; size?: number }) {
  if (kind === "github") return <GithubIcon size={size} />;
  if (kind === "gitlab") return <GitlabIcon size={size} />;
  return <GiteeIcon size={size} />;
}

// ── OAuth result type (mirrors Rust OAuthResult) ──────────────────────────────
interface OAuthResult {
  accessToken: string;
  username: string;
  avatarUrl: string;
  name: string;
}

// ── Add account form ──────────────────────────────────────────────────────────
type AuthMode = "token" | "oauth";

function AddProviderForm({ onAdd }: { onAdd: (p: GitProvider) => void }) {
  const t = useT();
  const [kind,      setKind]      = useState<ProviderKind>("github");
  const [host,      setHost]      = useState(PROVIDER_META.github.defaultHost);
  const [authMode,  setAuthMode]  = useState<AuthMode>("oauth");
  const [label,     setLabel]     = useState("");
  // Token mode
  const [token,     setToken]     = useState("");
  const [showToken, setShowToken] = useState(false);

  const [loading,      setLoading]      = useState(false);
  const [oauthWaiting, setOauthWaiting] = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const meta = PROVIDER_META[kind];
  // OAuth is supported for GitHub and GitLab (first-party apps registered)
  const oauthSupported = kind !== "gitee";

  function handleKindChange(k: ProviderKind) {
    setKind(k);
    setHost(PROVIDER_META[k].defaultHost);
    setError(null);
    // Default to OAuth for supported providers, token for Gitee
    setAuthMode(k !== "gitee" ? "oauth" : "token");
  }

  function resetForm() {
    setToken("");
    setLabel(""); setHost(PROVIDER_META[kind].defaultHost);
    setError(null);
  }

  // ── Token mode ────────────────────────────────────────────────────────────
  async function handleTokenVerify() {
    if (!token.trim()) { setError(t.personalAccessToken); return; }
    setLoading(true); setError(null);
    try {
      const draft: GitProvider = {
        id: `${kind}-${Date.now()}`,
        kind, host: host.trim() || meta.defaultHost,
        label: label.trim() || meta.label,
        token: token.trim(),
      };
      const verified = await verifyProvider(draft);
      verified.label = label.trim() || `${meta.label} (${verified.username})`;
      onAdd(verified);
      resetForm();
    } catch (e) {
      setError(String(e).replace("Error: ", ""));
    } finally {
      setLoading(false);
    }
  }

  // ── OAuth mode (one-click, PKCE, no credentials needed) ──────────────────
  async function handleOAuthStart() {
    setOauthWaiting(true); setError(null);
    try {
      const result = await invoke<OAuthResult>("oauth_start", {
        args: {
          kind,
          host: host.trim() || meta.defaultHost,
        },
      });
      const resolvedHost = host.trim() || meta.defaultHost;
      const p: GitProvider = {
        id:        `${kind}-${Date.now()}`,
        kind,
        host:      resolvedHost,
        label:     label.trim() || `${meta.label} (${result.username})`,
        token:     result.accessToken,
        oauth:     true,
        username:  result.username,
        avatarUrl: result.avatarUrl,
        name:      result.name,
      };
      onAdd(p);
      resetForm();
    } catch (e) {
      setError(String(e).replace("Error: ", ""));
    } finally {
      setOauthWaiting(false);
    }
  }

  return (
    <div className="provider-add-form">
      <div className="provider-add-title">{t.addAccount}</div>

      {/* Provider selector */}
      <div className="provider-kind-row">
        {(["github", "gitlab", "gitee"] as ProviderKind[]).map(k => (
          <button key={k} onClick={() => handleKindChange(k)}
            className={`provider-kind-btn ${kind === k ? "provider-kind-btn-active" : ""}`}>
            <ProviderIcon kind={k} size={14} />
            {PROVIDER_META[k].label}
          </button>
        ))}
      </div>

      {/* Auth mode tabs */}
      <div className="provider-auth-tabs">
        {oauthSupported && (
          <button
            onClick={() => { setAuthMode("oauth"); setError(null); }}
            className={`provider-auth-tab ${authMode === "oauth" ? "provider-auth-tab-active" : ""}`}
          >
            <Fingerprint size={13} />
            {t.signInWith(meta.label)}
          </button>
        )}
        <button
          onClick={() => { setAuthMode("token"); setError(null); }}
          className={`provider-auth-tab ${authMode === "token" ? "provider-auth-tab-active" : ""}`}
        >
          <KeyRound size={13} />
          {t.accessToken}
        </button>
      </div>

      {/* Custom host (GitLab only) */}
      {kind === "gitlab" && (
        <div className="provider-field">
          <label className="provider-field-label">{t.host}</label>
          <div className="provider-input-wrap">
            <Globe size={13} className="provider-input-icon" />
            <input className="provider-input provider-input-with-icon"
              placeholder="gitlab.com" value={host}
              onChange={e => setHost(e.target.value)} />
          </div>
        </div>
      )}

      {/* Label */}
      <div className="provider-field">
        <label className="provider-field-label">
          {t.label} <span className="provider-field-hint">({t.optional})</span>
        </label>
        <input className="provider-input"
          placeholder={`e.g. ${meta.label} (work)`}
          value={label} onChange={e => setLabel(e.target.value)} />
      </div>

      {/* ── OAuth mode (one-click) ── */}
      {authMode === "oauth" && oauthSupported && (
        <>
          <div className="provider-oauth-hint">
            {t.oauthHint}
          </div>

          {error && <div className="provider-error">{error}</div>}

          {oauthWaiting && (
            <div className="provider-oauth-waiting">
              <RefreshCw size={14} className="animate-spin" />
              <span>{t.oauthWaiting}</span>
            </div>
          )}

          <button onClick={handleOAuthStart}
            disabled={oauthWaiting}
            className="provider-verify-btn provider-oauth-btn"
            style={{ background: meta.color }}>
            {oauthWaiting
              ? <><RefreshCw size={13} className="animate-spin" /> {t.waitingForBrowser}</>
              : <><ProviderIcon kind={kind} size={14} /> {t.signInWith(meta.label)}</>}
          </button>
        </>
      )}

      {/* ── Token mode ── */}
      {authMode === "token" && (
        <>
          <div className="provider-field">
            <label className="provider-field-label">
              {t.personalAccessToken}
              <a href={meta.tokenUrl} target="_blank" rel="noreferrer"
                className="provider-token-link" title={t.generateToken}>
                <ExternalLink size={11} /> {t.generateToken}
              </a>
            </label>
            <div className="provider-input-wrap">
              <Lock size={13} className="provider-input-icon" />
              <input
                className="provider-input provider-input-with-icon"
                type={showToken ? "text" : "password"}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleTokenVerify()}
              />
              <button type="button" className="provider-show-token-btn"
                onClick={() => setShowToken(v => !v)} tabIndex={-1}>
                {showToken ? t.hide : t.show}
              </button>
            </div>
          </div>

          {error && <div className="provider-error">{error}</div>}

          <button onClick={handleTokenVerify}
            disabled={loading || !token.trim()}
            className="provider-verify-btn">
            {loading
              ? <><RefreshCw size={13} className="animate-spin" /> {t.verifying}</>
              : <><Check size={13} /> {t.verifyAndAdd}</>}
          </button>
        </>
      )}
    </div>
  );
}

// ── Provider card ─────────────────────────────────────────────────────────────
function ProviderCard({ provider, onRemove }: { provider: GitProvider; onRemove: () => void }) {
  const t = useT();
  const meta = PROVIDER_META[provider.kind];
  return (
    <div className="provider-card">
      <div className="provider-card-avatar">
        {provider.avatarUrl
          ? <img src={provider.avatarUrl} alt={provider.username} className="provider-avatar-img" />
          : <ProviderIcon kind={provider.kind} size={20} />}
        <div className="provider-card-badge" style={{ background: meta.color }} title={meta.label}>
          <ProviderIcon kind={provider.kind} size={9} />
        </div>
      </div>
      <div className="provider-card-info">
        <div className="provider-card-name">{provider.label}</div>
        <div className="provider-card-sub">
          <span className="provider-card-username">@{provider.username}</span>
          <span className="provider-card-dot">·</span>
          <span className="provider-card-host">{provider.host}</span>
        </div>
      </div>
      <button onClick={onRemove} className="provider-card-remove"
        aria-label={t.removeAccount} title={t.removeAccount}>
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export function ProvidersModal({ isOpen, onClose, providers, onProvidersChange }: Props) {
  const t = useT();
  function handleAdd(p: GitProvider) {
    const next = [...providers, p];
    saveProviders(next);
    onProvidersChange(next);
  }
  function handleRemove(id: string) {
    const next = providers.filter(p => p.id !== id);
    saveProviders(next);
    onProvidersChange(next);
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={open => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="app-modal providers-modal">
            <Modal.CloseTrigger />
            <Modal.Header><Modal.Heading>{t.gitAccountsTitle}</Modal.Heading></Modal.Header>
            <Modal.Body className="providers-modal-body">

              {providers.length > 0 && (
                <div className="provider-section">
                  <div className="provider-section-title">{t.connectedAccounts}</div>
                  <div className="provider-cards">
                    {providers.map(p => (
                      <ProviderCard key={p.id} provider={p} onRemove={() => handleRemove(p.id)} />
                    ))}
                  </div>
                </div>
              )}

              {providers.length === 0 && (
                <div className="provider-empty">
                  <div className="provider-empty-icons">
                    <GithubIcon size={22} /><GitlabIcon size={22} /><GiteeIcon size={22} />
                  </div>
                  <p className="provider-empty-text">{t.noAccountsYet}</p>
                  <p className="provider-empty-hint">{t.noAccountsHint}</p>
                </div>
              )}

              <AddProviderForm onAdd={handleAdd} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
