/**
 * Vite-only visual fixture. Uses the real frontend with Tauri's installed IPC
 * mocks, not a running desktop app. All profile/runtime data below is synthetic.
 * No call is forwarded to a native bridge, filesystem, core, or subscription.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import packageInfo from "../../package.json";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type { AppSettings, ProfileDetails, ProfileRecord } from "../../src/types";
import type { ThemePreference } from "../../src/theme";

const STORAGE_KEY = "mihomo-codex:test-fixture:theme-preview:v1";
const THEMES: readonly ThemePreference[] = ["system", "light", "dark", "purple"];
type FixtureState = { theme: ThemePreference; systemDark: boolean };

function readFixtureState(): FixtureState {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (value && THEMES.includes(value.theme) && typeof value.systemDark === "boolean") {
      return { theme: value.theme, systemDark: value.systemDark };
    }
  } catch {
    // A malformed fixture value never causes access to actual application data.
  }
  return { theme: "system", systemDark: false };
}

let persisted = readFixtureState();
let failNextThemeSave = false;
let themeSaveCount = 0;
let networkMutationCount = 0;
let blockedBrowserRequestCount = 0;
let runtimeErrorCount = 0;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing fixture element: ${id}`);
  return found as T;
}

function report(message: string): void {
  element("fixture-status").textContent = message;
  element("fixture-saved-theme").textContent = persisted.theme;
  element("fixture-system-appearance").textContent = persisted.systemDark ? "dark" : "light";
  element("fixture-theme-save-count").textContent = String(themeSaveCount);
  element("fixture-network-mutation-count").textContent = String(networkMutationCount);
  element("fixture-network-mutation-count").dataset.failed = String(networkMutationCount > 0);
  element("fixture-browser-request-count").textContent = String(blockedBrowserRequestCount);
  element("fixture-runtime-error-count").textContent = String(runtimeErrorCount);
  element("fixture-runtime-error-count").dataset.failed = String(runtimeErrorCount > 0);
  element("fixture-fail-save").setAttribute("aria-pressed", String(failNextThemeSave));
  element("fixture-system-light").setAttribute("aria-pressed", String(!persisted.systemDark));
  element("fixture-system-dark").setAttribute("aria-pressed", String(persisted.systemDark));
}

// Installed @tauri-apps/api 2.11.1 exposes mockIPC and shouldMockEvents. Its
// implementation replaces __TAURI_INTERNALS__.invoke/transformCallback and
// __TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener. No hand-rolled native IPC.
const stamp = "2026-09-03T00:00:00.000Z";
const policy = {
  enabled: true,
  autoMaintain: false,
  maxNodes: 10,
  selectedNodes: [
    { name: "演示东京 01（虚构）", latencyMs: 42, jitterMs: 4, bandwidthMbps: 180, score: 95, checkedAt: stamp },
    { name: "演示新加坡 02（虚构）", latencyMs: 68, jitterMs: 8, bandwidthMbps: 140, score: 86, checkedAt: stamp },
  ],
  candidateCount: 2,
  healthyCount: 2,
  lastBenchmarkedAt: stamp,
  benchmarkVersion: 1,
};
const summary = {
  format: "Clash / Mihomo",
  nodeCount: 2,
  proxyGroupCount: 2,
  proxyProviderCount: 0,
  ruleCount: 3,
  ruleProviderCount: 0,
  dnsConfigured: true,
  tunConfigured: false,
  nodeProtocols: ["trojan", "shadowsocks"],
  proxyGroupTypes: ["select", "fallback"],
  unsupportedGroupTypes: [],
  warnings: ["主题预览合成资料，不代表真实网络或节点测试结果。"],
};
const validation = { valid: true, warnings: [], errors: [], nativeCoreValidated: false };
const metadata = { contentType: "text/yaml", etag: null, lastModified: null, bytes: 8192 };

function makeProfile(id: string, displayName: string, enabled: boolean): ProfileRecord {
  return {
    schemaVersion: 1,
    id,
    displayName,
    source: { type: "remote_subscription", host: "subscription.example.invalid", userAgent: "fixture-only" },
    routingMode: "rule",
    openaiPolicy: { ...policy, enabled },
    activeRevisionId: `${id}-revision`,
    lastKnownGoodRevisionId: null,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

const profiles = [
  makeProfile("fixture-active", "演示订阅 · 活动", true),
  makeProfile("fixture-inactive", "演示订阅 · 备用（可预览删除弹窗）", false),
];

function profileDetails(profileId: string): ProfileDetails {
  const profile = profiles.find((entry) => entry.id === profileId);
  if (!profile) throw new Error("FIXTURE_ONLY: unknown synthetic profile");
  return {
    profile,
    summary,
    revisions: [{
      schemaVersion: 1,
      id: `${profile.id}-revision`,
      profileId: profile.id,
      sourceSha256: "0".repeat(64),
      effectiveSha256: "1".repeat(64),
      fetchedAt: stamp,
      subscription: metadata,
      validation,
      openaiPolicy: profile.openaiPolicy,
    }],
  };
}

function settings(): AppSettings {
  return {
    schemaVersion: 1,
    locale: "zh-CN",
    theme: persisted.theme,
    launchAtLogin: false,
    showGlobalTraffic: true,
    networkMode: "manual",
    mixedPort: 17890,
    controllerPort: 19090,
    updateChannel: "stable",
    diagnosticsRetentionDays: 7,
  };
}

const readonlyReplies: Record<string, () => unknown> = {
  app_info: () => ({ productName: "mihomo-codex", version: `${packageInfo.version} · 合成预览`, targetOs: "macos", targetArch: "aarch64" }),
  get_settings: settings,
  probe_mihomo: () => ({ available: true, path: "/fixture-only/mihomo", version: "v0.0.0-fixture", message: "纯合成状态，真实内核未启动" }),
  runtime_status: () => ({
    state: "running", phase: "running", binaryAvailable: true,
    binaryPath: "/fixture-only/mihomo", version: "v0.0.0-fixture", configPath: "/fixture-only/config.yaml",
    message: "合成运行态仅用于展示界面；未启动真实内核。", pid: null, startedAt: stamp, lastError: null,
  }),
  system_proxy_status: () => ({ active: false, snapshotPath: null, platform: "macos" }),
  tun_helper_status: () => ({ supported: true, state: "not_installed", message: "合成预览不安装或调用 Helper", protocolVersion: 1, runtimeRunning: false, runtimePid: null, runtimeVersion: null, lastError: null }),
  global_traffic_snapshot: () => ({ enabled: true, uploadBytesPerSecond: 32000, downloadBytesPerSecond: 2400000, sampledAt: stamp, interfaces: ["fixture-only"] }),
  list_profiles: () => profiles,
  list_subscriptions: () => profiles.map((profile, index) => ({ profile, summary, revisionCount: 1, latestFetchedAt: stamp, latestMetadata: metadata, latestValidation: validation, active: index === 0 })),
  get_active_profile: () => profileDetails(profiles[0].id),
  get_openai_policy_task: () => ({ running: false, profileId: null, phase: "idle", completed: 0, total: 0, message: "合成预览不执行健康检测", startedAt: null, finishedAt: null, error: null, result: null }),
  get_proxies: () => ({ proxies: {
    "演示节点选择": { type: "Selector", all: policy.selectedNodes.map((node) => node.name), now: policy.selectedNodes[0].name, udp: true },
    "🤖 OpenAI 自动灾备": { type: "Fallback", all: policy.selectedNodes.map((node) => node.name), now: policy.selectedNodes[0].name, udp: true, fixed: false },
  } }),
  get_rules: () => ({ rules: [
    { type: "DomainSuffix", payload: "example.invalid", proxy: "演示节点选择" },
    { type: "IPCIDR", payload: "192.0.2.0/24", proxy: "DIRECT" },
    { type: "Match", payload: "", proxy: "DIRECT" },
  ] }),
  get_connections: () => ({ uploadTotal: 2048, downloadTotal: 16384, connections: [{
    id: "fixture-connection", metadata: { host: "preview.example.invalid", destinationPort: "443", network: "tcp" },
    chains: ["演示节点选择", "演示东京 01（虚构）"], rule: "DomainSuffix", rulePayload: "example.invalid", upload: 2048, download: 16384,
  }] }),
  runtime_logs: () => [
    { timestamp: stamp, level: "info", source: "fixture", message: "信息日志：主题切换应只调用 set_app_theme。" },
    { timestamp: stamp, level: "warning", source: "fixture", message: "提示日志：所有节点、连接和带宽数值均为虚构。" },
    { timestamp: stamp, level: "error", source: "fixture", message: "错误样式预览：此行不是实际网络错误。" },
  ],
  run_connectivity_diagnostics: () => [{ stage: "fixture", success: true, latencyMs: null, detail: "合成诊断结果；未发送实际网络请求。" }],
  run_network_safety_check: () => ({ success: true, proxyEndpoint: "fixture-only", checks: [] }),
};

function payloadRecord(payload: InvokeArgs | undefined): Record<string, unknown> {
  return payload && !Array.isArray(payload) && !(payload instanceof ArrayBuffer)
    ? payload as Record<string, unknown>
    : {};
}

mockIPC(async (command, payload) => {
  const args = payloadRecord(payload);
  if (command === "set_app_theme") {
    const theme = args.theme;
    if (!THEMES.includes(theme as ThemePreference)) throw new Error("FIXTURE_ONLY: invalid theme");
    themeSaveCount += 1;
    report("正在模拟主题持久化");
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    if (failNextThemeSave) {
      failNextThemeSave = false;
      report("已模拟保存失败；持久化主题未变化");
      throw new Error("FIXTURE_SAVE_FAILED: 模拟主题保存失败，请重试");
    }
    const next = { ...persisted, theme: theme as ThemePreference };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    persisted = next;
    report("主题已保存到隔离测试空间；网络配置未变化");
    return settings();
  }
  if (command === "get_profile_details") return profileDetails(String(args.profileId));
  if (command === "get_current_node_details") {
    return {
      group: String(args.group), nodeName: policy.selectedNodes[0].name,
      routeChain: [String(args.group), policy.selectedNodes[0].name], nodeType: "Trojan", alive: true,
      udp: true, uot: false, xudp: false, tfo: false, mptcp: false, smux: false,
      providerName: "合成 Provider", maskedServer: "*.example.invalid", port: 443,
      network: "tcp", tls: "TLS", dialerProxy: null, interface: null,
      history: [42, 45, 40, 48, 42].map((delayMs) => ({ time: stamp, delayMs })), lastDelayMs: 42,
    };
  }
  if (Object.prototype.hasOwnProperty.call(readonlyReplies, command)) return readonlyReplies[command]();

  // Fail closed: even a future/new command never falls through to real Tauri.
  // This includes start/stop, subscribe, settings/network changes and probes.
  networkMutationCount += 1;
  report(`已拦截非主题调用：${command}`);
  throw new Error(`FIXTURE_ONLY: 已拦截 ${command}；此预览仅允许只读合成数据和主题保存`);
}, { shouldMockEvents: true });

// Supply a stable, mutable color-scheme MediaQueryList before main.ts imports.
const originalMatchMedia = window.matchMedia.bind(window);
const colorQueries = new Map<string, MediaQueryList>();
window.matchMedia = (query: string): MediaQueryList => {
  if (!/^\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)$/.test(query)) {
    return originalMatchMedia(query);
  }
  const existing = colorQueries.get(query);
  if (existing) return existing;
  const target = new EventTarget();
  const mql = Object.assign(target, {
    media: query,
    onchange: null as MediaQueryList["onchange"],
    addListener(callback: ((event: MediaQueryListEvent) => void) | null) {
      if (callback) target.addEventListener("change", callback as EventListener);
    },
    removeListener(callback: ((event: MediaQueryListEvent) => void) | null) {
      if (callback) target.removeEventListener("change", callback as EventListener);
    },
  }) as MediaQueryList;
  Object.defineProperty(mql, "matches", { get: () => query.includes("dark") ? persisted.systemDark : !persisted.systemDark });
  colorQueries.set(query, mql);
  return mql;
};

function setSystemDark(dark: boolean): void {
  if (persisted.systemDark === dark) return;
  const next = { ...persisted, systemDark: dark };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  persisted = next;
  for (const mql of colorQueries.values()) {
    const event = new MediaQueryListEvent("change", { matches: mql.matches, media: mql.media });
    mql.dispatchEvent(event);
    mql.onchange?.call(mql, event);
  }
  report("仅修改预览中的系统外观信号；真实系统设置未变化");
}

function blockBrowserRequest(): never {
  blockedBrowserRequestCount += 1;
  report("已拦截脚本网络请求");
  throw new Error("FIXTURE_ONLY: browser network requests are disabled");
}

// The browser still loads same-origin Vite modules/styles. Application-level
// fetch/XHR/beacon/socket calls are blocked, including localhost API requests.
window.fetch = async () => blockBrowserRequest();
XMLHttpRequest.prototype.open = function () { blockBrowserRequest(); };
navigator.sendBeacon = () => { blockBrowserRequest(); };
const OriginalWebSocket = window.WebSocket;
window.WebSocket = class extends OriginalWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const parsed = new URL(url, location.href);
    const protocolList = typeof protocols === "string" ? [protocols] : protocols ?? [];
    const isLocalVite = parsed.hostname === location.hostname
      && parsed.port === location.port && protocolList.includes("vite-hmr");
    if (!isLocalVite) blockBrowserRequest();
    super(url, protocols);
  }
};
window.EventSource = class extends EventSource {
  constructor(_url: string | URL, _configuration?: EventSourceInit) {
    blockBrowserRequest();
    // No connection is ever created; required super is unreachable by design.
    super("about:blank");
  }
};

element("fixture-system-light").addEventListener("click", () => setSystemDark(false));
element("fixture-system-dark").addEventListener("click", () => setSystemDark(true));
element("fixture-fail-save").addEventListener("click", () => {
  failNextThemeSave = !failNextThemeSave;
  report(failNextThemeSave ? "下一次实际主题保存将失败；请选择不同主题" : "已取消模拟保存失败");
});
element("fixture-reload").addEventListener("click", () => location.reload());
element("fixture-reset").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

const banner = element("fixture-banner");
new ResizeObserver(() => {
  document.documentElement.style.setProperty("--fixture-banner-height", `${banner.offsetHeight}px`);
}).observe(banner);

window.addEventListener("error", (event) => {
  runtimeErrorCount += 1;
  report(`未捕获错误：${event.message}`);
});
window.addEventListener("unhandledrejection", (event) => {
  runtimeErrorCount += 1;
  report(`未处理 Promise：${String(event.reason)}`);
});

report("隔离桥接已安装，正在加载真实 src/main.ts");
void import("../../src/main").then(() => {
  report("预览已就绪；可测试四种主题、系统跟随、保存回滚与弹窗");
}).catch((error: unknown) => {
  runtimeErrorCount += 1;
  report(`前端加载失败：${error instanceof Error ? error.message : String(error)}`);
});
