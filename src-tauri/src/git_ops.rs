use std::process::{Command, Output};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStashResult {
    stash_oid: Option<String>,
    output: String,
}

fn combined_output(output: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn current_stash_oid(path: &str) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--verify")
        .arg("refs/stash")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let oid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if oid.is_empty() {
            Ok(None)
        } else {
            Ok(Some(oid))
        }
    } else {
        Ok(None)
    }
}

fn find_stash_selector_by_oid(path: &str, stash_oid: &str) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("stash")
        .arg("list")
        .arg("--format=%gd~|~%H")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let mut parts = line.splitn(2, "~|~");
        let selector = parts.next().unwrap_or("").trim();
        let oid = parts.next().unwrap_or("").trim();
        if oid == stash_oid {
            return Ok(Some(selector.to_string()));
        }
    }

    Ok(None)
}

#[tauri::command]
pub async fn git_check_repo(path: String) -> Result<bool, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.trim() == "true")
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("status")
        .arg("--porcelain=v2")
        .arg("--branch")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_fetch(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("fetch")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr)) // Git fetch often outputs to stderr even on success
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("pull")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("push")
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_modified_files(path: String) -> Result<Vec<String>, String> {
    // Use -z to get NUL-separated output so filenames with spaces/quotes are never quoted
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("status")
        .arg("--porcelain")
        .arg("-z")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut files = Vec::new();
        // -z format: "XY filename\0" (no newlines, NUL-terminated entries)
        for entry in stdout.split('\0') {
            if entry.len() > 3 {
                // entry[0..2] = XY status, entry[2] = space, entry[3..] = filename
                let file = entry[3..].to_string();
                if !file.is_empty() {
                    files.push(file);
                }
            }
        }
        Ok(files)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_diff(path: String, file_path: String) -> Result<String, String> {
    // Strategy: try all diff variants in order and return the first non-empty result.
    // This avoids any status parsing (which breaks on filenames with spaces/quotes).

    // 1. Staged changes (index vs HEAD) — covers `git add`-ed files
    let staged = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("diff")
        .arg("--cached")
        .arg("HEAD")
        .arg("--")
        .arg(&file_path)
        .output()
        .map_err(|e| e.to_string())?;
    let staged_text = String::from_utf8_lossy(&staged.stdout).to_string();

    // 2. Unstaged changes (working tree vs index)
    let worktree = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("diff")
        .arg("--")
        .arg(&file_path)
        .output()
        .map_err(|e| e.to_string())?;
    let worktree_text = String::from_utf8_lossy(&worktree.stdout).to_string();

    // Combine: staged first, then any additional unstaged changes
    let mut result = String::new();
    if !staged_text.trim().is_empty() {
        result.push_str(&staged_text);
    }
    if !worktree_text.trim().is_empty() {
        result.push_str(&worktree_text);
    }

    // 3. If still empty, the file may be untracked — show full file as additions
    if result.trim().is_empty() {
        let full_path = std::path::Path::new(&path).join(&file_path);
        if full_path.exists() {
            let content = std::fs::read_to_string(&full_path).unwrap_or_default();
            let line_count = content.lines().count();
            let mut diff = format!(
                "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
                file_path, line_count
            );
            for line in content.lines() {
                diff.push('+');
                diff.push_str(line);
                diff.push('\n');
            }
            return Ok(diff);
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn git_get_branches(path: String) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("branch")
        .arg("-a")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut branches = Vec::new();
        for line in stdout.lines() {
            let branch = line.trim().to_string();
            if !branch.is_empty() {
                branches.push(branch);
            }
        }
        Ok(branches)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("checkout")
        .arg(&branch)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("checkout")
        .arg("-b")
        .arg(&branch)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_delete_branch(
    path: String,
    branch: String,
    force: bool,
) -> Result<String, String> {
    let flag = if force { "-D" } else { "-d" };
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("branch")
        .arg(flag)
        .arg(&branch)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_rebase(path: String, branch: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("rebase")
        .arg(&branch)
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_merge(path: String, branch: String, strategy: String) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&path).arg("merge");

    if strategy == "no-ff" {
        cmd.arg("--no-ff");
    } else if strategy == "ff-only" {
        cmd.arg("--ff-only");
    }

    cmd.arg(&branch);

    let output = cmd.output().map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if output.status.success() {
        Ok(format!("{}{}", stdout, stderr))
    } else {
        Err(stderr)
    }
}

#[tauri::command]
pub async fn git_head_oid(path: String) -> Result<String, String> {
    // Returns the full SHA of HEAD, plus the current branch name separated by ~|~
    // e.g. "abc123def456...~|~main" or "abc123def456...~|~HEAD" (detached)
    let sha_out = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .map_err(|e| e.to_string())?;
    let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();

    let branch_out = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .output()
        .map_err(|e| e.to_string())?;
    let branch = String::from_utf8_lossy(&branch_out.stdout)
        .trim()
        .to_string();

    Ok(format!("{}~|~{}", sha, branch))
}

#[tauri::command]
pub async fn git_log_graph(path: String) -> Result<Vec<String>, String> {
    // format: %H~|~%P~|~%s~|~%an~|~%ar~|~%d  (full hashes so HEAD matching is unambiguous)
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("log")
        .arg("--all")
        .arg("--pretty=format:%H~|~%P~|~%s~|~%an~|~%ar~|~%d~|~%ae")
        .arg("--color=never")
        .arg("-n")
        .arg("200")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = Vec::new();
        for line in stdout.lines() {
            lines.push(line.to_string());
        }
        Ok(lines)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_conflicted_files(path: String) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("status")
        .arg("--porcelain")
        .arg("-z")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut files = Vec::new();
        for entry in stdout.split('\0') {
            if entry.len() > 3 {
                let status = &entry[0..2];
                let file = entry[3..].to_string();
                if ["UU", "AA", "DD", "AU", "UA", "UD", "DU"].contains(&status) {
                    files.push(file);
                }
            }
        }
        Ok(files)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn read_file_content(path: String, file_path: String) -> Result<String, String> {
    let full_path = std::path::Path::new(&path).join(&file_path);
    std::fs::read_to_string(full_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file_content(
    path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let full_path = std::path::Path::new(&path).join(&file_path);
    std::fs::write(full_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_add(path: String, file_path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("add")
        .arg(&file_path)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("commit")
        .arg("-m")
        .arg(&message)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_stash(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("stash")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_auto_stash(path: String) -> Result<AutoStashResult, String> {
    let before_oid = current_stash_oid(&path)?;
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("stash")
        .arg("push")
        .arg("-m")
        .arg("git-client auto stash")
        .output()
        .map_err(|e| e.to_string())?;
    let output_text = combined_output(&output);

    if !output.status.success() {
        return Err(output_text);
    }

    let after_oid = current_stash_oid(&path)?;
    let stash_oid = if after_oid != before_oid {
        after_oid
    } else {
        None
    };

    Ok(AutoStashResult {
        stash_oid,
        output: output_text,
    })
}

#[tauri::command]
pub async fn git_stash_pop(path: String, stash_oid: Option<String>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&path).arg("stash").arg("pop");

    if let Some(stash_oid) = stash_oid.as_deref().filter(|oid| !oid.trim().is_empty()) {
        if let Some(selector) = find_stash_selector_by_oid(&path, stash_oid)? {
            cmd.arg(selector);
        } else {
            return Ok("Auto stash already released.".to_string());
        }
    }

    let output = cmd.output().map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(combined_output(&output))
    } else {
        Err(combined_output(&output))
    }
}

#[tauri::command]
pub async fn git_stash_drop(path: String, stash_oid: String) -> Result<String, String> {
    let Some(selector) = find_stash_selector_by_oid(&path, &stash_oid)? else {
        return Ok("Auto stash already released.".to_string());
    };

    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("stash")
        .arg("drop")
        .arg(selector)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(combined_output(&output))
    } else {
        Err(combined_output(&output))
    }
}

#[tauri::command]
pub async fn git_checkout_files(path: String, files: Vec<String>) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&path).arg("checkout").arg("--");
    for file in files {
        cmd.arg(file);
    }
    let output = cmd.output().map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_discard_file(path: String, file_path: String) -> Result<String, String> {
    let status = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("status")
        .arg("--porcelain")
        .arg("-z")
        .arg("--")
        .arg(&file_path)
        .output()
        .map_err(|e| e.to_string())?;

    if !status.status.success() {
        return Err(String::from_utf8_lossy(&status.stderr).to_string());
    }

    let status_text = String::from_utf8_lossy(&status.stdout);
    let is_untracked = status_text
        .split('\0')
        .any(|entry| entry.starts_with("?? "));

    let output = if is_untracked {
        Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("clean")
            .arg("-fd")
            .arg("--")
            .arg(&file_path)
            .output()
            .map_err(|e| e.to_string())?
    } else {
        Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("restore")
            .arg("--staged")
            .arg("--worktree")
            .arg("--")
            .arg(&file_path)
            .output()
            .map_err(|e| e.to_string())?
    };

    if output.status.success() {
        Ok(combined_output(&output))
    } else {
        Err(combined_output(&output))
    }
}

#[tauri::command]
pub async fn git_discard_all_changes(path: String) -> Result<String, String> {
    let reset = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("reset")
        .arg("--hard")
        .output()
        .map_err(|e| e.to_string())?;

    if !reset.status.success() {
        return Err(combined_output(&reset));
    }

    let clean = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("clean")
        .arg("-fd")
        .output()
        .map_err(|e| e.to_string())?;

    if clean.status.success() {
        Ok(format!(
            "{}{}",
            combined_output(&reset),
            combined_output(&clean)
        ))
    } else {
        Err(format!(
            "{}{}",
            combined_output(&reset),
            combined_output(&clean)
        ))
    }
}

#[tauri::command]
pub async fn git_reset_hard(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("reset")
        .arg("--hard")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn open_in_editor(editor: String, file_path: String) -> Result<(), String> {
    Command::new(&editor)
        .arg(&file_path)
        .spawn()
        .map_err(|e| format!("Failed to launch '{}': {}", editor, e))?;
    Ok(())
}

/// Clone a repository into `dest_dir/<repo_name>`.
/// `clone_url` should already contain embedded credentials if needed.
/// Returns the full path of the cloned directory.
#[tauri::command]
pub async fn git_clone(clone_url: String, dest_dir: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("clone")
        .arg("--progress")
        .arg(&clone_url)
        .current_dir(&dest_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        // Derive the directory name git used: last path segment of the URL, minus ".git"
        let repo_name = clone_url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("repo")
            .trim_end_matches(".git")
            // strip any "user:token@host/..." prefix that may be left
            .rsplit('@')
            .next()
            .unwrap_or("repo")
            .to_string();
        // Remove embedded credentials from repo_name if present
        let clean_name = repo_name
            .split('/')
            .last()
            .unwrap_or(&repo_name)
            .to_string();
        let full_path = format!("{}/{}", dest_dir.trim_end_matches('/'), clean_name);
        Ok(full_path)
    } else {
        // git prints progress + errors to stderr
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(stderr)
    }
}

/// Get the primary remote URL for a repo (origin).
#[tauri::command]
pub async fn git_remote_url(path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
