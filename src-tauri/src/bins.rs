use std::path::PathBuf;

pub fn resolve_sidecar(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("union-manifold-{name}.exe")
    } else {
        format!("union-manifold-{name}")
    };
    if let Ok(cur) = std::env::current_exe() {
        if let Some(dir) = cur.parent() {
            let candidate = dir.join(&exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(windows) { ';' } else { ':' };
        for dir in path.split(sep) {
            let candidate = PathBuf::from(dir).join(&exe);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    let prefix = format!("union-manifold-{name}-");
    let bindir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    if let Ok(entries) = std::fs::read_dir(&bindir) {
        for entry in entries.flatten() {
            let fname = entry.file_name();
            if fname.to_string_lossy().starts_with(&prefix) && entry.path().is_file() {
                return Some(entry.path());
            }
        }
    }
    None
}
