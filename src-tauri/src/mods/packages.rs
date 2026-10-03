//! Package rules based on files and binary formats, independent of mod IDs.
use super::*;
use object::Object;

pub(super) const ASI_PROXIES: &[&str] = &[
    "winmm.dll",
    "dinput8.dll",
    "version.dll",
    "dsound.dll",
    "winhttp.dll",
    "dwmapi.dll",
    "xinput1_3.dll",
    "wininet.dll",
];

pub(super) fn archive_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            ["paz", "pamt", "papgt"]
                .iter()
                .any(|v| ext.eq_ignore_ascii_case(v))
        })
        .unwrap_or(false)
}

pub(super) fn contains_patch_json(root: &Path) -> bool {
    walkdir::WalkDir::new(root)
        .max_depth(4)
        .into_iter()
        .flatten()
        .any(|entry| {
            let path = entry.path();
            if !entry.file_type().is_file()
                || path
                    .extension()
                    .map_or(true, |ext| !ext.eq_ignore_ascii_case("json"))
            {
                return false;
            }
            let Ok(file) = std::fs::File::open(path) else {
                return false;
            };
            let Ok(value) = serde_json::from_reader::<_, Value>(std::io::BufReader::new(file))
            else {
                return false;
            };
            value.get("patches").is_some()
                || value.get("format_version").is_some()
                || value.get("formatVersion").is_some()
        })
}

pub(super) fn binary_prefix(target: &Path) -> Option<String> {
    if let Some(bin) = child_dir(target, "bin64") {
        if has_extension(&bin, &["exe"], 1) {
            return Some(join_rel(bin.strip_prefix(target).ok()?));
        }
    }
    if let Some(prefix) = unreal_binaries_prefix(target) {
        return Some(prefix);
    }
    has_extension(target, &["exe"], 1).then(String::new)
}

pub(super) fn is_asi_loader(path: &Path) -> bool {
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let data = object::read::ReadCache::new(file);
    let Ok(pe) = object::File::parse(&data) else {
        return false;
    };
    pe.exports().ok().is_some_and(|exports| {
        exports
            .iter()
            .any(|export| export.name() == b"IsUltimateASILoader")
    })
}

pub(super) fn has_asi_loader(binary_dir: &Path) -> bool {
    std::fs::read_dir(binary_dir)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            ASI_PROXIES.iter().any(|name| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(name)
            }) && is_asi_loader(&entry.path())
        })
}

fn has_named_asi_loader(path: &Path) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    let Some(name) = path.file_name() else {
        return false;
    };
    std::fs::read_dir(parent)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .any(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case(&name.to_string_lossy())
                && is_asi_loader(&entry.path())
        })
}

pub(super) fn asi_plan(target: &Path, root: &Path) -> Option<DeploymentPlan> {
    let plugin = has_extension(root, &["asi"], 4);
    let prefix = binary_prefix(target)?;
    let wrapped = !prefix.is_empty() && root.join(&prefix).is_dir();
    let payload = if wrapped {
        root.join(&prefix)
    } else {
        root.to_path_buf()
    };
    let bundled_loader = has_asi_loader(&payload);
    if !plugin && !bundled_loader {
        return None;
    }
    let ready = bundled_loader || has_asi_loader(&target.join(&prefix));
    Some(deployment_plan(
        if plugin {
            ModLayout::Asi
        } else {
            ModLayout::Raw
        },
        if wrapped { "" } else { &prefix },
        if ready {
            "ASI files belong beside the game executable; an ASI loader is present"
        } else {
            "an ASI plugin requires a loader beside the game executable; install the ASI loader before enabling it"
        },
        if ready { "high" } else { "low" },
    ))
}

pub(super) fn tool_executables(root: &Path, target: &Path) -> Vec<String> {
    let mut result: Vec<_> = walkdir::WalkDir::new(root)
        .max_depth(3)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            entry
                .path()
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"))
        })
        .filter_map(|entry| {
            let rel = entry.path().strip_prefix(root).ok()?;
            // Executable replacements remain regular file mods.
            if target.join(rel).exists() {
                return None;
            }
            Some(join_rel(rel))
        })
        .collect();
    result.sort();
    result
}

pub(super) fn refresh_asi_dependencies(game_dir: &Path, target: &Path, cfg: &mut GameMods) -> bool {
    let Some(prefix) = binary_prefix(target) else {
        return false;
    };
    let journal = load_journal(game_dir);
    let staging = staging_root(game_dir);
    let ready = ASI_PROXIES.iter().any(|proxy| {
        let rel = Path::new(&prefix).join(proxy);
        cfg.mods.iter().any(|m| {
            m.enabled
                && (m.deploy_action.is_empty() || m.deploy_action == "asi-loader")
                && rel
                    .strip_prefix(&m.deploy_prefix)
                    .ok()
                    .is_some_and(|source| has_named_asi_loader(&staging.join(&m.id).join(source)))
        }) || (!journal
            .files
            .keys()
            .any(|key| key.eq_ignore_ascii_case(&join_rel(&rel)))
            && has_named_asi_loader(&target.join(&rel)))
    });
    let mut changed = false;
    for entry in &mut cfg.mods {
        if !has_extension(&staging.join(&entry.id), &["asi"], 4)
            || (!entry.deploy_action.is_empty() && entry.deploy_action != "asi-loader")
        {
            continue;
        }
        let action = if ready { "" } else { "asi-loader" };
        if entry.deploy_action != action || entry.deploy_blocked == ready {
            entry.deploy_action = action.into();
            entry.deploy_blocked = !ready;
            entry.deploy_confidence = if ready { "high" } else { "low" }.into();
            entry.deploy_reason = if ready {
                "ASI loader is available beside the game executable"
            } else {
                "install or enable an ASI loader beside the game executable"
            }
            .into();
            changed = true;
        }
    }
    changed
}

fn selected_game_exe(state: &AppState, appid: &str) -> Result<PathBuf, String> {
    let exe = state
        .settings
        .get_string(&format!("gameExe:{appid}"))
        .ok_or("choose the game's executable before installing a loader or running a tool")?;
    let exe = PathBuf::from(exe)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let root = library::game_files_dir(&library::scan_roots(state), appid)
        .ok_or("game folder not found")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !exe.starts_with(root) || !exe.is_file() {
        return Err("game executable is outside its install folder".into());
    }
    Ok(exe)
}

fn loader_choice(
    exe: &Path,
    requested: Option<&str>,
) -> Result<(&'static str, &'static str), String> {
    let data = object::read::ReadCache::new(std::fs::File::open(exe).map_err(|e| e.to_string())?);
    let pe = object::File::parse(&data).map_err(|e| e.to_string())?;
    if pe.format() != object::BinaryFormat::Pe {
        return Err("ASI loaders require a Windows executable".into());
    }
    let arch = match pe.architecture() {
        object::Architecture::X86_64 => "x64",
        object::Architecture::I386 => "x86",
        _ => {
            return Err("this executable's architecture is not supported by the ASI loader".into())
        }
    };
    let parent = exe
        .parent()
        .ok_or("game executable has no parent directory")?;
    if let Some(requested) = requested {
        let proxy = ASI_PROXIES
            .iter()
            .copied()
            .find(|name| name.eq_ignore_ascii_case(requested))
            .ok_or("unsupported ASI proxy DLL")?;
        if has_root_file(parent, proxy) {
            return Err(format!(
                "{proxy} already exists; its contents will not be overwritten"
            ));
        }
        return Ok((arch, proxy));
    }
    let imports = pe.imports().map_err(|_| "this executable's imports cannot be read; select a proxy DLL using the loader's instructions")?;
    let proxy = ASI_PROXIES.iter().copied().find(|name| {
        imports.iter().any(|import| import.library().eq_ignore_ascii_case(name.as_bytes()))
            && !has_root_file(parent, name)
    }).ok_or("no unused supported proxy DLL is imported by this executable; follow the loader's manual installation instructions")?;
    Ok((arch, proxy))
}

#[tauri::command]
pub async fn mods_asi_loader_install(
    app: AppHandle,
    appid: String,
    proxy: Option<String>,
) -> Result<Value, String> {
    // Network and extraction happen outside the per-game blocking lock. The
    // selected executable and destination are rechecked under it before deploy.
    let state = app.state::<AppState>();
    let exe = selected_game_exe(&state, &appid)?;
    let configured_proxy = state
        .settings
        .get_string("linuxDllOverrides")
        .and_then(|overrides| {
            overrides.split(';').find_map(|entry| {
                let (names, modes) = entry.split_once('=')?;
                if !modes.split(',').any(|mode| mode.trim() == "n") {
                    return None;
                }
                ASI_PROXIES
                    .iter()
                    .find(|proxy| {
                        names.split(',').any(|name| {
                            name.trim()
                                .eq_ignore_ascii_case(proxy.trim_end_matches(".dll"))
                        })
                    })
                    .map(|name| name.to_string())
            })
        });
    let requested = proxy.as_deref().filter(|s| !s.is_empty());
    let (arch, proxy) = loader_choice(&exe, requested).or_else(|error| {
        if requested.is_none() && cfg!(target_os = "linux") && configured_proxy.is_some() {
            loader_choice(&exe, configured_proxy.as_deref())
        } else {
            Err(error)
        }
    })?;
    let (asset, sha256) = if arch == "x64" {
        (
            "Ultimate-ASI-Loader-NoPDB_x64.zip",
            "e5860e7d9a1805267535b65749575b5e406cc6ea3325c7392189c578815045d1",
        )
    } else {
        (
            "Ultimate-ASI-Loader-NoPDB.zip",
            "14b3a1ad018899571ac9aa01482977f3c6d49e6cba99f552d01c5acacd1315e1",
        )
    };
    let temp = tempfile::tempdir().map_err(|e| e.to_string())?;
    let archive = temp.path().join(asset);
    let url = format!(
        "https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/download/v9.7.4/{asset}"
    );
    download_to_file(&url, &archive, HashMap::new(), |_| {}).await?;
    use sha2::Digest;
    let bytes = std::fs::read(&archive).map_err(|e| e.to_string())?;
    if hex::encode(sha2::Sha256::digest(&bytes)) != sha256 {
        return Err("ASI loader download failed integrity verification".into());
    }
    let extracted = temp.path().join("loader");
    crate::install::run_7z(&archive, &extracted, |_| {})
        .await
        .map_err(|e| e.to_string())?;
    let dll = extracted.join("dinput8.dll");
    if !is_asi_loader(&dll) {
        return Err("download did not contain an ASI loader".into());
    }
    blocking_game(app, appid, move |app, state, appid| {
        let result = (|| {
            let current_exe = selected_game_exe(state, appid)?;
            if current_exe != exe || loader_choice(&current_exe, Some(proxy))? != (arch, proxy) {
                return Err(
                    "game executable or loader destination changed; retry installation".to_string(),
                );
            }
            let mut cfg = load_config(&state.paths, appid);
            if cfg.mods.iter().any(|entry| entry.id == "loader-ultimate-asi") {
                return Err("an ASI loader is already managed for this game; enable it or uninstall it before choosing another proxy".into());
            }
            let target = deploy_target_dir(state, appid, &cfg)?
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let prefix = current_exe
                .parent()
                .ok_or("game executable has no parent directory")?
                .strip_prefix(&target)
                .map_err(|_| "the manual mod target does not contain the game executable")?;
            let dir = game_mods_dir(&state.paths, appid);
            let staged = dir.join("staging/loader-ultimate-asi");
            if staged.exists() {
                std::fs::remove_dir_all(&staged).map_err(|e| e.to_string())?;
            }
            let relative = prefix.join(proxy);
            std::fs::create_dir_all(staged.join(prefix)).map_err(|e| e.to_string())?;
            std::fs::copy(&dll, staged.join(&relative)).map_err(|e| e.to_string())?;
            cfg.mods.push(ModEntry {
                id: "loader-ultimate-asi".into(),
                provider: "loader".into(),
                name: "Ultimate ASI Loader".into(),
                version: "9.7.4".into(),
                author: "ThirteenAG".into(),
                enabled: true,
                order: cfg.mods.len() as u32,
                installed_at: now_secs(),
                size_bytes: crate::install::dir_size(&staged),
                page_url: "https://github.com/ThirteenAG/Ultimate-ASI-Loader".into(),
                deploy_confidence: "high".into(),
                deploy_reason: format!("{proxy} loader for the selected {arch} executable"),
                ..Default::default()
            });
            // Include the staged loader when resolving dependencies, then
            // deploy the loader and plugins in the same transaction.
            refresh_deployment_plans(state, appid, &mut cfg);
            redeploy(state, appid, &cfg)?;
            save_config(&state.paths, appid, &cfg);
            emit_changed(app, appid);
            Ok(json!({"ok": true}))
        })();
        // Keep the downloaded file alive until the blocking deployment finishes.
        drop(temp);
        fold(result)
    })
    .await
}

#[tauri::command]
pub async fn mods_tool_launch(
    app: AppHandle,
    appid: String,
    mod_id: String,
    executable: String,
) -> Result<Value, String> {
    blocking_game(app, appid, move |app, state, appid| {
        fold((|| {
            let cfg = load_config(&state.paths, appid);
            let entry = cfg
                .mods
                .iter()
                .find(|entry| entry.id == mod_id)
                .ok_or("package not found")?;
            if entry.deploy_action != "tool" || !entry.tool_executables.contains(&executable) {
                return Err("select an executable from this tool package".into());
            }
            let staged = staging_root(&game_mods_dir(&state.paths, appid))
                .join(&entry.id)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            let tool = staged
                .join(&executable)
                .canonicalize()
                .map_err(|e| e.to_string())?;
            if !tool.starts_with(&staged) || !tool.is_file() {
                return Err("tool path is outside its package".into());
            }
            #[cfg(windows)]
            let mut command = std::process::Command::new(&tool);
            #[cfg(target_os = "linux")]
            let mut command = {
                let exe = selected_game_exe(state, appid)?;
                let mut plan = crate::launch::linux::resolve_auxiliary(
                    state,
                    appid,
                    &exe.to_string_lossy(),
                    &tool.to_string_lossy(),
                    &[],
                )?;
                // Tools can run before the game starts and need their own umu
                // container while sharing the configured Wine prefix.
                plan.envs.retain(|(key, _)| key != "UMU_CONTAINER_NSENTER");
                let mut command = std::process::Command::new(plan.command);
                command.args(plan.args).envs(plan.envs);
                command
            };
            #[cfg(not(any(windows, target_os = "linux")))]
            {
                let _ = app;
                Err("Windows mod tools require Windows or Linux with Wine/Proton".into())
            }
            #[cfg(any(windows, target_os = "linux"))]
            {
                let mut child = command
                    .current_dir(tool.parent().unwrap_or(&staged))
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .map_err(|e| format!("launch tool: {e}"))?;
                let app = app.clone();
                let appid = appid.to_string();
                std::thread::spawn(move || {
                    let _ = child.wait();
                    emit_changed(&app, &appid);
                });
                Ok(json!({"ok": true}))
            }
        })())
    })
    .await
}

#[tauri::command(async)]
pub fn mods_package_open(
    state: State<'_, AppState>,
    appid: String,
    mod_id: Option<String>,
) -> Value {
    fold((|| {
        let cfg = load_config(&state.paths, &appid);
        let path = if let Some(id) = mod_id {
            let entry = cfg
                .mods
                .iter()
                .find(|entry| entry.id == id)
                .ok_or("package not found")?;
            staging_root(&game_mods_dir(&state.paths, &appid)).join(&entry.id)
        } else {
            deploy_target_dir(&state, &appid, &cfg)?
        };
        crate::system::open_path_os(&path).map_err(|e| e.to_string())?;
        Ok(json!({"ok": true}))
    })())
}

#[cfg(test)]
pub(super) fn pe_fixture(loader: bool, x64: bool) -> Vec<u8> {
    // Minimal PE fixture: one .rdata section, a WINMM import and optionally
    // the loader's documented identifying export. No executable code.
    let mut bytes = vec![0u8; 1024];
    bytes[..2].copy_from_slice(b"MZ");
    bytes[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
    bytes[0x80..0x84].copy_from_slice(b"PE\0\0");
    let optional_size = if x64 { 240u16 } else { 224 };
    bytes[0x84..0x86].copy_from_slice(&(if x64 { 0x8664u16 } else { 0x14c }).to_le_bytes());
    bytes[0x86..0x88].copy_from_slice(&1u16.to_le_bytes());
    bytes[0x94..0x96].copy_from_slice(&optional_size.to_le_bytes());
    bytes[0x96..0x98].copy_from_slice(&0x2022u16.to_le_bytes());
    bytes[0x98..0x9a].copy_from_slice(&(if x64 { 0x20bu16 } else { 0x10b }).to_le_bytes());
    let dirs = 0x98 + if x64 { 112 } else { 96 };
    let section = 0x98 + optional_size as usize;
    bytes[section..section + 6].copy_from_slice(b".rdata");
    for (offset, value) in [
        (0x98 + 32, 0x1000u32),
        (0x98 + 36, 0x200),
        (0x98 + 56, 0x2000),
        (0x98 + 60, 0x200),
        (dirs - 4, 16),
        (section + 8, 0x200),
        (section + 12, 0x1000),
        (section + 16, 0x200),
        (section + 20, 0x200),
        (dirs + 8, 0x1100),
        (dirs + 12, 40),
        (0x300, 0x1140),
        (0x30c, 0x1160),
        (0x310, 0x1140),
        (0x340, 0x1180),
    ] {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }
    bytes[0x360..0x36a].copy_from_slice(b"WINMM.dll\0");
    bytes[0x382..0x390].copy_from_slice(b"timeGetTime\0\0\0");
    if loader {
        for (offset, value) in [
            (dirs, 0x1000u32),
            (dirs + 4, 0x100),
            (0x214, 1),
            (0x218, 1),
            (0x21c, 0x1070),
            (0x220, 0x1080),
            (0x224, 0x1090),
            (0x270, 0x1200),
            (0x280, 0x10a0),
        ] {
            bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        let name = b"IsUltimateASILoader\0";
        bytes[0x2a0..0x2a0 + name.len()].copy_from_slice(name);
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_install_uses_imports_and_architecture_and_never_overwrites_a_proxy() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("AnyGame.exe");
        for (x64, arch) in [(true, "x64"), (false, "x86")] {
            std::fs::write(&exe, pe_fixture(false, x64)).unwrap();
            assert_eq!(loader_choice(&exe, None).unwrap(), (arch, "winmm.dll"));
        }
        std::fs::write(tmp.path().join("WINMM.DLL"), "another proxy").unwrap();
        assert!(loader_choice(&exe, None).is_err());
        assert!(loader_choice(&exe, Some("winmm.dll")).is_err());
        assert!(!has_asi_loader(tmp.path()));
        std::fs::write(tmp.path().join("WINMM.DLL"), pe_fixture(true, false)).unwrap();
        assert!(has_asi_loader(tmp.path()));
    }
}
