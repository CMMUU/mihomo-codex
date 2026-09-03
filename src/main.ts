import "./styles.css";
import { api, errorMessage, revisionLabel } from "./api";
import { listen } from "@tauri-apps/api/event";
import {
  THEME_OPTIONS,
  ThemeController,
  isThemePreference,
  themeColorScheme,
} from "./theme";
import type { ThemePreference, ThemeSnapshot } from "./theme";
import type {
  AppInfo,
  AppSettings,
  BinaryInfo,
  CurrentNodeDetails,
  GlobalTrafficSnapshot,
  NetworkMode,
  NetworkSafetyReport,
  OpenAiPolicyTask,
  ProfileDetails,
  ProfileRecord,
  RuntimeLog,
  RuntimeStatus,
  SystemProxyStatus,
  SubscriptionOverview,
  TunHelperStatus,
} from "./types";

const sampleProfile = `mixed-port: 7890
mode: rule
log-level: info
ipv6: false
proxies:
  - name: 本地 SOCKS5 示例
    type: socks5
    server: 127.0.0.1
    port: 1080
proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - 本地 SOCKS5 示例
      - DIRECT
rules:
  - DOMAIN-SUFFIX,example.com,PROXY
  - MATCH,DIRECT
dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - 1.1.1.1
    - 8.8.8.8
`;

type ViewName =
  | "overview"
  | "profiles"
  | "subscriptions"
  | "proxies"
  | "rules"
  | "connections"
  | "logs"
  | "diagnostics"
  | "settings";

const store: {
  view: ViewName;
  appInfo: AppInfo | null;
  settings: AppSettings | null;
  binary: BinaryInfo | null;
  runtime: RuntimeStatus | null;
  systemProxy: SystemProxyStatus | null;
  tunHelper: TunHelperStatus | null;
  profiles: ProfileRecord[];
  subscriptions: SubscriptionOverview[];
  activeProfile: ProfileDetails | null;
  selectedProfile: ProfileDetails | null;
  proxies: Record<string, unknown> | null;
  rules: Record<string, unknown> | null;
  connections: Record<string, unknown> | null;
  logs: RuntimeLog[];
  openAiTask: OpenAiPolicyTask | null;
  nodeDetails: CurrentNodeDetails | null;
  networkSafety: NetworkSafetyReport | null;
  globalTraffic: GlobalTrafficSnapshot | null;
} = {
  view: "overview",
  appInfo: null,
  settings: null,
  binary: null,
  runtime: null,
  systemProxy: null,
  tunHelper: null,
  profiles: [],
  subscriptions: [],
  activeProfile: null,
  selectedProfile: null,
  proxies: null,
  rules: null,
  connections: null,
  logs: [],
  openAiTask: null,
  nodeDetails: null,
  networkSafety: null,
  globalTraffic: null,
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app not found");
let subscriptionImporting = false;
let openAiTaskFinishedAt: string | null = null;
let networkModeSwitching = false;
let runtimeActionInFlight = false;
let settingsSaving = false;
let appearanceFeedback = "";
const OPENAI_GROUP_NAME = "🤖 OpenAI 自动灾备";
document.documentElement.dataset.view = store.view;

app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">M</div>
        <div><strong>mihomo-codex</strong><span>轻量稳定代理客户端</span></div>
      </div>
      <nav class="nav-list" aria-label="主导航">
        <button class="nav-item is-active" data-view="overview" aria-current="page"><span>●</span>概览</button>
        <button class="nav-item" data-view="profiles"><span>▣</span>配置</button>
        <button class="nav-item" data-view="subscriptions"><span>↻</span>订阅</button>
        <button class="nav-item" data-view="proxies"><span>◇</span>代理</button>
        <button class="nav-item" data-view="rules"><span>≡</span>规则</button>
        <button class="nav-item" data-view="connections"><span>⇄</span>连接</button>
        <button class="nav-item" data-view="logs"><span>⌁</span>日志</button>
        <button class="nav-item" data-view="diagnostics"><span>✓</span>诊断</button>
        <button class="nav-item" data-view="settings"><span>⚙</span>设置</button>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-runtime-status">
          <span class="status-dot" id="sidebar-status-dot"></span>
          <span id="sidebar-status">正在读取状态</span>
        </div>
        <div class="global-traffic-compact" id="global-traffic-compact" aria-label="全局实时流量">
          <span class="traffic-upload"><b>↑</b><strong id="global-upload-rate">0 B/s</strong></span>
          <span class="traffic-download"><b>↓</b><strong id="global-download-rate">0 B/s</strong></span>
        </div>
      </div>
    </aside>
    <main class="main-content">
      <header class="topbar" aria-label="应用状态与全局控制">
        <div class="application-status-summary">
          <div class="application-status-heading">
            <span class="application-status-dot" id="application-status-dot"></span>
            <div><p class="eyebrow">mihomo-codex</p><h1 id="page-title">应用状态</h1></div>
          </div>
          <div class="application-status-meta" aria-live="polite">
            <strong id="application-runtime-state">正在读取</strong>
            <span id="application-profile-state">未选择订阅</span>
            <span id="application-mode-state">Manual</span>
          </div>
        </div>
        <div class="topbar-actions">
          <span class="platform-chip" id="platform-chip">检测平台中</span>
          <button class="button status-mode-button" id="global-system-proxy" type="button" aria-pressed="false"><span>S</span>系统代理</button>
          <button class="button status-mode-button" id="global-tun" type="button" aria-pressed="false"><span>T</span>TUN 模式</button>
          <button class="button button-quiet" id="global-refresh">刷新</button>
          <button class="button button-primary" id="global-start">启动</button>
          <button class="button button-danger" id="global-stop" disabled>停止</button>
        </div>
      </header>

      <div class="page-scroll" id="page-scroll">
      <section class="view-stack" id="overview-view">
        <div class="hero-grid">
          <article class="connection-card">
            <div class="section-label">运行状态</div>
            <div class="connection-main">
              <span class="large-status-dot" id="connection-dot"></span>
              <div><h2 id="connection-state">读取中</h2><p id="connection-message">正在检查内核和配置。</p></div>
            </div>
            <div class="connection-meta">
              <span>核心</span><strong id="runtime-version">—</strong>
              <span>PID</span><strong id="runtime-pid">—</strong>
              <span>配置</span><strong id="runtime-config">—</strong>
            </div>
          </article>
          <article class="health-card">
            <div class="section-label">网络接管</div>
            <div class="health-row"><span>模式</span><strong id="overview-mode">—</strong></div>
            <div class="health-row"><span>本地代理</span><strong id="overview-endpoint">—</strong></div>
            <div class="health-row"><span>系统代理</span><strong id="overview-system-proxy">—</strong></div>
            <div class="health-row"><span>当前档案</span><strong id="overview-profile">—</strong></div>
          </article>
        </div>
        <article class="panel control-center-panel">
          <div class="control-center-heading">
            <div>
              <div class="section-label">网络控制中心</div>
              <h2>接管方式与路由策略</h2>
              <p id="control-profile-caption">当前订阅：未选择</p>
            </div>
            <span class="control-state-pill" id="control-runtime-pill">已停止</span>
          </div>
          <div class="control-grid">
            <label class="control-tile" for="home-system-proxy">
              <span class="control-icon proxy-icon">S</span>
              <span class="control-copy">
                <strong>系统代理</strong>
                <small>让遵循系统代理的应用接入 Mihomo</small>
              </span>
              <span class="toggle-switch">
                <input id="home-system-proxy" type="checkbox" />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </span>
            </label>
            <label class="control-tile" for="home-tun">
              <span class="control-icon tun-icon">T</span>
              <span class="control-copy">
                <strong>TUN 模式</strong>
                <small>接管更完整的系统 IP 流量</small>
              </span>
              <span class="toggle-switch">
                <input id="home-tun" type="checkbox" />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
              </span>
            </label>
            <div class="control-tile routing-tile">
              <span class="control-icon routing-icon">R</span>
              <span class="control-copy">
                <strong>订阅路由</strong>
                <small>决定当前订阅如何处理全部连接</small>
              </span>
              <div class="routing-segments" id="home-routing-mode" role="group" aria-label="订阅路由模式">
                <button type="button" data-routing-mode="global">全局</button>
                <button type="button" data-routing-mode="rule">规则</button>
                <button type="button" data-routing-mode="direct">直连</button>
              </div>
            </div>
          </div>
          <p class="control-hint" id="control-hint">系统代理和 TUN 互斥；切换时应用会自动停止、应用设置并恢复运行。</p>
        </article>
        <div class="metrics-grid">
          <article class="metric-card"><span>配置档案</span><strong id="metric-profiles">0</strong><small>profiles</small></article>
          <article class="metric-card"><span>节点</span><strong id="metric-nodes">—</strong><small>active profile</small></article>
          <article class="metric-card"><span>规则</span><strong id="metric-rules">—</strong><small>active profile</small></article>
          <article class="metric-card"><span>运行阶段</span><strong id="metric-phase">—</strong><small>runtime state</small></article>
        </div>
        <article class="panel quick-panel">
          <div class="panel-heading"><div><div class="section-label">快速开始</div><h2>从订阅创建可回滚配置</h2></div></div>
          <form id="quick-subscription-form" class="form-grid form-grid-compact">
            <input id="quick-name" required placeholder="配置名称" value="我的订阅" />
            <input id="quick-url" required type="url" placeholder="HTTPS 订阅地址" autocomplete="off" spellcheck="false" />
            <input id="quick-ua" value="clash.meta" aria-label="User-Agent" />
            <button class="button button-primary" id="quick-import-button" type="submit">导入并激活</button>
          </form>
          <label class="inline-option"><input id="quick-openai-auto" type="checkbox" checked /><span>导入后在后台筛选 10 个 OpenAI 自动灾备节点</span></label>
          <p class="hint">订阅会先经过 YAML 解析、本机控制字段覆盖和 Mihomo 原生校验，成功后才激活。</p>
          <p class="import-status" id="quick-import-status"></p>
        </article>
      </section>

      <section class="view-stack is-hidden" id="subscriptions-view">
        <article class="panel subscriptions-panel">
          <div class="panel-heading subscription-panel-heading">
            <div>
              <div class="section-label">SUBSCRIPTIONS</div>
              <h2>订阅源与更新状态</h2>
            </div>
            <div class="toolbar">
              <button class="button button-quiet" id="subscriptions-run-safety">安全检查</button>
              <button class="button button-quiet" id="subscriptions-refresh-all">刷新全部</button>
            </div>
          </div>
          <div class="subscription-workspace">
            <section class="subscription-import-card" aria-labelledby="managed-subscription-title">
              <div class="subscription-import-intro"><h3 id="managed-subscription-title">添加订阅</h3><p>验证地址、解析配置并保存首个可回滚版本。敏感参数仅在本机存储。</p></div>
              <form id="managed-subscription-form" class="managed-subscription-form">
                <label class="managed-field managed-name-field"><span>订阅名称</span><input id="managed-subscription-name" required value="我的订阅" maxlength="128" /></label>
                <label class="managed-field managed-url-field"><span>订阅地址</span><input id="managed-subscription-url" required type="url" placeholder="https://example.com/subscribe?token=…" autocomplete="off" spellcheck="false" /></label>
                <label class="managed-field managed-ua-field"><span>User-Agent</span><input id="managed-subscription-ua" value="clash.meta" /></label>
                <label class="managed-import-option"><input id="managed-subscription-openai" type="checkbox" checked /><span><strong>OpenAI 灾备</strong><small>导入后自动生成</small></span></label>
                <div class="managed-submit-stack">
                  <button class="button button-primary" id="managed-subscription-import-button" type="submit">验证并添加</button>
                  <small>导入前先执行 YAML 校验与端口安全检查</small>
                </div>
              </form>
              <p class="import-status" id="managed-subscription-import-status"></p>
            </section>
            <div class="subscription-summary-grid">
              <div><span>活动订阅</span><strong id="subscription-summary-active">—</strong></div>
              <div><span>节点总数</span><strong id="subscription-summary-nodes">0 个可用节点</strong></div>
              <div><span>最近更新</span><strong id="subscription-summary-updated">—</strong></div>
              <div><span>网络安全</span><strong id="subscription-summary-safety">等待检查</strong></div>
            </div>
            <section class="subscription-list-card" aria-labelledby="subscription-list-title">
              <div class="subscription-card-heading">
                <div><h3 id="subscription-list-title">订阅列表</h3><p id="subscription-list-caption">读取中</p></div>
                <button class="button button-quiet" id="subscriptions-refresh-list">刷新列表</button>
              </div>
              <div id="subscription-manager-list" class="subscription-manager-list empty-state">还没有远程订阅</div>
            </section>
          </div>
        </article>
      </section>

      <section class="view-stack is-hidden" id="profiles-view">
        <div class="split-grid">
          <article class="panel">
            <div class="panel-heading"><div><div class="section-label">PROFILES</div><h2>配置档案</h2></div><button class="button button-quiet" id="profiles-refresh">刷新列表</button></div>
            <div id="profile-list" class="profile-list empty-state">还没有配置档案</div>
          </article>
          <article class="panel" id="profile-detail-panel">
            <div class="panel-heading"><div><div class="section-label">DETAIL</div><h2 id="profile-detail-title">选择一个配置</h2></div></div>
            <div id="profile-detail" class="empty-state">在左侧选择配置后查看版本和校验结果。</div>
          </article>
        </div>
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">IMPORT</div><h2>新增远程订阅</h2></div></div>
          <form id="subscription-form" class="form-grid">
            <label><span>名称</span><input id="subscription-name" required value="我的订阅" /></label>
            <label class="span-2"><span>订阅地址</span><input id="subscription-url" required type="url" placeholder="https://…" autocomplete="off" spellcheck="false" /></label>
            <label><span>User-Agent</span><input id="subscription-ua" value="clash.meta" /></label>
            <label class="checkbox-row"><input id="subscription-openai-auto" type="checkbox" checked /><span>导入后自动生成 OpenAI 灾备组</span></label>
            <button class="button button-primary align-end" id="subscription-import-button" type="submit">获取、校验并创建</button>
          </form>
          <p class="import-status" id="subscription-import-status"></p>
        </article>
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">LOCAL YAML</div><h2>本地或内联配置</h2></div><label class="button button-quiet file-button" for="yaml-file">打开 YAML</label></div>
          <input id="yaml-file" type="file" accept=".yaml,.yml,text/plain" hidden />
          <div class="editor-toolbar">
            <input id="inline-name" class="profile-name" value="本地配置" aria-label="配置名称" />
            <button class="button button-quiet" id="load-sample">载入示例</button>
            <button class="button button-quiet" id="inspect-yaml">只检查</button>
            <span class="editor-spacer"></span>
            <span id="yaml-summary" class="hint">等待配置</span>
            <button class="button button-primary" id="create-inline">创建并激活</button>
          </div>
          <textarea id="yaml-source" class="config-editor" placeholder="粘贴 Clash Meta / Mihomo YAML…" spellcheck="false"></textarea>
        </article>
      </section>

      <section class="view-stack is-hidden" id="proxies-view">
        <article class="panel proxy-groups-panel">
          <div class="panel-heading"><div><div class="section-label">PROXY GROUPS</div><h2>代理组与节点</h2></div><div class="toolbar"><button class="button button-quiet" id="proxies-current-node">当前节点</button><button class="button button-quiet" id="proxies-refresh">刷新</button></div></div>
          <div id="openai-policy-card" class="openai-policy-card"></div>
          <div id="proxy-groups" class="card-list empty-state">启动 Mihomo 后查看代理组。</div>
        </article>
      </section>

      <section class="view-stack is-hidden" id="rules-view">
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">RULES</div><h2>当前规则</h2></div><div class="toolbar"><input id="rule-search" placeholder="搜索规则" /><button class="button button-quiet" id="rules-refresh">刷新</button></div></div>
          <div class="table-wrap"><table><thead><tr><th>类型</th><th>内容</th><th>策略</th></tr></thead><tbody id="rules-body"><tr><td colspan="3">启动后加载规则</td></tr></tbody></table></div>
        </article>
      </section>

      <section class="view-stack is-hidden" id="connections-view">
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">CONNECTIONS</div><h2>活动连接</h2></div><button class="button button-quiet" id="connections-refresh">刷新</button></div>
          <div id="connection-totals" class="summary-strip"></div>
          <div class="table-wrap"><table><thead><tr><th>目标</th><th>网络</th><th>规则</th><th>代理链</th><th>流量</th><th></th></tr></thead><tbody id="connections-body"><tr><td colspan="6">启动后加载连接</td></tr></tbody></table></div>
        </article>
      </section>

      <section class="view-stack is-hidden" id="logs-view">
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">LOGS</div><h2>应用与 Mihomo 日志</h2></div><div class="toolbar"><button class="button button-quiet" id="logs-refresh">刷新</button><button class="button button-danger" id="logs-clear">清空</button></div></div>
          <div id="log-list" class="log-list empty-state">暂无日志</div>
        </article>
      </section>

      <section class="view-stack is-hidden" id="diagnostics-view">
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">DIAGNOSTICS</div><h2>分层诊断</h2></div><button class="button button-primary" id="run-diagnostics">立即诊断</button></div>
          <div id="diagnostic-list" class="diagnostic-list"></div>
        </article>
      </section>

      <section class="view-stack is-hidden" id="settings-view">
        <article class="panel appearance-panel">
          <div class="panel-heading"><div><div class="section-label">APPEARANCE</div><h2>外观主题</h2></div></div>
          <fieldset class="appearance-settings">
            <legend>选择外观，立即生效并自动保存</legend>
            <div class="appearance-grid" role="radiogroup" aria-label="应用主题" aria-describedby="appearance-status">
              ${THEME_OPTIONS.map((option) => `
                <button type="button" class="theme-option" data-theme-choice="${option.id}" role="radio" aria-checked="false" tabindex="-1">
                  <span class="theme-swatch" data-swatch="${option.id}" aria-hidden="true"><i></i><i></i><i></i></span>
                  <span class="theme-copy"><strong>${option.label}</strong><small>${option.description}</small></span>
                  <span class="theme-checkmark" aria-hidden="true">✓</span>
                </button>
              `).join("")}
            </div>
            <p class="appearance-status" id="appearance-status" role="status" aria-live="polite"></p>
          </fieldset>
        </article>
        <article class="panel">
          <div class="panel-heading"><div><div class="section-label">SETTINGS</div><h2>运行设置</h2></div></div>
          <form id="settings-form" class="settings-grid">
            <label><span>网络模式</span><select id="settings-mode"><option value="manual">Manual 本地端口</option><option value="system_proxy">System Proxy 系统代理</option><option value="tun">TUN 全局接管</option></select></label>
            <label><span>Mixed Port</span><input id="settings-mixed-port" type="number" min="1024" max="65535" /></label>
            <label><span>Controller Port</span><input id="settings-controller-port" type="number" min="1024" max="65535" /></label>
            <label class="checkbox-row"><input id="settings-launch" type="checkbox" /><span>登录时启动</span></label>
            <label class="checkbox-row"><input id="settings-global-traffic" type="checkbox" /><span>显示全局流量监控</span></label>
            <label><span>日志保留天数</span><input id="settings-retention" type="number" min="1" max="90" /></label>
            <div class="span-2"><button class="button button-primary" type="submit">保存设置</button></div>
          </form>
          <div class="settings-note">切换网络模式和端口前需要先停止 Mihomo。首次开启 TUN 会先安装最小权限 Helper，并在旧网络模式仍运行时完成预检。</div>
        </article>
        <article class="panel tun-helper-panel">
          <div class="panel-heading">
            <div><div class="section-label">PRIVILEGED TUN</div><h2>TUN 权限服务</h2></div>
            <span class="control-state-pill" id="tun-helper-state">正在检查</span>
          </div>
          <div class="tun-helper-summary">
            <div class="tun-helper-mark">T</div>
            <div><strong id="tun-helper-title">正在检查 TUN Helper</strong><p id="tun-helper-message">仅 TUN 内核使用管理员权限，应用界面保持普通用户运行。</p></div>
          </div>
          <div class="about-grid tun-helper-details">
            <span>协议版本</span><strong id="tun-helper-protocol">—</strong>
            <span>特权内核</span><strong id="tun-helper-runtime">未运行</strong>
          </div>
          <div class="toolbar tun-helper-actions">
            <button class="button button-primary" id="tun-helper-install" type="button">安装 Helper</button>
            <button class="button button-quiet" id="tun-helper-repair" type="button">修复 Helper</button>
            <button class="button button-quiet" id="tun-helper-open-settings" type="button">打开系统设置</button>
            <button class="button button-danger" id="tun-helper-uninstall" type="button">卸载 Helper</button>
          </div>
        </article>
        <article class="panel">
          <div class="section-label">VERSIONS</div>
          <div class="about-grid"><span>应用</span><strong id="about-app">—</strong><span>Mihomo</span><strong id="about-core">—</strong><span>平台</span><strong id="about-platform">—</strong></div>
        </article>
      </section>
      </div>

      <div class="toast" id="toast" role="status" aria-live="polite"></div>
      <div class="confirmation-modal-backdrop is-hidden" id="confirmation-modal" role="presentation" aria-hidden="true">
        <section class="confirmation-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-message">
          <div class="confirmation-modal-mark" aria-hidden="true">!</div>
          <div class="confirmation-modal-copy">
            <p class="section-label">CONFIRM ACTION</p>
            <h2 id="confirmation-title">确认操作</h2>
            <p id="confirmation-message"></p>
          </div>
          <div class="confirmation-modal-actions">
            <button class="button button-quiet" type="button" data-confirmation-action="cancel">取消</button>
            <button class="button button-danger" type="button" data-confirmation-action="confirm">确认</button>
          </div>
        </section>
      </div>
      <div class="node-modal-backdrop is-hidden" id="node-details-modal" role="presentation" aria-hidden="true">
        <section class="node-details-modal" role="dialog" aria-modal="true" aria-labelledby="node-details-title">
          <div id="node-details-content"></div>
        </section>
      </div>
    </main>
  </div>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const $$ = <T extends HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
let confirmationResolver: ((confirmed: boolean) => void) | null = null;
let confirmationReturnFocus: HTMLElement | null = null;
const viewScrollPositions: Partial<Record<ViewName, number>> = {};
let scrollRestoreFrame: number | null = null;

function syncModalScrollLock() {
  const confirmationOpen =
    $("#confirmation-modal")?.classList.contains("is-hidden") === false;
  const nodeDetailsOpen =
    $("#node-details-modal")?.classList.contains("is-hidden") === false;
  document.documentElement.classList.toggle(
    "is-modal-open",
    confirmationOpen || nodeDetailsOpen,
  );
}

function restoreViewScroll(view: ViewName) {
  const scroller = $("#page-scroll");
  if (!scroller) return;
  if (scrollRestoreFrame !== null) window.cancelAnimationFrame(scrollRestoreFrame);
  scrollRestoreFrame = window.requestAnimationFrame(() => {
    scrollRestoreFrame = null;
    if (store.view !== view) return;
    scroller.scrollTop = viewScrollPositions[view] ?? 0;
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function toast(
  message: string,
  kind: "info" | "success" | "error" = "info",
  placement: "bottom-right" | "top-right" = "bottom-right",
) {
  const element = $("#toast");
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
  element.dataset.placement = placement;
  element.classList.add("is-visible");
  window.setTimeout(() => element.classList.remove("is-visible"), 4200);
}

function closeConfirmation(confirmed: boolean) {
  const modal = $("#confirmation-modal");
  modal?.classList.add("is-hidden");
  modal?.setAttribute("aria-hidden", "true");
  syncModalScrollLock();
  const resolve = confirmationResolver;
  const returnFocus = confirmationReturnFocus;
  confirmationResolver = null;
  confirmationReturnFocus = null;
  resolve?.(confirmed);
  returnFocus?.focus();
}

function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  returnFocus?: HTMLElement | null;
}): Promise<boolean> {
  if (confirmationResolver) closeConfirmation(false);
  const modal = $("#confirmation-modal");
  const title = $("#confirmation-title");
  const message = $("#confirmation-message");
  const confirmButton = $(
    "#confirmation-modal [data-confirmation-action='confirm']",
  ) as HTMLButtonElement | null;
  if (!modal || !title || !message || !confirmButton) return Promise.resolve(false);

  title.textContent = options.title;
  message.textContent = options.message;
  confirmButton.textContent = options.confirmLabel ?? "确认";
  confirmationReturnFocus = options.returnFocus ?? null;
  modal.classList.remove("is-hidden");
  modal.setAttribute("aria-hidden", "false");
  syncModalScrollLock();

  return new Promise((resolve) => {
    confirmationResolver = resolve;
    window.requestAnimationFrame(() => confirmButton.focus());
  });
}

async function action<T>(label: string, operation: () => Promise<T>): Promise<T | null> {
  try {
    const result = await operation();
    if (label) toast(label, "success");
    return result;
  } catch (error) {
    toast(errorMessage(error), "error");
    return null;
  }
}

function formatBytes(value: unknown): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(Math.floor(Math.log(number) / Math.log(1024)), units.length - 1);
  return `${(number / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatTrafficRate(bytesPerSecond: number | null | undefined): string {
  const value = Math.max(0, Number(bytesPerSecond ?? 0));
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let scaled = value;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }
  const digits = index === 0 || scaled >= 100 ? 0 : 1;
  return `${scaled.toFixed(digits)} ${units[index]}`;
}

function renderGlobalTraffic() {
  const container = $("#global-traffic-compact");
  if (!container) return;
  const enabled = store.settings?.showGlobalTraffic ?? store.globalTraffic?.enabled ?? true;
  container.classList.toggle("is-hidden", !enabled);
  if (!enabled) return;
  const upload = formatTrafficRate(store.globalTraffic?.uploadBytesPerSecond);
  const download = formatTrafficRate(store.globalTraffic?.downloadBytesPerSecond);
  $("#global-upload-rate")!.textContent = upload;
  $("#global-download-rate")!.textContent = download;
  const interfaces = store.globalTraffic?.interfaces ?? [];
  container.title = interfaces.length
    ? `系统全局流量 · ${interfaces.join(", ")}`
    : "系统全局流量";
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatPolicyDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? `今天 ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : date.toLocaleString([], {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function modeLabel(mode: NetworkMode | undefined): string {
  return mode === "system_proxy" ? "System Proxy" : mode === "tun" ? "TUN" : "Manual";
}

function phaseLabel(phase: string | undefined): string {
  const labels: Record<string, string> = {
    uninitialized: "未初始化",
    stopped: "已停止",
    validating: "校验中",
    starting: "启动中",
    running: "运行中",
    stopping: "停止中",
    crashed: "异常退出",
    recovering: "恢复中",
  };
  return labels[phase ?? "stopped"] ?? phase ?? "已停止";
}

async function refreshBase() {
  const requestedThemeRevision = themeController.mutationRevision;
  const result = await action("", async () => {
    const [
      appInfo,
      settings,
      binary,
      runtime,
      systemProxy,
      tunHelper,
      profiles,
      subscriptions,
      activeProfile,
      openAiTask,
      globalTraffic,
    ] =
      await Promise.all([
        api.appInfo(),
        api.settings(),
        api.binary(),
        api.runtime(),
        api.systemProxy(),
        api.tunHelperStatus(),
        api.profiles(),
        api.subscriptions(),
        api.activeProfile(),
        api.openAiPolicyTask(),
        api.globalTraffic(),
      ]);
    if (!themeController.sync(settings.theme, requestedThemeRevision)) {
      settings.theme = themeController.snapshot.preference;
    }
    Object.assign(store, {
      appInfo,
      settings,
      binary,
      runtime,
      systemProxy,
      tunHelper,
      profiles,
      subscriptions,
      activeProfile,
      openAiTask,
      globalTraffic,
    });
  });
  if (result === null) return;
  renderHeader();
  renderOverview();
  renderProfiles();
  renderSubscriptions();
  renderSettings();
  renderOpenAiPolicy();
  renderGlobalTraffic();
}

function renderHeader() {
  const running = store.runtime?.phase === "running";
  const mode = store.settings?.networkMode;
  const controlsBusy = networkModeSwitching || runtimeActionInFlight;
  const systemProxyActive = Boolean(
    running && mode === "system_proxy" && store.systemProxy?.active,
  );
  const tunActive = Boolean(running && mode === "tun");
  $("#platform-chip")!.textContent = store.appInfo
    ? `${store.appInfo.targetOs} · ${store.appInfo.targetArch}`
    : "—";
  $("#application-runtime-state")!.textContent = networkModeSwitching
    ? "正在切换网络"
    : runtimeActionInFlight
      ? "正在处理"
      : phaseLabel(store.runtime?.phase);
  $("#application-profile-state")!.textContent =
    store.activeProfile?.profile.displayName ?? "未选择订阅";
  $("#application-mode-state")!.textContent = modeLabel(mode);
  $("#application-status-dot")!.classList.toggle("is-running", running);
  $("#application-status-dot")!.classList.toggle("is-busy", controlsBusy);
  $("#sidebar-status")!.textContent = running ? "Mihomo 运行中" : "Mihomo 已停止";
  $("#sidebar-status-dot")!.classList.toggle("is-running", running);
  renderGlobalTraffic();
  const systemProxyButton = $("#global-system-proxy") as HTMLButtonElement;
  const tunButton = $("#global-tun") as HTMLButtonElement;
  systemProxyButton.classList.toggle("is-active", systemProxyActive);
  systemProxyButton.setAttribute("aria-pressed", String(systemProxyActive));
  systemProxyButton.disabled = controlsBusy || !store.settings || !store.activeProfile;
  tunButton.classList.toggle("is-active", tunActive);
  tunButton.setAttribute("aria-pressed", String(tunActive));
  tunButton.title = store.tunHelper?.message ?? "TUN 使用最小权限 Helper 接管系统流量";
  tunButton.disabled = controlsBusy || !store.settings || !store.activeProfile;
  ($("#global-start") as HTMLButtonElement).disabled = running || controlsBusy;
  ($("#global-stop") as HTMLButtonElement).disabled = !running || controlsBusy;
  $("#about-app")!.textContent = store.appInfo?.version ?? "—";
  $("#about-core")!.textContent = store.binary?.version ?? "未找到";
  $("#about-platform")!.textContent = store.appInfo
    ? `${store.appInfo.targetOs} ${store.appInfo.targetArch}`
    : "—";
}

function renderOverview() {
  const runtime = store.runtime;
  const running = runtime?.phase === "running";
  $("#connection-state")!.textContent = phaseLabel(runtime?.phase);
  $("#connection-message")!.textContent = runtime?.message ?? "等待运行时状态";
  $("#connection-dot")!.classList.toggle("is-running", running);
  $("#runtime-version")!.textContent = runtime?.version ?? store.binary?.version ?? "未找到";
  $("#runtime-pid")!.textContent = runtime?.pid ? String(runtime.pid) : "—";
  $("#runtime-config")!.textContent = runtime?.configPath ?? "—";
  $("#overview-mode")!.textContent = modeLabel(store.settings?.networkMode);
  $("#overview-endpoint")!.textContent = store.settings
    ? `127.0.0.1:${store.settings.mixedPort}`
    : "—";
  $("#overview-system-proxy")!.textContent = store.systemProxy?.active ? "已接管" : "未接管";
  $("#overview-profile")!.textContent = store.activeProfile?.profile.displayName ?? "未选择";
  $("#control-profile-caption")!.textContent = store.activeProfile
    ? `当前订阅：${store.activeProfile.profile.displayName}`
    : "当前订阅：未选择";
  $("#control-runtime-pill")!.textContent = phaseLabel(runtime?.phase);
  $("#control-runtime-pill")!.classList.toggle("is-running", running);
  const systemProxySwitch = $("#home-system-proxy") as HTMLInputElement;
  const tunSwitch = $("#home-tun") as HTMLInputElement;
  systemProxySwitch.checked = store.settings?.networkMode === "system_proxy";
  tunSwitch.checked = store.settings?.networkMode === "tun";
  systemProxySwitch.disabled = networkModeSwitching || !store.settings || !store.activeProfile;
  tunSwitch.disabled = networkModeSwitching || !store.settings || !store.activeProfile;
  const routingMode = store.activeProfile?.profile.routingMode ?? "rule";
  $$("#home-routing-mode button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.routingMode === routingMode);
    (button as HTMLButtonElement).disabled = !store.activeProfile;
  });
  $("#control-hint")!.textContent = store.activeProfile
    ? `${store.activeProfile.profile.displayName} · ${modeLabel(store.settings?.networkMode)} · ${routingMode === "global" ? "全局" : routingMode === "direct" ? "直连" : "规则"}`
    : "先创建并激活一个订阅，再使用网络控制中心。";
  $("#metric-profiles")!.textContent = String(store.profiles.length);
  $("#metric-nodes")!.textContent = store.activeProfile?.summary
    ? String(store.activeProfile.summary.nodeCount + store.activeProfile.summary.proxyProviderCount)
    : "—";
  $("#metric-rules")!.textContent = store.activeProfile?.summary
    ? String(store.activeProfile.summary.ruleCount + store.activeProfile.summary.ruleProviderCount)
    : "—";
  $("#metric-phase")!.textContent = phaseLabel(runtime?.phase);
}

function profileSourceLabel(profile: ProfileRecord): string {
  if (profile.source.type === "remote_subscription") {
    return profile.source.host;
  }
  return profile.source.type === "local_file" ? "本地文件" : "内联配置";
}

function routingModeLabel(mode: ProfileRecord["routingMode"]): string {
  return mode === "global" ? "全局" : mode === "direct" ? "直连" : "规则";
}

function renderSubscriptions() {
  const list = $("#subscription-manager-list");
  if (!list) return;
  const subscriptions = store.subscriptions;
  const active = subscriptions.find((subscription) => subscription.active);
  const totalNodes = subscriptions.reduce(
    (total, subscription) =>
      total +
      (subscription.summary
        ? subscription.summary.nodeCount + subscription.summary.proxyProviderCount
        : 0),
    0,
  );
  const updatedTimes = subscriptions
    .map((subscription) => subscription.latestFetchedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const latest = updatedTimes[updatedTimes.length - 1];
  $("#subscription-summary-active")!.textContent = active?.profile.displayName ?? "未选择";
  $("#subscription-summary-nodes")!.textContent = `${totalNodes} 个可用节点`;
  $("#subscription-summary-updated")!.textContent = formatPolicyDate(latest);
  $("#subscription-summary-safety")!.textContent = store.networkSafety
    ? store.networkSafety.success
      ? "代理预检通过"
      : "代理预检失败"
    : store.runtime?.phase === "running"
      ? "等待检查"
      : "内核未运行";
  $("#subscription-list-caption")!.textContent = `${subscriptions.length} 个订阅 · ${subscriptions.filter((subscription) => subscription.profile.openaiPolicy.autoMaintain).length} 个自动维护`;

  if (!subscriptions.length) {
    list.className = "subscription-manager-list empty-state";
    list.textContent = "还没有远程订阅，可在顶部添加。";
    return;
  }
  list.className = "subscription-manager-list";
  list.innerHTML = subscriptions
    .map((subscription) => {
      const { profile, summary, latestMetadata, latestValidation } = subscription;
      const nodeCount = summary ? summary.nodeCount + summary.proxyProviderCount : 0;
      const host = profile.source.type === "remote_subscription"
        ? profile.source.host
        : "remote-subscription";
      const taskForProfile = store.openAiTask?.profileId === profile.id;
      const generationRunning = Boolean(taskForProfile && store.openAiTask?.running);
      const generationFailed = Boolean(
        taskForProfile && !store.openAiTask?.running && store.openAiTask?.phase === "failed",
      );
      const anotherGenerationRunning = Boolean(store.openAiTask?.running && !taskForProfile);
      const generationProgress = generationRunning
        ? `${store.openAiTask!.completed}/${store.openAiTask!.total || "—"}`
        : "";
      const openAiButtonLabel = generationRunning
        ? `停止生成 ${generationProgress}`
        : profile.openaiPolicy.enabled
          ? "重新生成容灾"
          : "OpenAI 容灾";
      const openAiStatus = generationRunning
        ? ` · ${openAiTaskPhaseLabel(store.openAiTask!)} ${generationProgress}`
        : generationFailed
          ? ` · 上次生成失败：${store.openAiTask?.error ?? "请重试"}`
        : profile.openaiPolicy.enabled
          ? ` · OpenAI 容灾 ${profile.openaiPolicy.selectedNodes.length} 个节点`
          : "";
      return `
        <article class="subscription-entry ${subscription.active ? "is-active" : ""}" data-subscription-id="${profile.id}">
          <div class="subscription-entry-head">
            <div class="subscription-identity">
              <span class="subscription-mark">S</span>
              <div><h3>${escapeHtml(profile.displayName)}</h3><p>${escapeHtml(host)} · Clash / Mihomo</p></div>
            </div>
            <span class="subscription-state ${subscription.active ? "is-active" : ""}">${subscription.active ? "活动" : "备用"}</span>
          </div>
          <div class="subscription-source" title="订阅凭据已隐藏">https://${escapeHtml(host)}/••••••?token=••••••••</div>
          <div class="subscription-entry-metrics">
            <div><span>节点</span><strong>${nodeCount}</strong></div>
            <div><span>响应大小</span><strong>${formatBytes(latestMetadata?.bytes)}</strong></div>
            <div><span>版本</span><strong>${subscription.revisionCount}</strong></div>
            <div><span>最近更新</span><strong>${formatPolicyDate(subscription.latestFetchedAt)}</strong></div>
          </div>
          <div class="subscription-entry-footer">
            <span class="subscription-validation ${generationFailed ? "is-error" : latestValidation?.valid ? "is-valid" : ""}">${latestValidation?.valid ? "✓ 配置已验证" : "等待验证"} · ${routingModeLabel(profile.routingMode)}模式${escapeHtml(openAiStatus)}</span>
            <div class="toolbar">
              <button class="button button-openai ${profile.openaiPolicy.enabled ? "is-enabled" : ""}" data-subscription-action="${generationRunning ? "openai-cancel" : "openai-generate"}" data-profile-id="${profile.id}" ${anotherGenerationRunning ? "disabled" : ""}>${openAiButtonLabel}</button>
              <button class="button button-quiet" data-subscription-action="refresh" data-profile-id="${profile.id}">刷新</button>
              <button class="button button-quiet" data-subscription-action="activate" data-profile-id="${profile.id}" ${subscription.active ? "disabled" : ""}>激活</button>
              <button class="button button-quiet" data-subscription-action="versions" data-profile-id="${profile.id}">版本</button>
              <button class="button button-danger" data-subscription-action="delete" data-profile-id="${profile.id}">删除</button>
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function renderProfiles() {
  const list = $("#profile-list");
  if (!list) return;
  if (!store.profiles.length) {
    list.className = "profile-list empty-state";
    list.textContent = "还没有配置档案";
  } else {
    list.className = "profile-list";
    list.innerHTML = store.profiles
      .map((profile) => {
        const active = store.activeProfile?.profile.id === profile.id;
        const selected = store.selectedProfile?.profile.id === profile.id;
        return `
          <button class="profile-row ${active ? "is-active" : ""} ${selected ? "is-selected" : ""}" data-profile-id="${profile.id}">
            <span class="profile-status"></span>
            <span><strong>${escapeHtml(profile.displayName)}</strong><small>${escapeHtml(profileSourceLabel(profile))}</small></span>
            <time>${escapeHtml(formatDate(profile.updatedAt))}</time>
          </button>
        `;
      })
      .join("");
  }
  renderProfileDetails();
}

function renderProfileDetails() {
  const details = store.selectedProfile ?? store.activeProfile;
  const title = $("#profile-detail-title");
  const container = $("#profile-detail");
  if (!title || !container) return;
  if (!details) {
    title.textContent = "选择一个配置";
    container.className = "empty-state";
    container.textContent = "在左侧选择配置后查看版本和校验结果。";
    return;
  }
  const { profile, summary, revisions } = details;
  title.textContent = profile.displayName;
  container.className = "profile-detail";
  container.innerHTML = `
    <div class="detail-grid">
      <span>来源</span><strong>${escapeHtml(profileSourceLabel(profile))}</strong>
      <span>路由模式</span><strong>${profile.routingMode === "global" ? "全局" : profile.routingMode === "direct" ? "直连" : "规则"}</strong>
      <span>节点</span><strong>${summary ? summary.nodeCount + summary.proxyProviderCount : "—"}</strong>
      <span>代理组</span><strong>${summary?.proxyGroupCount ?? "—"}</strong>
      <span>规则</span><strong>${summary ? summary.ruleCount + summary.ruleProviderCount : "—"}</strong>
      <span>OpenAI 灾备</span><strong>${profile.openaiPolicy.enabled ? `${profile.openaiPolicy.selectedNodes.length} 个节点 · 自动维护${profile.openaiPolicy.autoMaintain ? "开启" : "关闭"}` : "未启用"}</strong>
    </div>
    <div class="profile-actions">
      <button class="button button-primary" data-profile-action="activate" data-profile-id="${profile.id}">激活</button>
      <button class="button button-quiet" data-profile-action="refresh" data-profile-id="${profile.id}" ${profile.source.type !== "remote_subscription" ? "disabled" : ""}>更新</button>
      <button class="button button-quiet" data-profile-action="rollback" data-profile-id="${profile.id}" ${!profile.lastKnownGoodRevisionId ? "disabled" : ""}>回滚</button>
      <button class="button button-danger" data-profile-action="delete" data-profile-id="${profile.id}" ${store.activeProfile?.profile.id === profile.id ? "disabled" : ""}>删除</button>
    </div>
    <h3>版本记录</h3>
    <div class="revision-list">
      ${revisions.map((revision) => `
        <button class="revision-row ${revision.id === profile.activeRevisionId ? "is-active" : ""}" data-profile-action="revision" data-profile-id="${profile.id}" data-revision-id="${revision.id}">
          <span>${escapeHtml(revisionLabel(revision))}</span>
          <small>${revision.validation.nativeCoreValidated ? "core validated" : "not validated"} · ${escapeHtml(revision.effectiveSha256.slice(0, 12))}</small>
        </button>
      `).join("") || '<div class="empty-state">暂无版本</div>'}
    </div>
    ${summary?.warnings.length ? `<div class="warning-box">${summary.warnings.map(escapeHtml).join("<br>")}</div>` : ""}
  `;
}

function renderSettings() {
  if (!store.settings) return;
  themeController.sync(store.settings.theme);
  ($("#settings-mode") as HTMLSelectElement).value = store.settings.networkMode;
  ($("#settings-mixed-port") as HTMLInputElement).value = String(store.settings.mixedPort);
  ($("#settings-controller-port") as HTMLInputElement).value = String(store.settings.controllerPort);
  ($("#settings-launch") as HTMLInputElement).checked = store.settings.launchAtLogin;
  ($("#settings-global-traffic") as HTMLInputElement).checked =
    store.settings.showGlobalTraffic;
  ($("#settings-retention") as HTMLInputElement).value = String(
    store.settings.diagnosticsRetentionDays,
  );
  renderGlobalTraffic();
  renderTunHelper();
}

function tunHelperStateLabel(state: TunHelperStatus["state"] | undefined): string {
  const labels: Record<TunHelperStatus["state"], string> = {
    unsupported: "当前不可用",
    not_installed: "未安装",
    requires_approval: "等待批准",
    ready: "已就绪",
    outdated: "需要更新",
    unreachable: "连接异常",
  };
  return state ? labels[state] : "正在检查";
}

function renderTunHelper() {
  const helper = store.tunHelper;
  const state = helper?.state;
  const stateElement = $("#tun-helper-state")!;
  stateElement.textContent = tunHelperStateLabel(state);
  stateElement.classList.toggle("is-running", state === "ready");
  stateElement.classList.toggle(
    "is-warning",
    state === "requires_approval" || state === "outdated" || state === "unreachable",
  );
  $("#tun-helper-title")!.textContent =
    state === "ready" ? "最小权限 TUN Helper 已就绪" : tunHelperStateLabel(state);
  $("#tun-helper-message")!.textContent =
    helper?.message ?? "仅 TUN 内核使用管理员权限，应用界面保持普通用户运行。";
  $("#tun-helper-protocol")!.textContent = helper?.protocolVersion
    ? `v${helper.protocolVersion}`
    : "—";
  $("#tun-helper-runtime")!.textContent = helper?.runtimeRunning
    ? `运行中 · PID ${helper.runtimePid ?? "—"}`
    : "未运行";
  const running = store.runtime?.phase === "running";
  const install = $("#tun-helper-install") as HTMLButtonElement;
  const repair = $("#tun-helper-repair") as HTMLButtonElement;
  const open = $("#tun-helper-open-settings") as HTMLButtonElement;
  const uninstall = $("#tun-helper-uninstall") as HTMLButtonElement;
  install.classList.toggle("is-hidden", state !== "not_installed");
  repair.classList.toggle(
    "is-hidden",
    state !== "outdated" && state !== "unreachable",
  );
  open.classList.toggle("is-hidden", state !== "requires_approval");
  uninstall.classList.toggle(
    "is-hidden",
    !state || state === "unsupported" || state === "not_installed",
  );
  install.disabled = networkModeSwitching;
  repair.disabled = networkModeSwitching || running;
  open.disabled = networkModeSwitching;
  uninstall.disabled = networkModeSwitching || running;
}

const systemAppearance = window.matchMedia("(prefers-color-scheme: dark)");
const themeController = new ThemeController({
  systemDark: () => systemAppearance.matches,
  persist: async (theme) => {
    const settings = await api.setTheme(theme);
    if (!isThemePreference(settings.theme)) throw new Error("保存主题返回了无效设置");
    // A theme response must not overwrite unrelated settings updated meanwhile.
    store.settings = store.settings ? { ...store.settings, theme: settings.theme } : settings;
    return settings.theme;
  },
  render: renderAppearance,
});

function renderAppearance(snapshot: ThemeSnapshot) {
  const root = document.documentElement;
  root.dataset.theme = snapshot.resolved;
  root.dataset.themePreference = snapshot.selected;
  root.style.colorScheme = themeColorScheme(snapshot.resolved);
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = { light: "#f5f6f8", dark: "#15171c", purple: "#160c25" }[snapshot.resolved];
  const busy = snapshot.saving || settingsSaving;
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === snapshot.selected;
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
    // Keep focus on a radio while a write is pending; event handlers reject re-entry.
    button.disabled = !store.settings;
    button.setAttribute("aria-disabled", String(busy || !store.settings));
  });
  $(".appearance-grid")!.setAttribute("aria-busy", String(snapshot.saving));
  const submit = document.querySelector<HTMLButtonElement>('#settings-form button[type="submit"]');
  if (submit) submit.disabled = busy;
  $("#appearance-status")!.textContent = snapshot.saving
    ? "正在保存外观…"
    : appearanceFeedback || (snapshot.selected === "system"
      ? `正在跟随系统 · 当前为${snapshot.resolved === "dark" ? "深色" : "浅色"}`
      : `${THEME_OPTIONS.find((option) => option.id === snapshot.selected)!.label}主题 · 自动保存，不影响代理状态`);
}

async function selectTheme(preference: ThemePreference) {
  if (!store.settings || settingsSaving || themeController.snapshot.saving) return;
  appearanceFeedback = "";
  try {
    await themeController.select(preference);
    themeController.refresh();
  } catch (error) {
    appearanceFeedback = "保存失败，已恢复此前外观，请重试。";
    toast(errorMessage(error), "error");
    themeController.refresh();
  }
}

systemAppearance.addEventListener("change", () => {
  appearanceFeedback = "";
  themeController.refresh();
});

document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => {
    const preference = button.dataset.themeChoice;
    if (isThemePreference(preference)) void selectTheme(preference);
  });
  button.addEventListener("keydown", (event) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")];
    const current = buttons.indexOf(button);
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    if (settingsSaving || themeController.snapshot.saving || buttons[next].disabled) return;
    buttons[next].focus();
    const preference = buttons[next].dataset.themeChoice;
    if (isThemePreference(preference)) void selectTheme(preference);
  });
});
themeController.refresh();

async function refreshRuntimeOnly() {
  const [runtime, systemProxy] = await Promise.all([api.runtime(), api.systemProxy()]);
  store.runtime = runtime;
  store.systemProxy = systemProxy;
  renderHeader();
  renderOverview();
  renderSubscriptions();
}

async function startRuntime() {
  if (!store.activeProfile) {
    toast("请先创建并激活一个配置档案", "error");
    navigate("profiles");
    return;
  }
  if (runtimeActionInFlight || networkModeSwitching) return;
  runtimeActionInFlight = true;
  renderHeader();
  try {
    if (store.settings?.networkMode === "tun" && !(await ensureTunHelperReady())) return;
    const result = await action("Mihomo 已启动", () => api.startActive());
    if (result) store.runtime = result;
  } finally {
    runtimeActionInFlight = false;
    await refreshRuntimeOnly();
  }
}

async function stopRuntime() {
  if (runtimeActionInFlight || networkModeSwitching) return;
  runtimeActionInFlight = true;
  renderHeader();
  try {
    const result = await action("Mihomo 已停止，系统代理已恢复", () => api.stop());
    if (result) store.runtime = result;
  } finally {
    runtimeActionInFlight = false;
    await refreshRuntimeOnly();
  }
}

function toggleGlobalNetworkMode(mode: "system_proxy" | "tun") {
  if (!store.settings || !store.activeProfile) return;
  const running = store.runtime?.phase === "running";
  const active = mode === "system_proxy"
    ? Boolean(running && store.settings.networkMode === mode && store.systemProxy?.active)
    : Boolean(running && store.settings.networkMode === mode);
  if (active) {
    void switchNetworkMode("manual");
  } else if (store.settings.networkMode === mode && !running) {
    void startRuntime();
  } else if (store.settings.networkMode === mode) {
    void (async () => {
      await stopRuntime();
      await startRuntime();
    })();
  } else {
    void switchNetworkMode(mode);
  }
}

async function switchNetworkMode(mode: NetworkMode) {
  if (!store.settings) return;
  if (networkModeSwitching || runtimeActionInFlight) return;
  const wasRunning = store.runtime?.phase === "running";
  const currentMode = store.settings.networkMode;
  if (mode === currentMode) return;
  const systemSwitch = $("#home-system-proxy") as HTMLInputElement;
  const tunSwitch = $("#home-tun") as HTMLInputElement;
  let modeChanged = false;
  networkModeSwitching = true;
  systemSwitch.disabled = true;
  tunSwitch.disabled = true;
  renderHeader();
  try {
    if (mode === "tun" && !(await ensureTunHelperReady())) return;
    if (wasRunning) await api.stop();
    store.settings = await api.setNetworkMode(mode);
    modeChanged = true;
    if (store.activeProfile && (wasRunning || mode !== "manual")) {
      store.runtime = await api.startActive();
    }
    toast(
      mode === "system_proxy"
        ? "系统代理已开启"
        : mode === "tun"
          ? "TUN 模式已开启"
          : "已切换为 Manual 模式",
      "success",
    );
  } catch (error) {
    let message = errorMessage(error);
    if (modeChanged) {
      try {
        store.settings = await api.setNetworkMode(currentMode);
        if (store.activeProfile && wasRunning) {
          store.runtime = await api.startActive();
        }
        message += "；已恢复之前的网络模式";
      } catch (rollbackError) {
        message += `；回滚失败：${errorMessage(rollbackError)}`;
      }
    }
    toast(message, "error");
  } finally {
    networkModeSwitching = false;
    await refreshBase();
  }
}

async function ensureTunHelperReady(): Promise<boolean> {
  let helper = await action("", () => api.tunHelperStatus());
  if (!helper) return false;
  store.tunHelper = helper;
  renderTunHelper();

  if (helper.state === "not_installed") {
    helper = await action("TUN Helper 已提交安装", () => api.installTunHelper());
  } else if (helper.state === "outdated" || helper.state === "unreachable") {
    helper = await action("TUN Helper 已修复", () => api.repairTunHelper());
  }
  if (!helper) return false;
  store.tunHelper = helper;
  renderTunHelper();

  if (helper.state === "requires_approval") {
    await action("", () => api.openTunHelperSettings());
    toast("请在系统设置中批准 mihomo-codex TUN Helper，然后再次开启 TUN", "error");
    return false;
  }
  if (helper.state !== "ready") {
    toast(helper.message, "error");
    return false;
  }
  const prepared = await action("TUN 环境预检完成", () => api.prepareTun());
  return prepared !== null;
}

async function switchRoutingMode(mode: "global" | "rule" | "direct") {
  const active = store.activeProfile;
  if (!active) {
    toast("请先创建并激活订阅", "error");
    navigate("profiles");
    return;
  }
  const details = await action(
    mode === "global" ? "已切换为全局代理" : mode === "direct" ? "已切换为直连" : "已切换为规则模式",
    () => api.setProfileRoutingMode(active.profile.id, mode),
  );
  if (!details) return;
  store.activeProfile = details;
  if (store.selectedProfile?.profile.id === details.profile.id) {
    store.selectedProfile = details;
  }
  renderOverview();
  renderProfiles();
}

async function createSubscription(
  name: string,
  url: string,
  userAgent: string,
  generateOpenAi: boolean,
) {
  if (subscriptionImporting) {
    toast("已有订阅正在导入，请等待当前校验完成", "info");
    return;
  }
  subscriptionImporting = true;
  const buttons = [
    $("#quick-import-button"),
    $("#subscription-import-button"),
    $("#managed-subscription-import-button"),
  ].filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement);
  const statuses = [
    $("#quick-import-status"),
    $("#subscription-import-status"),
    $("#managed-subscription-import-status"),
  ].filter(Boolean) as HTMLElement[];
  buttons.forEach((button) => {
    button.disabled = true;
    button.dataset.originalText = button.textContent ?? "";
    button.textContent = "正在校验…";
  });
  statuses.forEach((status) => {
    status.className = "import-status is-loading";
    status.textContent =
      "正在获取订阅并执行 Mihomo 原生校验。首次导入可能下载 GeoIP／GeoSite 数据，需要约 1～2 分钟，请保持窗口打开。";
  });
  try {
    const result = await api.createSubscriptionProfile(
      name,
      url,
      userAgent,
      generateOpenAi,
    );
    await refreshBase();
    store.selectedProfile = await api.profileDetails(result.profile.id);
    renderProfiles();
    statuses.forEach((status) => {
      status.className = "import-status is-success";
      status.textContent = result.updated
        ? "订阅已通过校验并激活。"
        : "该订阅已经存在，当前内容没有变化。";
    });
    ($("#quick-url") as HTMLInputElement).value = "";
    ($("#subscription-url") as HTMLInputElement).value = "";
    ($("#managed-subscription-url") as HTMLInputElement).value = "";
    toast(result.updated ? "订阅已创建并激活" : "订阅已存在且内容未变化", "success");
    if (generateOpenAi) {
      store.openAiTask = await api.openAiPolicyTask();
      renderOpenAiPolicy();
      toast("订阅已激活，正在后台筛选 OpenAI 灾备节点", "info");
    }
  } catch (error) {
    const message = errorMessage(error);
    statuses.forEach((status) => {
      status.className = "import-status is-error";
      status.textContent = message;
    });
    toast(message, "error");
  } finally {
    subscriptionImporting = false;
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = button.dataset.originalText ?? "导入";
    });
  }
}

async function createInline() {
  const name = ($("#inline-name") as HTMLInputElement).value.trim();
  const source = ($("#yaml-source") as HTMLTextAreaElement).value.trim();
  if (!name || !source) {
    toast("请填写名称和 YAML 配置", "error");
    return;
  }
  const result = await action("配置已创建、校验并激活", () =>
    api.createInlineProfile(name, source),
  );
  if (!result) return;
  await refreshBase();
  store.selectedProfile = await api.profileDetails(result.profile.id);
  renderProfiles();
}

async function handleProfileAction(target: HTMLElement) {
  const actionName = target.dataset.profileAction;
  const profileId = target.dataset.profileId;
  if (!actionName || !profileId) return;
  if (actionName === "activate") {
    const wasRunning = store.runtime?.phase === "running";
    await action("配置已激活", async () => {
      if (wasRunning) await api.stop();
      const details = await api.activateProfile(profileId);
      if (wasRunning) await api.startActive();
      return details;
    });
  } else if (actionName === "refresh") {
    const wasRunning = store.runtime?.phase === "running";
    const active = store.activeProfile?.profile.id === profileId;
    await action("订阅已更新", async () => {
      const result = await api.refreshProfile(profileId);
      if (wasRunning && active && result.updated) {
        await api.stop();
        await api.startActive();
      }
      return result;
    });
  } else if (actionName === "rollback") {
    const wasRunning = store.runtime?.phase === "running";
    const active = store.activeProfile?.profile.id === profileId;
    await action("已回滚到上一稳定版本", async () => {
      if (wasRunning && active) await api.stop();
      const details = await api.rollbackProfile(profileId);
      if (wasRunning && active) await api.startActive();
      return details;
    });
  } else if (actionName === "delete") {
    await action("配置已删除", () => api.deleteProfile(profileId));
    store.selectedProfile = null;
  } else if (actionName === "revision") {
    const wasRunning = store.runtime?.phase === "running";
    const active = store.activeProfile?.profile.id === profileId;
    await action("指定版本已激活", async () => {
      if (wasRunning && active) await api.stop();
      const details = await api.activateProfile(profileId, target.dataset.revisionId);
      if (wasRunning && active) await api.startActive();
      return details;
    });
  }
  await refreshBase();
  if (actionName !== "delete") {
    store.selectedProfile = await api.profileDetails(profileId);
  }
  renderProfiles();
}

async function runNetworkSafetyCheck() {
  if (store.runtime?.phase !== "running") {
    toast("请先启动 Mihomo，再执行本地代理安全检查", "info");
    return;
  }
  const report = await action("", () => api.networkSafety());
  if (!report) return;
  store.networkSafety = report;
  renderSubscriptions();
  const summary = report.checks
    .map((check) => `${check.target} ${check.actualStatus ?? "失败"}`)
    .join(" · ");
  toast(`代理安全预检通过：${summary}`, "success");
}

async function refreshAllSubscriptions() {
  if (!store.subscriptions.length) {
    toast("当前没有远程订阅", "info");
    return;
  }
  const button = $("#subscriptions-refresh-all") as HTMLButtonElement;
  button.disabled = true;
  button.textContent = "正在刷新…";
  let updated = 0;
  const wasRunning = store.runtime?.phase === "running";
  const activeProfileId = store.activeProfile?.profile.id;
  let activeUpdated = false;
  try {
    for (const subscription of store.subscriptions) {
      const result = await api.refreshProfile(subscription.profile.id);
      if (result.updated) {
        updated += 1;
        if (subscription.profile.id === activeProfileId) activeUpdated = true;
      }
    }
    if (wasRunning && activeUpdated) {
      await api.stop();
      await api.startActive();
    }
    toast(`订阅刷新完成，${updated} 个配置有更新`, "success");
  } catch (error) {
    toast(errorMessage(error), "error");
  } finally {
    button.disabled = false;
    button.textContent = "刷新全部";
    await refreshBase();
  }
}

async function handleSubscriptionAction(target: HTMLElement) {
  const actionName = target.dataset.subscriptionAction;
  const profileId = target.dataset.profileId;
  if (!actionName || !profileId) return;
  if (actionName === "versions") {
    store.selectedProfile = await api.profileDetails(profileId);
    renderProfiles();
    navigate("profiles");
    return;
  }
  if (actionName === "openai-generate") {
    await startOpenAiGeneration(profileId);
    return;
  }
  if (actionName === "openai-cancel") {
    await cancelOpenAiGeneration();
    return;
  }
  if (actionName === "refresh") {
    const wasRunning = store.runtime?.phase === "running";
    const active = store.activeProfile?.profile.id === profileId;
    await action("订阅已更新并通过校验", async () => {
      const result = await api.refreshProfile(profileId);
      if (wasRunning && active && result.updated) {
        await api.stop();
        await api.startActive();
      }
      return result;
    });
  } else if (actionName === "activate") {
    const wasRunning = store.runtime?.phase === "running";
    const activated = await action("", async () => {
      if (wasRunning) await api.stop();
      const details = await api.activateProfile(profileId);
      if (wasRunning) await api.startActive();
      return details;
    });
    if (activated) toast("订阅已激活", "success");
  } else if (actionName === "delete") {
    const subscription = store.subscriptions.find(
      (subscription) => subscription.profile.id === profileId,
    );
    const profile = subscription?.profile;
    if (subscription?.active) {
      toast("当前订阅正在使用，请先激活其他订阅后再删除", "info", "top-right");
      return;
    }
    const confirmed = await confirmAction({
      title: "删除订阅",
      message: `确定删除“${profile?.displayName ?? "未命名订阅"}”及其本地版本记录？此操作不可撤销。`,
      confirmLabel: "确认删除",
      returnFocus: target,
    });
    if (!confirmed) {
      return;
    }
    const deleted = await action("", async () => {
      await api.deleteProfile(profileId);
      return true;
    });
    if (!deleted) return;
    toast("订阅删除成功", "success", "top-right");
  }
  await refreshBase();
}

function openAiTaskPhaseLabel(task: OpenAiPolicyTask): string {
  const labels: Record<OpenAiPolicyTask["phase"], string> = {
    idle: "等待创建",
    preparing: "准备独立检测环境",
    checking: "检测 OpenAI 可达性",
    bandwidth: "评估带宽与抖动",
    applying: "校验并应用配置",
    completed: "配置已生成",
    failed: "生成失败",
    cancelled: "任务已停止",
  };
  return labels[task.phase];
}

function renderOpenAiPolicy() {
  const container = $("#openai-policy-card");
  if (!container) return;
  const active = store.activeProfile;
  if (!active) {
    container.innerHTML = `
      <div class="openai-policy-empty">
        <span class="openai-mark">AI</span>
        <div><h3>OpenAI 自动灾备</h3><p>激活一个包含显式节点的订阅后即可生成。</p></div>
      </div>`;
    return;
  }

  const policy = active.profile.openaiPolicy;
  const task = store.openAiTask;
  const taskForActive = task?.profileId === active.profile.id;
  const running = Boolean(taskForActive && task?.running);
  const anotherTaskRunning = Boolean(task?.running && !taskForActive);
  const runningProfileName = anotherTaskRunning
    ? store.subscriptions.find((subscription) => subscription.profile.id === task?.profileId)
        ?.profile.displayName ?? "其他订阅"
    : null;
  const proxyMap = (store.proxies?.proxies ?? {}) as Record<string, any>;
  const runtimeGroup = proxyMap[OPENAI_GROUP_NAME];
  const currentNode = runtimeGroup?.now ?? policy.selectedNodes[0]?.name ?? "—";
  const progress = task?.total
    ? Math.min(100, Math.round((task.completed / task.total) * 100))
    : running
      ? 6
      : 0;
  const statusText = running
    ? `${openAiTaskPhaseLabel(task!)} · ${task!.completed}/${task!.total || "—"}`
    : anotherTaskRunning
      ? `${runningProfileName} 正在生成 OpenAI 容灾`
    : policy.enabled
      ? `${policy.selectedNodes.length} 个节点 · ${policy.healthyCount}/${policy.candidateCount} 个候选通过`
      : "尚未创建托管策略";
  container.innerHTML = `
    <div class="openai-policy-head">
      <div class="openai-policy-title">
        <span class="openai-mark">AI</span>
        <div>
          <div class="openai-title-line"><h3>OpenAI 自动灾备</h3><span class="managed-badge">托管策略</span></div>
          <p>${escapeHtml(statusText)}</p>
        </div>
      </div>
      <div class="openai-policy-actions">
        ${running
          ? '<button class="button button-danger" data-openai-action="cancel">停止检测</button>'
          : `<button class="button button-primary" data-openai-action="generate" ${anotherTaskRunning ? "disabled" : ""}>${anotherTaskRunning ? "其他订阅生成中" : policy.enabled ? "重新筛选 10 个" : "生成 10 个节点"}</button>`}
        <button class="button button-quiet" data-openai-action="health" ${!policy.enabled || Boolean(task?.running) || store.runtime?.phase !== "running" ? "disabled" : ""}>立即健康检查</button>
        <button class="button button-quiet" data-openai-action="details" ${!policy.enabled || store.runtime?.phase !== "running" ? "disabled" : ""}>节点详情</button>
        ${runtimeGroup?.fixed ? '<button class="button button-quiet" data-openai-action="auto">恢复自动</button>' : ""}
        ${policy.enabled && !task?.running ? '<button class="button button-danger" data-openai-action="disable">停用</button>' : ""}
      </div>
    </div>
    ${running ? `
      <div class="openai-progress" aria-label="${escapeHtml(task!.message)}">
        <span style="width:${progress}%"></span>
      </div>
      <p class="openai-progress-copy">${escapeHtml(task!.message)}</p>
    ` : ""}
    ${taskForActive && task?.phase === "failed" && task.error ? `<div class="openai-error">${escapeHtml(task.error)}</div>` : ""}
    <div class="openai-policy-stats">
      <div><span>当前节点</span><strong>${escapeHtml(currentNode)}</strong></div>
      <div><span>自动维护</span><strong>${policy.autoMaintain ? "订阅更新后执行" : "仅手动执行"}</strong></div>
      <div><span>上次筛选</span><strong>${formatPolicyDate(policy.lastBenchmarkedAt)}</strong></div>
      <div><span>故障策略</span><strong>按优先级自动切换</strong></div>
    </div>
  `;
}

async function startOpenAiGeneration(profileId?: string) {
  const targetProfileId = profileId ?? store.activeProfile?.profile.id;
  if (!targetProfileId) {
    toast("请选择需要生成 OpenAI 容灾的订阅", "error");
    return;
  }
  const profile = store.subscriptions.find(
    (subscription) => subscription.profile.id === targetProfileId,
  )?.profile ?? (store.activeProfile?.profile.id === targetProfileId
    ? store.activeProfile.profile
    : null);
  const task = await action(
    `${profile?.displayName ?? "订阅"}：OpenAI 容灾生成已启动`,
    () => api.startOpenAiPolicyGeneration(targetProfileId, true),
  );
  if (!task) return;
  store.openAiTask = task;
  renderOpenAiPolicy();
  renderSubscriptions();
}

async function cancelOpenAiGeneration() {
  const task = await action("正在停止检测", () => api.cancelOpenAiPolicyGeneration());
  if (!task) return;
  store.openAiTask = task;
  renderOpenAiPolicy();
  renderSubscriptions();
}

async function refreshOpenAiTask() {
  const previous = store.openAiTask;
  const task = await action("", () => api.openAiPolicyTask());
  if (!task) return;
  store.openAiTask = task;
  renderOpenAiPolicy();
  renderSubscriptions();
  if (
    previous?.running &&
    !task.running &&
    task.finishedAt &&
    task.finishedAt !== openAiTaskFinishedAt
  ) {
    openAiTaskFinishedAt = task.finishedAt;
    if (task.phase === "completed") {
      const completedProfile = store.subscriptions.find(
        (subscription) => subscription.profile.id === task.profileId,
      );
      const applied = completedProfile?.active;
      toast(
        `${completedProfile?.profile.displayName ?? "订阅"}：${task.message}${applied ? "，已应用" : "，激活后生效"}`,
        "success",
      );
      await refreshBase();
      if (store.runtime?.phase === "running" && task.profileId === store.activeProfile?.profile.id) {
        await Promise.all([refreshProxies(), refreshRules()]);
      }
    } else if (task.phase === "failed") {
      toast(task.error ?? task.message, "error");
    } else if (task.phase === "cancelled") {
      toast("OpenAI 节点筛选已停止", "info");
    }
  }
}

async function refreshProxies() {
  const result = await action("", () => api.proxies());
  if (!result) return;
  store.proxies = result;
  renderProxies();
}

function renderProxies() {
  renderOpenAiPolicy();
  const container = $("#proxy-groups");
  if (!container) return;
  const proxyMap = (store.proxies?.proxies ?? {}) as Record<string, any>;
  const groups = Object.entries(proxyMap).filter(
    ([name, value]) => name !== OPENAI_GROUP_NAME && Array.isArray(value?.all),
  );
  if (!groups.length) {
    container.className = "card-list empty-state";
    container.textContent = "没有可展示的代理组。";
    return;
  }
  container.className = "card-list";
  container.innerHTML = groups
    .map(([name, value]) => {
      const selector = String(value.type).toLowerCase() === "selector";
      return `
        <article class="proxy-card" data-group="${escapeHtml(name)}" tabindex="-1">
          <div><h3>${escapeHtml(name)}</h3><p>${escapeHtml(value.type)} · UDP ${value.udp ? "支持" : "未知"}</p></div>
          ${selector
            ? `<select class="proxy-select" data-group="${escapeHtml(name)}">
                ${value.all.map((proxy: string) => `<option value="${escapeHtml(proxy)}" ${proxy === value.now ? "selected" : ""}>${escapeHtml(proxy)}</option>`).join("")}
              </select>`
            : `<div class="proxy-current-node">${escapeHtml(value.now ?? "正在选择")}</div>`}
          <div class="proxy-card-footer">
            <span>当前：${escapeHtml(value.now ?? "—")}</span>
            <div class="toolbar">
              ${value.fixed ? `<button class="button button-quiet proxy-auto" data-group="${escapeHtml(name)}">恢复自动</button>` : ""}
              <button class="button button-quiet proxy-details" data-group="${escapeHtml(name)}">详情</button>
              <button class="button button-quiet proxy-delay" data-proxy="${escapeHtml(value.now ?? name)}">测速</button>
            </div>
          </div>
        </article>`;
    })
    .join("");
}

function preferredCurrentGroup(): string | null {
  const proxyMap = (store.proxies?.proxies ?? {}) as Record<string, any>;
  if (store.activeProfile?.profile.openaiPolicy.enabled && proxyMap[OPENAI_GROUP_NAME]) {
    return OPENAI_GROUP_NAME;
  }
  const preferred = Object.entries(proxyMap).find(
    ([name, value]) =>
      name !== "GLOBAL" &&
      name !== "COMPATIBLE" &&
      name !== "PASS" &&
      Array.isArray(value?.all) &&
      typeof value?.now === "string",
  );
  if (preferred) return preferred[0];
  return proxyMap.GLOBAL ? "GLOBAL" : null;
}

function renderNodeDetails() {
  const details = store.nodeDetails;
  const container = $("#node-details-content");
  if (!container || !details) return;
  const history = details.history.filter((sample) => sample.delayMs > 0).slice(-5);
  const delays = history.map((sample) => sample.delayMs);
  const minDelay = delays.length ? Math.min(...delays) : 0;
  const maxDelay = delays.length ? Math.max(...delays) : 0;
  const bars = history.length
    ? history
        .map((sample, index) => {
          const ratio = maxDelay === minDelay
            ? 0.5
            : (sample.delayMs - minDelay) / (maxDelay - minDelay);
          return `<span title="${sample.delayMs} ms" style="height:${Math.round(18 + ratio * 16)}px;opacity:${0.65 + index * 0.07}"></span>`;
        })
        .join("")
    : '<em>暂无历史</em>';
  const average = delays.length
    ? Math.round(delays.reduce((sum, delay) => sum + delay, 0) / delays.length)
    : null;
  const latestTime = history[history.length - 1]?.time;
  const detailsRows = [
    ["节点名称", details.nodeName],
    ["传输网络", details.network?.toUpperCase() ?? "未声明"],
    ["服务器", details.maskedServer ?? "由 Provider 托管"],
    ["TLS", details.tls ?? "未声明"],
    ["端口", details.port ?? "—"],
    ["UDP", details.udp == null ? "未知" : details.udp ? "支持" : "关闭"],
    ["Provider", details.providerName ?? "本地配置"],
    ["活动状态", details.alive == null ? "未知" : details.alive ? "Mihomo 已选中" : "当前不可用"],
  ];
  container.innerHTML = `
    <header class="node-modal-header">
      <div class="node-modal-identity"><span class="node-modal-mark">${escapeHtml(Array.from(details.nodeName).slice(0, 2).join("").toUpperCase())}</span><div><h2 id="node-details-title">当前节点信息</h2><p>${escapeHtml(details.group)} · 当前生效链路</p></div></div>
      <button class="button button-quiet" data-node-modal-action="close">关闭</button>
    </header>
    <div class="node-health-summary">
      <div><span>状态</span><strong>${details.alive === false ? "不可用" : "在线"}</strong></div>
      <div><span>延迟</span><strong>${details.lastDelayMs == null ? "—" : `${details.lastDelayMs} ms`}</strong></div>
      <div><span>协议</span><strong>${escapeHtml(details.nodeType)} · ${escapeHtml(details.tls ?? "无 TLS")}</strong></div>
      <div><span>最近检测</span><strong>${latestTime ? formatPolicyDate(latestTime) : "暂无"}</strong></div>
    </div>
    <section class="node-route-card"><span>当前代理链路</span><strong>${details.routeChain.map(escapeHtml).join(" <i>›</i> ")}</strong></section>
    <div class="node-detail-grid">
      ${detailsRows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}
    </div>
    <section class="node-history-card">
      <div><strong>最近 ${history.length || 0} 次检测</strong><span>${average == null ? "暂无有效延迟记录" : `平均 ${average} ms · ${details.alive === false ? "等待故障切换" : "未触发切换"}`}</span></div>
      <div class="node-latency-bars">${bars}</div>
    </section>
    <footer class="node-modal-footer">
      <span>敏感凭据已隐藏，仅展示诊断所需信息</span>
      <div class="toolbar">
        <button class="button button-quiet" data-node-modal-action="retest">重新测速</button>
        <button class="button button-primary" data-node-modal-action="switch">切换节点</button>
      </div>
    </footer>`;
}

async function openNodeDetails(group: string | null) {
  if (!group) {
    toast("当前没有可展示的代理组", "info");
    return;
  }
  if (store.runtime?.phase !== "running") {
    toast("请先启动 Mihomo，再读取当前节点信息", "info");
    return;
  }
  const details = await action("", () => api.currentNodeDetails(group));
  if (!details) return;
  store.nodeDetails = details;
  renderNodeDetails();
  $("#node-details-modal")!.classList.remove("is-hidden");
  $("#node-details-modal")!.setAttribute("aria-hidden", "false");
  syncModalScrollLock();
  const close = $("#node-details-modal [data-node-modal-action='close']") as HTMLButtonElement;
  close?.focus();
}

function closeNodeDetails() {
  $("#node-details-modal")?.classList.add("is-hidden");
  $("#node-details-modal")?.setAttribute("aria-hidden", "true");
  syncModalScrollLock();
}

function focusNodeGroup(group: string) {
  closeNodeDetails();
  const card = $$(".proxy-card").find((element) => element.dataset.group === group);
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  (card?.querySelector("select, button") as HTMLElement | null)?.focus();
}

async function refreshRules() {
  const result = await action("", () => api.rules());
  if (!result) return;
  store.rules = result;
  renderRules();
}

function renderRules() {
  const query = ($("#rule-search") as HTMLInputElement)?.value.toLowerCase() ?? "";
  const rules = ((store.rules?.rules ?? []) as any[]).filter((rule) =>
    JSON.stringify(rule).toLowerCase().includes(query),
  );
  $("#rules-body")!.innerHTML =
    rules
      .map(
        (rule) => `<tr><td>${escapeHtml(rule.type)}</td><td>${escapeHtml(rule.payload)}</td><td>${escapeHtml(rule.proxy)}</td></tr>`,
      )
      .join("") || '<tr><td colspan="3">没有匹配规则</td></tr>';
}

async function refreshConnections() {
  const result = await action("", () => api.connections());
  if (!result) return;
  store.connections = result;
  renderConnections();
}

function renderConnections() {
  const payload = store.connections ?? {};
  const connections = (payload.connections ?? []) as any[];
  $("#connection-totals")!.innerHTML = `<span>上传 <strong>${formatBytes(payload.uploadTotal)}</strong></span><span>下载 <strong>${formatBytes(payload.downloadTotal)}</strong></span><span>连接 <strong>${connections.length}</strong></span>`;
  $("#connections-body")!.innerHTML =
    connections
      .map((connection) => {
        const metadata = connection.metadata ?? {};
        const target = metadata.host || metadata.destinationIP || "—";
        const chains = Array.isArray(connection.chains) ? connection.chains.join(" → ") : "—";
        return `
          <tr>
            <td><strong>${escapeHtml(target)}</strong><small>:${escapeHtml(metadata.destinationPort)}</small></td>
            <td>${escapeHtml(metadata.network ?? metadata.type)}</td>
            <td>${escapeHtml(connection.rule)} ${escapeHtml(connection.rulePayload)}</td>
            <td>${escapeHtml(chains)}</td>
            <td>↑ ${formatBytes(connection.upload)}<br>↓ ${formatBytes(connection.download)}</td>
            <td><button class="button button-danger close-connection" data-connection-id="${escapeHtml(connection.id)}">关闭</button></td>
          </tr>
        `;
      })
      .join("") || '<tr><td colspan="6">暂无活动连接</td></tr>';
}

async function refreshLogs() {
  store.logs = await api.logs(500);
  renderLogs();
}

function renderLogs() {
  const container = $("#log-list");
  if (!container) return;
  if (!store.logs.length) {
    container.className = "log-list empty-state";
    container.textContent = "暂无日志";
    return;
  }
  container.className = "log-list";
  container.innerHTML = store.logs
    .map((log) => `<div class="log-row level-${escapeHtml(log.level)}"><time>${escapeHtml(new Date(log.timestamp).toLocaleTimeString())}</time><span>${escapeHtml(log.source)}</span><p>${escapeHtml(log.message)}</p></div>`)
    .join("");
  container.scrollTop = container.scrollHeight;
}

async function runDiagnostics() {
  const checks: Array<{ label: string; status: string; detail: string }> = [];
  const binary = await action("", () => api.binary());
  checks.push({
    label: "Mihomo sidecar",
    status: binary?.available ? "pass" : "fail",
    detail: binary?.version ?? binary?.message ?? "未找到",
  });
  const runtime = await action("", () => api.runtime());
  checks.push({
    label: "运行状态",
    status: runtime?.phase === "running" ? "pass" : "warn",
    detail: runtime?.message ?? "未运行",
  });
  checks.push({
    label: "活动配置",
    status: store.activeProfile ? "pass" : "fail",
    detail: store.activeProfile?.profile.displayName ?? "未激活配置",
  });
  checks.push({
    label: "系统代理",
    status:
      store.settings?.networkMode !== "system_proxy" || store.systemProxy?.active
        ? "pass"
        : "warn",
    detail: store.systemProxy?.active ? "已保存快照并接管" : "未接管",
  });
  if (runtime?.phase === "running") {
    const proxyResult = await action("", () => api.proxies());
    checks.push({
      label: "Mihomo API",
      status: proxyResult ? "pass" : "fail",
      detail: proxyResult ? "控制接口可访问" : "控制接口请求失败",
    });
    const networkChecks = await action("", () => api.diagnostics());
    for (const check of networkChecks ?? []) {
      checks.push({
        label:
          check.stage === "local_proxy"
            ? "本地代理端口"
            : check.stage === "controller"
              ? "控制接口端口"
              : "实际代理请求",
        status: check.success ? "pass" : "fail",
        detail:
          check.detail +
          (check.latencyMs != null ? " · " + check.latencyMs + " ms" : ""),
      });
    }
  }
  $("#diagnostic-list")!.innerHTML = checks
    .map((check) => `<div class="diagnostic-item status-${check.status}"><span class="diagnostic-icon">${check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "×"}</span><div><strong>${escapeHtml(check.label)}</strong><p>${escapeHtml(check.detail)}</p></div></div>`)
    .join("");
}

function navigate(view: ViewName) {
  const previousView = store.view;
  const scroller = $("#page-scroll");
  if (previousView !== view && scroller) {
    viewScrollPositions[previousView] = scroller.scrollTop;
  }
  store.view = view;
  document.documentElement.dataset.view = view;
  $$(".nav-item").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
    button.style.color = active ? "var(--text)" : "var(--muted)";
    button.style.borderColor = active ? "var(--line-strong)" : "transparent";
    button.style.background = active ? "rgba(81, 45, 120, 0.54)" : "transparent";
    const icon = button.querySelector<HTMLElement>("span");
    if (icon) icon.style.color = active ? "#c19aff" : "var(--muted)";
  });
  $$(".view-stack").forEach((element) =>
    element.classList.toggle("is-hidden", element.id !== `${view}-view`),
  );
  if (view === "proxies") {
    void refreshOpenAiTask();
    if (store.runtime?.phase === "running") void refreshProxies();
  }
  if (view === "subscriptions") renderSubscriptions();
  if (view === "rules" && store.runtime?.phase === "running") void refreshRules();
  if (view === "connections" && store.runtime?.phase === "running") void refreshConnections();
  if (view === "logs") void refreshLogs();
  if (view === "diagnostics") void runDiagnostics();
  if (previousView !== view) restoreViewScroll(view);
}

$$<HTMLButtonElement>(".nav-item").forEach((button) =>
  button.addEventListener("click", () => navigate(button.dataset.view as ViewName)),
);
$("#global-refresh")!.addEventListener("click", () => void refreshBase());
$("#global-start")!.addEventListener("click", () => void startRuntime());
$("#global-stop")!.addEventListener("click", () => void stopRuntime());
$("#global-system-proxy")!.addEventListener("click", () =>
  toggleGlobalNetworkMode("system_proxy"),
);
$("#global-tun")!.addEventListener("click", () => toggleGlobalNetworkMode("tun"));
$("#home-system-proxy")!.addEventListener("change", (event) => {
  const enabled = (event.target as HTMLInputElement).checked;
  void switchNetworkMode(enabled ? "system_proxy" : "manual");
});
$("#home-tun")!.addEventListener("change", (event) => {
  const enabled = (event.target as HTMLInputElement).checked;
  void switchNetworkMode(enabled ? "tun" : "manual");
});
$("#home-routing-mode")!.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-routing-mode]",
  );
  if (button?.dataset.routingMode) {
    void switchRoutingMode(
      button.dataset.routingMode as "global" | "rule" | "direct",
    );
  }
});
$("#profiles-refresh")!.addEventListener("click", () => void refreshBase());
$("#subscriptions-refresh-list")!.addEventListener("click", () => void refreshBase());
$("#subscriptions-refresh-all")!.addEventListener("click", () => void refreshAllSubscriptions());
$("#subscriptions-run-safety")!.addEventListener("click", () => void runNetworkSafetyCheck());
$("#proxies-refresh")!.addEventListener("click", () => void refreshProxies());
$("#proxies-current-node")!.addEventListener("click", () =>
  void openNodeDetails(preferredCurrentGroup()),
);
$("#rules-refresh")!.addEventListener("click", () => void refreshRules());
$("#connections-refresh")!.addEventListener("click", () => void refreshConnections());
$("#logs-refresh")!.addEventListener("click", () => void refreshLogs());
$("#run-diagnostics")!.addEventListener("click", () => void runDiagnostics());

$("#quick-subscription-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void createSubscription(
    ($("#quick-name") as HTMLInputElement).value.trim(),
    ($("#quick-url") as HTMLInputElement).value.trim(),
    ($("#quick-ua") as HTMLInputElement).value.trim() || "clash.meta",
    ($("#quick-openai-auto") as HTMLInputElement).checked,
  );
});

$("#subscription-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void createSubscription(
    ($("#subscription-name") as HTMLInputElement).value.trim(),
    ($("#subscription-url") as HTMLInputElement).value.trim(),
    ($("#subscription-ua") as HTMLInputElement).value.trim() || "clash.meta",
    ($("#subscription-openai-auto") as HTMLInputElement).checked,
  );
});

$("#managed-subscription-form")!.addEventListener("submit", (event) => {
  event.preventDefault();
  void createSubscription(
    ($("#managed-subscription-name") as HTMLInputElement).value.trim(),
    ($("#managed-subscription-url") as HTMLInputElement).value.trim(),
    ($("#managed-subscription-ua") as HTMLInputElement).value.trim() || "clash.meta",
    ($("#managed-subscription-openai") as HTMLInputElement).checked,
  );
});

$("#load-sample")!.addEventListener("click", () => {
  ($("#yaml-source") as HTMLTextAreaElement).value = sampleProfile;
  $("#yaml-summary")!.textContent = "已载入示例";
});
$("#yaml-file")!.addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    ($("#yaml-source") as HTMLTextAreaElement).value = String(reader.result ?? "");
    ($("#inline-name") as HTMLInputElement).value = file.name.replace(/\.(ya?ml)$/i, "");
    $("#yaml-summary")!.textContent = `${file.size.toLocaleString()} 字节`;
  };
  reader.readAsText(file);
});
$("#inspect-yaml")!.addEventListener("click", async () => {
  const source = ($("#yaml-source") as HTMLTextAreaElement).value;
  const summary = await action("", () => api.inspect(source));
  if (summary) {
    $("#yaml-summary")!.textContent = `${summary.nodeCount} 节点 · ${summary.proxyGroupCount} 组 · ${summary.ruleCount} 规则`;
    toast(summary.warnings[0] ?? "配置结构检查通过", summary.warnings.length ? "info" : "success");
  }
});
$("#create-inline")!.addEventListener("click", () => void createInline());

$("#profile-list")!.addEventListener("click", async (event) => {
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-profile-id]");
  if (!row?.dataset.profileId) return;
  store.selectedProfile = await api.profileDetails(row.dataset.profileId);
  renderProfiles();
});
$("#profile-detail")!.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-profile-action]");
  if (target) void handleProfileAction(target);
});

$("#subscription-manager-list")!.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-subscription-action]",
  );
  if (target) void handleSubscriptionAction(target);
});

$("#confirmation-modal")!.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.id === "confirmation-modal") {
    closeConfirmation(false);
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-confirmation-action]");
  if (button?.dataset.confirmationAction === "cancel") closeConfirmation(false);
  if (button?.dataset.confirmationAction === "confirm") closeConfirmation(true);
});

$("#proxy-groups")!.addEventListener("change", async (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>(".proxy-select");
  if (!select) return;
  await action("节点已切换", () => api.selectProxy(select.dataset.group ?? "", select.value));
  await refreshProxies();
});
$("#proxy-groups")!.addEventListener("click", async (event) => {
  const autoButton = (event.target as HTMLElement).closest<HTMLButtonElement>(".proxy-auto");
  if (autoButton?.dataset.group) {
    await action("已恢复自动选择", () =>
      api.clearProxySelection(autoButton.dataset.group!),
    );
    await refreshProxies();
    return;
  }
  const detailsButton = (event.target as HTMLElement).closest<HTMLButtonElement>(
    ".proxy-details",
  );
  if (detailsButton?.dataset.group) {
    await openNodeDetails(detailsButton.dataset.group);
    return;
  }
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".proxy-delay");
  if (!button?.dataset.proxy) return;
  const result = await action("", () => api.testProxyDelay(button.dataset.proxy!));
  if (result) toast(`延迟：${escapeHtml(result.delay ?? "—")} ms`, "success");
});

$("#openai-policy-card")!.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-openai-action]",
  );
  const actionName = button?.dataset.openaiAction;
  if (!actionName || !store.activeProfile) return;
  if (actionName === "generate") {
    await startOpenAiGeneration();
  } else if (actionName === "cancel") {
    await cancelOpenAiGeneration();
  } else if (actionName === "health") {
    const result = await action("", () =>
      api.testProxyGroup(
        OPENAI_GROUP_NAME,
        "https://api.openai.com/v1/models",
        "401",
        8_000,
      ),
    );
    if (result) {
      toast(`健康检查完成：${Object.keys(result).length} 个节点可达`, "success");
      await refreshProxies();
    }
  } else if (actionName === "details") {
    await openNodeDetails(OPENAI_GROUP_NAME);
  } else if (actionName === "auto") {
    await action("OpenAI 策略已恢复自动选择", () =>
      api.clearProxySelection(OPENAI_GROUP_NAME),
    );
    await refreshProxies();
  } else if (actionName === "disable") {
    const policy = await action("OpenAI 自动灾备已停用", () =>
      api.disableOpenAiPolicy(store.activeProfile!.profile.id),
    );
    if (policy) {
      await refreshBase();
      if (store.runtime?.phase === "running") {
        await Promise.all([refreshProxies(), refreshRules()]);
      }
    }
  }
});

$("#node-details-modal")!.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  if (target.id === "node-details-modal") {
    closeNodeDetails();
    return;
  }
  const button = target.closest<HTMLButtonElement>("[data-node-modal-action]");
  const actionName = button?.dataset.nodeModalAction;
  const details = store.nodeDetails;
  if (!actionName) return;
  if (actionName === "close") {
    closeNodeDetails();
  } else if (actionName === "retest" && details) {
    const result = await action("", () => api.testProxyDelay(details.nodeName));
    if (result) toast(`延迟：${result.delay ?? "—"} ms`, "success");
    await openNodeDetails(details.group);
  } else if (actionName === "switch" && details) {
    focusNodeGroup(details.group);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("#confirmation-modal")!.classList.contains("is-hidden")) {
    closeConfirmation(false);
    return;
  }
  if (event.key === "Escape" && !$("#node-details-modal")!.classList.contains("is-hidden")) {
    closeNodeDetails();
  }
});

$("#rule-search")!.addEventListener("input", renderRules);
$("#connections-body")!.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".close-connection");
  if (!button?.dataset.connectionId) return;
  await action("连接已关闭", () => api.closeConnection(button.dataset.connectionId!));
  await refreshConnections();
});

$("#logs-clear")!.addEventListener("click", async () => {
  await api.clearLogs();
  await refreshLogs();
});

$("#tun-helper-install")!.addEventListener("click", async () => {
  const helper = await action("TUN Helper 已提交安装", () => api.installTunHelper());
  if (helper) store.tunHelper = helper;
  await refreshBase();
});

$("#tun-helper-repair")!.addEventListener("click", async () => {
  const helper = await action("TUN Helper 已修复", () => api.repairTunHelper());
  if (helper) store.tunHelper = helper;
  await refreshBase();
});

$("#tun-helper-open-settings")!.addEventListener("click", async () => {
  await action("", () => api.openTunHelperSettings());
});

$("#tun-helper-uninstall")!.addEventListener("click", async (event) => {
  const confirmed = await confirmAction({
    title: "卸载 TUN Helper",
    message: "卸载后 TUN 模式将停止使用，Manual 与系统代理不受影响。",
    confirmLabel: "确认卸载",
    returnFocus: event.currentTarget as HTMLElement,
  });
  if (!confirmed) return;
  await action("TUN Helper 已卸载", () => api.uninstallTunHelper());
  await refreshBase();
});

$("#settings-form")!.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!store.settings || settingsSaving || themeController.snapshot.saving) return;
  const mode = ($("#settings-mode") as HTMLSelectElement).value as NetworkMode;
  const settings: AppSettings = {
    ...store.settings,
    networkMode: mode,
    mixedPort: Number(($("#settings-mixed-port") as HTMLInputElement).value),
    controllerPort: Number(($("#settings-controller-port") as HTMLInputElement).value),
    theme: themeController.snapshot.preference,
    launchAtLogin: ($("#settings-launch") as HTMLInputElement).checked,
    showGlobalTraffic: ($("#settings-global-traffic") as HTMLInputElement).checked,
    diagnosticsRetentionDays: Number(
      ($("#settings-retention") as HTMLInputElement).value,
    ),
  };
  settingsSaving = true;
  themeController.refresh();
  try {
    if (mode === "tun" && mode !== store.settings.networkMode) {
      if (!(await ensureTunHelperReady())) return;
    }
    const updated = await action("设置已保存", async () => {
      if (mode !== store.settings!.networkMode) {
        await api.setNetworkMode(mode);
      }
      return api.updateSettings(settings);
    });
    if (updated) {
      store.settings = updated;
      renderSettings();
      renderOverview();
      renderGlobalTraffic();
    }
  } finally {
    settingsSaving = false;
    themeController.refresh();
  }
});

window.setInterval(() => {
  if (store.runtime?.phase === "running") {
    void refreshRuntimeOnly();
    if (store.view === "logs") void refreshLogs();
    if (store.view === "connections") void refreshConnections();
  }
}, 3_000);

window.setInterval(() => {
  if (store.openAiTask?.running) void refreshOpenAiTask();
}, 1_000);

void listen<GlobalTrafficSnapshot>("global-traffic", (event) => {
  store.globalTraffic = event.payload;
  renderGlobalTraffic();
});

void listen<string>("navigate-view", (event) => {
  if (event.payload === "overview") navigate("overview");
});

void refreshBase();
