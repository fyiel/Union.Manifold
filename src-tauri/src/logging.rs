use std::path::PathBuf;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::Value;

static LOG_PATH: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));
static REDACT: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (Regex::new(r#"(?i)(token|secret|password|cookie|authorization)"?\s*[:=]\s*"?[^\s",}]+"#).unwrap(), "$1=[redacted]"),
        (Regex::new(r"/home/[^/\s]+").unwrap(), "/home/[user]"),
        (Regex::new(r"C:\\Users\\[^\\\s]+").unwrap(), r"C:\Users\[user]"),
    ]
});

pub fn init(path: PathBuf) {
    let prev = path.with_extension("prev.txt");
    std::fs::rename(&path, &prev).ok();
    *LOG_PATH.lock() = Some(path);
}

fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for (re, rep) in REDACT.iter() {
        out = re.replace_all(&out, *rep).to_string();
    }
    out
}

pub fn write_line(level: &str, message: &str) {
    // Clone the path out and do the stamping/redaction/IO outside the lock:
    // nothing that can panic (REDACT's lazy regex init, formatting, file IO)
    // runs while LOG_PATH is held, so the panic hook — which calls back into
    // write_line — can never re-enter a lock its own thread already holds and
    // hang the abort. O_APPEND keeps concurrent one-shot line writes whole.
    let path = match LOG_PATH.lock().clone() {
        Some(p) => p,
        None => return,
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{stamp}] [{}] {}\n", level.to_uppercase(), redact(message));
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        f.write_all(line.as_bytes()).ok();
    }
}

#[tauri::command(async)]
pub fn log(level: String, message: String, data: Option<Value>) {
    let extra = data.map(|d| format!(" {d}")).unwrap_or_default();
    write_line(&level, &format!("{message}{extra}"));
}

