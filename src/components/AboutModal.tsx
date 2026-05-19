import { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Modal } from "@heroui/react";
import { X, GitFork, ExternalLink, Heart } from "lucide-react";
import appIcon from "../assets/icon.png";
import { useT } from "../i18n";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const GITHUB_URL = "https://github.com/Seamain/Arbor";
const TAURI_URL = "https://tauri.app";
const ISSUES_URL = "https://github.com/Seamain/Arbor/issues";

export function AboutModal({ isOpen, onClose }: Props) {
  const t = useT();
  const [version, setVersion] = useState("—");

  useEffect(() => {
    if (isOpen) {
      getVersion().then(v => setVersion(v)).catch(() => setVersion("—"));
    }
  }, [isOpen]);

  function link(url: string) {
    openUrl(url).catch(() => window.open(url, "_blank"));
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={open => { if (!open) onClose(); }}
    >
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="app-modal about-modal">
            {/* Header */}
            <div className="about-header">
              <button className="settings-close-btn" onClick={onClose} aria-label={t.close}>
                <X size={16} />
              </button>
            </div>

            {/* Logo + identity */}
            <div className="about-hero">
              <div className="about-icon">
                <img src={appIcon} alt="Arbor" width={64} height={64} style={{ borderRadius: 16 }} />
              </div>
              <h1 className="about-name">Arbor</h1>
              <p className="about-tagline">{t.aboutTagline}</p>
              <span className="about-version-badge">v{version}</span>
            </div>

            {/* Links */}
            <div className="about-links">
              <button className="about-link-btn" onClick={() => link(GITHUB_URL)}>
                <GitFork size={14} />
                {t.aboutGitHub}
                <ExternalLink size={11} className="about-link-ext" />
              </button>
              <div className="about-link-divider" />
              <button className="about-link-btn" onClick={() => link(ISSUES_URL)}>
                {t.aboutReportIssue}
                <ExternalLink size={11} className="about-link-ext" />
              </button>
            </div>

            {/* Tech stack */}
            <div className="about-stack">
              <span className="about-stack-label">{t.aboutBuiltWith}</span>
              <button className="about-stack-chip" onClick={() => link(TAURI_URL)}>
                Tauri
              </button>
              <span className="about-stack-sep">·</span>
              <span className="about-stack-chip about-stack-chip-plain">Rust</span>
              <span className="about-stack-sep">·</span>
              <span className="about-stack-chip about-stack-chip-plain">React</span>
            </div>

            {/* Footer */}
            <div className="about-footer">
              <Heart size={11} className="about-heart" />
              <span>
                © {new Date().getFullYear()} Seamain. MIT License.
              </span>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
