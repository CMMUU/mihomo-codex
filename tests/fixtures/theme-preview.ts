/**
 * Vite-only visual fixture. Uses the real frontend with Tauri's installed IPC
 * mocks, not a running desktop app. All profile/runtime data below is synthetic.
 * No call is forwarded to a native bridge, filesystem, core, or subscription.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import packageInfo from "../../package.json";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  AppSettings, ProfileDetails, ProfileRecord,
  UserRule, UserRulesState, UserRulesValidation,
} from "../../src/types";
import type { ThemePreference } from "../../src/theme";

const STORAGE_KEY = "routedeck:test-fixture:theme-preview:v1";
const RULES_STORAGE_KEY = "routedeck:test-fixture:user-rules:v1";
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
let failNextRulesSave = false;
let rulesSaveCount = 0;
let rulesRollbackCount = 0;
let rulesApplyCount = 0;

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
  element("fixture-rules-revision").textContent = String(rulesPersisted.revision);
  element("fixture-rules-save-count").textContent = String(rulesSaveCount);
  element("fixture-rules-rollback-count").textContent = String(rulesRollbackCount);
  element("fixture-rules-apply-count").textContent = String(rulesApplyCount);
  element("fixture-network-mutation-count").textContent = String(networkMutationCount);
  element("fixture-network-mutation-count").dataset.failed = String(networkMutationCount > 0);
  element("fixture-browser-request-count").textContent = String(blockedBrowserRequestCount);
  element("fixture-runtime-error-count").textContent = String(runtimeErrorCount);
  element("fixture-runtime-error-count").dataset.failed = String(runtimeErrorCount > 0);
  element("fixture-fail-save").setAttribute("aria-pressed", String(failNextThemeSave));
  element("fixture-rules-fail-save").setAttribute("aria-pressed", String(failNextRulesSave));
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

type RulesFixtureHistory = { id: string; createdAt: string; count: number; rules: UserRule[] };
type RulesFixtureState = { revision: number; rules: UserRule[]; history: RulesFixtureHistory[] };
const fixtureTargets = [
  "DIRECT", "REJECT", "REJECT-DROP", "演示节点选择", "🤖 OpenAI 自动灾备",
  ...policy.selectedNodes.map((node) => node.name),
];
const ruleTypes = new Set([
  "DOMAIN", "DOMAIN-SUFFIX", "DOMAIN-KEYWORD", "DOMAIN-REGEX", "DOMAIN-WILDCARD", "GEOSITE",
  "GEOIP", "SRC-GEOIP", "IP-ASN", "SRC-IP-ASN", "IP-CIDR", "IP-CIDR6", "SRC-IP-CIDR", "IP-SUFFIX", "SRC-IP-SUFFIX",
  "SRC-PORT", "DST-PORT", "IN-PORT", "DSCP", "PROCESS-NAME", "PROCESS-PATH", "PROCESS-NAME-REGEX",
  "PROCESS-PATH-REGEX", "PROCESS-NAME-WILDCARD", "PROCESS-PATH-WILDCARD", "NETWORK", "UID",
  "IN-TYPE", "IN-USER", "IN-NAME", "REMATCH-NAME", "SUB-RULE", "AND", "OR", "NOT", "RULE-SET", "MATCH",
]);
const byteLength = (value: string): number => new TextEncoder().encode(value).length;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function isRuleRecord(value: unknown): value is UserRule {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<UserRule>;
  return typeof item.id === "string" && typeof item.enabled === "boolean"
    && typeof item.rule === "string" && typeof item.note === "string";
}

function readRulesFixtureState(): RulesFixtureState {
  try {
    const value = JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) ?? "null");
    if (value && Number.isSafeInteger(value.revision) && value.revision >= 0
      && Array.isArray(value.rules) && value.rules.every(isRuleRecord)
      && Array.isArray(value.history) && value.history.every((entry: RulesFixtureHistory) =>
        entry && typeof entry.id === "string" && typeof entry.createdAt === "string"
        && Array.isArray(entry.rules) && entry.rules.every(isRuleRecord))) {
      return { revision: value.revision, rules: value.rules, history: value.history.slice(0, 20) };
    }
  } catch {
    // Read only the synthetic fixture key, never desktop settings or profiles.
  }
  return {
    revision: 1,
    rules: [
      { id: "00000000-0000-4000-8000-000000000001", enabled: true, rule: "DOMAIN-SUFFIX,example.invalid,DIRECT", note: "合成直连示例" },
      { id: "00000000-0000-4000-8000-000000000002", enabled: false, rule: "DOMAIN,blocked.example.invalid,REJECT", note: "合成禁用示例" },
    ],
    history: [{ id: "0", createdAt: stamp, count: 0, rules: [] }],
  };
}

let rulesPersisted = readRulesFixtureState();

function userRulesState(): UserRulesState {
  return copy({
    revision: rulesPersisted.revision,
    rules: rulesPersisted.rules,
    history: rulesPersisted.history.map(({ id, createdAt, rules }) => ({ id, createdAt, count: rules.length })),
    targets: fixtureTargets,
    warnings: ["隔离预览仅执行合成校验与应用，不代表 Mihomo 原生校验结果。"],
    routingMode: "rule",
  });
}

function ruleError(code: "INVALID_INPUT" | "STATE_CONFLICT" | "RUNTIME_ERROR", message: string) {
  return { code, stage: "fixture_user_rules", message, retryable: code !== "INVALID_INPUT" };
}

/** Keep commas inside logical-rule parentheses in one field. */
function ruleFields(source: string): string[] {
  let depth = 0;
  let start = 0;
  const fields: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
    if (depth < 0) throw new Error("括号不匹配");
    if (source[index] === "," && depth === 0) {
      fields.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) throw new Error("括号不匹配");
  fields.push(source.slice(start).trim());
  return fields;
}

function validateRules(input: unknown): UserRulesValidation {
  const errors: string[] = [];
  const warnings = ["浏览器预览校验为合成实现；实际发布版本还须通过 Mihomo 原生校验。"];
  const normalizedRules: UserRule[] = [];
  const ids = new Set<string>();
  if (!Array.isArray(input)) {
    return { valid: false, errors: ["规则必须是数组"], warnings, normalizedRules, preview: "" };
  }
  if (input.length > 1000) errors.push("规则数量超过 1000 条");
  for (const [index, value] of input.entries()) {
    const prefix = `第 ${index + 1} 条`;
    if (!isRuleRecord(value)) { errors.push(`${prefix}规则字段不完整`); continue; }
    const normalized = { ...value, id: value.id.trim() || crypto.randomUUID(), rule: value.rule.trim(), note: value.note.trim() };
    normalizedRules.push(normalized);
    if (ids.has(normalized.id)) errors.push(`${prefix}规则 ID 重复`);
    ids.add(normalized.id);
    if (normalized.id.length > 128) errors.push(`${prefix}规则 ID 过长`);
    if (byteLength(normalized.rule) > 4096 || byteLength(normalized.note) > 512) errors.push(`${prefix}规则或备注过长`);
    if (!normalized.rule || /[\r\n]/.test(normalized.rule)) { errors.push(`${prefix}必须是单行规则`); continue; }
    try {
      const fields = ruleFields(normalized.rule);
      const kind = fields[0];
      const targetIndex = kind === "MATCH" ? 1 : 2;
      if (!ruleTypes.has(kind)) errors.push(`${prefix}不支持的规则类型：${kind}`);
      if (fields.length <= targetIndex || fields.some((part) => !part)) errors.push(`${prefix}规则缺少必要字段`);
      const target = fields[targetIndex];
      if (target && !fixtureTargets.includes(target)) {
        (normalized.enabled ? errors : warnings).push(`${prefix}目标不存在：${target}`);
      }
      if (fields.slice(targetIndex + 1).some((part) => !["no-resolve", "src"].includes(part))) errors.push(`${prefix}存在不支持的规则参数`);
      if (kind === "MATCH" && normalized.enabled) warnings.push(`${prefix} MATCH 会遮蔽后续规则`);
      if (["IP-CIDR", "SRC-IP-CIDR"].includes(kind)) {
        const [address, mask, extra] = (fields[1] ?? "").split("/");
        const octets = address.split(".");
        if (extra !== undefined || octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)
          || mask === undefined || !/^\d{1,2}$/.test(mask) || Number(mask) > 32) errors.push(`${prefix}IPv4 CIDR 格式不正确`);
      }
      if (kind === "IP-CIDR6" && !/^[\da-f:]+\/(\d{1,3})$/i.test(fields[1] ?? "")) errors.push(`${prefix}IPv6 CIDR 格式不正确`);
    } catch (error) { errors.push(`${prefix}${error instanceof Error ? error.message : String(error)}`); }
  }
  const preview = normalizedRules.filter((rule) => rule.enabled).map((rule) => rule.rule).join("\n");
  return { valid: errors.length === 0, errors, warnings, normalizedRules, preview };
}

function decodeRuleLine(line: string): string {
  if (line.startsWith('"')) {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "string") throw new Error("YAML 规则必须是字符串");
    return value;
  }
  if (line.startsWith("'")) {
    if (!line.endsWith("'")) throw new Error("规则引号不完整");
    return line.slice(1, -1).replace(/''/g, "'");
  }
  return line;
}

function parseRulesText(text: string): UserRule[] {
  if (byteLength(text) > 512 * 1024) throw ruleError("INVALID_INPUT", "规则文本超过 512 KiB");
  let pending: Partial<UserRule> | null = null;
  const result: UserRule[] = [];
  try {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed === "rules: []" || trimmed === "[]") return [];
    for (const original of text.split(/\r?\n/)) {
      const line = original.trim();
      if (!line || line === "rules:" || line === "---") continue;
      if (line.startsWith("# mihomo-codex-rule: ")) {
        pending = JSON.parse(line.slice("# mihomo-codex-rule: ".length));
        if (!pending || typeof pending !== "object") throw new Error("规则元数据格式错误");
        continue;
      }
      if (line.startsWith("#")) continue;
      if (/^[\w-]+\s*:/.test(line)) throw new Error("仅接受 rules 字段，其他 YAML 顶层字段已拒绝");
      const rule = decodeRuleLine(line.startsWith("- ") ? line.slice(2).trim() : line);
      result.push({
        id: typeof pending?.id === "string" ? pending.id : crypto.randomUUID(),
        enabled: typeof pending?.enabled === "boolean" ? pending.enabled : true,
        rule,
        note: typeof pending?.note === "string" ? pending.note : "",
      });
      pending = null;
    }
    if (pending) throw new Error("规则元数据后缺少规则行");
    const validationResult = validateRules(result);
    if (!validationResult.valid) throw new Error(validationResult.errors.join("；"));
    return validationResult.normalizedRules;
  } catch (error) {
    throw ruleError("INVALID_INPUT", error instanceof Error ? error.message : String(error));
  }
}

function persistRules(rules: UserRule[]): UserRulesState {
  const previous = rulesPersisted;
  const next: RulesFixtureState = {
    revision: previous.revision + 1,
    rules: copy(rules),
    history: [{ id: String(previous.revision), createdAt: new Date().toISOString(), count: previous.rules.length, rules: copy(previous.rules) }, ...previous.history].slice(0, 20),
  };
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(next));
  rulesPersisted = next;
  return userRulesState();
}

async function writeRules(args: Record<string, unknown>, rollback: boolean): Promise<UserRulesState> {
  if (rollback) rulesRollbackCount += 1;
  else rulesSaveCount += 1;
  report(rollback ? "正在模拟规则回滚" : "正在模拟规则保存与应用");
  if (args.expectedRevision !== rulesPersisted.revision) throw ruleError("STATE_CONFLICT", "规则已被其他窗口更新，请重新读取后合并修改");
  const target = rollback
    ? rulesPersisted.history.find((entry) => entry.id === args.revisionId)?.rules
    : args.rules;
  if (!target) throw ruleError("INVALID_INPUT", "目标历史版本不存在");
  const result = validateRules(target);
  if (!result.valid) throw ruleError("INVALID_INPUT", result.errors.join("；"));
  await new Promise((resolve) => window.setTimeout(resolve, 180));
  // Check again after the asynchronous boundary, mirroring optimistic locking.
  if (args.expectedRevision !== rulesPersisted.revision) throw ruleError("STATE_CONFLICT", "保存期间规则版本已变化，未覆盖其他修改");
  if (failNextRulesSave) {
    failNextRulesSave = false;
    report("已模拟应用失败；规则、版本、历史与合成生效状态全部保留");
    throw ruleError("RUNTIME_ERROR", "模拟 Mihomo 应用失败；已恢复旧规则与运行配置");
  }
  const next = persistRules(result.normalizedRules);
  rulesApplyCount += 1;
  report(`合成规则已${rollback ? "回滚" : "保存"}为版本 ${next.revision}；真实网络未变化`);
  return next;
}

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
  app_info: () => ({ productName: "RouteDeck", version: `${packageInfo.version} · 合成预览`, targetOs: "macos", targetArch: "aarch64" }),
  get_settings: settings,
  get_user_rules: userRulesState,
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
    ...rulesPersisted.rules.filter((rule) => rule.enabled).map((rule) => {
      const [type, payload, target] = ruleFields(rule.rule);
      return { type, payload: type === "MATCH" ? "" : payload, proxy: type === "MATCH" ? payload : target };
    }),
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
  if (command === "validate_user_rules") return validateRules(args.rules);
  if (command === "parse_user_rules_text") {
    if (typeof args.text !== "string") throw ruleError("INVALID_INPUT", "规则文本必须是字符串");
    return parseRulesText(args.text);
  }
  if (command === "save_user_rules") return writeRules(args, false);
  if (command === "rollback_user_rules") return writeRules(args, true);
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
  report(`已拦截真实状态修改调用：${command}`);
  throw new Error(`FIXTURE_ONLY: 已拦截 ${command}；此预览仅允许合成数据、隔离主题和规则保存`);
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
element("fixture-rules-fail-save").addEventListener("click", () => {
  failNextRulesSave = !failNextRulesSave;
  report(failNextRulesSave ? "下一次规则保存或回滚将模拟应用失败" : "已取消模拟规则应用失败");
});
element("fixture-rules-conflict").addEventListener("click", () => {
  const externalRules = copy(rulesPersisted.rules);
  externalRules.push({
    id: crypto.randomUUID(), enabled: true,
    rule: `DOMAIN,concurrent-${rulesPersisted.revision + 1}.example.invalid,DIRECT`,
    note: "模拟其他窗口新增；当前未保存草稿应保留",
  });
  const updated = persistRules(externalRules);
  report(`已模拟其他窗口写入版本 ${updated.revision}；当前页面仍持有旧版本，可测试冲突与刷新`);
});
element("fixture-reload").addEventListener("click", () => location.reload());
element("fixture-reset").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(RULES_STORAGE_KEY);
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
  report("预览已就绪；可测试主题、用户规则、文本校验、应用失败与版本冲突");
}).catch((error: unknown) => {
  runtimeErrorCount += 1;
  report(`前端加载失败：${error instanceof Error ? error.message : String(error)}`);
});
