use std::sync::Arc;

use crate::achievements::AchievementService;
use crate::downloads::DownloadEngine;
use crate::paths::AppPaths;
use crate::settings::SettingsStore;
use crate::sources::Registry;

pub struct AppState {
    pub paths: Arc<AppPaths>,
    pub settings: Arc<SettingsStore>,
    pub sources: Arc<Registry>,
    pub downloads: Arc<DownloadEngine>,
    pub achievements: Arc<AchievementService>,
}

impl AppState {
    pub fn download_root(&self) -> std::path::PathBuf {
        self.settings
            .get_string("downloadPath")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| crate::paths::default_download_root(&self.paths.data_dir))
    }
}
