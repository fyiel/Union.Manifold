//! Dev-only measurement commands. Inert unless UM_PERF=1 is set on launch.

#[tauri::command]
pub fn perf_enabled() -> bool {
    std::env::var("UM_PERF").map(|v| v == "1").unwrap_or(false)
}

#[tauri::command]
pub fn perf_dump(payload: String) {
    use std::io::Write;
    let path = std::env::temp_dir().join(format!("um-perf-{}.jsonl", std::process::id()));
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(f, "{payload}");
    }
}