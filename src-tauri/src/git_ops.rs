use std::process::Command;

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
        .arg("-C").arg(&path)
        .arg("diff").arg("--cached").arg("HEAD")
        .arg("--").arg(&file_path)
        .output()
        .map_err(|e| e.to_string())?;
    let staged_text = String::from_utf8_lossy(&staged.stdout).to_string();

    // 2. Unstaged changes (working tree vs index)
    let worktree = Command::new("git")
        .arg("-C").arg(&path)
        .arg("diff")
        .arg("--").arg(&file_path)
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
pub async fn git_delete_branch(path: String, branch: String, force: bool) -> Result<String, String> {
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
        .arg("-C").arg(&path)
        .arg("rev-parse").arg("HEAD")
        .output()
        .map_err(|e| e.to_string())?;
    let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();

    let branch_out = Command::new("git")
        .arg("-C").arg(&path)
        .arg("rev-parse").arg("--abbrev-ref").arg("HEAD")
        .output()
        .map_err(|e| e.to_string())?;
    let branch = String::from_utf8_lossy(&branch_out.stdout).trim().to_string();

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
