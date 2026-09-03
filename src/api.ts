import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  AppSettings,
  BinaryInfo,
  ConfigRevision,
  CurrentNodeDetails,
  GlobalTrafficSnapshot,
  NetworkMode,
  NetworkSafetyReport,
  OpenAiPolicy,
  OpenAiPolicyTask,
  ProfileDetails,
  ProfileOperationResult,
  ProfileRecord,
  ProfileSummary,
  RoutingMode,
  RuntimeLog,
  RuntimeStatus,
  SystemProxyStatus,
  SubscriptionOverview,
  TunHelperStatus,
} from "./types";

export const api = {
  appInfo: () => invoke<AppInfo>("app_info"),
  settings: () => invoke<AppSettings>("get_settings"),
  updateSettings: (settings: AppSettings) =>
    invoke<AppSettings>("update_settings", { settings }),
  globalTraffic: () =>
    invoke<GlobalTrafficSnapshot>("global_traffic_snapshot"),
  inspect: (source: string) =>
    invoke<ProfileSummary>("inspect_mihomo_yaml", { source }),
  profiles: () => invoke<ProfileRecord[]>("list_profiles"),
  subscriptions: () => invoke<SubscriptionOverview[]>("list_subscriptions"),
  profileDetails: (profileId: string) =>
    invoke<ProfileDetails>("get_profile_details", { profileId }),
  activeProfile: () => invoke<ProfileDetails | null>("get_active_profile"),
  createInlineProfile: (displayName: string, source: string) =>
    invoke<ProfileOperationResult>("create_inline_profile", { displayName, source }),
  createSubscriptionProfile: (
    displayName: string,
    url: string,
    userAgent: string,
    generateOpenAi = false,
  ) =>
    invoke<ProfileOperationResult>("create_subscription_profile", {
      displayName,
      url,
      userAgent,
      generateOpenAi,
    }),
  refreshProfile: (profileId: string) =>
    invoke<ProfileOperationResult>("refresh_profile", { profileId }),
  activateProfile: (profileId: string, revisionId?: string | null) =>
    invoke<ProfileDetails>("activate_profile", {
      profileId,
      revisionId: revisionId ?? null,
    }),
  rollbackProfile: (profileId: string) =>
    invoke<ProfileDetails>("rollback_profile", { profileId }),
  deleteProfile: (profileId: string) =>
    invoke<void>("delete_profile", { profileId }),
  binary: () => invoke<BinaryInfo>("probe_mihomo"),
  runtime: () => invoke<RuntimeStatus>("runtime_status"),
  startActive: () => invoke<RuntimeStatus>("start_active_profile"),
  stop: () => invoke<RuntimeStatus>("stop_mihomo"),
  logs: (limit = 300) => invoke<RuntimeLog[]>("runtime_logs", { limit }),
  clearLogs: () => invoke<void>("clear_runtime_logs"),
  systemProxy: () => invoke<SystemProxyStatus>("system_proxy_status"),
  tunHelperStatus: () => invoke<TunHelperStatus>("tun_helper_status"),
  installTunHelper: () => invoke<TunHelperStatus>("install_tun_helper"),
  repairTunHelper: () => invoke<TunHelperStatus>("repair_tun_helper"),
  uninstallTunHelper: () => invoke<void>("uninstall_tun_helper"),
  openTunHelperSettings: () => invoke<void>("open_tun_helper_settings"),
  prepareTun: () => invoke<void>("prepare_tun_active_profile"),
  setNetworkMode: (mode: NetworkMode) =>
    invoke<AppSettings>("set_network_mode", { mode }),
  setProfileRoutingMode: (profileId: string, mode: RoutingMode) =>
    invoke<ProfileDetails>("set_profile_routing_mode", { profileId, mode }),
  proxies: () => invoke<Record<string, unknown>>("get_proxies"),
  currentNodeDetails: (group: string) =>
    invoke<CurrentNodeDetails>("get_current_node_details", { group }),
  rules: () => invoke<Record<string, unknown>>("get_rules"),
  connections: () => invoke<Record<string, unknown>>("get_connections"),
  selectProxy: (group: string, proxy: string) =>
    invoke<void>("select_proxy", { group, proxy }),
  clearProxySelection: (group: string) =>
    invoke<void>("clear_proxy_selection", { group }),
  testProxyDelay: (proxy: string, url?: string, timeoutMs = 5_000) =>
    invoke<Record<string, unknown>>("test_proxy_delay", {
      proxy,
      url: url ?? null,
      timeoutMs,
    }),
  testProxyGroup: (
    group: string,
    url?: string,
    expectedStatus?: string,
    timeoutMs = 8_000,
  ) =>
    invoke<Record<string, number>>("test_proxy_group", {
      group,
      url: url ?? null,
      expectedStatus: expectedStatus ?? null,
      timeoutMs,
    }),
  startOpenAiPolicyGeneration: (profileId: string, autoMaintain = true) =>
    invoke<OpenAiPolicyTask>("start_openai_policy_generation", {
      profileId,
      autoMaintain,
    }),
  openAiPolicyTask: () =>
    invoke<OpenAiPolicyTask>("get_openai_policy_task"),
  cancelOpenAiPolicyGeneration: () =>
    invoke<OpenAiPolicyTask>("cancel_openai_policy_generation"),
  disableOpenAiPolicy: (profileId: string) =>
    invoke<OpenAiPolicy>("disable_openai_policy", { profileId }),
  closeConnection: (connectionId: string) =>
    invoke<void>("close_connection", { connectionId }),
  diagnostics: () =>
    invoke<Array<{ stage: string; success: boolean; latencyMs: number | null; detail: string }>>(
      "run_connectivity_diagnostics",
    ),
  networkSafety: () =>
    invoke<NetworkSafetyReport>("run_network_safety_check"),
};

export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; code?: unknown };
    const message = typeof value.message === "string" ? value.message : JSON.stringify(error);
    return typeof value.code === "string" ? `${value.code}: ${message}` : message;
  }
  return String(error);
}

export function revisionLabel(revision: ConfigRevision): string {
  return new Date(revision.fetchedAt).toLocaleString();
}
