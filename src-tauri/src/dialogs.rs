use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

async fn pick_folder(app: AppHandle) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |path| {
        tx.send(path.map(|p| p.to_string())).ok();
    });
    rx.await.ok().flatten()
}

async fn pick_file(app: AppHandle, exts: &[&str]) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if !exts.is_empty() {
        builder = builder.add_filter("files", exts);
    }
    builder.pick_file(move |path| {
        tx.send(path.map(|p| p.to_string())).ok();
    });
    rx.await.ok().flatten()
}

async fn pick_files(app: AppHandle, exts: &[&str]) -> Vec<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if !exts.is_empty() {
        builder = builder.add_filter("files", exts);
    }
    builder.pick_files(move |paths| {
        tx.send(paths.map(|list| list.into_iter().map(|p| p.to_string()).collect::<Vec<_>>())).ok();
    });
    rx.await.ok().flatten().unwrap_or_default()
}

#[tauri::command]
pub async fn pick_external_game_folder(app: AppHandle) -> Value {
    match pick_folder(app).await {
        Some(p) => json!(p),
        None => Value::Null,
    }
}

#[tauri::command]
pub async fn download_path_pick(app: AppHandle) -> Value {
    match pick_folder(app).await {
        Some(p) => json!({ "ok": true, "path": p }),
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub async fn pick_image(app: AppHandle) -> Value {
    match pick_file(app, &["png", "jpg", "jpeg", "webp", "gif", "bmp"]).await {
        Some(p) => json!(p),
        None => Value::Null,
    }
}

#[tauri::command]
pub async fn browse_for_game_exe(app: AppHandle, _default_path: Option<String>) -> Value {
    let exts: &[&str] = if cfg!(windows) { &["exe"] } else { &["exe", "sh", "x86_64", "bin"] };
    match pick_file(app, exts).await {
        Some(p) => json!({ "ok": true, "path": p }),
        None => json!({ "ok": false }),
    }
}

#[tauri::command]
pub async fn pick_archive_files(app: AppHandle) -> Value {
    let files = pick_files(app, &["zip", "rar", "7z", "001", "part1", "tar", "gz"]).await;
    if files.is_empty() {
        return json!({ "ok": false, "cancelled": true });
    }
    let entries: Vec<Value> = files
        .iter()
        .map(|p| {
            let path = std::path::Path::new(p);
            json!({
                "path": p,
                "name": path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
                "size": std::fs::metadata(path).map(|m| m.len()).unwrap_or(0),
            })
        })
        .collect();
    json!({ "ok": true, "files": entries })
}

#[tauri::command]
pub async fn linux_pick_binary(app: AppHandle) -> Value {
    match pick_file(app, &[]).await {
        Some(p) => json!({ "ok": true, "path": p }),
        None => json!({ "ok": true, "cancelled": true }),
    }
}

#[tauri::command]
pub async fn linux_pick_prefix_dir(app: AppHandle) -> Value {
    match pick_folder(app).await {
        Some(p) => json!({ "ok": true, "path": p }),
        None => json!({ "ok": true, "cancelled": true }),
    }
}
