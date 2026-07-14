use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State};

use crate::state::AppState;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAchievement {
    pub api_name: String,
    pub display_name: String,
    pub description: String,
    pub hidden: bool,
    pub icon: Option<String>,
    pub icon_locked: Option<String>,
    pub unlocked: bool,
    pub unlocked_at: Option<i64>,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementGame {
    pub appid: String,
    pub steam_app_id: Option<u64>,
    pub title: String,
    pub image: Option<String>,
    pub provider: String,
    pub catalog_complete: bool,
    pub updated_at: i64,
    pub achievements: Vec<LocalAchievement>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementUnlock {
    pub appid: String,
    pub steam_app_id: Option<u64>,
    pub game_title: String,
    pub achievement: LocalAchievement,
}

#[derive(Clone)]
pub(crate) struct GameContext {
    appid: String,
    steam_app_id: Option<u64>,
    title: String,
    image: Option<String>,
    install_dir: PathBuf,
    exe_path: Option<PathBuf>,
    prefixes: Vec<PathBuf>,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoreFile {
    version: u32,
    games: Vec<AchievementGame>,
}

#[derive(Clone)]
struct WatchEntry {
    stop: Arc<AtomicBool>,
    context: GameContext,
}

pub struct AchievementService {
    file: PathBuf,
    games: Mutex<Vec<AchievementGame>>,
    watches: Mutex<HashMap<String, WatchEntry>>,
}

#[derive(Clone)]
struct AchievementDefinition {
    api_name: String,
    display_name: String,
    description: String,
    hidden: bool,
    icon: Option<String>,
    icon_locked: Option<String>,
}

#[derive(Clone, Default)]
struct UnlockState {
    unlocked: bool,
    unlocked_at: Option<i64>,
}

struct Discovery {
    definitions: Option<PathBuf>,
    states: Vec<PathBuf>,
    provider: String,
}

struct ScannedGame {
    game: AchievementGame,
    state_loaded: bool,
}

impl AchievementService {
    pub fn new(file: PathBuf) -> Arc<Self> {
        let games = std::fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<StoreFile>(&bytes).ok())
            .map(|store| store.games)
            .unwrap_or_default();
        Arc::new(Self {
            file,
            games: Mutex::new(games),
            watches: Mutex::new(HashMap::new()),
        })
    }

    pub fn list(&self) -> Vec<AchievementGame> {
        let mut games = self.games.lock().clone();
        games.sort_by(|a, b| {
            b.updated_at
                .cmp(&a.updated_at)
                .then_with(|| a.title.cmp(&b.title))
        });
        games
    }

    pub fn refresh(&self, app: &AppHandle, contexts: Vec<GameContext>) {
        let mut changed = false;
        for context in contexts {
            if let Some(scanned) = scan_game(&context) {
                changed |= self.apply_scan(app, scanned, false, false);
            }
        }
        if changed {
            app.emit("uc:achievements-updated", json!({ "reason": "refresh" }))
                .ok();
        }
    }

    pub fn start_watch(self: &Arc<Self>, app: AppHandle, context: GameContext) {
        let stop = Arc::new(AtomicBool::new(false));
        if let Some(previous) = self.watches.lock().insert(
            context.appid.clone(),
            WatchEntry {
                stop: stop.clone(),
                context: context.clone(),
            },
        ) {
            previous.stop.store(true, Ordering::Relaxed);
        }
        let service = self.clone();
        let name = format!("achievement-watch-{}", context.appid);
        let watch_appid = context.appid.clone();
        if let Err(error) = std::thread::Builder::new().name(name).spawn(move || {
            let mut discovery = discover(&context);
            let mut first = true;
            let mut empty_ticks = 0u8;
            while !stop.load(Ordering::Relaxed) {
                let scanned = scan_discovery(&context, &discovery);
                let state_loaded = scanned
                    .as_ref()
                    .map(|scan| scan.state_loaded)
                    .unwrap_or(false);
                if let Some(scanned) = scanned {
                    service.apply_scan(&app, scanned, !first, true);
                }
                first = false;
                if state_loaded {
                    empty_ticks = 0;
                } else {
                    empty_ticks = empty_ticks.saturating_add(1);
                    if empty_ticks >= 10 {
                        discovery = discover(&context);
                        empty_ticks = 0;
                    }
                }
                for _ in 0..10 {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
        }) {
            self.watches.lock().remove(&watch_appid);
            crate::logging::write_line(
                "error",
                &format!("achievement watcher spawn failed: {error}"),
            );
        }
    }

    pub fn finish_watch(&self, app: &AppHandle, appid: &str) {
        let entry = self.watches.lock().remove(appid);
        if let Some(entry) = entry {
            entry.stop.store(true, Ordering::Relaxed);
            if let Some(scanned) = scan_game(&entry.context) {
                self.apply_scan(app, scanned, true, true);
            }
        }
    }

    pub fn stop_all(&self) {
        let mut watches = self.watches.lock();
        for entry in watches.values() {
            entry.stop.store(true, Ordering::Relaxed);
        }
        watches.clear();
    }

    fn apply_scan(
        &self,
        app: &AppHandle,
        scanned: ScannedGame,
        notify: bool,
        emit_update: bool,
    ) -> bool {
        let ScannedGame {
            game: scanned_game,
            state_loaded,
        } = scanned;
        let scanned_appid = scanned_game.appid.clone();
        let mut unlocks = Vec::new();
        let mut changed = false;
        {
            let mut games = self.games.lock();
            if let Some(index) = games.iter().position(|game| game.appid == scanned_appid) {
                let previous = games[index].clone();
                let mut next = merge_game(&previous, scanned_game, state_loaded);
                next.updated_at = previous.updated_at;
                if next != previous {
                    if notify && state_loaded {
                        let previous_unlocks: HashSet<String> = previous
                            .achievements
                            .iter()
                            .filter(|achievement| achievement.unlocked)
                            .map(|achievement| achievement.api_name.to_lowercase())
                            .collect();
                        unlocks.extend(
                            next.achievements
                                .iter()
                                .filter(|achievement| {
                                    achievement.unlocked
                                        && !previous_unlocks
                                            .contains(&achievement.api_name.to_lowercase())
                                })
                                .cloned(),
                        );
                    }
                    next.updated_at = now_ms();
                    games[index] = next;
                    changed = true;
                }
            } else {
                let mut game = scanned_game;
                game.updated_at = now_ms();
                games.push(game);
                changed = true;
            }
        }
        if changed {
            self.persist();
            if emit_update {
                app.emit("uc:achievements-updated", json!({ "reason": "state" }))
                    .ok();
            }
        }
        if !unlocks.is_empty() {
            if let Some(game) = self
                .games
                .lock()
                .iter()
                .find(|game| game.appid == scanned_appid)
                .cloned()
            {
                for achievement in unlocks {
                    emit_unlock(app, &game, achievement);
                }
            }
        }
        changed
    }

    fn persist(&self) {
        let store = StoreFile {
            version: 1,
            games: self.games.lock().clone(),
        };
        if let Ok(value) = serde_json::to_value(store) {
            if let Some(parent) = self.file.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            if let Err(error) = crate::downloads::write_json_atomic(&self.file, &value) {
                crate::logging::write_line(
                    "warn",
                    &format!("achievement state write failed: {error}"),
                );
            }
        }
    }
}

fn merge_game(
    previous: &AchievementGame,
    mut next: AchievementGame,
    state_loaded: bool,
) -> AchievementGame {
    let previous_by_id: HashMap<String, &LocalAchievement> = previous
        .achievements
        .iter()
        .map(|achievement| (achievement.api_name.to_lowercase(), achievement))
        .collect();
    let mut seen = HashSet::new();
    for achievement in &mut next.achievements {
        let key = achievement.api_name.to_lowercase();
        seen.insert(key.clone());
        if let Some(old) = previous_by_id.get(&key) {
            if old.unlocked || !state_loaded {
                achievement.unlocked = old.unlocked;
                achievement.unlocked_at = old.unlocked_at;
            } else if achievement.unlocked && achievement.unlocked_at.is_none() {
                achievement.unlocked_at = old.unlocked_at;
            }
        }
    }
    if !state_loaded {
        next.achievements.extend(
            previous
                .achievements
                .iter()
                .filter(|achievement| !seen.contains(&achievement.api_name.to_lowercase()))
                .cloned(),
        );
    }
    if !state_loaded
        && !next.catalog_complete
        && previous.provider != "Awaiting local data"
    {
        next.provider = previous.provider.clone();
        next.catalog_complete = previous.catalog_complete;
    }
    next.achievements
        .sort_by(|a, b| a.api_name.cmp(&b.api_name));
    next
}

fn emit_unlock(app: &AppHandle, game: &AchievementGame, mut achievement: LocalAchievement) {
    if achievement.unlocked_at.is_none() {
        achievement.unlocked_at = Some(now_ms());
    }
    let payload = AchievementUnlock {
        appid: game.appid.clone(),
        steam_app_id: game.steam_app_id,
        game_title: game.title.clone(),
        achievement,
    };
    app.emit("uc:achievement-unlocked", &payload).ok();
    let enabled = app
        .state::<AppState>()
        .settings
        .get("achievementNotifications")
        .as_bool()
        .unwrap_or(true);
    if enabled {
        present_toast(app, &payload);
    }
}

fn present_toast(app: &AppHandle, payload: &AchievementUnlock) {
    let Some(window) = app.get_webview_window("achievement-toast") else {
        crate::notify::send(
            app,
            "Achievement unlocked",
            &format!(
                "{} — {}",
                payload.game_title, payload.achievement.display_name
            ),
        );
        return;
    };
    position_toast(&window);
    if window.show().is_err() {
        crate::notify::send(
            app,
            "Achievement unlocked",
            &format!(
                "{} — {}",
                payload.game_title, payload.achievement.display_name
            ),
        );
        return;
    }
    window.set_ignore_cursor_events(true).ok();
    window.emit("uc:achievement-toast", payload).ok();
}

fn position_toast(window: &tauri::WebviewWindow) {
    let monitor = window
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());
    let Ok(size) = window.outer_size() else {
        return;
    };
    let Some(monitor) = monitor else {
        return;
    };
    let area = monitor.size();
    let origin = monitor.position();
    let x = origin.x + area.width.saturating_sub(size.width + 24) as i32;
    let y = origin.y + area.height.saturating_sub(size.height + 40) as i32;
    window.set_position(PhysicalPosition::new(x, y)).ok();
}

fn scan_game(context: &GameContext) -> Option<ScannedGame> {
    let discovery = discover(context);
    scan_discovery(context, &discovery)
}

fn scan_discovery(context: &GameContext, discovery: &Discovery) -> Option<ScannedGame> {
    let definitions = discovery
        .definitions
        .as_deref()
        .and_then(parse_definitions)
        .unwrap_or_default();
    let mut state = HashMap::new();
    let mut state_loaded = false;
    let mut provider = discovery.provider.clone();
    for path in &discovery.states {
        if !path.is_file() {
            continue;
        }
        if let Some(parsed) = parse_state(path) {
            state = parsed;
            state_loaded = true;
            provider = provider_for(path);
            break;
        }
    }
    let catalog_complete = !definitions.is_empty();
    if !catalog_complete && !state_loaded {
        provider = "Awaiting local data".to_string();
    }
    let mut achievements = Vec::with_capacity(definitions.len().max(state.len()));
    let mut matched = HashSet::new();
    for definition in definitions {
        let key = definition.api_name.to_lowercase();
        let current = state.get(&key).cloned().unwrap_or_default();
        matched.insert(key);
        achievements.push(LocalAchievement {
            api_name: definition.api_name,
            display_name: definition.display_name,
            description: definition.description,
            hidden: definition.hidden,
            icon: definition.icon,
            icon_locked: definition.icon_locked,
            unlocked: current.unlocked,
            unlocked_at: current.unlocked_at,
        });
    }
    for (key, current) in state {
        if matched.contains(&key) {
            continue;
        }
        achievements.push(LocalAchievement {
            api_name: key.clone(),
            display_name: humanize_api_name(&key),
            description: String::new(),
            hidden: false,
            icon: None,
            icon_locked: None,
            unlocked: current.unlocked,
            unlocked_at: current.unlocked_at,
        });
    }
    achievements.sort_by(|a, b| a.api_name.cmp(&b.api_name));
    Some(ScannedGame {
        game: AchievementGame {
            appid: context.appid.clone(),
            steam_app_id: context.steam_app_id,
            title: context.title.clone(),
            image: context.image.clone(),
            provider,
            catalog_complete,
            updated_at: 0,
            achievements,
        },
        state_loaded,
    })
}

fn discover(context: &GameContext) -> Discovery {
    let definitions = find_definitions(context);
    let mut states = Vec::new();
    let mut saves_folder = "GSE Saves".to_string();
    if let Some(definitions_path) = &definitions {
        if let Some(settings_dir) = definitions_path.parent() {
            let config = settings_dir.join("configs.user.ini");
            if let Ok(text) = std::fs::read_to_string(&config) {
                if let Some(value) = ini_value(&text, "saves_folder_name") {
                    if !value.is_empty() {
                        saves_folder = value;
                    }
                }
                if let Some(value) = ini_value(&text, "local_save_path") {
                    if !value.is_empty() {
                        let base = settings_dir.parent().unwrap_or(settings_dir);
                        let root = absolute_or_join(base, &value);
                        push_state_names(
                            &mut states,
                            &root.join(
                                context
                                    .steam_app_id
                                    .map(|id| id.to_string())
                                    .unwrap_or_else(|| context.appid.clone()),
                            ),
                        );
                    }
                }
            }
        }
    }
    add_global_states(context, &saves_folder, &mut states);
    add_install_states(context, definitions.as_deref(), &mut states);
    dedupe_paths(&mut states);
    let provider = definitions
        .as_ref()
        .map(|path| provider_for(path))
        .unwrap_or_else(|| "Local Steam".to_string());
    Discovery {
        definitions,
        states,
        provider,
    }
}

fn find_definitions(context: &GameContext) -> Option<PathBuf> {
    let mut direct = Vec::new();
    if let Some(exe) = &context.exe_path {
        if let Some(mut dir) = exe.parent() {
            loop {
                direct.push(dir.join("steam_settings").join("achievements.json"));
                if dir == context.install_dir {
                    break;
                }
                let Some(parent) = dir.parent() else {
                    break;
                };
                if !parent.starts_with(&context.install_dir) {
                    break;
                }
                dir = parent;
            }
        }
    }
    direct.push(
        context
            .install_dir
            .join("steam_settings")
            .join("achievements.json"),
    );
    if let Some(path) = direct.into_iter().find(|path| path.is_file()) {
        return Some(path);
    }
    if let Some(steam_app_id) = context.steam_app_id {
        let filename = format!("UserGameStatsSchema_{steam_app_id}.bin");
        if let Some(path) = crate::import::steam_roots()
            .into_iter()
            .map(|root| root.join("appcache/stats").join(&filename))
            .find(|path| path.is_file())
        {
            return Some(path);
        }
    }
    walkdir::WalkDir::new(&context.install_dir)
        .max_depth(6)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .find_map(|entry| {
            let path = entry.path();
            let is_definition = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("achievements.json"))
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case("steam_settings"));
            is_definition.then(|| path.to_path_buf())
        })
}

fn add_install_states(
    context: &GameContext,
    definitions: Option<&Path>,
    states: &mut Vec<PathBuf>,
) {
    for entry in walkdir::WalkDir::new(&context.install_dir)
        .max_depth(6)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
    {
        let path = entry.path();
        if definitions.is_some_and(|definition| definition == path) {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if is_state_filename(name) {
            states.push(path.to_path_buf());
        }
    }
}

fn add_global_states(context: &GameContext, saves_folder: &str, states: &mut Vec<PathBuf>) {
    let Some(steam_app_id) = context.steam_app_id else {
        return;
    };
    let appid = steam_app_id.to_string();
    let mut roaming_roots = Vec::new();
    if let Some(path) = dirs::data_dir() {
        roaming_roots.push(path);
    }
    for key in ["APPDATA", "XDG_DATA_HOME"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                roaming_roots.push(PathBuf::from(value));
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        roaming_roots.push(PathBuf::from(home).join(".local/share"));
    }
    for root in roaming_roots {
        add_roaming_states(states, &root, saves_folder, &appid);
    }
    if let Ok(public) = std::env::var("PUBLIC") {
        add_document_states(states, &PathBuf::from(public).join("Documents"), &appid);
    }
    for prefix in &context.prefixes {
        let users = prefix.join("drive_c/users");
        if let Ok(entries) = std::fs::read_dir(&users) {
            for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
                let user = entry.path();
                add_roaming_states(
                    states,
                    &user.join("AppData/Roaming"),
                    saves_folder,
                    &appid,
                );
                add_document_states(states, &user.join("Documents"), &appid);
            }
        }
    }
}

fn add_roaming_states(
    states: &mut Vec<PathBuf>,
    roaming: &Path,
    saves_folder: &str,
    appid: &str,
) {
    for folder in [
        saves_folder,
        "GSE Saves",
        "Goldberg SteamEmu Saves",
        "SmartSteamEmu",
        "CreamAPI",
    ] {
        push_nested_state_names(states, &roaming.join(folder).join(appid));
    }
    for folder in ["Steam/CODEX", "Steam/RUNE", "EMPRESS"] {
        push_state_names(states, &roaming.join(folder).join(appid));
    }
    push_nested_state_names(states, &roaming.join("OnlineFix").join(appid));
}

fn add_document_states(states: &mut Vec<PathBuf>, documents: &Path, appid: &str) {
    for folder in ["Steam/CODEX", "Steam/RUNE", "EMPRESS"] {
        push_state_names(states, &documents.join(folder).join(appid));
    }
    push_nested_state_names(states, &documents.join("OnlineFix").join(appid));
}

fn push_nested_state_names(states: &mut Vec<PathBuf>, root: &Path) {
    push_state_names(states, root);
    if let Ok(entries) = std::fs::read_dir(root) {
        for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
            push_state_names(states, &entry.path());
        }
    }
}

fn push_state_names(states: &mut Vec<PathBuf>, root: &Path) {
    for name in [
        "achievements.json",
        "achievements.ini",
        "Achievements.ini",
        "achiev.ini",
        "stats.ini",
        "stats/achievements.ini",
        "stats/CreamAPI.Achievements.cfg",
    ] {
        states.push(root.join(name));
    }
}

fn is_state_filename(name: &str) -> bool {
    [
        "achievements.json",
        "achievements.ini",
        "achiev.ini",
        "stats.ini",
        "creamapi.achievements.cfg",
    ]
    .iter()
    .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn dedupe_paths(paths: &mut Vec<PathBuf>) {
    let mut seen = HashSet::new();
    paths.retain(|path| {
        let path = path.to_string_lossy();
        let key = if cfg!(windows) {
            path.to_lowercase()
        } else {
            path.into_owned()
        };
        seen.insert(key)
    });
}

fn parse_definitions(path: &Path) -> Option<Vec<AchievementDefinition>> {
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("bin"))
    {
        return parse_steam_definitions(path);
    }
    parse_json_definitions(path)
}

fn parse_json_definitions(path: &Path) -> Option<Vec<AchievementDefinition>> {
    let value: Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let root = path.parent()?;
    let mut definitions = Vec::new();
    match value {
        Value::Array(items) => {
            for item in items {
                if let Some(definition) = definition_from_value(None, &item, root) {
                    definitions.push(definition);
                }
            }
        }
        Value::Object(object) => {
            if let Some(Value::Array(items)) = object.get("achievements") {
                for item in items {
                    if let Some(definition) = definition_from_value(None, item, root) {
                        definitions.push(definition);
                    }
                }
            } else {
                for (key, item) in object {
                    if let Some(definition) = definition_from_value(Some(&key), &item, root) {
                        definitions.push(definition);
                    }
                }
            }
        }
        _ => return None,
    }
    (!definitions.is_empty()).then_some(definitions)
}

struct BinaryKeyValues<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl BinaryKeyValues<'_> {
    fn object(&mut self) -> Option<Map<String, Value>> {
        let mut object = Map::new();
        loop {
            let kind = *self.bytes.get(self.offset)?;
            self.offset += 1;
            if kind == 8 {
                return Some(object);
            }
            let key = self.string()?;
            let value = match kind {
                0 => Value::Object(self.object()?),
                1 => Value::String(self.string()?),
                2 => {
                    let end = self.offset.checked_add(4)?;
                    let bytes: [u8; 4] = self.bytes.get(self.offset..end)?.try_into().ok()?;
                    self.offset = end;
                    Value::Number(i32::from_le_bytes(bytes).into())
                }
                _ => return None,
            };
            object.insert(key, value);
        }
    }

    fn string(&mut self) -> Option<String> {
        let remaining = self.bytes.get(self.offset..)?;
        let length = remaining.iter().position(|byte| *byte == 0)?;
        let end = self.offset.checked_add(length)?;
        let value = String::from_utf8_lossy(self.bytes.get(self.offset..end)?).into_owned();
        self.offset = end.checked_add(1)?;
        Some(value)
    }
}

fn parse_steam_definitions(path: &Path) -> Option<Vec<AchievementDefinition>> {
    let steam_app_id = path
        .file_stem()?
        .to_str()?
        .strip_prefix("UserGameStatsSchema_")?
        .parse::<u64>()
        .ok()?;
    let bytes = std::fs::read(path).ok()?;
    let mut parser = BinaryKeyValues {
        bytes: &bytes,
        offset: 0,
    };
    let root = parser.object()?;
    if parser.offset != bytes.len() {
        return None;
    }
    let mut definitions = Vec::new();
    let mut seen = HashSet::new();
    for app in root.values().filter_map(Value::as_object) {
        let Some(stats) = value_ci(app, &["stats"]).and_then(Value::as_object) else {
            continue;
        };
        for group in stats.values().filter_map(Value::as_object) {
            if !string_value_ci(group, &["type"])
                .is_some_and(|value| value.eq_ignore_ascii_case("ACHIEVEMENTS"))
            {
                continue;
            }
            let Some(bits) = value_ci(group, &["bits"]).and_then(Value::as_object) else {
                continue;
            };
            for bit in bits.values().filter_map(Value::as_object) {
                let Some(api_name) = string_value_ci(bit, &["name"])
                    .filter(|value| !value.is_empty())
                else {
                    continue;
                };
                if !seen.insert(api_name.to_lowercase()) {
                    continue;
                }
                let Some(display) = value_ci(bit, &["display"]).and_then(Value::as_object) else {
                    continue;
                };
                let display_name = localized_value_ci(display, &["name"])
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| humanize_api_name(&api_name));
                let description =
                    localized_value_ci(display, &["description", "desc"]).unwrap_or_default();
                let hidden = value_ci(display, &["hidden"]).is_some_and(truthy);
                let icon = string_value_ci(display, &["icon"])
                    .and_then(|value| steam_icon_url(steam_app_id, &value));
                let icon_locked = string_value_ci(display, &["icon_gray", "icongray"])
                    .and_then(|value| steam_icon_url(steam_app_id, &value));
                definitions.push(AchievementDefinition {
                    api_name,
                    display_name,
                    description,
                    hidden,
                    icon,
                    icon_locked,
                });
            }
        }
    }
    (!definitions.is_empty()).then_some(definitions)
}

fn steam_icon_url(steam_app_id: u64, value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }
    if value.starts_with("http://") || value.starts_with("https://") {
        return Some(value.to_string());
    }
    Some(format!(
        "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/{steam_app_id}/{value}"
    ))
}

fn definition_from_value(
    key: Option<&str>,
    value: &Value,
    root: &Path,
) -> Option<AchievementDefinition> {
    let object = value.as_object()?;
    let api_name = string_value_ci(object, &["name", "id", "apiname"])
        .or_else(|| key.map(String::from))?
        .trim()
        .to_string();
    if api_name.is_empty() {
        return None;
    }
    let display_name = localized_value_ci(object, &["displayName", "display_name"])
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| humanize_api_name(&api_name));
    let description = localized_value_ci(object, &["description", "desc"]).unwrap_or_default();
    let hidden = value_ci(object, &["hidden"]).is_some_and(truthy);
    let icon = string_value_ci(object, &["icon", "icon_unlocked"])
        .and_then(|value| resolve_icon(root, &value));
    let icon_locked = string_value_ci(object, &["icongray", "icon_gray", "icon_locked"])
        .and_then(|value| resolve_icon(root, &value));
    Some(AchievementDefinition {
        api_name,
        display_name,
        description,
        hidden,
        icon,
        icon_locked,
    })
}

fn resolve_icon(root: &Path, value: &str) -> Option<String> {
    if value.is_empty() {
        return None;
    }
    if value.starts_with("http://") || value.starts_with("https://") || value.starts_with("file://")
    {
        return Some(value.to_string());
    }
    let direct = absolute_or_join(root, value);
    if direct.is_file() {
        return Some(direct.to_string_lossy().to_string());
    }
    let fallback = root.join("achievement_images").join(value);
    fallback
        .is_file()
        .then(|| fallback.to_string_lossy().to_string())
}

fn parse_state(path: &Path) -> Option<HashMap<String, UnlockState>> {
    let bytes = std::fs::read(path).ok()?;
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        let value: Value = serde_json::from_slice(&bytes).ok()?;
        let mut state = HashMap::new();
        parse_json_state(&value, &mut state);
        return Some(state);
    }
    let text = String::from_utf8(bytes).ok()?;
    Some(parse_ini_state(&text))
}

fn parse_json_state(value: &Value, state: &mut HashMap<String, UnlockState>) {
    if let Some(object) = value.as_object() {
        if let Some(inner) = value_ci(object, &["ACHIEVE_DATA"]) {
            parse_json_state(inner, state);
            return;
        }
        if let Some(achievements) = value_ci(object, &["Achievements"]).and_then(Value::as_object) {
            let times = value_ci(object, &["AchievementsUnlockTimes"]).and_then(Value::as_object);
            for (id, value) in achievements {
                let mut entry = json_unlock_state(value).unwrap_or_else(|| UnlockState {
                    unlocked: truthy(value),
                    unlocked_at: None,
                });
                if entry.unlocked_at.is_none() {
                    entry.unlocked_at =
                        times.and_then(|times| times.get(id)).and_then(timestamp_ms);
                }
                state.insert(id.to_lowercase(), entry);
            }
            return;
        }
        for (id, value) in object {
            if let Some(entry) = json_unlock_state(value) {
                state.insert(id.to_lowercase(), entry);
            }
        }
    } else if let Some(items) = value.as_array() {
        for item in items {
            let Some(object) = item.as_object() else {
                continue;
            };
            let Some(id) = string_value_ci(object, &["name", "id", "apiname"]) else {
                continue;
            };
            if let Some(entry) = json_unlock_state(item) {
                state.insert(id.to_lowercase(), entry);
            }
        }
    }
}

fn json_unlock_state(value: &Value) -> Option<UnlockState> {
    if !value.is_object() {
        return Some(UnlockState {
            unlocked: truthy(value),
            unlocked_at: None,
        });
    }
    let object = value.as_object()?;
    let marker = value_ci(
        object,
        &["earned", "achieved", "State", "HaveAchieved", "Unlocked"],
    );
    let progress = value_ci(object, &["CurProgress", "progress"]).and_then(number_value);
    let maximum = value_ci(object, &["MaxProgress", "max_progress"]).and_then(number_value);
    if marker.is_none() && progress.is_none() && maximum.is_none() {
        return None;
    }
    let unlocked = marker.is_some_and(truthy)
        || matches!((progress, maximum), (Some(current), Some(maximum)) if maximum > 0.0 && current >= maximum);
    let unlocked_at = value_ci(
        object,
        &[
            "earned_time",
            "UnlockTime",
            "unlocktime",
            "HaveAchievedTime",
            "Time",
        ],
    )
    .and_then(timestamp_ms);
    Some(UnlockState {
        unlocked,
        unlocked_at,
    })
}

fn parse_ini_state(text: &str) -> HashMap<String, UnlockState> {
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current = String::new();
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty()
            || line.starts_with(';')
            || line.starts_with('#')
            || line.starts_with("//")
        {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            current = line[1..line.len() - 1].trim().to_string();
            sections.entry(current.clone()).or_default();
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            sections
                .entry(current.clone())
                .or_default()
                .insert(key.trim().to_string(), clean_ini_value(value));
        }
    }
    let mut state = HashMap::new();
    let achievements = section_ci(&sections, "Achievements");
    let times = section_ci(&sections, "AchievementsUnlockTimes");
    if let Some(achievements) = achievements {
        for (id, value) in achievements {
            state.insert(
                id.to_lowercase(),
                UnlockState {
                    unlocked: truthy_text(value),
                    unlocked_at: times
                        .and_then(|times| map_value_ci(times, id))
                        .and_then(|value| timestamp_text(value)),
                },
            );
        }
    }
    for (section, values) in &sections {
        if section.is_empty()
            || [
                "Achievements",
                "AchievementsUnlockTimes",
                "SteamAchievements",
                "Steam64",
                "Steam",
            ]
            .iter()
            .any(|name| section.eq_ignore_ascii_case(name))
        {
            continue;
        }
        let marker = map_value_any_ci(
            values,
            &["Achieved", "earned", "State", "HaveAchieved", "Unlocked"],
        );
        let progress = map_value_any_ci(values, &["CurProgress", "progress"])
            .and_then(|value| value.parse::<f64>().ok());
        let maximum = map_value_any_ci(values, &["MaxProgress", "max_progress"])
            .and_then(|value| value.parse::<f64>().ok());
        if marker.is_none() && progress.is_none() && maximum.is_none() {
            continue;
        }
        let unlocked = marker.is_some_and(truthy_text)
            || matches!((progress, maximum), (Some(current), Some(maximum)) if maximum > 0.0 && current >= maximum);
        let unlocked_at = map_value_any_ci(
            values,
            &["UnlockTime", "unlocktime", "HaveAchievedTime", "Time"],
        )
        .and_then(timestamp_text);
        state.insert(
            section.to_lowercase(),
            UnlockState {
                unlocked,
                unlocked_at,
            },
        );
    }
    if let Some(flat) = sections.get("") {
        for (id, value) in flat {
            if !state.contains_key(&id.to_lowercase())
                && ["0", "1", "true", "false"]
                    .iter()
                    .any(|candidate| value.eq_ignore_ascii_case(candidate))
            {
                state.insert(
                    id.to_lowercase(),
                    UnlockState {
                        unlocked: truthy_text(value),
                        unlocked_at: None,
                    },
                );
            }
        }
    }
    state
}

fn provider_for(path: &Path) -> String {
    let lower = path.to_string_lossy().to_lowercase();
    if lower.contains("gse saves") {
        "GSE local".to_string()
    } else if lower.contains("goldberg") {
        "Goldberg local".to_string()
    } else if lower.contains("codex") {
        "CODEX local".to_string()
    } else if lower.contains("rune") {
        "RUNE local".to_string()
    } else if lower.contains("onlinefix") {
        "OnlineFix local".to_string()
    } else if lower.contains("smartsteamemu") {
        "SmartSteamEmu local".to_string()
    } else if lower.contains("empress") {
        "EMPRESS local".to_string()
    } else if lower.contains("usergamestatsschema_") {
        "Steam cache".to_string()
    } else if lower.contains("steam_settings") {
        "Steam settings".to_string()
    } else {
        "Local Steam".to_string()
    }
}

fn localized_value_ci(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    let value = value_ci(object, keys)?;
    if let Some(value) = value.as_str() {
        return Some(value.to_string());
    }
    let localized = value.as_object()?;
    value_ci(localized, &["english"])
        .and_then(Value::as_str)
        .map(String::from)
        .or_else(|| {
            localized
                .iter()
                .find(|(key, value)| !key.eq_ignore_ascii_case("token") && value.is_string())
                .and_then(|(_, value)| value.as_str())
                .map(String::from)
        })
        .or_else(|| {
            value_ci(localized, &["token"])
                .and_then(Value::as_str)
                .map(String::from)
        })
}

fn value_ci<'a>(object: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    object
        .iter()
        .find(|(key, _)| {
            keys.iter()
                .any(|candidate| key.eq_ignore_ascii_case(candidate))
        })
        .map(|(_, value)| value)
}

fn string_value_ci(object: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    let value = value_ci(object, keys)?;
    value
        .as_str()
        .map(String::from)
        .or_else(|| value.as_i64().map(|value| value.to_string()))
        .or_else(|| value.as_u64().map(|value| value.to_string()))
}

fn map_value_ci<'a, T>(object: &'a HashMap<String, T>, key: &str) -> Option<&'a T> {
    object
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value)
}

fn map_value_any_ci<'a>(object: &'a HashMap<String, String>, keys: &[&str]) -> Option<&'a str> {
    object
        .iter()
        .find(|(key, _)| {
            keys.iter()
                .any(|candidate| key.eq_ignore_ascii_case(candidate))
        })
        .map(|(_, value)| value.as_str())
}

fn section_ci<'a>(
    sections: &'a HashMap<String, HashMap<String, String>>,
    name: &str,
) -> Option<&'a HashMap<String, String>> {
    sections
        .iter()
        .find(|(section, _)| section.eq_ignore_ascii_case(name))
        .map(|(_, values)| values)
}

fn truthy(value: &Value) -> bool {
    value
        .as_bool()
        .or_else(|| value.as_i64().map(|value| value != 0))
        .or_else(|| value.as_u64().map(|value| value != 0))
        .or_else(|| value.as_str().map(truthy_text))
        .unwrap_or(false)
}

fn truthy_text(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "1" | "true" | "yes" | "on" | "0101"
    )
}

fn number_value(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
}

fn timestamp_ms(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_str().and_then(|value| value.parse::<i64>().ok()))
        .and_then(normalize_timestamp)
}

fn timestamp_text(value: &str) -> Option<i64> {
    value
        .trim()
        .parse::<i64>()
        .ok()
        .and_then(normalize_timestamp)
}

fn normalize_timestamp(value: i64) -> Option<i64> {
    if value <= 0 {
        None
    } else if value < 100_000_000_000 {
        value.checked_mul(1000)
    } else {
        Some(value)
    }
}

fn ini_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|raw| {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            return None;
        }
        let (candidate, value) = line.split_once('=')?;
        candidate
            .trim()
            .eq_ignore_ascii_case(key)
            .then(|| clean_ini_value(value))
    })
}

fn clean_ini_value(value: &str) -> String {
    value
        .split_once(';')
        .map(|(value, _)| value)
        .unwrap_or(value)
        .trim()
        .trim_matches(['\'', '"'])
        .to_string()
}

fn absolute_or_join(root: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value.replace('\\', std::path::MAIN_SEPARATOR_STR));
    if path.is_absolute() {
        path
    } else {
        root.join(path)
    }
}

fn humanize_api_name(value: &str) -> String {
    let words: Vec<String> = value
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                Some(first) => {
                    first.to_uppercase().collect::<String>() + &chars.as_str().to_lowercase()
                }
                None => String::new(),
            }
        })
        .collect();
    if words.is_empty() {
        value.to_string()
    } else {
        words.join(" ")
    }
}

fn find_steam_app_id(root: &Path) -> Option<u64> {
    walkdir::WalkDir::new(root)
        .max_depth(6)
        .follow_links(false)
        .into_iter()
        .flatten()
        .filter(|entry| entry.file_type().is_file())
        .find_map(|entry| {
            let matches = entry
                .path()
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("steam_appid.txt"));
            if !matches {
                return None;
            }
            std::fs::read_to_string(entry.path())
                .ok()?
                .trim()
                .parse()
                .ok()
        })
}

fn manifest_steam_app_id(manifest: &Value) -> Option<u64> {
    manifest
        .get("steamAppId")
        .and_then(Value::as_u64)
        .or_else(|| {
            manifest
                .pointer("/metadata/steamAppId")
                .and_then(Value::as_u64)
        })
}

fn manifest_image(manifest: &Value) -> Option<String> {
    manifest
        .pointer("/metadata/image")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("image").and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .map(String::from)
}

fn push_compatibility_prefix(prefixes: &mut Vec<PathBuf>, value: &str, append_pfx: bool) {
    if value.is_empty() {
        return;
    }
    let mut path = PathBuf::from(value);
    let already_pfx = path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("pfx"));
    if append_pfx && !already_pfx {
        path.push("pfx");
    }
    prefixes.push(path);
}

fn compatibility_prefixes(
    state: &AppState,
    appid: &str,
    envs: &[(String, String)],
) -> Vec<PathBuf> {
    let mut prefixes: Vec<PathBuf> = crate::library::scan_roots(state)
        .into_iter()
        .map(|root| root.join("compatdata").join(appid).join("pfx"))
        .collect();
    let config = state.settings.get(&format!("gameLinux:{appid}"));
    if let Some(value) = config.get("winePrefix").and_then(Value::as_str) {
        push_compatibility_prefix(&mut prefixes, value, false);
    }
    if let Some(value) = config.get("protonPrefix").and_then(Value::as_str) {
        push_compatibility_prefix(&mut prefixes, value, true);
    }
    if let Some(value) = state.settings.get_string("linuxProtonPrefix") {
        push_compatibility_prefix(&mut prefixes, &value, true);
    }
    for (key, value) in envs {
        if key.eq_ignore_ascii_case("WINEPREFIX") {
            push_compatibility_prefix(&mut prefixes, value, false);
        } else if key.eq_ignore_ascii_case("STEAM_COMPAT_DATA_PATH") {
            push_compatibility_prefix(&mut prefixes, value, true);
        }
    }
    dedupe_paths(&mut prefixes);
    prefixes
}

fn context_from_manifest(state: &AppState, manifest: &Value) -> Option<GameContext> {
    let appid = manifest.get("appid")?.as_str()?.to_string();
    let install_dir = manifest
        .get("installPath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| crate::library::game_files_dir(&crate::library::scan_roots(state), &appid))?;
    let exe_path = manifest
        .get("exePath")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let steam_app_id = manifest_steam_app_id(manifest)
        .or_else(|| {
            appid
                .strip_prefix("steam-")
                .and_then(|value| value.parse().ok())
        })
        .or_else(|| find_steam_app_id(&install_dir));
    let title = manifest
        .pointer("/metadata/name")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("name").and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .unwrap_or(&appid)
        .to_string();
    let prefixes = compatibility_prefixes(state, &appid, &[]);
    Some(GameContext {
        appid,
        steam_app_id,
        title,
        image: manifest_image(manifest),
        install_dir,
        exe_path,
        prefixes,
    })
}

pub(crate) fn launch_context(
    state: &AppState,
    appid: &str,
    exe_path: &str,
    game_name: Option<&str>,
    envs: &[(String, String)],
) -> GameContext {
    let manifest = crate::library::installed_manifest(state, appid).unwrap_or(Value::Null);
    let install_dir = crate::library::game_files_dir(&crate::library::scan_roots(state), appid)
        .or_else(|| Path::new(exe_path).parent().map(Path::to_path_buf))
        .unwrap_or_else(|| state.download_root());
    let steam_app_id = manifest_steam_app_id(&manifest)
        .or_else(|| {
            appid
                .strip_prefix("steam-")
                .and_then(|value| value.parse().ok())
        })
        .or_else(|| find_steam_app_id(&install_dir));
    let title = game_name
        .filter(|value| !value.is_empty())
        .map(String::from)
        .or_else(|| {
            manifest
                .pointer("/metadata/name")
                .and_then(Value::as_str)
                .map(String::from)
        })
        .or_else(|| {
            manifest
                .get("name")
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_else(|| appid.to_string());
    let prefixes = compatibility_prefixes(state, appid, envs);
    GameContext {
        appid: appid.to_string(),
        steam_app_id,
        title,
        image: manifest_image(&manifest),
        install_dir,
        exe_path: Some(PathBuf::from(exe_path)),
        prefixes,
    }
}

fn installed_contexts(state: &AppState) -> Vec<GameContext> {
    crate::library::installed_manifests(state)
        .iter()
        .filter_map(|manifest| context_from_manifest(state, manifest))
        .collect()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[tauri::command]
pub async fn achievements_list(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let contexts = installed_contexts(&state);
    let service = state.achievements.clone();
    let app_for_scan = app.clone();
    tauri::async_runtime::spawn_blocking(move || service.refresh(&app_for_scan, contexts))
        .await
        .map_err(|error| error.to_string())?;
    Ok(json!({ "ok": true, "games": state.achievements.list() }))
}

#[tauri::command(async)]
pub fn achievements_toast_hide(app: AppHandle) -> Value {
    if let Some(window) = app.get_webview_window("achievement-toast") {
        window.hide().ok();
    }
    json!({ "ok": true })
}

#[tauri::command(async)]
pub fn achievements_test_notification(app: AppHandle) -> Value {
    let payload = AchievementUnlock {
        appid: "achievement-test".to_string(),
        steam_app_id: None,
        game_title: "Union.Manifold".to_string(),
        achievement: LocalAchievement {
            api_name: "LOCAL_SIGNAL_FOUND".to_string(),
            display_name: "Local signal found".to_string(),
            description: "Achievement notifications are ready.".to_string(),
            hidden: false,
            icon: None,
            icon_locked: None,
            unlocked: true,
            unlocked_at: Some(now_ms()),
        },
    };
    present_toast(&app, &payload);
    json!({ "ok": true })
}

pub fn stop_all(state: &AppState) {
    state.achievements.stop_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_goldberg_catalog_and_json_and_ini_unlock_state() {
        let temp = tempfile::tempdir().unwrap();
        let images = temp.path().join("achievement_images");
        std::fs::create_dir_all(&images).unwrap();
        std::fs::write(images.join("winner.png"), b"image").unwrap();
        std::fs::write(images.join("winner_locked.png"), b"image").unwrap();

        let catalog = temp.path().join("achievements.json");
        std::fs::write(
            &catalog,
            serde_json::to_vec(&json!({
                "ACH_WIN": {
                    "displayName": { "english": "Winner" },
                    "description": { "english": "Finish the final chamber." },
                    "hidden": "1",
                    "icon": "winner.png",
                    "icongray": "winner_locked.png"
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let definitions = parse_definitions(&catalog).unwrap();
        assert_eq!(definitions.len(), 1);
        assert_eq!(definitions[0].api_name, "ACH_WIN");
        assert_eq!(definitions[0].display_name, "Winner");
        assert_eq!(definitions[0].description, "Finish the final chamber.");
        assert!(definitions[0].hidden);
        assert_eq!(
            definitions[0].icon.as_deref(),
            images.join("winner.png").to_str()
        );
        assert_eq!(
            definitions[0].icon_locked.as_deref(),
            images.join("winner_locked.png").to_str()
        );

        let json_state_path = temp.path().join("user_stats.json");
        std::fs::write(
            &json_state_path,
            serde_json::to_vec(&json!({
                "Achievements": {
                    "ACH_WIN": { "earned": true, "earned_time": 1_710_000_000 }
                }
            }))
            .unwrap(),
        )
        .unwrap();
        let json_state = parse_state(&json_state_path).unwrap();
        assert!(json_state["ach_win"].unlocked);
        assert_eq!(json_state["ach_win"].unlocked_at, Some(1_710_000_000_000));

        let ini_state_path = temp.path().join("achievements.ini");
        std::fs::write(
            &ini_state_path,
            "[Achievements]\nACH_WIN=true\n[AchievementsUnlockTimes]\nACH_WIN=1710000001\n",
        )
        .unwrap();
        let ini_state = parse_state(&ini_state_path).unwrap();
        assert!(ini_state["ach_win"].unlocked);
        assert_eq!(ini_state["ach_win"].unlocked_at, Some(1_710_000_001_000));
    }

    #[test]
    fn merge_keeps_unlock_history_monotonic_and_preserves_unknown_entries_without_state() {
        let previous = AchievementGame {
            appid: "steam-620".to_string(),
            steam_app_id: Some(620),
            title: "Portal 2".to_string(),
            image: None,
            provider: "Goldberg / GSE".to_string(),
            catalog_complete: true,
            updated_at: 10,
            achievements: vec![
                LocalAchievement {
                    api_name: "ACH_STAY".to_string(),
                    display_name: "Stay unlocked".to_string(),
                    description: String::new(),
                    hidden: false,
                    icon: None,
                    icon_locked: None,
                    unlocked: true,
                    unlocked_at: Some(123_000),
                },
                LocalAchievement {
                    api_name: "ACH_OLD_ONLY".to_string(),
                    display_name: "Old only".to_string(),
                    description: String::new(),
                    hidden: false,
                    icon: None,
                    icon_locked: None,
                    unlocked: true,
                    unlocked_at: Some(456_000),
                },
            ],
        };
        let current = AchievementGame {
            achievements: vec![
                LocalAchievement {
                    api_name: "ACH_STAY".to_string(),
                    display_name: "Stay unlocked".to_string(),
                    description: String::new(),
                    hidden: false,
                    icon: None,
                    icon_locked: None,
                    unlocked: false,
                    unlocked_at: None,
                },
                LocalAchievement {
                    api_name: "ACH_NEW".to_string(),
                    display_name: "New".to_string(),
                    description: String::new(),
                    hidden: false,
                    icon: None,
                    icon_locked: None,
                    unlocked: false,
                    unlocked_at: None,
                },
            ],
            ..previous.clone()
        };

        let with_state = merge_game(&previous, current.clone(), true);
        let stay = with_state
            .achievements
            .iter()
            .find(|achievement| achievement.api_name == "ACH_STAY")
            .unwrap();
        assert!(stay.unlocked);
        assert_eq!(stay.unlocked_at, Some(123_000));
        assert!(!with_state
            .achievements
            .iter()
            .any(|achievement| achievement.api_name == "ACH_OLD_ONLY"));

        let without_state = merge_game(&previous, current, false);
        assert!(without_state
            .achievements
            .iter()
            .any(|achievement| achievement.api_name == "ACH_OLD_ONLY"));
    }

    #[test]
    fn achievement_store_round_trips_atomically() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("achievements.json");
        let expected = AchievementGame {
            appid: "local-card-corner".to_string(),
            steam_app_id: None,
            title: "Card Corner".to_string(),
            image: None,
            provider: "CODEX".to_string(),
            catalog_complete: false,
            updated_at: 900,
            achievements: vec![LocalAchievement {
                api_name: "FIRST_WIN".to_string(),
                display_name: "First win".to_string(),
                description: "Win one round.".to_string(),
                hidden: false,
                icon: None,
                icon_locked: None,
                unlocked: true,
                unlocked_at: Some(800),
            }],
        };
        let service = AchievementService::new(file.clone());
        service.games.lock().push(expected.clone());
        service.persist();

        assert!(file.is_file());
        let loaded = AchievementService::new(file);
        assert_eq!(loaded.list(), vec![expected]);
    }
}
