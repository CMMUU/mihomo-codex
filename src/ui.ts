/** Code-native desktop primitives shared by the shell and preference groups. */
const ICONS = {
  home: '<path d="m3 10 9-7 9 7M5 9v11h5v-7h4v7h5V9"/>',
  archive: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 11h16M8 7h3M8 15h3M15 7h1M15 15h1"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6.5h14M5 17.5h14"/>',
  desktop: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M6 8h12M6 11h7"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  arrows: '<path d="M3 7h17l-4-4M21 17H4l4 4"/>',
  document: '<path d="M14 3H5v18h14V8zm0 0v5h5M8 12h8M8 16h8M8 8h2"/>',
  pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
  gear: '<path d="m9 3-.6 2.3-2 .9L4.2 5.5 2.7 8l1.6 1.7-.2 2.4L2.5 14 4 16.6l2.3-.4 1.9 1.4.6 2.4h3l.8-2.2 2.2-.9 2.2.5 1.5-2.6-1.5-1.9.1-2.2 1.6-1.9-1.5-2.6-2.3.6-2-1L12 3Z"/><circle cx="10.5" cy="11.5" r="3"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
} as const;

export function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export const NAV_ITEMS = [
  { id: "overview", label: "概览", icon: "home", color: "blue" },
  { id: "profiles", label: "配置", icon: "archive", color: "purple" },
  { id: "subscriptions", label: "订阅", icon: "refresh", color: "green" },
  { id: "proxies", label: "代理", icon: "globe", color: "orange" },
  { id: "programs", label: "程序代理", icon: "desktop", color: "blue" },
  { id: "rules", label: "规则", icon: "list", color: "purple" },
  { id: "connections", label: "连接", icon: "arrows", color: "green" },
  { id: "logs", label: "日志", icon: "document", color: "yellow" },
  { id: "diagnostics", label: "诊断", icon: "pulse", color: "red" },
  { id: "settings", label: "设置", icon: "gear", color: "blue" },
] as const;

export type ViewName = typeof NAV_ITEMS[number]["id"];

export const navigationMarkup = NAV_ITEMS.map((item) => `
  <button class="nav-item${item.id === "overview" ? " is-active" : ""}" data-view="${item.id}" title="${item.label}"${item.id === "overview" ? ' aria-current="page"' : ""}>
    <span class="nav-icon nav-icon-${item.color}">${icon(item.icon)}</span>${item.label}
  </button>`).join("");

/** The surrounding label supplies the accessible name; native checked state is retained. */
export function preferenceSwitch(id: string): string {
  return `<span class="toggle-switch"><input id="${id}" type="checkbox" role="switch" /><span class="toggle-track" aria-hidden="true"><span class="toggle-thumb"></span></span></span>`;
}
