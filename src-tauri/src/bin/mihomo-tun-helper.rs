#[cfg(target_os = "macos")]
fn main() {
    mihomo_codex_lib::tun_service::daemon::run()
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("mihomo-tun-helper is only available on macOS");
    std::process::exit(1);
}
