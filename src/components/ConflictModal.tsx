import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "@heroui/react";
import { CheckCircle2, FileWarning, Save } from "lucide-react";
import { parseConflicts } from "../utils/conflictParser";

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  repoPath: string;
  onResolved: () => void | Promise<void>;
}

export function ConflictModal({ isOpen, onClose, repoPath, onResolved }: ConflictModalProps) {
  const [conflictedFiles, setConflictedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("Merge branch");
  const [isRawMode, setIsRawMode] = useState(false);

  function handleResolveBlock(blockId: string, resolvedContent: string) {
    const blocks = parseConflicts(fileContent);
    const newContent = blocks.map(b => {
      if (b.type === "conflict" && b.id === blockId) {
        return resolvedContent;
      }
      return b.type === "normal" ? b.content : 
        `<<<<<<< ${b.currentName}\n${b.current}\n=======\n${b.incoming}\n>>>>>>> ${b.incomingName}`;
    }).join('\n');
    setFileContent(newContent);
  }

  useEffect(() => {
    if (isOpen && repoPath) {
      loadConflictedFiles();
    }
  }, [isOpen, repoPath]);

  async function loadConflictedFiles() {
    setLoading(true);
    try {
      const files = await invoke<string[]>("git_conflicted_files", { path: repoPath });
      setConflictedFiles(files);
      if (files.length === 0) {
        setSelectedFile(null);
      } else if (!files.includes(selectedFile || "")) {
        setSelectedFile(files[0]);
      }
    } catch (e) {
      console.error("Failed to load conflicted files:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedFile && repoPath) {
      invoke<string>("read_file_content", { path: repoPath, filePath: selectedFile })
        .then(content => {
          setFileContent(content);
          setIsRawMode(false); // Reset to visual mode on new file
        })
        .catch(console.error);
    } else {
      setFileContent("");
    }
  }, [selectedFile, repoPath]);

  async function handleSaveAndAdd() {
    if (!selectedFile) return;
    setLoading(true);
    try {
      await invoke("write_file_content", { path: repoPath, filePath: selectedFile, content: fileContent });
      await invoke("git_add", { path: repoPath, filePath: selectedFile });
      await loadConflictedFiles(); // Refresh list
    } catch (e) {
      console.error("Failed to save and add file:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCommitMerge() {
    setLoading(true);
    try {
      await invoke("git_commit", { path: repoPath, message: commitMessage });
      await onResolved();
      onClose();
    } catch (e) {
      console.error("Failed to commit merge:", e);
    } finally {
      setLoading(false);
    }
  }

  const parsedBlocks = parseConflicts(fileContent);
  const hasParsedConflicts = parsedBlocks.some(b => b.type === "conflict");
  const showVisual = hasParsedConflicts && !isRawMode;

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="app-modal max-w-5xl">
            <Modal.Header>
              <Modal.Heading>Resolve Conflicts</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="p-0 overflow-hidden flex flex-row h-[70vh]">
              {/* Left sidebar: file list */}
              <div className="side-panel w-64 flex flex-col h-full shrink-0">
                <div className="panel-header p-3 font-semibold text-sm flex items-center justify-between">
                  Conflicted Files ({conflictedFiles.length})
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {conflictedFiles.map(f => (
                    <button
                      key={f}
                      onClick={() => setSelectedFile(f)}
                      className={`branch-row w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 ${selectedFile === f ? "change-row-active" : "text-default-700"}`}
                    >
                      <FileWarning size={14} className="shrink-0" />
                      <span className="truncate">{f}</span>
                    </button>
                  ))}
                  {conflictedFiles.length === 0 && !loading && (
                    <div className="text-sm text-default-500 p-2 flex items-center gap-2 text-success">
                      <CheckCircle2 size={16} />
                      All conflicts resolved!
                    </div>
                  )}
                </div>
              </div>
              
              {/* Right area: editor & actions */}
              <div className="flex-1 flex flex-col h-full bg-white dark:bg-default-50 min-w-0">
                {selectedFile ? (
                  <>
                    <div className="panel-header p-3 flex items-center justify-between shrink-0">
                      <span className="text-sm font-medium truncate pr-4">{selectedFile}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {hasParsedConflicts && (
                          <button 
                            onClick={() => setIsRawMode(!isRawMode)}
                            className="toolbar-button px-3 py-1.5 text-default-700 text-sm rounded-md"
                          >
                            {isRawMode ? "Visual Mode" : "Raw Editor"}
                          </button>
                        )}
                        <button 
                          onClick={handleSaveAndAdd}
                          disabled={loading}
                          className="flex items-center gap-2 px-3 py-1.5 bg-primary text-white text-sm rounded-md hover:bg-primary-600 transition-colors disabled:opacity-50 font-semibold"
                        >
                          <Save size={14} /> Save & Mark Resolved
                        </button>
                      </div>
                    </div>
                    {showVisual ? (
                      <div className="flex-1 overflow-auto p-4 font-mono text-sm bg-transparent">
                        {parsedBlocks.map((block, i) => {
                          if (block.type === "normal") {
                            return (
                              <div key={`normal-${i}`} className="whitespace-pre text-default-700">
                                {block.content}
                              </div>
                            );
                          }
                          
                          return (
                            <div key={block.id} className="my-4 border border-default-200 rounded-md overflow-hidden bg-white shadow-sm shrink-0">
                              <div className="bg-primary-50 border-b border-default-200">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-primary-100/50 flex-wrap gap-2">
                                  <span className="font-semibold text-primary-700 text-xs">{block.currentName}</span>
                                  <button 
                                    onClick={() => handleResolveBlock(block.id, block.current)}
                                    className="text-xs px-2 py-1 bg-white rounded text-primary-600 hover:bg-primary-50 shadow-sm transition-colors border border-primary-200"
                                  >
                                    Accept Current
                                  </button>
                                </div>
                                <div className="p-3 whitespace-pre text-primary-900 overflow-x-auto">
                                  {block.current}
                                </div>
                              </div>
                              
                              <div className="bg-success-50">
                                <div className="flex items-center justify-between px-3 py-1.5 bg-success-100/50 border-y border-default-200 flex-wrap gap-2">
                                  <span className="font-semibold text-success-700 text-xs">{block.incomingName}</span>
                                  <div className="flex gap-2">
                                    <button 
                                      onClick={() => handleResolveBlock(block.id, block.incoming)}
                                      className="text-xs px-2 py-1 bg-white rounded text-success-600 hover:bg-success-50 shadow-sm transition-colors border border-success-200"
                                    >
                                      Accept Incoming
                                    </button>
                                    <button 
                                      onClick={() => handleResolveBlock(block.id, block.current + '\n' + block.incoming)}
                                      className="text-xs px-2 py-1 bg-white rounded text-default-600 hover:bg-default-50 shadow-sm transition-colors border border-default-200"
                                    >
                                      Accept Both
                                    </button>
                                  </div>
                                </div>
                                <div className="p-3 whitespace-pre text-success-900 overflow-x-auto">
                                  {block.incoming}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <textarea 
                        className="diff-shell flex-1 w-full p-4 font-mono text-sm resize-none focus:outline-none"
                        value={fileContent}
                        onChange={e => setFileContent(e.target.value)}
                        spellCheck={false}
                      />
                    )}
                  </>
                ) : conflictedFiles.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
                    <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center text-success">
                      <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-xl font-semibold">Conflicts Resolved</h3>
                    <p className="text-default-500 text-center max-w-md">
                      All conflicted files have been resolved and staged. You can now commit the merge.
                    </p>
                    <div className="w-full max-w-md mt-4 space-y-2">
                      <label className="text-sm font-medium text-default-700">Merge Commit Message</label>
                      <textarea 
                        className="w-full p-3 border border-default-200 rounded-md text-sm focus:outline-none focus:border-primary resize-none h-24"
                        value={commitMessage}
                        onChange={e => setCommitMessage(e.target.value)}
                      />
                      <button 
                        onClick={handleCommitMerge}
                        disabled={loading || !commitMessage.trim()}
                        className="w-full py-2.5 bg-success text-white font-medium rounded-md hover:bg-success-600 transition-colors disabled:opacity-50 mt-2"
                      >
                        Commit Merge
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-default-400">
                    Select a file to resolve conflicts
                  </div>
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
