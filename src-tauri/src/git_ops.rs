use git2::{
    BranchType, build::CheckoutBuilder, DiffOptions, FetchOptions, MergeOptions,
    PushOptions, RemoteCallbacks, Repository, ResetType, StashFlags,
};
use std::path::Path;

// ── helpers ───────────────────────────────────────────────────────────────────

fn open(path: &str) -> Result<Repository, String> {
    Repository::open(path).map_err(|e| e.to_string())
}

/// Build a credential callback with retry-guard.
///
/// libgit2 re-invokes the callback on every auth failure with the same
/// `allowed` flags, causing an infinite loop if we keep returning the same
/// (wrong) credential.  We use a call-count cell to bail out after one
/// attempt per credential type, which surfaces a clean error to the caller.
///
/// Priority order:
///   1. SSH agent (silently skipped if agent unavailable / returns banner error)
///   2. SSH key files from ~/.ssh (id_ed25519, id_rsa, …)
///   3. git credential helper (for HTTPS repos with stored tokens)
///   4. GIT_DEFAULT (Kerberos / NTLM / GSSAPI)
fn make_callbacks<'a>() -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();

    // `attempts` tracks how many times the callback has fired so we can
    // stop libgit2 from retrying forever on wrong credentials.
    let attempts = std::cell::Cell::new(0u32);

    cb.credentials(move |url, username, allowed| {
        let n = attempts.get();
        attempts.set(n + 1);

        // After 3 total attempts give up — avoids infinite retry loops.
        if n >= 3 {
            return Err(git2::Error::from_str(
                "authentication failed after multiple attempts",
            ));
        }

        // ── 1. SSH agent ──────────────────────────────────────────────────
        if allowed.contains(git2::CredentialType::SSH_KEY) {
            let user = username.unwrap_or("git");

            // Try SSH agent — ignore banner/connection errors silently.
            match git2::Cred::ssh_key_from_agent(user) {
                Ok(cred) => return Ok(cred),
                Err(_) => {} // agent not running or banner error — fall through
            }

            // Try key files from ~/.ssh in order of preference.
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_default();
            let ssh_dir = std::path::Path::new(&home).join(".ssh");
            for key_name in &["id_ed25519", "id_ecdsa", "id_rsa"] {
                let private = ssh_dir.join(key_name);
                let public = ssh_dir.join(format!("{}.pub", key_name));
                if private.exists() {
                    match git2::Cred::ssh_key(user, Some(&public), &private, None) {
                        Ok(cred) => return Ok(cred),
                        Err(_) => continue,
                    }
                }
            }
        }

        // ── 2. HTTPS credential helper ────────────────────────────────────
        if allowed.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(config) = git2::Config::open_default() {
                if let Ok(cred) = git2::Cred::credential_helper(&config, url, username) {
                    return Ok(cred);
                }
            }
        }

        // ── 3. Kerberos / NTLM / GSSAPI ──────────────────────────────────
        if allowed.contains(git2::CredentialType::DEFAULT) {
            if let Ok(cred) = git2::Cred::default() {
                return Ok(cred);
            }
        }

        Err(git2::Error::from_str(
            "no credentials available — configure SSH keys or run `git credential approve`",
        ))
    });
    cb
}

fn fetch_options<'a>() -> FetchOptions<'a> {
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(make_callbacks());
    fo
}

fn push_options<'a>() -> PushOptions<'a> {
    let mut po = PushOptions::new();
    po.remote_callbacks(make_callbacks());
    po
}

/// Returns true if the URL uses SSH transport (git@… or ssh://…).
/// libgit2's vendored SSH transport can fail with "Failed getting banner"
/// on some servers, so we route these through the system git binary instead.
fn is_ssh_url(url: &str) -> bool {
    url.starts_with("git@") || url.starts_with("ssh://")
}

/// Get the origin URL for a repo, returning None if not found.
fn origin_url(repo: &Repository) -> Option<String> {
    repo.find_remote("origin")
        .ok()
        .and_then(|r| r.url().map(|u| u.to_string()))
}

/// Run a system `git` command in `repo_path` with the given args.
///
/// On Windows the process is created with CREATE_NO_WINDOW (0x08000000) so
/// no console window ever appears — even for SSH operations that prompt for
/// passphrases (libssh2 / OpenSSH handle that through the SSH agent instead).
fn run_git_command(repo_path: &str, args: &[&str]) -> Result<String, String> {
    git_command_output(repo_path, args)
}

#[cfg(target_os = "windows")]
fn git_command_output(repo_path: &str, args: &[&str]) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let output = std::process::Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn git_command_output(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("git")
        .current_dir(repo_path)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

// ── public commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_check_repo(path: String) -> Result<bool, String> {
    Ok(Repository::open(&path).is_ok())
}

#[tauri::command]
pub async fn git_status(path: String) -> Result<String, String> {
    let repo = open(&path)?;
    let head = repo.head().ok();

    // HEAD OID
    let head_oid = head
        .as_ref()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string())
        .unwrap_or_else(|| "(initial)".to_string());

    let branch = head
        .as_ref()
        .and_then(|h| h.shorthand())
        .unwrap_or("HEAD")
        .to_string();

    // Build porcelain-v2-compatible output that the frontend parses.
    let mut out = format!("# branch.oid {}\n", head_oid);
    out.push_str(&format!("# branch.head {}\n", branch));

    // Upstream tracking info + ahead/behind counts
    if let Some(ref head_ref) = head {
        if let Some(ref_name) = head_ref.name() {
            if let Ok(upstream_buf) = repo.branch_upstream_name(ref_name) {
                if let Some(upstream_name) = upstream_buf.as_str() {
                    out.push_str(&format!("# branch.upstream {}\n", upstream_name));

                    // Ahead/behind
                    if let (Ok(local_oid), Ok(upstream_ref)) = (
                        head_ref.peel_to_commit().map(|c| c.id()),
                        repo.find_reference(upstream_name).and_then(|r| r.peel_to_commit().map(|c| c.id())),
                    ) {
                        if let Ok((ahead, behind)) = repo.graph_ahead_behind(local_oid, upstream_ref) {
                            out.push_str(&format!("# branch.ab +{} -{}\n", ahead, behind));
                        }
                    }
                }
            }
        }
    }

    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    for entry in statuses.iter() {
        let flags = entry.status();
        let path_str = entry.path().unwrap_or("");

        if flags.contains(git2::Status::CONFLICTED) {
            // porcelain v2 unmerged entry starts with "u "
            out.push_str(&format!("u UU N... 0 0 0 0 0 0 0 {}\n", path_str));
            continue;
        }

        let xy = status_to_porcelain(flags);
        if xy == ". ." {
            continue;
        }
        // porcelain v2 changed-entry: "1 XY N... hI hI hW oidI oidI filepath"
        out.push_str(&format!("1 {} N... 0 0 0 0 0 {}\n", xy, path_str));
    }

    Ok(out)
}

fn status_to_porcelain(flags: git2::Status) -> &'static str {
    use git2::Status;
    // Index (staged) changes
    let idx = if flags.intersects(Status::INDEX_NEW) {
        'A'
    } else if flags.intersects(Status::INDEX_MODIFIED) {
        'M'
    } else if flags.intersects(Status::INDEX_DELETED) {
        'D'
    } else if flags.intersects(Status::INDEX_RENAMED) {
        'R'
    } else if flags.intersects(Status::INDEX_TYPECHANGE) {
        'T'
    } else {
        '.'
    };
    // Worktree changes
    let wt = if flags.intersects(Status::WT_NEW) {
        '?'
    } else if flags.intersects(Status::WT_MODIFIED) {
        'M'
    } else if flags.intersects(Status::WT_DELETED) {
        'D'
    } else if flags.intersects(Status::WT_TYPECHANGE) {
        'T'
    } else if flags.intersects(Status::CONFLICTED) {
        'U'
    } else {
        '.'
    };
    match (idx, wt) {
        ('A', '.') => "A .",
        ('M', '.') => "M .",
        ('D', '.') => "D .",
        ('R', '.') => "R .",
        ('T', '.') => "T .",
        ('.', '?') => "? ?",
        ('.', 'M') => ". M",
        ('.', 'D') => ". D",
        ('.', 'T') => ". T",
        ('.', 'U') => "U U",
        ('M', 'M') => "M M",
        _ => ". .",
    }
}

#[tauri::command]
pub async fn git_fetch(path: String) -> Result<String, String> {
    let repo = open(&path)?;

    // SSH repos: delegate to system git to avoid libgit2 SSH banner errors.
    if origin_url(&repo).as_deref().map(is_ssh_url).unwrap_or(false) {
        return run_git_command(&path, &["fetch", "origin"]);
    }

    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    remote
        .fetch(&[] as &[&str], Some(&mut fetch_options()), None)
        .map_err(|e| e.to_string())?;
    Ok("Fetched from origin.".to_string())
}

#[tauri::command]
pub async fn git_pull(path: String) -> Result<String, String> {
    let repo = open(&path)?;

    // SSH repos: delegate to system git to avoid libgit2 SSH banner errors.
    if origin_url(&repo).as_deref().map(is_ssh_url).unwrap_or(false) {
        return run_git_command(&path, &["pull", "--ff-only", "origin"]);
    }

    // 1. Fetch
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    remote
        .fetch(&[] as &[&str], Some(&mut fetch_options()), None)
        .map_err(|e| e.to_string())?;

    // 2. Resolve FETCH_HEAD
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;

    // 3. Merge analysis
    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok("Already up to date.".to_string());
    }
    if analysis.is_fast_forward() {
        // Fast-forward: just move HEAD
        let refname = {
            let head = repo.head().map_err(|e| e.to_string())?;
            head.name().unwrap_or("HEAD").to_string()
        };
        let target_oid = fetch_commit.id();
        let mut reference = repo
            .find_reference(&refname)
            .map_err(|e| e.to_string())?;
        reference
            .set_target(target_oid, "Fast-forward pull")
            .map_err(|e| e.to_string())?;
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
        Ok("Fast-forwarded.".to_string())
    } else if analysis.is_normal() {
        // Normal merge
        repo.merge(&[&fetch_commit], Some(&mut MergeOptions::new()), None)
            .map_err(|e| e.to_string())?;
        if repo.index().map_err(|e| e.to_string())?.has_conflicts() {
            return Err("Merge conflict — please resolve manually.".to_string());
        }
        // Commit the merge
        let sig = repo.signature().map_err(|e| e.to_string())?;
        let mut index = repo.index().map_err(|e| e.to_string())?;
        let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
        let head_commit = repo
            .head()
            .map_err(|e| e.to_string())?
            .peel_to_commit()
            .map_err(|e| e.to_string())?;
        let fetch_commit_obj = repo
            .find_commit(fetch_commit.id())
            .map_err(|e| e.to_string())?;
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Merge",
            &tree,
            &[&head_commit, &fetch_commit_obj],
        )
        .map_err(|e| e.to_string())?;
        repo.cleanup_state().map_err(|e| e.to_string())?;
        Ok("Merged.".to_string())
    } else {
        Err("Cannot pull: unborn or unresolvable state.".to_string())
    }
}

#[tauri::command]
pub async fn git_push(path: String) -> Result<String, String> {
    let repo = open(&path)?;

    // SSH repos: delegate to system git to avoid libgit2 SSH banner errors.
    if origin_url(&repo).as_deref().map(is_ssh_url).unwrap_or(false) {
        let head = repo.head().map_err(|e| e.to_string())?;
        let branch = head.shorthand().ok_or("HEAD is detached")?.to_string();
        return run_git_command(&path, &["push", "origin", &branch]);
    }

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head
        .shorthand()
        .ok_or("HEAD is detached")?
        .to_string();
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    remote
        .push(&[refspec.as_str()], Some(&mut push_options()))
        .map_err(|e| e.to_string())?;
    Ok(format!("Pushed '{}' to origin.", branch))
}

#[tauri::command]
pub async fn git_modified_files(path: String) -> Result<Vec<String>, String> {
    let repo = open(&path)?;
    let mut opts = git2::StatusOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);

    let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
    let files = statuses
        .iter()
        .filter_map(|e| {
            let s = e.status();
            // Exclude completely unmodified
            if s.is_empty() {
                None
            } else {
                e.path().map(|p| p.to_string())
            }
        })
        .collect();
    Ok(files)
}

#[tauri::command]
pub async fn git_diff(path: String, file_path: String) -> Result<String, String> {
    let repo = open(&path)?;
    let mut result = String::new();

    // 1. Staged diff (index vs HEAD)
    let head_tree = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_tree().ok());

    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(&file_path);

    let staged_diff = repo
        .diff_tree_to_index(head_tree.as_ref(), None, Some(&mut diff_opts))
        .map_err(|e| e.to_string())?;
    diff_to_string(&staged_diff, &mut result)?;

    // 2. Unstaged diff (workdir vs index)
    let mut diff_opts2 = DiffOptions::new();
    diff_opts2.pathspec(&file_path);
    let worktree_diff = repo
        .diff_index_to_workdir(None, Some(&mut diff_opts2))
        .map_err(|e| e.to_string())?;
    diff_to_string(&worktree_diff, &mut result)?;

    // 3. Untracked file — show as full addition
    if result.trim().is_empty() {
        let full_path = Path::new(&path).join(&file_path);
        if full_path.exists() {
            let content = std::fs::read_to_string(&full_path).unwrap_or_default();
            let line_count = content.lines().count();
            result.push_str(&format!(
                "--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
                file_path, line_count
            ));
            for line in content.lines() {
                result.push('+');
                result.push_str(line);
                result.push('\n');
            }
        }
    }

    Ok(result)
}

fn diff_to_string(diff: &git2::Diff, out: &mut String) -> Result<(), String> {
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' => "+",
            '-' => "-",
            ' ' => " ",
            'H' => "",  // hunk header — already included in line content
            'F' => "",  // file header
            _ => "",
        };
        // For file/hunk headers the origin char is already part of content
        let content = std::str::from_utf8(line.content()).unwrap_or("");
        match line.origin() {
            'F' | 'H' => out.push_str(content),
            _ => {
                out.push_str(prefix);
                out.push_str(content);
            }
        }
        true
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_get_branches(path: String) -> Result<Vec<String>, String> {
    let repo = open(&path)?;
    let mut branches = Vec::new();

    // Current branch (with leading "* ")
    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            branches.push(format!("* {}", name));
        }
    }

    // Local branches
    for branch in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?
    {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.to_string())? {
            let prefix = if branch.is_head() { "* " } else { "  " };
            let entry = format!("{}{}", prefix, name);
            if !branches.contains(&entry) {
                branches.push(entry);
            }
        }
    }

    // Remote branches
    for branch in repo
        .branches(Some(BranchType::Remote))
        .map_err(|e| e.to_string())?
    {
        let (branch, _) = branch.map_err(|e| e.to_string())?;
        if let Some(name) = branch.name().map_err(|e| e.to_string())? {
            branches.push(format!("  remotes/{}", name));
        }
    }

    Ok(branches)
}

#[tauri::command]
pub async fn git_checkout(path: String, branch: String) -> Result<String, String> {
    let repo = open(&path)?;
    let (object, reference) = repo
        .revparse_ext(&branch)
        .map_err(|e| e.to_string())?;
    repo.checkout_tree(&object, None)
        .map_err(|e| e.to_string())?;
    match reference {
        Some(gref) => repo
            .set_head(gref.name().unwrap_or(&branch))
            .map_err(|e| e.to_string())?,
        None => repo
            .set_head_detached(object.id())
            .map_err(|e| e.to_string())?,
    }
    Ok(format!("Switched to '{}'.", branch))
}

#[tauri::command]
pub async fn git_create_branch(path: String, branch: String) -> Result<String, String> {
    let repo = open(&path)?;
    let head = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    repo.branch(&branch, &head, false)
        .map_err(|e| e.to_string())?;
    // Checkout the new branch
    let refname = format!("refs/heads/{}", branch);
    repo.set_head(&refname).map_err(|e| e.to_string())?;
    repo.checkout_head(Some(CheckoutBuilder::default().force()))
        .map_err(|e| e.to_string())?;
    Ok(format!("Created and switched to '{}'.", branch))
}

#[tauri::command]
pub async fn git_delete_branch(
    path: String,
    branch: String,
    force: bool,
) -> Result<String, String> {
    let repo = open(&path)?;
    let mut b = repo
        .find_branch(&branch, BranchType::Local)
        .map_err(|e| e.to_string())?;
    if force {
        b.delete().map_err(|e| e.to_string())?;
    } else {
        // Only delete if fully merged — check that branch tip is reachable from HEAD
        let head_oid = repo
            .head()
            .map_err(|e| e.to_string())?
            .peel_to_commit()
            .map_err(|e| e.to_string())?
            .id();
        let branch_oid = b
            .get()
            .peel_to_commit()
            .map_err(|e| e.to_string())?
            .id();
        let merged = repo
            .graph_descendant_of(head_oid, branch_oid)
            .map_err(|e| e.to_string())?;
        if !merged {
            return Err(format!(
                "Branch '{}' is not fully merged. Use force=true to delete anyway.",
                branch
            ));
        }
        b.delete().map_err(|e| e.to_string())?;
    }
    Ok(format!("Deleted branch '{}'.", branch))
}

#[tauri::command]
pub async fn git_rebase(path: String, branch: String) -> Result<String, String> {
    let repo = open(&path)?;
    let upstream = repo
        .revparse_single(&branch)
        .map_err(|e| e.to_string())?;
    let upstream_commit = repo
        .find_annotated_commit(upstream.id())
        .map_err(|e| e.to_string())?;

    let mut rebase = repo
        .rebase(None, Some(&upstream_commit), None, None)
        .map_err(|e| e.to_string())?;

    let sig = repo.signature().map_err(|e| e.to_string())?;
    while let Some(op) = rebase.next() {
        op.map_err(|e| e.to_string())?;
        if repo.index().map_err(|e| e.to_string())?.has_conflicts() {
            rebase.abort().ok();
            return Err("Rebase conflict — aborted. Resolve conflicts manually.".to_string());
        }
        rebase.commit(None, &sig, None).map_err(|e| e.to_string())?;
    }
    rebase.finish(Some(&sig)).map_err(|e| e.to_string())?;
    Ok(format!("Rebased onto '{}'.", branch))
}

#[tauri::command]
pub async fn git_merge(path: String, branch: String, strategy: String) -> Result<String, String> {
    let repo = open(&path)?;
    let branch_ref = repo
        .revparse_single(&branch)
        .map_err(|e| e.to_string())?;
    let annotated = repo
        .find_annotated_commit(branch_ref.id())
        .map_err(|e| e.to_string())?;

    let (analysis, pref) = repo
        .merge_analysis(&[&annotated])
        .map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok("Already up to date.".to_string());
    }

    let force_no_ff =
        strategy == "no-ff" || pref.contains(git2::MergePreference::NO_FAST_FORWARD);

    if analysis.is_fast_forward() && !force_no_ff && strategy != "no-ff" {
        // Fast-forward
        let target = branch_ref.id();
        let refname = repo.head().map_err(|e| e.to_string())?.name().unwrap_or("HEAD").to_string();
        if let Ok(mut reference) = repo.find_reference(&refname) {
            reference.set_target(target, "Fast-forward merge").map_err(|e| e.to_string())?;
        }
        repo.set_head(&refname).map_err(|e| e.to_string())?;
        repo.checkout_head(Some(CheckoutBuilder::default().force()))
            .map_err(|e| e.to_string())?;
        return Ok("Fast-forwarded.".to_string());
    }

    if strategy == "ff-only" {
        return Err("Cannot fast-forward only merge.".to_string());
    }

    // Normal merge commit
    repo.merge(&[&annotated], None, None)
        .map_err(|e| e.to_string())?;
    if repo.index().map_err(|e| e.to_string())?.has_conflicts() {
        return Err("Merge conflict — resolve manually.".to_string());
    }

    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;
    let head_commit = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    let merge_commit = repo
        .find_commit(annotated.id())
        .map_err(|e| e.to_string())?;
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &format!("Merge branch '{}'", branch),
        &tree,
        &[&head_commit, &merge_commit],
    )
    .map_err(|e| e.to_string())?;
    repo.cleanup_state().map_err(|e| e.to_string())?;
    Ok(format!("Merged '{}'.", branch))
}

#[tauri::command]
pub async fn git_head_oid(path: String) -> Result<String, String> {
    let repo = open(&path)?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let oid = head
        .peel_to_commit()
        .map_err(|e| e.to_string())?
        .id()
        .to_string();
    let branch = head.shorthand().unwrap_or("HEAD").to_string();
    Ok(format!("{}~|~{}", oid, branch))
}

#[tauri::command]
pub async fn git_log_graph(path: String) -> Result<Vec<String>, String> {
    let repo = open(&path)?;
    let mut walk = repo.revwalk().map_err(|e| e.to_string())?;
    walk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)
        .map_err(|e| e.to_string())?;

    // Push all branch/tag refs but skip refs/stash — stash commits have
    // synthetic parents that are not in the ODB and cause "object not found".
    let all_refs = repo.references().map_err(|e| e.to_string())?;
    for reference in all_refs.flatten() {
        let name = match reference.name() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name == "refs/stash" || name.starts_with("refs/stash/") {
            continue;
        }
        if let Ok(oid) = reference.peel_to_commit().map(|c| c.id()) {
            let _ = walk.push(oid); // ignore errors for packed refs etc.
        }
    }

    // Build a map: oid → ref names (branches/tags)
    let refs = repo.references().map_err(|e| e.to_string())?;
    let mut ref_map: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    let head_branch = repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string()));

    for reference in refs.flatten() {
        let name = match reference.name() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name == "refs/stash" || name.starts_with("refs/stash/") {
            continue;
        }
        if let Ok(target) = reference.peel_to_commit() {
            let display = prettify_ref(&name, head_branch.as_deref());
            ref_map.entry(target.id().to_string()).or_default().push(display);
        }
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let mut lines = Vec::new();
    for (i, oid_result) in walk.enumerate() {
        if i >= 200 {
            break;
        }
        // Skip any OID that fails to resolve — avoids crashing on shallow
        // clones or repos with loose objects referencing missing packfile data.
        let oid = match oid_result {
            Ok(o) => o,
            Err(_) => continue,
        };
        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let hash = oid.to_string();
        let parents: Vec<String> = commit.parent_ids().map(|p| p.to_string()).collect();
        let parent_str = parents.join(" ");
        let subject = commit.summary().unwrap_or("").replace("~|~", " ");
        let author = commit.author();
        let author_name = author.name().unwrap_or("").replace("~|~", " ");
        let author_email = author.email().unwrap_or("").replace("~|~", " ");
        let commit_time = commit.time().seconds();
        let ago = relative_time(now - commit_time);

        let refs_display = ref_map
            .get(&hash)
            .map(|v| {
                let joined = v.join(", ");
                format!(" ({})", joined)
            })
            .unwrap_or_default();

        // format: hash~|~parents~|~subject~|~author~|~age~|~ (refs)~|~email
        lines.push(format!(
            "{}~|~{}~|~{}~|~{}~|~{}~|~{}~|~{}",
            hash, parent_str, subject, author_name, ago, refs_display, author_email
        ));
    }

    Ok(lines)
}

fn prettify_ref(name: &str, head_branch: Option<&str>) -> String {
    if name == "HEAD" {
        return "HEAD".to_string();
    }
    if let Some(branch) = name.strip_prefix("refs/heads/") {
        if head_branch == Some(branch) {
            return format!("HEAD -> {}", branch);
        }
        return branch.to_string();
    }
    if let Some(remote) = name.strip_prefix("refs/remotes/") {
        return remote.to_string();
    }
    if let Some(tag) = name.strip_prefix("refs/tags/") {
        return format!("tag: {}", tag);
    }
    name.to_string()
}

fn relative_time(secs: i64) -> String {
    let secs = secs.max(0) as u64;
    if secs < 60 {
        return "just now".to_string();
    }
    let mins = secs / 60;
    if mins < 60 {
        return format!("{} minute{} ago", mins, if mins == 1 { "" } else { "s" });
    }
    let hours = mins / 60;
    if hours < 24 {
        return format!("{} hour{} ago", hours, if hours == 1 { "" } else { "s" });
    }
    let days = hours / 24;
    if days < 30 {
        return format!("{} day{} ago", days, if days == 1 { "" } else { "s" });
    }
    let months = days / 30;
    if months < 12 {
        return format!("{} month{} ago", months, if months == 1 { "" } else { "s" });
    }
    let years = months / 12;
    format!("{} year{} ago", years, if years == 1 { "" } else { "s" })
}

#[tauri::command]
pub async fn git_conflicted_files(path: String) -> Result<Vec<String>, String> {
    let repo = open(&path)?;
    let index = repo.index().map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for entry in index.conflicts().map_err(|e| e.to_string())? {
        let conflict = entry.map_err(|e| e.to_string())?;
        // Any of ancestor/our/their can carry the path
        let path_bytes = conflict
            .ancestor
            .as_ref()
            .or(conflict.our.as_ref())
            .or(conflict.their.as_ref())
            .and_then(|e| std::str::from_utf8(&e.path).ok().map(|s| s.to_string()));
        if let Some(p) = path_bytes {
            files.push(p);
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn read_file_content(path: String, file_path: String) -> Result<String, String> {
    let full_path = Path::new(&path).join(&file_path);
    std::fs::read_to_string(full_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_file_content(
    path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let full_path = Path::new(&path).join(&file_path);
    std::fs::write(full_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_add(path: String, file_path: String) -> Result<String, String> {
    let repo = open(&path)?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index.add_path(Path::new(&file_path)).map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;
    Ok(String::new())
}

#[tauri::command]
pub async fn git_commit(path: String, message: String) -> Result<String, String> {
    let repo = open(&path)?;
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    let parents: Vec<git2::Commit> = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .into_iter()
        .collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)
        .map_err(|e| e.to_string())?;
    Ok(format!("Created commit {}", oid))
}

#[tauri::command]
pub async fn git_stash(path: String) -> Result<String, String> {
    let mut repo = open(&path)?;
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let oid = repo
        .stash_save(&sig, "WIP", Some(StashFlags::DEFAULT))
        .map_err(|e| e.to_string())?;
    Ok(format!("Stashed as {}", oid))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStashResult {
    stash_oid: Option<String>,
    output: String,
}

#[tauri::command]
pub async fn git_auto_stash(path: String) -> Result<AutoStashResult, String> {
    let mut repo = open(&path)?;

    // Check if there is anything to stash.
    // The `statuses` borrow must be dropped before we can call `stash_save`
    // (which requires &mut repo), so we scope it explicitly.
    let has_changes = {
        let mut opts = git2::StatusOptions::new();
        opts.include_untracked(false);
        let statuses = repo.statuses(Some(&mut opts)).map_err(|e| e.to_string())?;
        statuses.iter().any(|e| !e.status().is_empty())
    }; // `statuses` dropped here — &repo borrow released

    if !has_changes {
        return Ok(AutoStashResult { stash_oid: None, output: "Nothing to stash.".to_string() });
    }

    let sig = repo.signature().map_err(|e| e.to_string())?;
    let oid = repo
        .stash_save(&sig, "git-client auto stash", Some(StashFlags::DEFAULT))
        .map_err(|e| e.to_string())?;
    Ok(AutoStashResult {
        stash_oid: Some(oid.to_string()),
        output: format!("Auto stashed as {}", oid),
    })
}

#[tauri::command]
pub async fn git_stash_pop(path: String, stash_oid: Option<String>) -> Result<String, String> {
    let mut repo = open(&path)?;

    let index = if let Some(oid_str) = stash_oid.as_deref().filter(|s| !s.trim().is_empty()) {
        // Find the stash index by OID
        find_stash_index_by_oid(&mut repo, oid_str)?
    } else {
        Some(0)
    };

    match index {
        None => Ok("Auto stash already released.".to_string()),
        Some(idx) => {
            repo.stash_pop(idx, None).map_err(|e| e.to_string())?;
            Ok("Stash popped.".to_string())
        }
    }
}

#[tauri::command]
pub async fn git_stash_drop(path: String, stash_oid: String) -> Result<String, String> {
    let mut repo = open(&path)?;
    let index = find_stash_index_by_oid(&mut repo, &stash_oid)?;
    match index {
        None => Ok("Auto stash already released.".to_string()),
        Some(idx) => {
            repo.stash_drop(idx).map_err(|e| e.to_string())?;
            Ok("Stash dropped.".to_string())
        }
    }
}

fn find_stash_index_by_oid(repo: &mut Repository, oid_str: &str) -> Result<Option<usize>, String> {
    let target = git2::Oid::from_str(oid_str).map_err(|e| e.to_string())?;
    let mut found: Option<usize> = None;
    repo.stash_foreach(|index, _msg, oid| {
        if *oid == target {
            found = Some(index);
            false // stop iteration
        } else {
            true
        }
    })
    .map_err(|e| e.to_string())?;
    Ok(found)
}

#[tauri::command]
pub async fn git_checkout_files(path: String, files: Vec<String>) -> Result<String, String> {
    let repo = open(&path)?;
    let mut checkout_opts = CheckoutBuilder::new();
    for f in &files {
        checkout_opts.path(f);
    }
    checkout_opts.force();
    repo.checkout_head(Some(&mut checkout_opts))
        .map_err(|e| e.to_string())?;
    Ok(format!("Restored {} file(s).", files.len()))
}

#[tauri::command]
pub async fn git_discard_file(path: String, file_path: String) -> Result<String, String> {
    let repo = open(&path)?;

    // Check if the file is untracked
    let mut status_opts = git2::StatusOptions::new();
    status_opts.pathspec(&file_path);
    let statuses = repo
        .statuses(Some(&mut status_opts))
        .map_err(|e| e.to_string())?;
    let is_untracked = statuses
        .iter()
        .any(|e| e.status().contains(git2::Status::WT_NEW));

    if is_untracked {
        let full = Path::new(&path).join(&file_path);
        if full.is_dir() {
            std::fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&full).map_err(|e| e.to_string())?;
        }
        return Ok(format!("Removed untracked '{}'.", file_path));
    }

    // Reset staged changes
    if let Ok(head) = repo.head().and_then(|h| h.peel_to_commit()) {
        let tree = head.tree().map_err(|e| e.to_string())?;
        repo.reset_default(Some(tree.as_object()), [file_path.as_str()])
            .map_err(|e| e.to_string())?;
    }

    // Restore working tree
    let mut checkout_opts = CheckoutBuilder::new();
    checkout_opts.path(&file_path).force();
    repo.checkout_head(Some(&mut checkout_opts))
        .map_err(|e| e.to_string())?;

    Ok(format!("Discarded changes in '{}'.", file_path))
}

#[tauri::command]
pub async fn git_discard_all_changes(path: String) -> Result<String, String> {
    let repo = open(&path)?;

    // Hard reset tracked files
    let head = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    repo.reset(head.as_object(), ResetType::Hard, None)
        .map_err(|e| e.to_string())?;

    // Remove untracked files
    let mut status_opts = git2::StatusOptions::new();
    status_opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut status_opts)).map_err(|e| e.to_string())?;
    for entry in statuses.iter() {
        if entry.status().contains(git2::Status::WT_NEW) {
            if let Some(p) = entry.path() {
                let full = Path::new(&path).join(p);
                if full.is_dir() {
                    let _ = std::fs::remove_dir_all(&full);
                } else {
                    let _ = std::fs::remove_file(&full);
                }
            }
        }
    }

    Ok("Discarded all changes and removed untracked files.".to_string())
}

#[tauri::command]
pub async fn git_reset_hard(path: String) -> Result<String, String> {
    let repo = open(&path)?;
    let head = repo
        .head()
        .map_err(|e| e.to_string())?
        .peel_to_commit()
        .map_err(|e| e.to_string())?;
    repo.reset(head.as_object(), ResetType::Hard, None)
        .map_err(|e| e.to_string())?;
    Ok("Hard reset to HEAD.".to_string())
}

#[tauri::command]
pub async fn open_in_editor(editor: String, file_path: String) -> Result<(), String> {
    // This one intentionally keeps spawning an external process — it's opening the user's
    // editor of choice, not a git subprocess. We use spawn() (not output()) so it doesn't
    // block and doesn't show a console window on Windows either.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(&editor)
            .arg(&file_path)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to launch '{}': {}", editor, e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(&editor)
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to launch '{}': {}", editor, e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn git_clone(clone_url: String, dest_dir: String) -> Result<String, String> {
    // Derive the repo name from the URL (same logic as the old CLI version)
    let repo_name = clone_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .rsplit('@')
        .next()
        .unwrap_or("repo")
        .to_string();
    let clean_name = repo_name
        .split('/')
        .next_back()
        .unwrap_or(&repo_name)
        .to_string();

    let target = Path::new(&dest_dir).join(&clean_name);
    let target_str = target.to_string_lossy().to_string();

    // SSH URLs: use system git to avoid libgit2 SSH banner errors.
    if is_ssh_url(&clone_url) {
        run_git_command(&dest_dir, &["clone", &clone_url, &clean_name])?;
        return Ok(target_str);
    }

    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_options());
    builder.clone(&clone_url, &target).map_err(|e| e.to_string())?;

    Ok(target_str)
}

#[tauri::command]
pub async fn git_remote_url(path: String) -> Result<String, String> {
    let repo = open(&path)?;
    let remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    Ok(remote.url().unwrap_or("").to_string())
}
