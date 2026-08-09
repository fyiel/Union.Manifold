use std::path::PathBuf;

use std::sync::LazyLock;
use parking_lot::Mutex;
use regex::Regex;
use serde_json::Value;

static LOG_PATH: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));
static REDACT: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        (
            Regex::new(
                r#"(?i)(token|secret|password|cookie|authorization)"?\s*[:=]\s*"?[^\s",}]+"#,
            )
            .unwrap(),
            "$1=[redacted]",
        ),
        (Regex::new(r"/home/[^/\s]+").unwrap(), "/home/[user]"),
        (
            Regex::new(r"C:\\Users\\[^\\\s]+").unwrap(),
            r"C:\Users\[user]",
        ),
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
    let path = match LOG_PATH.lock().clone() {
        Some(p) => p,
        None => return,
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
    let line = format!("[{stamp}] [{}] {}\n", level.to_uppercase(), redact(message));
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        f.write_all(line.as_bytes()).ok();
    }
}

#[tauri::command(async)]
pub fn log(level: String, message: String, data: Option<Value>) {
    let extra = data.map(|d| format!(" {d}")).unwrap_or_default();
    write_line(&level, &format!("{message}{extra}"));
}
