import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "@heroui/react";
import { ArchiveRestore, Eraser, Trash2 } from "lucide-react";
import { useT } from "../i18n";

interface LocalChangesModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath: string;
  files: string[];
  command: string; // The command that failed (e.g. "git_pull")
  onResolved: () => void | Promise<void>;
  onAutoStashCreated: (stashOid: string) => void;
  onAutoStashReleased: () => void;
  onNeedsConflictResolution: () => void;
}

interface AutoStashResult {
  stashOid?: string | null;
  output: string;
}

export function LocalChangesModal({
  isOpen,
  onClose,
  repoPath,
  files,
  command,
  onResolved,
  onAutoStashCreated,
  onAutoStashReleased,
  onNeedsConflictResolution,
}: LocalChangesModalProps) {
  const t = useT();
  const [loading, setLoading] = useState(false);

  // 1. Auto stash and recover: git stash -> git pull -> git stash pop
  async function handleAutoStash() {
    setLoading(true);
    try {
      const stash = await invoke<AutoStashResult>("git_auto_stash", { path: repoPath });
      const stashOid = stash.stashOid || null;
      if (stashOid) {
        onAutoStashCreated(stashOid);
      }

      await invoke(command, { path: repoPath });
      if (stashOid) {
        await invoke("git_stash_pop", { path: repoPath, stashOid }).catch((e) => {
          const errStr = String(e);
          if (errStr.includes("CONFLICT") || errStr.includes("needs merge")) {
            onNeedsConflictResolution();
          }
          throw e;
        });
        onAutoStashReleased();
      }
      await onResolved();
      onClose();
    } catch (e) {
      console.error("Auto stash failed:", e);
      const errStr = String(e);
      if (errStr.includes("CONFLICT") || errStr.includes("needs merge")) {
        await onResolved();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  }

  // 2. Discard changes to overwritten files: git checkout -- <files> -> git pull
  async function handleDiscardOverwritten() {
    setLoading(true);
    try {
      await invoke("git_checkout_files", { path: repoPath, files });
      await invoke(command, { path: repoPath });
      await onResolved();
      onClose();
    } catch (e) {
      console.error("Discard overwritten failed:", e);
    } finally {
      setLoading(false);
    }
  }

  // 3. Discard all local changes: git reset --hard -> git pull
  async function handleDiscardAll() {
    setLoading(true);
    try {
      await invoke("git_reset_hard", { path: repoPath });
      await invoke(command, { path: repoPath });
      await onResolved();
      onClose();
    } catch (e) {
      console.error("Discard all failed:", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="app-modal max-w-xl">
            <Modal.Header>
              <Modal.Heading>{t.localChangesTitle}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="p-0 border-b border-default-200">
              <div className="flex flex-col">
                <button
                  onClick={handleAutoStash}
                  disabled={loading}
                  className="action-choice flex items-center gap-3 p-4 hover:bg-primary-50 text-left border-b border-default-200 transition-colors disabled:opacity-50"
                >
                  <span className="action-choice-icon"><ArchiveRestore size={17} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-default-800">{t.autoStashAndApply}</span>
                    <span className="block text-sm text-danger mt-1">{t.autoStashAndApplyDesc}</span>
                  </span>
                </button>
                <button
                  onClick={handleDiscardOverwritten}
                  disabled={loading}
                  className="action-choice flex items-center gap-3 p-4 hover:bg-default-100 text-left border-b border-default-200 transition-colors disabled:opacity-50"
                >
                  <span className="action-choice-icon"><Eraser size={17} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-default-800">{t.discardOverwritten}</span>
                    <span className="block text-sm text-default-500 mt-1">{t.discardOverwrittenDesc}</span>
                  </span>
                </button>
                <button
                  onClick={handleDiscardAll}
                  disabled={loading}
                  className="action-choice action-choice-danger flex items-center gap-3 p-4 hover:bg-default-100 text-left transition-colors disabled:opacity-50"
                >
                  <span className="action-choice-icon"><Trash2 size={17} /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold text-default-800">{t.discardAllChanges}</span>
                    <span className="block text-sm text-danger mt-1">{t.discardAllChangesDesc}</span>
                  </span>
                </button>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <button
                onClick={onClose}
                disabled={loading}
                className="toolbar-button px-6 py-2 rounded text-default-600 disabled:opacity-50"
              >
                {t.close}
              </button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
