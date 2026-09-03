use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProtocolState {
    pub enabled: bool,
    pub server: String,
    pub port: u16,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MacServiceProxyState {
    pub service: String,
    pub http: ProxyProtocolState,
    pub https: ProxyProtocolState,
    pub socks: ProxyProtocolState,
    pub bypass_domains: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "platform", rename_all = "snake_case")]
pub enum SystemProxySnapshot {
    Macos {
        services: Vec<MacServiceProxyState>,
    },
    Linux {
        values: BTreeMap<String, String>,
    },
    Windows {
        proxy_enable: u32,
        proxy_server: Option<String>,
        proxy_override: Option<String>,
        auto_config_url: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemProxyStatus {
    pub active: bool,
    pub snapshot_path: Option<String>,
    pub platform: String,
}

#[cfg(target_os = "macos")]
#[derive(Debug, Clone, PartialEq, Eq)]
struct MacNetworkServiceEntry {
    service: String,
    device: String,
    enabled: bool,
}

pub fn enable_system_proxy(app: &AppHandle, port: u16) -> AppResult<SystemProxyStatus> {
    let snapshot_path = snapshot_path(app)?;
    if !snapshot_path.exists() {
        let snapshot = capture_system_proxy()?;
        write_snapshot(&snapshot_path, &snapshot)?;
    }
    apply_system_proxy(port)?;
    Ok(status(app))
}

pub fn verify_system_proxy(port: u16) -> AppResult<()> {
    verify_system_proxy_inner(port)
}

pub fn restore_system_proxy(app: &AppHandle) -> AppResult<SystemProxyStatus> {
    let path = snapshot_path(app)?;
    if !path.exists() {
        return Ok(status(app));
    }
    let snapshot: SystemProxySnapshot = serde_json::from_slice(&fs::read(&path)?)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    restore_snapshot(&snapshot)?;
    fs::remove_file(path)?;
    Ok(status(app))
}

pub fn status(app: &AppHandle) -> SystemProxyStatus {
    let path = snapshot_path(app).ok();
    SystemProxyStatus {
        active: path.as_ref().is_some_and(|value| value.exists()),
        snapshot_path: path.map(|value| value.display().to_string()),
        platform: std::env::consts::OS.to_string(),
    }
}

fn snapshot_path(app: &AppHandle) -> AppResult<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Io(error.to_string()))?
        .join("runtime");
    fs::create_dir_all(&directory)?;
    Ok(directory.join("system-proxy-snapshot.json"))
}

fn write_snapshot(path: &Path, snapshot: &SystemProxySnapshot) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(snapshot)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    fs::write(path, bytes)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn capture_system_proxy() -> AppResult<SystemProxySnapshot> {
    let services = mac_active_physical_network_services()?
        .into_iter()
        .map(|service| {
            Ok(MacServiceProxyState {
                http: mac_get_proxy(&service, "-getwebproxy")?,
                https: mac_get_proxy(&service, "-getsecurewebproxy")?,
                socks: mac_get_proxy(&service, "-getsocksfirewallproxy")?,
                bypass_domains: mac_get_bypass(&service)?,
                service,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(SystemProxySnapshot::Macos { services })
}

#[cfg(target_os = "macos")]
fn apply_system_proxy(port: u16) -> AppResult<()> {
    let services = mac_active_physical_network_services()?;
    if services.is_empty() {
        return Err(AppError::Platform(
            "没有检测到可设置代理的活动物理网络服务".to_string(),
        ));
    }
    for service in services {
        for command in [
            "-setwebproxy",
            "-setsecurewebproxy",
            "-setsocksfirewallproxy",
        ] {
            run_command(
                "networksetup",
                &[command, &service, "127.0.0.1", &port.to_string()],
            )?;
        }
        for command in [
            "-setwebproxystate",
            "-setsecurewebproxystate",
            "-setsocksfirewallproxystate",
        ] {
            run_command("networksetup", &[command, &service, "on"])?;
        }
        let mut bypass = mac_get_bypass(&service)?;
        for required in ["localhost", "127.0.0.1", "::1", "*.local"] {
            if !bypass.iter().any(|value| value == required) {
                bypass.push(required.to_string());
            }
        }
        let mut args = vec!["-setproxybypassdomains", service.as_str()];
        args.extend(bypass.iter().map(String::as_str));
        run_command("networksetup", &args)?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn verify_system_proxy_inner(port: u16) -> AppResult<()> {
    let services = mac_active_physical_network_services()?;
    if services.is_empty() {
        return Err(AppError::Platform(
            "没有检测到可验证的活动物理网络服务".to_string(),
        ));
    }
    for service in services {
        for command in [
            "-getwebproxy",
            "-getsecurewebproxy",
            "-getsocksfirewallproxy",
        ] {
            let state = mac_get_proxy(&service, command)?;
            if !state.enabled || state.server != "127.0.0.1" || state.port != port {
                return Err(AppError::Platform(format!(
                    "网络服务 {service} 的系统代理未正确应用"
                )));
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn restore_snapshot(snapshot: &SystemProxySnapshot) -> AppResult<()> {
    let SystemProxySnapshot::Macos { services } = snapshot else {
        return Err(AppError::Platform("系统代理快照平台不匹配".to_string()));
    };
    for service in services {
        mac_set_proxy(
            &service.service,
            "-setwebproxy",
            "-setwebproxystate",
            &service.http,
        )?;
        mac_set_proxy(
            &service.service,
            "-setsecurewebproxy",
            "-setsecurewebproxystate",
            &service.https,
        )?;
        mac_set_proxy(
            &service.service,
            "-setsocksfirewallproxy",
            "-setsocksfirewallproxystate",
            &service.socks,
        )?;
        if service.bypass_domains.is_empty() {
            run_command(
                "networksetup",
                &["-setproxybypassdomains", &service.service, "Empty"],
            )?;
        } else {
            let mut args = vec!["-setproxybypassdomains", service.service.as_str()];
            args.extend(service.bypass_domains.iter().map(String::as_str));
            run_command("networksetup", &args)?;
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn mac_active_physical_network_services() -> AppResult<Vec<String>> {
    let output = run_command("networksetup", &["-listnetworkserviceorder"])?;
    let physical = parse_mac_network_service_order(&output)
        .into_iter()
        .filter(|entry| entry.enabled && !entry.device.is_empty())
        .collect::<Vec<_>>();
    let default_route_device = run_command("route", &["-n", "get", "default"])
        .ok()
        .and_then(|output| parse_mac_default_route_device(&output));
    if let Some(device) = default_route_device {
        let routed = physical
            .iter()
            .filter(|entry| entry.device == device)
            .map(|entry| entry.service.clone())
            .collect::<Vec<_>>();
        if !routed.is_empty() {
            return Ok(routed);
        }
    }
    let mut active = Vec::new();
    for entry in &physical {
        let info = run_command("networksetup", &["-getinfo", &entry.service])?;
        if mac_service_has_address(&info) {
            active.push(entry.service.clone());
        }
    }
    if active.is_empty() {
        Ok(physical.into_iter().map(|entry| entry.service).collect())
    } else {
        Ok(active)
    }
}

#[cfg(target_os = "macos")]
fn parse_mac_default_route_device(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        (key.trim() == "interface")
            .then(|| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

#[cfg(target_os = "macos")]
fn parse_mac_network_service_order(output: &str) -> Vec<MacNetworkServiceEntry> {
    let mut result = Vec::new();
    let mut pending: Option<(String, bool)> = None;
    for line in output.lines().map(str::trim) {
        if line.starts_with('(') && !line.starts_with("(Hardware Port:") {
            let Some((_, service)) = line.split_once(')') else {
                continue;
            };
            let service = service.trim();
            let enabled = !service.starts_with('*');
            pending = Some((service.trim_start_matches('*').trim().to_string(), enabled));
            continue;
        }
        if !line.starts_with("(Hardware Port:") {
            continue;
        }
        let Some((service, enabled)) = pending.take() else {
            continue;
        };
        let device = line
            .split_once(", Device:")
            .map(|(_, value)| value.trim().trim_end_matches(')').trim().to_string())
            .unwrap_or_default();
        result.push(MacNetworkServiceEntry {
            service,
            device,
            enabled,
        });
    }
    result
}

#[cfg(target_os = "macos")]
fn mac_service_has_address(output: &str) -> bool {
    output.lines().any(|line| {
        let Some((key, value)) = line.split_once(':') else {
            return false;
        };
        let value = value.trim();
        match key.trim() {
            "IP address" => {
                !value.is_empty()
                    && !value.eq_ignore_ascii_case("none")
                    && !value.starts_with("169.254.")
            }
            "IPv6 IP address" => {
                !value.is_empty()
                    && !value.eq_ignore_ascii_case("none")
                    && !value.to_ascii_lowercase().starts_with("fe80:")
            }
            _ => false,
        }
    })
}

#[cfg(target_os = "macos")]
fn mac_get_proxy(service: &str, command: &str) -> AppResult<ProxyProtocolState> {
    let output = run_command("networksetup", &[command, service])?;
    Ok(parse_mac_proxy(&output))
}

#[cfg(target_os = "macos")]
fn parse_mac_proxy(output: &str) -> ProxyProtocolState {
    let mut state = ProxyProtocolState::default();
    for line in output.lines() {
        let (key, value) = line.split_once(':').unwrap_or((line, ""));
        match key.trim() {
            "Enabled" => state.enabled = value.trim().eq_ignore_ascii_case("yes"),
            "Server" => state.server = value.trim().to_string(),
            "Port" => state.port = value.trim().parse().unwrap_or(0),
            _ => {}
        }
    }
    state
}

#[cfg(target_os = "macos")]
fn mac_get_bypass(service: &str) -> AppResult<Vec<String>> {
    let output = run_command("networksetup", &["-getproxybypassdomains", service])?;
    if output.contains("There aren't any") {
        return Ok(Vec::new());
    }
    Ok(output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

#[cfg(target_os = "macos")]
fn mac_set_proxy(
    service: &str,
    set_command: &str,
    state_command: &str,
    state: &ProxyProtocolState,
) -> AppResult<()> {
    if !state.server.is_empty() && state.port > 0 {
        run_command(
            "networksetup",
            &[set_command, service, &state.server, &state.port.to_string()],
        )?;
    }
    run_command(
        "networksetup",
        &[
            state_command,
            service,
            if state.enabled { "on" } else { "off" },
        ],
    )?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn capture_system_proxy() -> AppResult<SystemProxySnapshot> {
    let mut values = BTreeMap::new();
    for (schema, key) in linux_proxy_keys() {
        let value = run_command("gsettings", &["get", schema, key])?;
        values.insert(format!("{schema}|{key}"), value.trim().to_string());
    }
    Ok(SystemProxySnapshot::Linux { values })
}

#[cfg(target_os = "linux")]
fn apply_system_proxy(port: u16) -> AppResult<()> {
    linux_set("org.gnome.system.proxy", "mode", "'manual'")?;
    linux_set("org.gnome.system.proxy.http", "host", "'127.0.0.1'")?;
    linux_set("org.gnome.system.proxy.http", "port", &port.to_string())?;
    linux_set("org.gnome.system.proxy.https", "host", "'127.0.0.1'")?;
    linux_set("org.gnome.system.proxy.https", "port", &port.to_string())?;
    linux_set("org.gnome.system.proxy.socks", "host", "'127.0.0.1'")?;
    linux_set("org.gnome.system.proxy.socks", "port", &port.to_string())?;
    linux_set(
        "org.gnome.system.proxy",
        "ignore-hosts",
        "['localhost', '127.0.0.0/8', '::1']",
    )
}

#[cfg(target_os = "linux")]
fn verify_system_proxy_inner(port: u16) -> AppResult<()> {
    let mode = run_command("gsettings", &["get", "org.gnome.system.proxy", "mode"])?;
    let http = run_command("gsettings", &["get", "org.gnome.system.proxy.http", "port"])?;
    let https = run_command(
        "gsettings",
        &["get", "org.gnome.system.proxy.https", "port"],
    )?;
    let socks = run_command(
        "gsettings",
        &["get", "org.gnome.system.proxy.socks", "port"],
    )?;
    if !mode.contains("manual")
        || http.trim() != port.to_string()
        || https.trim() != port.to_string()
        || socks.trim() != port.to_string()
    {
        return Err(AppError::Platform("GNOME 系统代理未正确应用".to_string()));
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn restore_snapshot(snapshot: &SystemProxySnapshot) -> AppResult<()> {
    let SystemProxySnapshot::Linux { values } = snapshot else {
        return Err(AppError::Platform("系统代理快照平台不匹配".to_string()));
    };
    for (compound, value) in values {
        let (schema, key) = compound
            .split_once('|')
            .ok_or_else(|| AppError::Platform("无效 Linux 代理快照".to_string()))?;
        linux_set(schema, key, value)?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_proxy_keys() -> Vec<(&'static str, &'static str)> {
    vec![
        ("org.gnome.system.proxy", "mode"),
        ("org.gnome.system.proxy", "ignore-hosts"),
        ("org.gnome.system.proxy.http", "host"),
        ("org.gnome.system.proxy.http", "port"),
        ("org.gnome.system.proxy.https", "host"),
        ("org.gnome.system.proxy.https", "port"),
        ("org.gnome.system.proxy.socks", "host"),
        ("org.gnome.system.proxy.socks", "port"),
    ]
}

#[cfg(target_os = "linux")]
fn linux_set(schema: &str, key: &str, value: &str) -> AppResult<()> {
    run_command("gsettings", &["set", schema, key, value]).map(|_| ())
}

#[cfg(windows)]
fn capture_system_proxy() -> AppResult<SystemProxySnapshot> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .map_err(|error| AppError::Platform(error.to_string()))?;
    Ok(SystemProxySnapshot::Windows {
        proxy_enable: key.get_value("ProxyEnable").unwrap_or(0),
        proxy_server: key.get_value("ProxyServer").ok(),
        proxy_override: key.get_value("ProxyOverride").ok(),
        auto_config_url: key.get_value("AutoConfigURL").ok(),
    })
}

#[cfg(windows)]
fn apply_system_proxy(port: u16) -> AppResult<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            winreg::enums::KEY_SET_VALUE,
        )
        .map_err(|error| AppError::Platform(error.to_string()))?;
    key.set_value("ProxyEnable", &1u32)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    key.set_value(
        "ProxyServer",
        &format!("http=127.0.0.1:{port};https=127.0.0.1:{port};socks=127.0.0.1:{port}"),
    )
    .map_err(|error| AppError::Platform(error.to_string()))?;
    key.set_value("ProxyOverride", &"<local>;localhost;127.*;[::1]")
        .map_err(|error| AppError::Platform(error.to_string()))?;
    windows_refresh_proxy()
}

#[cfg(windows)]
fn verify_system_proxy_inner(port: u16) -> AppResult<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .map_err(|error| AppError::Platform(error.to_string()))?;
    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    let server: String = key.get_value("ProxyServer").unwrap_or_default();
    if enabled != 1 || !server.contains(&format!("127.0.0.1:{port}")) {
        return Err(AppError::Platform("Windows 系统代理未正确应用".to_string()));
    }
    Ok(())
}

#[cfg(windows)]
fn restore_snapshot(snapshot: &SystemProxySnapshot) -> AppResult<()> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let SystemProxySnapshot::Windows {
        proxy_enable,
        proxy_server,
        proxy_override,
        auto_config_url,
    } = snapshot
    else {
        return Err(AppError::Platform("系统代理快照平台不匹配".to_string()));
    };
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
            winreg::enums::KEY_SET_VALUE,
        )
        .map_err(|error| AppError::Platform(error.to_string()))?;
    key.set_value("ProxyEnable", proxy_enable)
        .map_err(|error| AppError::Platform(error.to_string()))?;
    windows_restore_string(&key, "ProxyServer", proxy_server.as_deref())?;
    windows_restore_string(&key, "ProxyOverride", proxy_override.as_deref())?;
    windows_restore_string(&key, "AutoConfigURL", auto_config_url.as_deref())?;
    windows_refresh_proxy()
}

#[cfg(windows)]
fn windows_restore_string(key: &winreg::RegKey, name: &str, value: Option<&str>) -> AppResult<()> {
    match value {
        Some(value) => key
            .set_value(name, &value)
            .map_err(|error| AppError::Platform(error.to_string())),
        None => {
            let _ = key.delete_value(name);
            Ok(())
        }
    }
}

#[cfg(windows)]
fn windows_refresh_proxy() -> AppResult<()> {
    use windows_sys::Win32::Networking::WinInet::{
        InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
    };
    unsafe {
        let changed = InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_SETTINGS_CHANGED,
            std::ptr::null_mut(),
            0,
        );
        let refreshed = InternetSetOptionW(
            std::ptr::null_mut(),
            INTERNET_OPTION_REFRESH,
            std::ptr::null_mut(),
            0,
        );
        if changed == 0 || refreshed == 0 {
            return Err(AppError::Platform(
                std::io::Error::last_os_error().to_string(),
            ));
        }
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn run_command(program: &str, args: &[&str]) -> AppResult<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| AppError::Platform(format!("{program}: {error}")))?;
    if !output.status.success() {
        return Err(AppError::Platform(format!(
            "{} {}",
            program,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{
        mac_service_has_address, parse_mac_default_route_device, parse_mac_network_service_order,
        parse_mac_proxy,
    };

    #[test]
    fn parses_networksetup_proxy_state() {
        let state = parse_mac_proxy("Enabled: Yes\nServer: 127.0.0.1\nPort: 7895\n");
        assert!(state.enabled);
        assert_eq!(state.server, "127.0.0.1");
        assert_eq!(state.port, 7895);
    }

    #[test]
    fn identifies_physical_and_virtual_network_services() {
        let entries = parse_mac_network_service_order(
            "An asterisk (*) denotes that a network service is disabled.\n\
             (1) Wi-Fi\n\
             (Hardware Port: Wi-Fi, Device: en0)\n\n\
             (2) Shadowrocket\n\
             (Hardware Port: com.example.vpn, Device: )\n\n\
             (3) *Thunderbolt Bridge\n\
             (Hardware Port: Thunderbolt Bridge, Device: bridge0)\n",
        );
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].service, "Wi-Fi");
        assert_eq!(entries[0].device, "en0");
        assert!(entries[0].enabled);
        assert!(entries[1].device.is_empty());
        assert!(!entries[2].enabled);
    }

    #[test]
    fn detects_configured_network_addresses() {
        assert!(mac_service_has_address(
            "IP address: 192.168.1.10\nIPv6 IP address: none\n"
        ));
        assert!(!mac_service_has_address(
            "IPv6 IP address: none\nRouter: none\n"
        ));
        assert!(!mac_service_has_address(
            "IP address: none\nIPv6 IP address: fe80::1234\n"
        ));
    }

    #[test]
    fn parses_default_route_interface() {
        let output = "   route to: default\ninterface: en0\n      flags: <UP,GATEWAY>\n";
        assert_eq!(
            parse_mac_default_route_device(output).as_deref(),
            Some("en0")
        );
    }
}
