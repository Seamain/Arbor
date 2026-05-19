mod git_ops;
mod oauth;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
#[cfg(target_os = "macos")]
use tauri_plugin_notification::NotificationExt;
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager,
};

// Map from repo path → its debouncer (keeping it alive)
struct WatcherState(
    Mutex<
        HashMap<
            String,
            notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
        >,
    >,
);

#[tauri::command]
fn watch_repo(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut map = state.0.lock().map_err(|e| e.to_string())?;

    if map.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let path_clone = path.clone();
    let git_dir = std::path::Path::new(&path).join(".git");
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: DebounceEventResult| {
            if let Ok(events) = result {
                // Ignore any event whose path is inside the .git/ directory.
                // Git routinely writes to .git/ (FETCH_HEAD, index, packed-refs, …)
                // during normal operations, so watching those paths on Windows
                // causes an infinite loop: git write → repo-changed → silentRefresh
                // → more git writes → repo-changed → …
                let has_worktree_change = events.iter().any(|e| {
                    !e.path.starts_with(&git_dir)
                });
                if has_worktree_change {
                    let _ = app_handle.emit("repo-changed", path_clone.clone());
                }
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    map.insert(path, debouncer);
    Ok(())
}

#[tauri::command]
fn unwatch_repo(app: AppHandle, path: String) -> Result<(), String> {
    let state = app.state::<WatcherState>();
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.remove(&path);
    Ok(())
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // ── File ──────────────────────────────────────────────────────────────
    // CmdOrCtrl → Cmd on macOS, Ctrl on Windows/Linux
    let file_open  = MenuItem::with_id(app, "file_open",  "Open Repository…", true, Some("CmdOrCtrl+O"))?;
    let file_close = MenuItem::with_id(app, "file_close", "Close Tab",        true, Some("CmdOrCtrl+W"))?;
    let file_menu  = Submenu::with_items(app, "File", true, &[
        &file_open,
        &PredefinedMenuItem::separator(app)?,
        &file_close,
    ])?;

    // ── Repository ────────────────────────────────────────────────────────
    let repo_fetch      = MenuItem::with_id(app, "repo_fetch",      "Fetch",          true, Some("CmdOrCtrl+Shift+F"))?;
    let repo_pull       = MenuItem::with_id(app, "repo_pull",       "Pull",           true, Some("CmdOrCtrl+Shift+P"))?;
    let repo_push       = MenuItem::with_id(app, "repo_push",       "Push",           true, Some("CmdOrCtrl+P"))?;
    let repo_refresh    = MenuItem::with_id(app, "repo_refresh",    "Refresh Status", true, Some("CmdOrCtrl+R"))?;
    let repo_new_branch = MenuItem::with_id(app, "repo_new_branch", "New Branch…",    true, Some("CmdOrCtrl+Shift+B"))?;
    let repo_stash      = MenuItem::with_id(app, "repo_stash",      "Stash Changes",  true, Some("CmdOrCtrl+Shift+S"))?;
    let repo_menu = Submenu::with_items(app, "Repository", true, &[
        &repo_fetch,
        &repo_pull,
        &repo_push,
        &PredefinedMenuItem::separator(app)?,
        &repo_refresh,
        &PredefinedMenuItem::separator(app)?,
        &repo_new_branch,
        &PredefinedMenuItem::separator(app)?,
        &repo_stash,
    ])?;

    // ── View ──────────────────────────────────────────────────────────────
    let view_history = MenuItem::with_id(app, "view_history", "Show History",   true, Some("CmdOrCtrl+1"))?;
    let view_diff    = MenuItem::with_id(app, "view_diff",    "Show Diff",      true, Some("CmdOrCtrl+2"))?;
    let view_console = MenuItem::with_id(app, "view_console", "Toggle Console", true, Some("CmdOrCtrl+`"))?;
    let view_sidebar = MenuItem::with_id(app, "view_sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+B"))?;
    let view_menu = Submenu::with_items(app, "View", true, &[
        &view_history,
        &view_diff,
        &PredefinedMenuItem::separator(app)?,
        &view_console,
        &view_sidebar,
    ])?;

    // ── Edit (standard system copy/paste/undo etc.) ───────────────────────
    // PredefinedMenuItem handles the correct accelerators per platform automatically
    let edit_menu = Submenu::with_items(app, "Edit", true, &[
        &PredefinedMenuItem::undo(app, None)?,
        &PredefinedMenuItem::redo(app, None)?,
        &PredefinedMenuItem::separator(app)?,
        &PredefinedMenuItem::cut(app, None)?,
        &PredefinedMenuItem::copy(app, None)?,
        &PredefinedMenuItem::paste(app, None)?,
        &PredefinedMenuItem::select_all(app, None)?,
    ])?;

    // ── Help ──────────────────────────────────────────────────────────────
    let help_about    = PredefinedMenuItem::about(app, Some("About Git Client"), None)?;
    let help_settings = MenuItem::with_id(app, "app_settings", "Preferences…", true, Some("CmdOrCtrl+,"))?;
    let help_menu     = Submenu::with_items(app, "Help", true, &[&help_settings, &PredefinedMenuItem::separator(app)?, &help_about])?;

    // On macOS the system inserts an implicit "Apple" menu before everything.
    // On Windows/Linux the order below is exactly what appears in the menu bar.
    Menu::with_items(app, &[&file_menu, &edit_menu, &repo_menu, &view_menu, &help_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // ── macOS: vibrancy / frosted glass ───────────────────────────
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                    .expect("apply_vibrancy failed");
            }

            // ── Windows: acrylic blur (requires Windows 10 1803+) ─────────
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_acrylic;
                // colour = RGBA; a light semi-transparent tint
                let _ = apply_acrylic(&window, Some((245, 248, 252, 200)));
            }

            // ── Linux: no native blur — force solid background via JS ────────
            #[cfg(target_os = "linux")]
            {
                // Most Linux compositors don't support backdrop-filter or
                // transparent Tauri windows. Tell the frontend to switch from
                // its glass CSS to the solid-colour fallback palette.
                // (WebviewWindow has no set_transparent API in Tauri v2;
                // transparency is controlled only via tauri.conf.json. The
                // index.html inline script handles the pre-paint case; this
                // eval covers any edge cases where the attribute was not set.)
                let _ = window.eval(
                    "document.documentElement.setAttribute('data-platform','linux'); \
                     document.documentElement.style.background='#f1f4f8'; \
                     document.body && (document.body.style.background='#f1f4f8');"
                );
            }

            // ── macOS: request notification permission at startup ─────────
            // This triggers the system permission dialog on first launch,
            // before the user has interacted with anything.
            #[cfg(target_os = "macos")]
            {
                let _ = app.notification().request_permission();
            }

            // ── Native menu bar (all platforms) ───────────────────────────
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            // Forward menu-item clicks to the frontend as "menu-action" events
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let _ = handle.emit("menu-action", event.id().0.clone());
            });

            Ok(())
        })
        .manage(WatcherState(Mutex::new(HashMap::new())))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            watch_repo,
            unwatch_repo,
            git_ops::git_check_repo,
            git_ops::git_status,
            git_ops::git_fetch,
            git_ops::git_pull,
            git_ops::git_push,
            git_ops::git_modified_files,
            git_ops::git_diff,
            git_ops::git_get_branches,
            git_ops::git_checkout,
            git_ops::git_create_branch,
            git_ops::git_delete_branch,
            git_ops::git_rebase,
            git_ops::git_merge,
            git_ops::git_head_oid,
            git_ops::git_log_graph,
            git_ops::git_conflicted_files,
            git_ops::read_file_content,
            git_ops::write_file_content,
            git_ops::git_add,
            git_ops::git_commit,
            git_ops::git_stash,
            git_ops::git_auto_stash,
            git_ops::git_stash_pop,
            git_ops::git_stash_drop,
            git_ops::git_checkout_files,
            git_ops::git_discard_file,
            git_ops::git_discard_all_changes,
            git_ops::git_reset_hard,
            git_ops::open_in_editor,
            git_ops::git_clone,
            git_ops::git_remote_url,
            oauth::oauth_start
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
