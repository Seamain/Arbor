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
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("status")
        .arg("--porcelain")
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut files = Vec::new();
        for line in stdout.lines() {
            if line.len() > 3 {
                let file = line[3..].to_string();
                files.push(file);
            }
        }
        Ok(files)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
pub async fn git_diff(path: String, file_path: String) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("diff")
        .arg("HEAD")
        .arg("--")
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
pub async fn git_log_graph(path: String) -> Result<Vec<String>, String> {
    // format: %h~|~%p~|~%s~|~%an~|~%ar~|~%d
    let output = Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("log")
        .arg("--all")
        .arg("--pretty=format:%h~|~%p~|~%s~|~%an~|~%ar~|~%d")
        .arg("--color=never")
        .arg("-n")
        .arg("100") // Limiting to 100 commits for performance with custom graphs
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
