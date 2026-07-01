use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, Result};

pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub asset_cache_dir: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &AppHandle) -> Result<Self> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|e| AppError::msg(format!("config dir: {e}")))?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::msg(format!("data dir: {e}")))?;
        let logs_dir = app
            .path()
            .app_log_dir()
            .map_err(|e| AppError::msg(format!("log dir: {e}")))?;
        let asset_cache_dir = data_dir.join("uc-asset");
        for d in [&config_dir, &data_dir, &logs_dir, &asset_cache_dir] {
            std::fs::create_dir_all(d).ok();
        }
        Ok(Self {
            config_dir,
            data_dir,
            logs_dir,
            asset_cache_dir,
        })
    }

    pub fn settings_file(&self) -> PathBuf {
        self.config_dir.join("settings.json")
    }

    pub fn log_file(&self) -> PathBuf {
        self.logs_dir.join("app-logs.txt")
    }

    pub fn downloads_state_file(&self) -> PathBuf {
        self.data_dir.join("downloads-state.json")
    }

    pub fn catalog_state_file(&self) -> PathBuf {
        self.data_dir.join("catalog-state.json")
    }
}

pub fn default_download_root(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join("installing")
}
