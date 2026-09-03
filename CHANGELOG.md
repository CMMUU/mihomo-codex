# Changelog

## 0.3.2 - 2026-09-03

- Add immediately saved appearance choices: neutral Light, neutral Dark, Deep Purple, and System (Light/Dark only).
- Repair the historical light/dark CSS overrides and synchronize the native application appearance with the saved preference.
- Add a theme-only settings command that preserves proxy ports, subscriptions, autostart preferences and controller credentials.
- Restore the previous appearance when persistence fails and prevent concurrent theme writes.
- Add theme state-machine tests, backend persistence tests, and an isolated browser preview fixture for visual regression checks without proxy takeover.
- Fix unused Unix-only permission parameters and command helpers in Windows strict Clippy checks without changing runtime behavior.

## 0.3.1 - 2026-09-03

Includes the previously unreleased changes from 2026-08-23 and the following rename:

- Rename the app, project, package, window, tray and main executable to `mihomo-codex`.
- Retain the original bundle identifier, application-data path and TUN helper service identity for upgrade compatibility.
- Update the helper peer-binary lookup to the renamed main executable.
- Add a branding and compatibility-identity regression check.
- Correct the bundled Mihomo v1.19.30 license from the historical MIT mislabel to the upstream GPL v3 text, pin its hash, and include the matching upstream source with the first GitHub release.

### Added

- A shared application-status App Shell header rendered above the page scroller on every route.
- Global System Proxy and TUN controls in the application-status header, synchronized with runtime and operating-system state.
- Per-subscription OpenAI failover generation and regeneration actions, with global single-job progress, cancellation and failure feedback.
- Standby-profile OpenAI failover generation that writes a validated new revision without activating the profile or reloading the running core.
- OS-global real-time upload and download monitoring independent of Mihomo, Manual, System Proxy or TUN state.
- Figma component `Global Traffic / Sidebar` with runtime status on the left and vertically stacked upload/download rates on the right.
- Figma component `Global Traffic / Menu Bar` and a compact monochrome macOS template status item with antialiased M, arrows and upload/download text.
- Semibold menu-bar rate values with light glyph emboldening for improved recognition at native status-item scale.
- `showGlobalTraffic` setting, enabled by default and persisted through settings schema v3.
- Cross-platform network counter sampling through `sysinfo 0.39.6`, with one-second normalized rates and Tauri event delivery.

### Changed

- Refresh, start and stop controls now live in the shared application-status header instead of being duplicated inside individual pages.
- Page scrolling is isolated to `page-scroll`; the sidebar and application-status controls remain visible while content scrolls.
- OpenAI failover generation reloads Mihomo only when its target subscription is still active at commit time; standby subscriptions preserve the active profile and runtime PID.
- Non-network settings, including global traffic monitoring, can be saved while Mihomo is running.
- Tray left-click continues to open the application home page while the icon is updated with live traffic data.
- Subscription deletion now uses an in-app confirmation dialog instead of the unreliable WebView-native `window.confirm` path.
- Successful deletion reports a top-right toast only after storage deletion succeeds; clicking delete on the active subscription now gives an explicit switch-first message instead of doing nothing.
- Regular views now use the native main-content scroller instead of nested subscription/profile list scrolling, preserving mouse-wheel and trackpad momentum.
- Each view restores its previous scroll position during navigation; confirmation and node-detail dialogs lock background scrolling.
- The subscription import card remains visible with a lightweight wide-screen sticky position, while compact and short windows fall back to natural document flow.

### Privacy

- Traffic monitoring reads aggregate interface byte counters only and excludes process, destination, domain and payload data.
- Loopback, TUN, VPN and common virtual interfaces are filtered to avoid duplicate accounting.

## 0.3.0 - 2026-08-19

### Added

- Figma-first subscription management screen with masked sources, validation state, node/revision summaries, refresh, activate, version and delete actions.
- Current-node details on the proxy page with recursive route chain, provider, masked endpoint, protocol capabilities, delay history and retest controls.
- Local-proxy safety check covering Google HTTP 204, Cloudflare HTTP 204 and the unauthenticated OpenAI Models HTTP 401 response.
- Tray left-click now opens and focuses the main window on the Overview page; the tray menu remains available from right-click.
- New Figma-designed deep-purple routing monogram app icon, exported to macOS ICNS, Windows ICO, Linux PNG and Windows Store logo sizes.
- Reproducible ad-hoc macOS bundle signing through Tauri `bundle.macOS.signingIdentity: "-"`.
- Figma-first proxy-page redesign with local variables, typography/effect styles and reusable Button, Nav Item, Metric Cell and Proxy Group Card components.
- Pixel-matched 1180×780 deep-purple glass implementation based on Figma node `8:2`, while preserving all original proxy-group controls.
- Managed `🤖 OpenAI 自动灾备` fallback policy with up to ten references to existing subscription nodes.
- Isolated temporary Mihomo benchmark runtime that never changes the active system proxy or TUN state.
- Two-stage OpenAI reachability, latency, jitter and bounded 2 MiB throughput evaluation.
- Three-way concurrent bandwidth checks through node-specific loopback listeners.
- Automatic generation after subscription import, automatic maintenance after subscription refresh and manual regeneration from the proxy page.
- Persistent benchmark report, progress, cancellation, health check, disable and revision rollback controls.
- High-priority OpenAI and ChatGPT domain rules based on the official OpenAI network list.
- Runtime config hot reload with rollback when applying a generated policy fails.

### Security

- System Proxy startup is transactional: preflight before OS mutation, read-back verification, post-apply validation and snapshot restoration on every failure path.
- macOS proxy capture and mutation target the default-route physical service and exclude virtual services with empty devices.
- Automatic proxy groups use HTTPS 204 health checks; subscription status pseudo-nodes are removed from effective proxies and group membership.
- Node-details serialization is whitelist-only and never exposes UUIDs, passwords, tokens, keys or unmasked server endpoints.
- Refreshing a standby subscription updates only that profile revision and no longer changes the globally active profile or runtime configuration.
- Benchmark listeners bind only to `127.0.0.1`; temporary files use private permissions and are removed when the job finishes.
- OpenAI reachability checks use the unauthenticated Models endpoint with expected HTTP 401 and never request or persist an OpenAI API key.
- Subscription metadata/status pseudo-nodes are excluded from benchmark candidates.

## 0.2.0 - 2026-08-19

### Added

- Deep-purple premium glass theme with layered translucency, 32–50 px backdrop blur and Gaussian light fields.
- One-click System Proxy and TUN switches with automatic stop/apply/restart orchestration.
- Per-profile Global, Rule and Direct routing controls on the home screen.
- Subscription import progress state, first-run GeoIP／GeoSite explanation, concurrency guard and URL-based deduplication.
- Reproducible Mihomo 1.19.30 sidecar preparation for six target triples.
- Pinned compressed-asset SHA-256 checks.
- Versioned profiles, immutable revisions, activation and rollback.
- Effective configuration generation with local security overrides.
- Runtime state, port preflight, bounded redacted logs and crash visibility.
- Mihomo API integration for proxies, rules, connections and delay tests.
- Manual, System Proxy and TUN modes.
- macOS, Windows and Linux system-proxy adapters.
- Full dashboard, profiles, proxies, rules, connections, logs, diagnostics and settings UI.
- System tray, single-instance behavior and launch-at-login integration.
- Native CI and release workflows for macOS, Windows and Linux.

### Security

- CSP and explicit Tauri capability configuration.
- Controller secret remains inside the Rust process and protected settings file.
- Remote config cannot override local controller exposure, ports, allow-lan or TUN policy.
- Logs redact URL queries, UUIDs and secret-like fields.
