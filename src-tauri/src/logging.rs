use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};
use tauri::State;

use crate::error::Result;
use crate::state::AppState;

static LOG_PATH: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));
static REDACT: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (Regex::new(r#"(?i)(token|secret|password|cookie|authorization)"?\s*[:=]\s*"?[^\s",}]+"#).unwrap(), "$1=[redacted]"),
        (Regex::new(r"/home/[^/\s]+").unwrap(), "/home/[user]"),
        (Regex::new(r"C:\\Users\\[^\\\s]+").unwrap(), r"C:\Users\[user]"),
    ]
});

pub fn init(path: PathBuf) {
    std::fs::write(&path, "").ok();
    *LOG_PATH.lock().unwrap() = Some(path);
}

fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for (re, rep) in REDACT.iter() {
        out = re.replace_all(&out, *rep).to_string();
    }
    out
}

pub fn write_line(level: &str, message: &str) {
    let guard = LOG_PATH.lock().unwrap();
    if let Some(path) = guard.as_ref() {
        let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let line = format!("[{stamp}] [{}] {}\n", level.to_uppercase(), redact(message));
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
            f.write_all(line.as_bytes()).ok();
        }
    }
}

#[tauri::command]
pub fn log(level: String, message: String, data: Option<Value>) {
    let extra = data.map(|d| format!(" {d}")).unwrap_or_default();
    write_line(&level, &format!("{message}{extra}"));
}

#[tauri::command]
pub fn logs_get() -> String {
    let guard = LOG_PATH.lock().unwrap();
    guard
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn logs_clear() {
    let guard = LOG_PATH.lock().unwrap();
    if let Some(p) = guard.as_ref() {
        std::fs::write(p, "").ok();
    }
}

#[tauri::command]
pub fn logs_open_folder(state: State<'_, AppState>) -> Result<Value> {
    let dir = state.paths.logs_dir.clone();
    crate::system::open_path_os(&dir)?;
    Ok(json!({ "ok": true }))
}
