use std::path::PathBuf;

pub fn resolve_sidecar(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Ok(cur) = std::env::current_exe() {
        if let Some(dir) = cur.parent() {
            let direct = dir.join(&exe);
            if direct.is_file() {
                return Some(direct);
            }
        }
    }
    let bindir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Ok(entries) = std::fs::read_dir(&bindir) {
        for entry in entries.flatten() {
            let fname = entry.file_name();
            let fname = fname.to_string_lossy();
            if fname.starts_with(name) && entry.path().is_file() {
                return Some(entry.path());
            }
        }
    }
    None
}
