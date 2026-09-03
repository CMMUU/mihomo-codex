use std::ffi::{c_void, CStr};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr;

type CfRef = *const c_void;
type CfUrlRef = *const c_void;
type CfStringRef = *const c_void;
type SecStaticCodeRef = *mut c_void;
type SecRequirementRef = *mut c_void;
type OsStatus = i32;

const ERR_SUCCESS: OsStatus = 0;
const UTF8: u32 = 0x0800_0100;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: CfRef,
        buffer: *const u8,
        buffer_length: isize,
        is_directory: bool,
    ) -> CfUrlRef;
    fn CFStringGetLength(value: CfStringRef) -> isize;
    fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
    fn CFStringGetCString(
        value: CfStringRef,
        buffer: *mut i8,
        buffer_size: isize,
        encoding: u32,
    ) -> bool;
    fn CFRelease(value: CfRef);
}

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecStaticCodeCreateWithPath(
        path: CfUrlRef,
        flags: u32,
        code: *mut SecStaticCodeRef,
    ) -> OsStatus;
    fn SecStaticCodeCheckValidity(
        code: SecStaticCodeRef,
        flags: u32,
        requirement: SecRequirementRef,
    ) -> OsStatus;
    fn SecCodeCopyDesignatedRequirement(
        code: SecStaticCodeRef,
        flags: u32,
        requirement: *mut SecRequirementRef,
    ) -> OsStatus;
    fn SecRequirementCopyString(
        requirement: SecRequirementRef,
        flags: u32,
        text: *mut CfStringRef,
    ) -> OsStatus;
}

struct OwnedCf(CfRef);

impl Drop for OwnedCf {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

pub fn sibling_executable(name: &str) -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = current
        .parent()
        .ok_or_else(|| "当前可执行文件没有父目录".to_string())?;
    Ok(directory.join(name))
}

pub fn bundle_root() -> Result<PathBuf, String> {
    let current = std::env::current_exe().map_err(|error| error.to_string())?;
    let macos = current
        .parent()
        .ok_or_else(|| "当前可执行文件不在 app bundle 中".to_string())?;
    let contents = macos
        .parent()
        .ok_or_else(|| "当前可执行文件不在 Contents/MacOS 中".to_string())?;
    let bundle = contents
        .parent()
        .ok_or_else(|| "当前可执行文件不在 app bundle 中".to_string())?;
    if bundle.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("当前构建不是 macOS app bundle".to_string());
    }
    Ok(bundle.to_path_buf())
}

pub fn bundle_layout_ready() -> bool {
    let Ok(bundle) = bundle_root() else {
        return false;
    };
    let plist = bundle
        .join("Contents/Library/LaunchDaemons")
        .join(super::protocol::PLIST_NAME.to_string_lossy().as_ref());
    let helper = bundle
        .join("Contents/MacOS")
        .join(super::protocol::HELPER_BINARY_NAME);
    plist.is_file() && helper.is_file()
}

pub fn designated_requirement(path: &Path) -> Result<String, String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("拒绝非普通签名文件：{}", path.display()));
    }
    let canonical = path.canonicalize().map_err(|error| error.to_string())?;
    let bytes = canonical.as_os_str().as_bytes();
    unsafe {
        let url = CFURLCreateFromFileSystemRepresentation(
            ptr::null(),
            bytes.as_ptr(),
            bytes.len() as isize,
            false,
        );
        if url.is_null() {
            return Err("创建签名校验 URL 失败".to_string());
        }
        let _url = OwnedCf(url);
        let mut code: SecStaticCodeRef = ptr::null_mut();
        let status = SecStaticCodeCreateWithPath(url, 0, &mut code);
        if status != ERR_SUCCESS || code.is_null() {
            return Err(format!("读取代码签名失败：OSStatus {status}"));
        }
        let _code = OwnedCf(code.cast());
        let status = SecStaticCodeCheckValidity(code, 0, ptr::null_mut());
        if status != ERR_SUCCESS {
            return Err(format!("代码签名无效：OSStatus {status}"));
        }
        let mut requirement: SecRequirementRef = ptr::null_mut();
        let status = SecCodeCopyDesignatedRequirement(code, 0, &mut requirement);
        if status != ERR_SUCCESS || requirement.is_null() {
            return Err(format!("读取指定要求失败：OSStatus {status}"));
        }
        let _requirement = OwnedCf(requirement.cast());
        let mut text: CfStringRef = ptr::null();
        let status = SecRequirementCopyString(requirement, 0, &mut text);
        if status != ERR_SUCCESS || text.is_null() {
            return Err(format!("转换指定要求失败：OSStatus {status}"));
        }
        let _text = OwnedCf(text);
        cf_string(text)
    }
}

pub fn validate(path: &Path) -> Result<(), String> {
    designated_requirement(path).map(|_| ())
}

unsafe fn cf_string(value: CfStringRef) -> Result<String, String> {
    let length = CFStringGetLength(value);
    let capacity = CFStringGetMaximumSizeForEncoding(length, UTF8) + 1;
    if capacity <= 1 {
        return Err("签名要求字符串为空".to_string());
    }
    let mut buffer = vec![0_i8; capacity as usize];
    if !CFStringGetCString(value, buffer.as_mut_ptr(), capacity, UTF8) {
        return Err("读取签名要求字符串失败".to_string());
    }
    Ok(CStr::from_ptr(buffer.as_ptr())
        .to_string_lossy()
        .into_owned())
}
