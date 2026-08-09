use std::path::PathBuf;

/// Resolve a bundled resource file: `{resource_dir}/{name}` first, then
/// `{resource_dir}/resources/{name}` (the packaging layout varies).
pub(crate) fn resolve_resource_file(resource_dir: &std::path::Path, name: &str) -> Option<PathBuf> {
    [resource_dir.join(name), resource_dir.join("resources").join(name)]
        .into_iter()
        .find(|path| path.is_file())
}

pub(crate) fn find_on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var("PATH").ok()?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    for dir in path.split(sep) {
        let p = std::path::Path::new(dir).join(&file);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

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
    if let Some(p) = find_on_path(&exe) {
        return Some(p);
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
