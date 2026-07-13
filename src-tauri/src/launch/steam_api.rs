use std::path::{Path, PathBuf};

use futures::StreamExt;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const REQUIRED_EXPORT: &[u8] = b"SteamInternal_SteamAPI_Init";
const BROKEN_GBE_SHA256: &str = "0cfe547ea82071953cf99daffa3bd11bb468eec0e400961e7e33e4dc36674ea8";
const GBE_RELEASE: &str = "release-2026_05_30";
const GBE_ARCHIVE_URL: &str =
    "https://github.com/Detanup01/gbe_fork/releases/download/release-2026_05_30/emu-win-release.7z";
const GBE_ARCHIVE_SHA256: &str = "38d0ce822f78f5b22dd28d948f4b1c98bc65f5fc3a850b7775286743a60e3516";
const GBE_DLL_SHA256: &str = "cc5a2c9cb93fdbde7dadb825138ab7f694e3f8c310cdd675f733eaa784cbcc3e";
const GBE_DLL_MEMBER: &str = "release/regular/x64/steam_api64.dll";
const READ_CHUNK: usize = 64 * 1024;

static REPAIR_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct FileInspection {
    sha256: String,
    contains_required_export: bool,
}

fn prefix_table(needle: &[u8]) -> Vec<usize> {
    let mut table = vec![0; needle.len()];
    let mut matched = 0;
    for index in 1..needle.len() {
        while matched > 0 && needle[index] != needle[matched] {
            matched = table[matched - 1];
        }
        if needle[index] == needle[matched] {
            matched += 1;
            table[index] = matched;
        }
    }
    table
}

fn scan_chunk(chunk: &[u8], needle: &[u8], table: &[usize], matched: &mut usize) -> bool {
    for byte in chunk {
        while *matched > 0 && *byte != needle[*matched] {
            *matched = table[*matched - 1];
        }
        if *byte == needle[*matched] {
            *matched += 1;
            if *matched == needle.len() {
                return true;
            }
        }
    }
    false
}

async fn file_contains(path: &Path, needle: &[u8]) -> Result<bool, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("read {}: {error}", path.display()))?;
    let table = prefix_table(needle);
    let mut matched = 0;
    let mut buffer = vec![0; READ_CHUNK];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("read {}: {error}", path.display()))?;
        if read == 0 {
            return Ok(false);
        }
        if scan_chunk(&buffer[..read], needle, &table, &mut matched) {
            return Ok(true);
        }
    }
}

async fn inspect_file(path: &Path) -> Result<FileInspection, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("read {}: {error}", path.display()))?;
    let table = prefix_table(REQUIRED_EXPORT);
    let mut matched = 0;
    let mut found = false;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; READ_CHUNK];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        hasher.update(chunk);
        if !found && scan_chunk(chunk, REQUIRED_EXPORT, &table, &mut matched) {
            found = true;
        }
    }
    Ok(FileInspection {
        sha256: hex::encode(hasher.finalize()),
        contains_required_export: found,
    })
}

async fn download_verified_archive(path: &Path) -> Result<(), String> {
    let temp = path.with_extension("7z.download");
    let response = crate::http::fetch(GBE_ARCHIVE_URL, &crate::http::FetchOpts::default())
        .await
        .map_err(|error| format!("download GBE repair: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("download GBE repair: HTTP {}", response.status()));
    }

    let mut output = tokio::fs::File::create(&temp)
        .await
        .map_err(|error| format!("create repair archive: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("download GBE repair: {error}"))?;
        hasher.update(&chunk);
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("write repair archive: {error}"))?;
    }
    output
        .flush()
        .await
        .map_err(|error| format!("write repair archive: {error}"))?;
    drop(output);

    let digest = hex::encode(hasher.finalize());
    if digest != GBE_ARCHIVE_SHA256 {
        tokio::fs::remove_file(&temp).await.ok();
        return Err(format!(
            "GBE repair checksum mismatch: expected {GBE_ARCHIVE_SHA256}, got {digest}"
        ));
    }
    if path.is_file() {
        tokio::fs::remove_file(path)
            .await
            .map_err(|error| format!("replace cached repair archive: {error}"))?;
    }
    tokio::fs::rename(&temp, path)
        .await
        .map_err(|error| format!("cache repair archive: {error}"))?;
    Ok(())
}

async fn ensure_replacement(cache_root: &Path) -> Result<PathBuf, String> {
    let cache = cache_root.join("steam-api").join(GBE_RELEASE);
    let cached_dll = cache.join("steam_api64.dll");
    if cached_dll.is_file() {
        let inspection = inspect_file(&cached_dll).await?;
        if inspection.sha256 == GBE_DLL_SHA256 && inspection.contains_required_export {
            return Ok(cached_dll);
        }
        tokio::fs::remove_file(&cached_dll).await.ok();
    }

    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|error| format!("create Steam API repair cache: {error}"))?;
    let archive = cache.join("gbe-fork.7z");
    let archive_ok = if archive.is_file() {
        inspect_file(&archive).await?.sha256 == GBE_ARCHIVE_SHA256
    } else {
        false
    };
    if !archive_ok {
        if archive.is_file() {
            tokio::fs::remove_file(&archive).await.ok();
        }
        download_verified_archive(&archive).await?;
    }

    let extracted = cache.join("extracting");
    if extracted.is_dir() {
        tokio::fs::remove_dir_all(&extracted).await.ok();
    }
    crate::install::run_7z(&archive, &extracted, |_| {})
        .await
        .map_err(|error| format!("extract GBE repair: {error}"))?;
    let source = extracted.join(GBE_DLL_MEMBER);
    let inspection = inspect_file(&source).await?;
    if inspection.sha256 != GBE_DLL_SHA256 || !inspection.contains_required_export {
        tokio::fs::remove_dir_all(&extracted).await.ok();
        return Err(
            "extracted GBE repair did not contain the verified Steam API library".to_string(),
        );
    }

    let staged = cache.join("steam_api64.dll.new");
    tokio::fs::copy(&source, &staged)
        .await
        .map_err(|error| format!("stage Steam API repair: {error}"))?;
    if cached_dll.is_file() {
        tokio::fs::remove_file(&cached_dll).await.ok();
    }
    tokio::fs::rename(&staged, &cached_dll)
        .await
        .map_err(|error| format!("cache Steam API repair: {error}"))?;
    tokio::fs::remove_dir_all(&extracted).await.ok();
    tokio::fs::remove_file(&archive).await.ok();
    Ok(cached_dll)
}

fn sibling_path(path: &Path, name: &str) -> Result<PathBuf, String> {
    path.parent()
        .map(|parent| parent.join(name))
        .ok_or_else(|| format!("{} has no parent directory", path.display()))
}

async fn install_replacement(
    current: &Path,
    replacement: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let backup = sibling_path(current, "steam_api64.dll.manifold-backup")?;
    let staged = sibling_path(current, "steam_api64.dll.manifold-new")?;
    tokio::fs::copy(replacement, &staged)
        .await
        .map_err(|error| format!("stage compatible steam_api64.dll: {error}"))?;
    if inspect_file(&staged).await?.sha256 != expected_sha256 {
        tokio::fs::remove_file(&staged).await.ok();
        return Err("staged steam_api64.dll failed checksum verification".to_string());
    }
    if !backup.is_file() {
        tokio::fs::copy(current, &backup)
            .await
            .map_err(|error| format!("back up incompatible steam_api64.dll: {error}"))?;
    }
    tokio::fs::remove_file(current)
        .await
        .map_err(|error| format!("replace incompatible steam_api64.dll: {error}"))?;
    if let Err(error) = tokio::fs::rename(&staged, current).await {
        tokio::fs::copy(&backup, current).await.ok();
        tokio::fs::remove_file(&staged).await.ok();
        return Err(format!("install compatible steam_api64.dll: {error}"));
    }
    Ok(())
}

pub async fn repair_if_needed(cache_root: &Path, executable: &Path) -> Result<bool, String> {
    if !executable
        .extension()
        .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
        .unwrap_or(false)
    {
        return Ok(false);
    }
    if !file_contains(executable, REQUIRED_EXPORT).await? {
        return Ok(false);
    }
    let steam_api = sibling_path(executable, "steam_api64.dll")?;
    if !steam_api.is_file() {
        return Ok(false);
    }

    let inspection = inspect_file(&steam_api).await?;
    if inspection.contains_required_export {
        return Ok(false);
    }
    if inspection.sha256 != BROKEN_GBE_SHA256 {
        return Err(format!(
            "{} imports SteamInternal_SteamAPI_Init, but its steam_api64.dll does not export it. Install an updated game build with a matching Steam API library.",
            executable.file_name().unwrap_or_default().to_string_lossy()
        ));
    }

    let _guard = REPAIR_LOCK.lock().await;
    let inspection = inspect_file(&steam_api).await?;
    if inspection.contains_required_export {
        return Ok(false);
    }
    if inspection.sha256 != BROKEN_GBE_SHA256 {
        return Err(
            "steam_api64.dll changed while its compatibility repair was starting".to_string(),
        );
    }

    let replacement = ensure_replacement(cache_root).await.map_err(|error| {
        format!(
            "This game includes an incompatible steam_api64.dll (missing SteamInternal_SteamAPI_Init). Automatic repair failed: {error}"
        )
    })?;
    install_replacement(&steam_api, &replacement, GBE_DLL_SHA256).await?;
    crate::logging::write_line(
        "info",
        &format!(
            "replaced incompatible Steam API library beside {}",
            executable.display()
        ),
    );
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn scanner_finds_export_across_read_chunks() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("steam_api64.dll");
        let mut bytes = vec![b'x'; READ_CHUNK - 3];
        bytes.extend_from_slice(REQUIRED_EXPORT);
        tokio::fs::write(&path, &bytes).await.unwrap();

        let inspection = inspect_file(&path).await.unwrap();
        assert!(inspection.contains_required_export);
        assert_eq!(inspection.sha256, hex::encode(Sha256::digest(&bytes)));
    }

    #[tokio::test]
    async fn replacement_is_verified_and_preserves_original_backup() {
        let temp = tempfile::tempdir().unwrap();
        let current = temp.path().join("steam_api64.dll");
        let replacement = temp.path().join("replacement.dll");
        tokio::fs::write(&current, b"old library").await.unwrap();
        tokio::fs::write(&replacement, b"new library")
            .await
            .unwrap();
        let expected = hex::encode(Sha256::digest(b"new library"));

        install_replacement(&current, &replacement, &expected)
            .await
            .unwrap();

        assert_eq!(tokio::fs::read(&current).await.unwrap(), b"new library");
        assert_eq!(
            tokio::fs::read(temp.path().join("steam_api64.dll.manifold-backup"))
                .await
                .unwrap(),
            b"old library"
        );
    }
}
