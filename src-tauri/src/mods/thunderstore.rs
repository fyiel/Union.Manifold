use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::downloads::{safe_folder_name, write_json_atomic};
use crate::http;
use crate::paths::AppPaths;
use crate::sources::cache::Cached;
use crate::sources::schema::normalize_title;
use crate::state::AppState;

use super::{
    apply_bepinex_layout, download_to_file, emit_progress, finalize_install, fold, game_mods_dir,
    now_secs, InstallSpec,
};

const SITE: &str = "https://thunderstore.io";
const PAGE_SIZE: usize = 24;
const CACHE_TTL_SECS: i64 = 3 * 60 * 60;
const CACHE_TTL: Duration = Duration::from_secs(CACHE_TTL_SECS as u64);

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct TsVersion {
    version: String,
    downloads: u64,
    size_bytes: u64,
    uploaded_at: i64,
    dependencies: Vec<String>,
    description: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default)]
struct TsPackage {
    full_name: String,
    name: String,
    owner: String,
    package_url: String,
    updated_at: i64,
    created_at: i64,
    rating: i64,
    deprecated: bool,
    icon: String,
    latest: usize,
    versions: Vec<TsVersion>,
}

#[derive(Serialize, Deserialize)]
struct DiskCache {
    fetched_at: i64,
    packages: Vec<TsPackage>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Community {
    pub identifier: String,
    pub name: String,
}

#[derive(Deserialize)]
struct RawPkg {
    #[serde(default)]
    name: String,
    #[serde(default)]
    full_name: String,
    #[serde(default)]
    owner: String,
    #[serde(default)]
    package_url: String,
    #[serde(default)]
    date_created: String,
    #[serde(default)]
    date_updated: String,
    #[serde(default)]
    rating_score: i64,
    #[serde(default)]
    is_deprecated: bool,
    #[serde(default)]
    versions: Vec<RawVer>,
}

#[derive(Deserialize)]
struct RawVer {
    #[serde(default)]
    version_number: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    dependencies: Vec<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    date_created: String,
}

fn iso_to_unix(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|d| d.timestamp())
        .unwrap_or(0)
}

fn version_key(v: &str) -> Vec<u64> {
    v.split('.')
        .map(|p| {
            p.trim()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .unwrap_or(0)
        })
        .collect()
}

fn parse_full_name(s: &str) -> Option<(String, String)> {
    let (owner, name) = s.split_once('-')?;
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some((owner.to_string(), name.to_string()))
}

fn parse_dependency(s: &str) -> Option<(String, String, String)> {
    let (full, version) = s.rsplit_once('-')?;
    let (owner, name) = parse_full_name(full)?;
    if version.is_empty() {
        return None;
    }
    Some((owner, name, version.to_string()))
}

fn compact(raw: RawPkg) -> Option<TsPackage> {
    if raw.versions.is_empty() {
        return None;
    }
    let mut latest = 0usize;
    let mut best = version_key(&raw.versions[0].version_number);
    for (i, v) in raw.versions.iter().enumerate().skip(1) {
        let k = version_key(&v.version_number);
        if k > best {
            latest = i;
            best = k;
        }
    }
    let icon = raw.versions[latest].icon.clone();
    let versions = raw
        .versions
        .into_iter()
        .map(|v| TsVersion {
            version: v.version_number,
            downloads: v.downloads,
            size_bytes: v.file_size,
            uploaded_at: iso_to_unix(&v.date_created),
            dependencies: v.dependencies,
            description: v.description,
        })
        .collect();
    Some(TsPackage {
        full_name: raw.full_name,
        name: raw.name,
        owner: raw.owner,
        package_url: raw.package_url,
        updated_at: iso_to_unix(&raw.date_updated),
        created_at: iso_to_unix(&raw.date_created),
        rating: raw.rating_score,
        deprecated: raw.is_deprecated,
        icon,
        latest,
        versions,
    })
}

fn latest_of(p: &TsPackage) -> Option<&TsVersion> {
    p.versions.get(p.latest).or_else(|| p.versions.first())
}

static PKG_MEM: LazyLock<parking_lot::Mutex<HashMap<String, (Instant, Arc<Vec<TsPackage>>)>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));
static PKG_LOCKS: LazyLock<parking_lot::Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| parking_lot::Mutex::new(HashMap::new()));

fn mem_get(community: &str) -> Option<Arc<Vec<TsPackage>>> {
    let map = PKG_MEM.lock();
    map.get(community)
        .filter(|(at, _)| at.elapsed() < CACHE_TTL)
        .map(|(_, pkgs)| pkgs.clone())
}

fn mem_put(community: &str, pkgs: Arc<Vec<TsPackage>>) {
    PKG_MEM
        .lock()
        .insert(community.to_string(), (Instant::now(), pkgs));
}

fn pkg_lock(community: &str) -> Arc<tokio::sync::Mutex<()>> {
    PKG_LOCKS
        .lock()
        .entry(community.to_string())
        .or_default()
        .clone()
}

fn cache_file(paths: &AppPaths, community: &str) -> PathBuf {
    paths
        .data_dir
        .join("thunderstore")
        .join(format!("{}.json", safe_folder_name(community)))
}

fn load_disk(paths: &AppPaths, community: &str) -> Option<Arc<Vec<TsPackage>>> {
    let text = std::fs::read_to_string(cache_file(paths, community)).ok()?;
    let disk: DiskCache = serde_json::from_str(&text).ok()?;
    if now_secs() - disk.fetched_at >= CACHE_TTL_SECS {
        return None;
    }
    Some(Arc::new(disk.packages))
}

fn save_disk(paths: &AppPaths, community: &str, pkgs: &[TsPackage]) {
    let file = cache_file(paths, community);
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let disk = DiskCache {
        fetched_at: now_secs(),
        packages: pkgs.to_vec(),
    };
    if let Ok(v) = serde_json::to_value(&disk) {
        write_json_atomic(&file, &v).ok();
    }
}

async fn fetch_dump(community: &str) -> Result<Vec<TsPackage>, String> {
    let url = format!("{SITE}/c/{community}/api/v1/package/");
    let opts = http::FetchOpts {
        timeout: Some(Duration::from_secs(5 * 60)),
        ..Default::default()
    };
    let resp = http::fetch(&url, &opts)
        .await
        .map_err(|e| format!("thunderstore packages: {e}"))?;
    let status = resp.status();
    if status.as_u16() == 404 {
        return Err(format!("Thunderstore has no community named '{community}'"));
    }
    if !status.is_success() {
        return Err(format!("thunderstore packages: HTTP {status}"));
    }
    let raw: Vec<RawPkg> = resp
        .json()
        .await
        .map_err(|e| format!("thunderstore packages parse: {e}"))?;
    Ok(raw.into_iter().filter_map(compact).collect())
}

async fn load_packages(paths: &AppPaths, community: &str) -> Result<Arc<Vec<TsPackage>>, String> {
    let community = community.trim();
    if community.is_empty() {
        return Err("no Thunderstore community set for this game".to_string());
    }
    if let Some(p) = mem_get(community) {
        return Ok(p);
    }
    let lock = pkg_lock(community);
    let _g = lock.lock().await;
    if let Some(p) = mem_get(community) {
        return Ok(p);
    }
    if let Some(p) = load_disk(paths, community) {
        mem_put(community, p.clone());
        return Ok(p);
    }
    let arc = Arc::new(fetch_dump(community).await?);
    save_disk(paths, community, &arc);
    mem_put(community, arc.clone());
    Ok(arc)
}

static COMMUNITIES: LazyLock<Cached<Arc<Vec<Community>>>> =
    LazyLock::new(|| Cached::new(Duration::from_secs(6 * 60 * 60)));

async fn fetch_communities() -> Result<Vec<Community>, String> {
    let mut out: Vec<Community> = Vec::new();
    let mut url = format!("{SITE}/api/experimental/community/");
    let mut guard = 0;
    loop {
        let v: Value = http::get_json(&url)
            .await
            .map_err(|e| format!("thunderstore communities: {e}"))?;
        if let Some(arr) = v.get("results").and_then(|r| r.as_array()) {
            for c in arr {
                if let (Some(id), Some(name)) = (
                    c.get("identifier").and_then(|x| x.as_str()),
                    c.get("name").and_then(|x| x.as_str()),
                ) {
                    out.push(Community {
                        identifier: id.to_string(),
                        name: name.to_string(),
                    });
                }
            }
        }
        match v
            .pointer("/pagination/next_link")
            .and_then(|n| n.as_str())
            .filter(|s| !s.is_empty())
        {
            Some(next) => {
                url = next.to_string();
                guard += 1;
                if guard > 500 {
                    break;
                }
            }
            None => break,
        }
    }
    if out.is_empty() {
        return Err("Thunderstore communities came back empty".to_string());
    }
    Ok(out)
}

async fn communities() -> Result<Arc<Vec<Community>>, String> {
    COMMUNITIES
        .get_or(|| async { fetch_communities().await.ok().map(Arc::new) })
        .await
        .ok_or_else(|| "Thunderstore communities are currently unavailable".to_string())
}

fn find_community(list: &[Community], title: &str) -> Option<Community> {
    let norm = normalize_title(title);
    if norm.is_empty() {
        return None;
    }
    list.iter()
        .find(|c| normalize_title(&c.name) == norm)
        .cloned()
}

pub(crate) async fn match_community(title: &str) -> Result<Option<Community>, String> {
    let list = communities().await?;
    Ok(find_community(&list, title))
}

fn sort_key(p: &TsPackage, sort: &str) -> i64 {
    match sort {
        "updated" => p.updated_at,
        "published" => p.created_at,
        "rating" => p.rating,
        _ => latest_of(p).map(|v| v.downloads as i64).unwrap_or(0),
    }
}

fn browse_mod(p: &TsPackage) -> Value {
    let latest = latest_of(p);
    json!({
        "remoteId": p.full_name,
        "name": p.name,
        "summary": latest.map(|v| v.description.trim()).unwrap_or(""),
        "author": p.owner,
        "picture": (!p.icon.is_empty()).then(|| p.icon.clone()),
        "downloads": latest.map(|v| v.downloads).unwrap_or(0),
        "endorsements": p.rating.max(0),
        "version": latest.map(|v| v.version.as_str()).unwrap_or(""),
        "updatedAt": p.updated_at,
        "sizeBytes": latest.map(|v| v.size_bytes).unwrap_or(0),
        "pageUrl": p.package_url,
    })
}

fn filter_sort_page(
    pkgs: &[TsPackage],
    sort: &str,
    period: &str,
    page: u32,
    query: &str,
    now: i64,
) -> (Vec<Value>, bool) {
    let q = query.trim().to_lowercase();
    let cutoff = match period {
        "7" => Some(now - 7 * 86_400),
        "28" => Some(now - 28 * 86_400),
        _ => None,
    };
    let mut filtered: Vec<&TsPackage> = pkgs
        .iter()
        .filter(|p| {
            if p.deprecated || p.versions.is_empty() {
                return false;
            }
            if let Some(c) = cutoff {
                if p.updated_at < c {
                    return false;
                }
            }
            if !q.is_empty() {
                let desc = latest_of(p).map(|v| v.description.as_str()).unwrap_or("");
                let hit = p.name.to_lowercase().contains(&q)
                    || p.owner.to_lowercase().contains(&q)
                    || desc.to_lowercase().contains(&q);
                if !hit {
                    return false;
                }
            }
            true
        })
        .collect();
    filtered.sort_by(|a, b| {
        sort_key(b, sort)
            .cmp(&sort_key(a, sort))
            .then_with(|| a.full_name.cmp(&b.full_name))
    });
    let total = filtered.len();
    let start = (page as usize).saturating_mul(PAGE_SIZE);
    let mods: Vec<Value> = filtered
        .iter()
        .skip(start)
        .take(PAGE_SIZE)
        .map(|p| browse_mod(p))
        .collect();
    let has_more = start + mods.len() < total;
    (mods, has_more)
}

async fn fetch_detail(owner: &str, name: &str) -> Result<Value, String> {
    let url = format!("{SITE}/api/experimental/package/{owner}/{name}/");
    let resp = http::fetch(&url, &http::FetchOpts::default())
        .await
        .map_err(|e| format!("thunderstore package: {e}"))?;
    let status = resp.status();
    if status.as_u16() == 404 {
        return Err(format!("Thunderstore package {owner}-{name} not found"));
    }
    if !status.is_success() {
        return Err(format!("thunderstore package: HTTP {status}"));
    }
    resp.json::<Value>()
        .await
        .map_err(|e| format!("thunderstore package parse: {e}"))
}

fn version_json(v: &TsVersion) -> Value {
    json!({
        "version": v.version,
        "downloads": v.downloads,
        "sizeBytes": v.size_bytes,
        "uploadedAt": v.uploaded_at,
        "dependencyCount": v.dependencies.len(),
        "description": v.description.trim(),
    })
}

async fn versions_for(
    paths: &AppPaths,
    community: &str,
    full_name: &str,
) -> Result<Vec<Value>, String> {
    if let Ok(pkgs) = load_packages(paths, community).await {
        if let Some(p) = pkgs
            .iter()
            .find(|p| p.full_name.eq_ignore_ascii_case(full_name))
        {
            let mut versions: Vec<&TsVersion> = p.versions.iter().collect();
            versions.sort_by(|a, b| version_key(&b.version).cmp(&version_key(&a.version)));
            return Ok(versions.into_iter().map(version_json).collect());
        }
    }
    let (owner, name) =
        parse_full_name(full_name).ok_or_else(|| format!("bad package id {full_name}"))?;
    let detail = fetch_detail(&owner, &name).await?;
    let latest = detail
        .get("latest")
        .ok_or("Thunderstore package has no versions")?;
    Ok(vec![json!({
        "version": latest.get("version_number").and_then(|x| x.as_str()).unwrap_or(""),
        "downloads": latest.get("downloads").and_then(|x| x.as_u64()).unwrap_or(0),
        "sizeBytes": latest.get("file_size").and_then(|x| x.as_u64()).unwrap_or(0),
        "uploadedAt": iso_to_unix(latest.get("date_created").and_then(|x| x.as_str()).unwrap_or("")),
        "dependencyCount": latest.get("dependencies").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0),
        "description": latest.get("description").and_then(|x| x.as_str()).unwrap_or("").trim(),
    })])
}

struct ResolvedMod {
    full_name: String,
    version: String,
    download_url: String,
    display_name: String,
    author: String,
    picture: Option<String>,
    summary: Option<String>,
    page_url: String,
}

fn download_url(owner: &str, name: &str, version: &str) -> String {
    format!("{SITE}/package/download/{owner}/{name}/{version}/")
}

async fn resolve_node(
    paths: &AppPaths,
    community: &str,
    owner: &str,
    name: &str,
    ver: &str,
) -> Result<(ResolvedMod, Vec<String>), String> {
    let full = format!("{owner}-{name}");
    let want_latest = ver.is_empty() || ver.eq_ignore_ascii_case("latest");
    if let Ok(pkgs) = load_packages(paths, community).await {
        if let Some(p) = pkgs
            .iter()
            .find(|p| p.full_name.eq_ignore_ascii_case(&full))
        {
            let v = if want_latest {
                p.versions.get(p.latest)
            } else {
                p.versions.iter().find(|v| v.version == ver)
            };
            if let Some(v) = v {
                return Ok((
                    ResolvedMod {
                        full_name: p.full_name.clone(),
                        version: v.version.clone(),
                        download_url: download_url(&p.owner, &p.name, &v.version),
                        display_name: p.name.clone(),
                        author: p.owner.clone(),
                        picture: (!p.icon.is_empty()).then(|| p.icon.clone()),
                        summary: Some(v.description.clone()),
                        page_url: p.package_url.clone(),
                    },
                    v.dependencies.clone(),
                ));
            }
        }
    }
    let detail = fetch_detail(owner, name).await?;
    let latest = detail
        .get("latest")
        .ok_or_else(|| format!("{owner}-{name} has no versions"))?;
    let install_version = if want_latest {
        latest
            .get("version_number")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    } else {
        ver.to_string()
    };
    if install_version.is_empty() {
        return Err(format!("{owner}-{name} has no installable version"));
    }
    let deps: Vec<String> = latest
        .get("dependencies")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|d| d.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok((
        ResolvedMod {
            full_name: full,
            version: install_version.clone(),
            download_url: download_url(owner, name, &install_version),
            display_name: detail
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or(name)
                .to_string(),
            author: detail
                .get("owner")
                .and_then(|x| x.as_str())
                .unwrap_or(owner)
                .to_string(),
            picture: latest
                .get("icon")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from),
            summary: latest
                .get("description")
                .and_then(|x| x.as_str())
                .map(String::from),
            page_url: detail
                .get("package_url")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
        },
        deps,
    ))
}

async fn resolve_install(
    paths: &AppPaths,
    community: &str,
    full_name: &str,
    version: &str,
) -> Result<Vec<ResolvedMod>, String> {
    let (owner, name) =
        parse_full_name(full_name).ok_or_else(|| format!("bad package id {full_name}"))?;
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<ResolvedMod> = Vec::new();
    let mut queue: VecDeque<(String, String, String)> = VecDeque::new();
    queue.push_back((owner, name, version.to_string()));
    while let Some((o, n, ver)) = queue.pop_front() {
        let key = format!("{}-{}", o.to_lowercase(), n.to_lowercase());
        if !seen.insert(key) {
            continue;
        }
        let (resolved, deps) = resolve_node(paths, community, &o, &n, &ver).await?;
        out.push(resolved);
        for d in deps {
            if let Some((doo, dn, dv)) = parse_dependency(&d) {
                let k = format!("{}-{}", doo.to_lowercase(), dn.to_lowercase());
                if !seen.contains(&k) {
                    queue.push_back((doo, dn, dv));
                }
            }
        }
    }
    Ok(out)
}

async fn install_batch(
    app: &AppHandle,
    appid: &str,
    root_mod_id: &str,
    root_name: &str,
    resolved: &[ResolvedMod],
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let dir = game_mods_dir(&state.paths, appid);
    let tmp_dir = dir.join(".tmp");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| format!("tmp dir: {e}"))?;
    let n = resolved.len().max(1);
    for (i, r) in resolved.iter().enumerate() {
        let mod_id = format!("thunderstore-{}", r.full_name);
        let base = ((i * 100) / n) as u8;
        emit_progress(
            app,
            appid,
            root_mod_id,
            root_name,
            "downloading",
            Some(base),
            None,
        );
        let archive = tmp_dir.join(format!("{mod_id}.zip"));
        download_to_file(&r.download_url, &archive, HashMap::new(), |p| {
            let overall = p.map(|v| ((i * 100 + v as usize) / n) as u8);
            emit_progress(
                app,
                appid,
                root_mod_id,
                root_name,
                "downloading",
                overall,
                None,
            );
        })
        .await
        .map_err(|e| format!("download {}: {e}", r.full_name))?;

        emit_progress(app, appid, root_mod_id, root_name, "extracting", None, None);
        let extract_dir = tmp_dir.join(format!("{mod_id}-extract"));
        if extract_dir.exists() {
            std::fs::remove_dir_all(&extract_dir).ok();
        }
        crate::install::run_7z(&archive, &extract_dir, |_| {})
            .await
            .map_err(|e| format!("extract {}: {e}", r.full_name))?;
        std::fs::remove_file(&archive).ok();

        let staged = tmp_dir.join(format!("{mod_id}-staged"));
        if staged.exists() {
            std::fs::remove_dir_all(&staged).ok();
        }
        apply_bepinex_layout(&extract_dir, &staged, &r.full_name)?;
        std::fs::remove_dir_all(&extract_dir).ok();

        emit_progress(app, appid, root_mod_id, root_name, "installing", None, None);
        let spec = InstallSpec {
            appid: appid.to_string(),
            provider: "thunderstore".to_string(),
            remote_id: r.full_name.clone(),
            file_id: None,
            name: r.display_name.clone(),
            version: r.version.clone(),
            author: r.author.clone(),
            picture: r.picture.clone(),
            summary: r.summary.clone(),
            page_url: r.page_url.clone(),
        };
        finalize_install(app, &spec, &staged, true)
            .await
            .map_err(|e| format!("install {}: {e}", r.full_name))?;
    }
    emit_progress(app, appid, root_mod_id, root_name, "done", Some(100), None);
    Ok(())
}

async fn run_install(
    app: AppHandle,
    appid: String,
    root_full_name: String,
    resolved: Vec<ResolvedMod>,
) {
    let root_mod_id = format!("thunderstore-{root_full_name}");
    let root_name = resolved
        .first()
        .map(|r| r.display_name.clone())
        .unwrap_or_else(|| root_full_name.clone());
    if let Err(e) = install_batch(&app, &appid, &root_mod_id, &root_name, &resolved).await {
        emit_progress(
            &app,
            &appid,
            &root_mod_id,
            &root_name,
            "error",
            None,
            Some(&e),
        );
    }
}

#[tauri::command]
pub async fn thunderstore_communities() -> Result<Value, String> {
    let res = async {
        let list = communities().await?;
        let communities: Vec<Value> = list
            .iter()
            .map(|c| json!({ "identifier": c.identifier, "name": c.name }))
            .collect();
        Ok(json!({ "ok": true, "communities": communities }))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn thunderstore_browse(
    state: State<'_, AppState>,
    community: String,
    sort: String,
    period: String,
    page: u32,
    query: String,
) -> Result<Value, String> {
    let res = async {
        let pkgs = load_packages(&state.paths, &community).await?;
        // The frontend pages 1-based (page + 1); convert to the 0-based page
        // filter_sort_page expects so the first page starts at offset 0.
        let page = page.max(1) - 1;
        let (mods, has_more) = filter_sort_page(&pkgs, &sort, &period, page, &query, now_secs());
        Ok(json!({ "ok": true, "mods": mods, "hasMore": has_more }))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn thunderstore_versions(
    state: State<'_, AppState>,
    community: String,
    full_name: String,
) -> Result<Value, String> {
    let res = async {
        let versions = versions_for(&state.paths, &community, &full_name).await?;
        Ok(json!({ "ok": true, "versions": versions }))
    }
    .await;
    Ok(fold(res))
}

#[tauri::command]
pub async fn thunderstore_install(
    app: AppHandle,
    state: State<'_, AppState>,
    appid: String,
    community: String,
    full_name: String,
    version: String,
) -> Result<Value, String> {
    let res = async {
        if appid.trim().is_empty() {
            return Err("missing appid".to_string());
        }
        let resolved = resolve_install(&state.paths, &community, &full_name, &version).await?;
        if resolved.is_empty() {
            return Err("nothing to install".to_string());
        }
        tauri::async_runtime::spawn(run_install(
            app.clone(),
            appid.clone(),
            full_name.clone(),
            resolved,
        ));
        Ok(json!({ "ok": true, "started": true }))
    }
    .await;
    Ok(fold(res))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    fn write_file(p: &Path, content: &str) {
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(p, content).unwrap();
    }

    #[test]
    fn parses_full_name_and_dependency_strings() {
        assert_eq!(
            parse_full_name("bbepis-BepInExPack"),
            Some(("bbepis".to_string(), "BepInExPack".to_string()))
        );
        assert_eq!(
            parse_dependency("RiskofThunder-BepInEx_GUI-3.0.1"),
            Some((
                "RiskofThunder".to_string(),
                "BepInEx_GUI".to_string(),
                "3.0.1".to_string()
            ))
        );
        assert_eq!(
            parse_dependency("bbepis-BepInExPack-5.4.2121"),
            Some((
                "bbepis".to_string(),
                "BepInExPack".to_string(),
                "5.4.2121".to_string()
            ))
        );
        assert_eq!(parse_full_name("nohyphen"), None);
        assert_eq!(parse_dependency("owner-name"), None);
        assert_eq!(parse_dependency("nohyphen"), None);
    }

    #[test]
    fn version_key_orders_semver_numerically() {
        assert!(version_key("5.4.2121") > version_key("5.4.999"));
        assert!(version_key("2.0.0") > version_key("1.99.99"));
        assert!(version_key("1.2") < version_key("1.2.0"));
    }

    #[test]
    fn bepinex_transform_nests_loose_files_and_maps_subdirs() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        write_file(&src.join("MyMod.dll"), "dll");
        write_file(&src.join("manifest.json"), "{}");
        write_file(&src.join("config/my.cfg"), "cfg");
        write_file(&src.join("patchers/patch.dll"), "patch");

        apply_bepinex_layout(&src, &dst, "team-MyMod").unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/plugins/team-MyMod/MyMod.dll")).unwrap(),
            "dll"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/plugins/team-MyMod/manifest.json")).unwrap(),
            "{}"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/config/my.cfg")).unwrap(),
            "cfg"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/patchers/patch.dll")).unwrap(),
            "patch"
        );
        assert!(!dst.join("MyMod.dll").exists());
    }

    #[test]
    fn bepinex_transform_stages_bepinex_tree_verbatim() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        write_file(&src.join("BepInEx/plugins/Plug.dll"), "plug");
        write_file(&src.join("manifest.json"), "{}");

        apply_bepinex_layout(&src, &dst, "team-Plug").unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/plugins/Plug.dll")).unwrap(),
            "plug"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("manifest.json")).unwrap(),
            "{}"
        );
        assert!(!dst.join("BepInEx/plugins/team-Plug").exists());
    }

    #[test]
    fn bepinex_transform_unwraps_pack_wrapper() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        write_file(&src.join("BepInExPack/BepInEx/core/loader.dll"), "core");
        write_file(&src.join("BepInExPack/winhttp.dll"), "doorstop");

        apply_bepinex_layout(&src, &dst, "bbepis-BepInExPack").unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/core/loader.dll")).unwrap(),
            "core"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("winhttp.dll")).unwrap(),
            "doorstop"
        );
        assert!(!dst.join("BepInExPack").exists());
    }

    #[test]
    fn bepinex_transform_unwraps_pack_beside_metadata() {
        let tmp = tempdir().unwrap();
        let src = tmp.path().join("src");
        let dst = tmp.path().join("dst");
        write_file(
            &src.join("BepInExPack_GTFO/BepInEx/core/0Harmony.dll"),
            "core",
        );
        write_file(&src.join("BepInExPack_GTFO/winhttp.dll"), "doorstop");
        write_file(&src.join("BepInExPack_GTFO/doorstop_config.ini"), "cfg");
        write_file(&src.join("manifest.json"), "{}");
        write_file(&src.join("icon.png"), "png");
        write_file(&src.join("README.md"), "readme");

        apply_bepinex_layout(&src, &dst, "BepInEx-BepInExPack_GTFO").unwrap();

        assert_eq!(
            std::fs::read_to_string(dst.join("BepInEx/core/0Harmony.dll")).unwrap(),
            "core"
        );
        assert_eq!(
            std::fs::read_to_string(dst.join("winhttp.dll")).unwrap(),
            "doorstop"
        );
        assert!(!dst
            .join("BepInEx/plugins/BepInEx-BepInExPack_GTFO")
            .exists());
        assert!(!dst.join("BepInExPack_GTFO").exists());
    }

    fn mk_pkg(
        full: &str,
        name: &str,
        owner: &str,
        updated: i64,
        created: i64,
        rating: i64,
        deprecated: bool,
        desc: &str,
        downloads: u64,
    ) -> TsPackage {
        TsPackage {
            full_name: full.to_string(),
            name: name.to_string(),
            owner: owner.to_string(),
            package_url: format!("https://thunderstore.io/package/{full}/"),
            updated_at: updated,
            created_at: created,
            rating,
            deprecated,
            icon: String::new(),
            latest: 0,
            versions: vec![TsVersion {
                version: "1.0.0".to_string(),
                downloads,
                size_bytes: 1000,
                uploaded_at: updated,
                dependencies: vec![],
                description: desc.to_string(),
            }],
        }
    }

    const NOW: i64 = 1_700_000_000;
    const DAY: i64 = 86_400;

    fn fixture() -> Vec<TsPackage> {
        vec![
            mk_pkg(
                "team-Alpha",
                "Alpha",
                "team",
                NOW - DAY,
                NOW - 100 * DAY,
                5,
                false,
                "alpha helper",
                50,
            ),
            mk_pkg(
                "team-Beta",
                "Beta",
                "team",
                NOW - 40 * DAY,
                NOW - 10 * DAY,
                1,
                false,
                "beta tool",
                100,
            ),
            mk_pkg(
                "bad-Gone",
                "Gone",
                "bad",
                NOW - DAY,
                NOW - DAY,
                999,
                true,
                "deprecated",
                9_999,
            ),
            mk_pkg(
                "team-Gamma",
                "Gamma",
                "team",
                NOW - 3 * DAY,
                NOW - 2 * DAY,
                9,
                false,
                "gamma widget",
                10,
            ),
        ]
    }

    fn ids(mods: &[Value]) -> Vec<String> {
        mods.iter()
            .map(|m| m["remoteId"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn browse_excludes_deprecated_and_sorts_by_downloads() {
        let pkgs = fixture();
        let (mods, has_more) = filter_sort_page(&pkgs, "downloads", "all", 0, "", NOW);
        assert_eq!(ids(&mods), vec!["team-Beta", "team-Alpha", "team-Gamma"]);
        assert!(!has_more);
        assert!(!ids(&mods).iter().any(|id| id == "bad-Gone"));
    }

    #[test]
    fn browse_sorts_by_rating_published_and_updated() {
        let pkgs = fixture();
        assert_eq!(
            ids(&filter_sort_page(&pkgs, "rating", "all", 0, "", NOW).0),
            vec!["team-Gamma", "team-Alpha", "team-Beta"]
        );
        assert_eq!(
            ids(&filter_sort_page(&pkgs, "published", "all", 0, "", NOW).0),
            vec!["team-Gamma", "team-Beta", "team-Alpha"]
        );
        assert_eq!(
            ids(&filter_sort_page(&pkgs, "updated", "all", 0, "", NOW).0),
            vec!["team-Alpha", "team-Gamma", "team-Beta"]
        );
    }

    #[test]
    fn browse_period_filters_by_update_recency() {
        let pkgs = fixture();
        let (mods, _) = filter_sort_page(&pkgs, "downloads", "7", 0, "", NOW);
        assert_eq!(ids(&mods), vec!["team-Alpha", "team-Gamma"]);
    }

    #[test]
    fn browse_query_matches_name_owner_and_description() {
        let pkgs = fixture();
        assert_eq!(
            ids(&filter_sort_page(&pkgs, "downloads", "all", 0, "widget", NOW).0),
            vec!["team-Gamma"]
        );
        assert_eq!(
            ids(&filter_sort_page(&pkgs, "downloads", "all", 0, "TEAM", NOW).0),
            vec!["team-Beta", "team-Alpha", "team-Gamma"]
        );
    }

    #[test]
    fn browse_paginates_in_pages_of_24() {
        let pkgs: Vec<TsPackage> = (0..30)
            .map(|i| {
                mk_pkg(
                    &format!("team-M{i:02}"),
                    &format!("M{i:02}"),
                    "team",
                    NOW,
                    NOW,
                    0,
                    false,
                    "",
                    i,
                )
            })
            .collect();
        let (p0, more0) = filter_sort_page(&pkgs, "downloads", "all", 0, "", NOW);
        assert_eq!(p0.len(), 24);
        assert!(more0);
        let (p1, more1) = filter_sort_page(&pkgs, "downloads", "all", 1, "", NOW);
        assert_eq!(p1.len(), 6);
        assert!(!more1);
    }

    #[test]
    fn community_match_is_normalized_and_exact() {
        let list = vec![
            Community {
                identifier: "lethal-company".to_string(),
                name: "Lethal Company".to_string(),
            },
            Community {
                identifier: "riskofrain2".to_string(),
                name: "Risk of Rain 2".to_string(),
            },
        ];
        assert_eq!(
            find_community(&list, "LETHAL COMPANY\u{2122}")
                .unwrap()
                .identifier,
            "lethal-company"
        );
        assert_eq!(
            find_community(&list, "Risk of Rain 2").unwrap().identifier,
            "riskofrain2"
        );
        assert!(find_community(&list, "Some Other Game").is_none());
    }

    #[test]
    fn compact_picks_highest_version_as_latest() {
        let raw = RawPkg {
            name: "Mod".to_string(),
            full_name: "team-Mod".to_string(),
            owner: "team".to_string(),
            package_url: "url".to_string(),
            date_created: "2020-01-01T00:00:00Z".to_string(),
            date_updated: "2021-01-01T00:00:00Z".to_string(),
            rating_score: 3,
            is_deprecated: false,
            versions: vec![
                RawVer {
                    version_number: "1.0.0".to_string(),
                    description: "old".to_string(),
                    icon: "old.png".to_string(),
                    dependencies: vec![],
                    downloads: 5,
                    file_size: 10,
                    date_created: "2020-01-01T00:00:00Z".to_string(),
                },
                RawVer {
                    version_number: "1.2.0".to_string(),
                    description: "new".to_string(),
                    icon: "new.png".to_string(),
                    dependencies: vec!["a-b-1.0.0".to_string()],
                    downloads: 50,
                    file_size: 20,
                    date_created: "2021-01-01T00:00:00Z".to_string(),
                },
            ],
        };
        let p = compact(raw).unwrap();
        assert_eq!(p.latest, 1);
        assert_eq!(latest_of(&p).unwrap().version, "1.2.0");
        assert_eq!(p.icon, "new.png");
        assert_eq!(p.versions.len(), 2);
    }
}
