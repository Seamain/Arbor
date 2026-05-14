mod git_ops;

use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

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

    // Already watching this path — skip
    if map.contains_key(&path) {
        return Ok(());
    }

    let app_handle = app.clone();
    let path_clone = path.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: DebounceEventResult| {
            if result.is_ok() {
                let _ = app_handle.emit("repo-changed", path_clone.clone());
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let window = app.get_webview_window("main").unwrap();
                apply_vibrancy(&window, NSVisualEffectMaterial::HudWindow, None, None)
                    .expect("Unsupported platform! 'apply_vibrancy' is only supported on macOS");
            }
            Ok(())
        })
        .manage(WatcherState(Mutex::new(HashMap::new())))
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
            git_ops::git_reset_hard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
