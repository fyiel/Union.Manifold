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
            let libdir = dir.join("../lib/Union.Manifold").join(&exe);
            if libdir.is_file() {
                return Some(libdir);
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
