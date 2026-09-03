use super::client;
use super::codesign;
use super::protocol::{PLIST_NAME, PROTOCOL_VERSION};
use super::{TunHelperState, TunHelperStatus};
use objc2::msg_send;
use objc2::runtime::{AnyClass, AnyObject};
use std::ffi::{c_char, CStr};
use std::ptr;

const STATUS_NOT_REGISTERED: isize = 0;
const STATUS_ENABLED: isize = 1;
const STATUS_REQUIRES_APPROVAL: isize = 2;
const STATUS_NOT_FOUND: isize = 3;

pub fn status() -> TunHelperStatus {
    objc2::rc::autoreleasepool(|_| {
        if !codesign::bundle_layout_ready() {
            return TunHelperStatus::unsupported("当前构建未包含已签名的 macOS TUN Helper");
        }
        let Some(class) = service_class() else {
            return TunHelperStatus::unsupported("TUN Helper 需要 macOS 13 或更高版本");
        };
        unsafe {
            let service = daemon_service(class);
            if service.is_null() {
                return not_installed();
            }
            let raw: isize = msg_send![service, status];
            match raw {
                STATUS_ENABLED => enabled_status(),
                STATUS_REQUIRES_APPROVAL => TunHelperStatus {
                    supported: true,
                    state: TunHelperState::RequiresApproval,
                    message: "需要在系统设置的登录项与扩展中批准 TUN Helper".to_string(),
                    protocol_version: PROTOCOL_VERSION,
                    runtime_running: false,
                    runtime_pid: None,
                    runtime_version: None,
                    last_error: None,
                },
                STATUS_NOT_REGISTERED | STATUS_NOT_FOUND => not_installed(),
                _ => not_installed(),
            }
        }
    })
}

pub fn register() -> Result<TunHelperStatus, String> {
    client::reset_probe_gate();
    objc2::rc::autoreleasepool(|_| {
        let Some(class) = service_class() else {
            return Err("TUN Helper 需要 macOS 13 或更高版本".to_string());
        };
        if !codesign::bundle_layout_ready() {
            return Err("当前 app bundle 缺少 TUN Helper 或 LaunchDaemon 配置".to_string());
        }
        unsafe {
            let service = daemon_service(class);
            if service.is_null() {
                return Err("创建 SMAppService 失败".to_string());
            }
            let mut error: *mut AnyObject = ptr::null_mut();
            let ok: bool = msg_send![service, registerAndReturnError: &mut error];
            if !ok {
                return Err(ns_error_message(error));
            }
        }
        Ok(status())
    })
}

pub fn unregister() -> Result<(), String> {
    client::reset_probe_gate();
    objc2::rc::autoreleasepool(|_| {
        let Some(class) = service_class() else {
            return Err("TUN Helper 需要 macOS 13 或更高版本".to_string());
        };
        unsafe {
            let service = daemon_service(class);
            if service.is_null() {
                return Ok(());
            }
            let mut error: *mut AnyObject = ptr::null_mut();
            let ok: bool = msg_send![service, unregisterAndReturnError: &mut error];
            if !ok {
                return Err(ns_error_message(error));
            }
        }
        Ok(())
    })
}

pub fn repair() -> Result<TunHelperStatus, String> {
    let _ = unregister();
    register()
}

pub fn open_approval_settings() -> Result<(), String> {
    objc2::rc::autoreleasepool(|_| {
        let Some(class) = service_class() else {
            return Err("TUN Helper 需要 macOS 13 或更高版本".to_string());
        };
        unsafe {
            let _: () = msg_send![class, openSystemSettingsLoginItems];
        }
        Ok(())
    })
}

fn enabled_status() -> TunHelperStatus {
    match client::status_probe() {
        Ok(snapshot) if snapshot.protocol_version == PROTOCOL_VERSION => TunHelperStatus {
            supported: true,
            state: TunHelperState::Ready,
            message: if snapshot.running {
                "TUN Helper 已授权，特权内核正在运行".to_string()
            } else {
                "TUN Helper 已授权并可用".to_string()
            },
            protocol_version: snapshot.protocol_version,
            runtime_running: snapshot.running,
            runtime_pid: snapshot.pid,
            runtime_version: snapshot.version,
            last_error: snapshot.last_error,
        },
        Ok(snapshot) => TunHelperStatus {
            supported: true,
            state: TunHelperState::Outdated,
            message: "TUN Helper 协议版本不匹配，需要修复".to_string(),
            protocol_version: snapshot.protocol_version,
            runtime_running: snapshot.running,
            runtime_pid: snapshot.pid,
            runtime_version: snapshot.version,
            last_error: snapshot.last_error,
        },
        Err(error) => TunHelperStatus {
            supported: true,
            state: TunHelperState::Unreachable,
            message: format!("TUN Helper 已注册但连接失败：{error}"),
            protocol_version: PROTOCOL_VERSION,
            runtime_running: false,
            runtime_pid: None,
            runtime_version: None,
            last_error: Some(error),
        },
    }
}

fn not_installed() -> TunHelperStatus {
    TunHelperStatus {
        supported: true,
        state: TunHelperState::NotInstalled,
        message: "首次使用 TUN 需要安装最小权限 Helper".to_string(),
        protocol_version: PROTOCOL_VERSION,
        runtime_running: false,
        runtime_pid: None,
        runtime_version: None,
        last_error: None,
    }
}

fn service_class() -> Option<&'static AnyClass> {
    AnyClass::get(c"SMAppService")
}

unsafe fn daemon_service(class: &AnyClass) -> *mut AnyObject {
    let name: *mut AnyObject = msg_send![
        ns_string_class(),
        stringWithUTF8String: PLIST_NAME.as_ptr()
    ];
    msg_send![class, daemonServiceWithPlistName: name]
}

fn ns_string_class() -> &'static AnyClass {
    AnyClass::get(c"NSString").expect("NSString must exist on macOS")
}

unsafe fn ns_error_message(error: *mut AnyObject) -> String {
    if error.is_null() {
        return "未知的 ServiceManagement 错误".to_string();
    }
    let description: *mut AnyObject = msg_send![error, localizedDescription];
    if description.is_null() {
        return "未知的 ServiceManagement 错误".to_string();
    }
    let utf8: *const c_char = msg_send![description, UTF8String];
    if utf8.is_null() {
        return "未知的 ServiceManagement 错误".to_string();
    }
    CStr::from_ptr(utf8).to_string_lossy().into_owned()
}
