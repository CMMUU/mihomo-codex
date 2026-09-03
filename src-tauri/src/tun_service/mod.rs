use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "macos")]
mod admin;
#[cfg(target_os = "macos")]
mod client;
#[cfg(target_os = "macos")]
mod codesign;
#[cfg(target_os = "macos")]
pub mod daemon;
#[cfg(target_os = "macos")]
mod protocol;
#[cfg(target_os = "macos")]
mod xpc;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TunHelperState {
    Unsupported,
    NotInstalled,
    RequiresApproval,
    Ready,
    Outdated,
    Unreachable,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TunHelperStatus {
    pub supported: bool,
    pub state: TunHelperState,
    pub message: String,
    pub protocol_version: u32,
    pub runtime_running: bool,
    pub runtime_pid: Option<u32>,
    pub runtime_version: Option<String>,
    pub last_error: Option<String>,
}

impl TunHelperStatus {
    pub fn unsupported(message: impl Into<String>) -> Self {
        Self {
            supported: false,
            state: TunHelperState::Unsupported,
            message: message.into(),
            protocol_version: 0,
            runtime_running: false,
            runtime_pid: None,
            runtime_version: None,
            last_error: None,
        }
    }

    pub fn ready(&self) -> bool {
        self.state == TunHelperState::Ready
    }
}

#[derive(Debug, Clone)]
pub struct TunRuntimeStart {
    pub pid: u32,
    pub version: Option<String>,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TunRuntimeLog {
    pub timestamp: DateTime<Utc>,
    pub level: String,
    pub source: String,
    pub message: String,
}

pub fn status() -> TunHelperStatus {
    #[cfg(target_os = "macos")]
    {
        admin::status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        TunHelperStatus::unsupported(format!("{} TUN Helper 尚未安装", std::env::consts::OS))
    }
}

pub fn install() -> AppResult<TunHelperStatus> {
    #[cfg(target_os = "macos")]
    {
        admin::register().map_err(AppError::Platform)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Platform(format!(
            "{} TUN Helper 尚未实现",
            std::env::consts::OS
        )))
    }
}

pub fn repair() -> AppResult<TunHelperStatus> {
    #[cfg(target_os = "macos")]
    {
        admin::repair().map_err(AppError::Platform)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Platform(format!(
            "{} TUN Helper 尚未实现",
            std::env::consts::OS
        )))
    }
}

pub fn uninstall() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        admin::unregister().map_err(AppError::Platform)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Platform(format!(
            "{} TUN Helper 尚未实现",
            std::env::consts::OS
        )))
    }
}

pub fn open_approval_settings() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        admin::open_approval_settings().map_err(AppError::Platform)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Platform(
            "当前平台没有对应的授权设置页".to_string(),
        ))
    }
}

pub fn prepare(source: &str) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        client::prepare(source).map_err(AppError::Runtime)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = source;
        Err(AppError::Platform(format!(
            "{} TUN Helper 尚未实现",
            std::env::consts::OS
        )))
    }
}

pub fn start(source: &str, lease: &str) -> AppResult<TunRuntimeStart> {
    #[cfg(target_os = "macos")]
    {
        client::start(source, lease).map_err(AppError::Runtime)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (source, lease);
        Err(AppError::Platform(format!(
            "{} TUN Helper 尚未实现",
            std::env::consts::OS
        )))
    }
}

pub fn heartbeat(lease: &str) -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        client::heartbeat(lease).map_err(AppError::Runtime)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = lease;
        Err(AppError::Platform("当前平台没有 TUN Helper".to_string()))
    }
}

pub fn stop() -> AppResult<()> {
    #[cfg(target_os = "macos")]
    {
        client::stop().map_err(AppError::Runtime)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err(AppError::Platform("当前平台没有 TUN Helper".to_string()))
    }
}

pub fn logs(limit: usize) -> Vec<TunRuntimeLog> {
    #[cfg(target_os = "macos")]
    {
        client::logs(limit).unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = limit;
        Vec::new()
    }
}
