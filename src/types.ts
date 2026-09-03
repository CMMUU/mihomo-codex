import type { ThemePreference } from "./theme";

export type NetworkMode = "manual" | "system_proxy" | "tun";
export type RoutingMode = "rule" | "global" | "direct";

export type OpenAiNodeScore = {
  name: string;
  latencyMs: number;
  jitterMs: number;
  bandwidthMbps: number | null;
  score: number;
  checkedAt: string;
};

export type OpenAiPolicy = {
  enabled: boolean;
  autoMaintain: boolean;
  maxNodes: number;
  selectedNodes: OpenAiNodeScore[];
  candidateCount: number;
  healthyCount: number;
  lastBenchmarkedAt: string | null;
  benchmarkVersion: number;
};

export type OpenAiTaskPhase =
  | "idle"
  | "preparing"
  | "checking"
  | "bandwidth"
  | "applying"
  | "completed"
  | "failed"
  | "cancelled";

export type OpenAiPolicyTask = {
  running: boolean;
  profileId: string | null;
  phase: OpenAiTaskPhase;
  completed: number;
  total: number;
  message: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: OpenAiPolicy | null;
};

export type AppSettings = {
  schemaVersion: number;
  locale: string;
  theme: ThemePreference;
  launchAtLogin: boolean;
  showGlobalTraffic: boolean;
  networkMode: NetworkMode;
  mixedPort: number;
  controllerPort: number;
  updateChannel: string;
  diagnosticsRetentionDays: number;
};

export type GlobalTrafficSnapshot = {
  enabled: boolean;
  uploadBytesPerSecond: number;
  downloadBytesPerSecond: number;
  sampledAt: string | null;
  interfaces: string[];
};

export type RuntimeStatus = {
  state: string;
  phase: string;
  binaryAvailable: boolean;
  binaryPath: string | null;
  version: string | null;
  configPath: string | null;
  message: string;
  pid: number | null;
  startedAt: string | null;
  lastError: string | null;
};

export type RuntimeLog = {
  timestamp: string;
  level: string;
  source: string;
  message: string;
};

export type ProfileSource =
  | { type: "remote_subscription"; host: string; userAgent: string }
  | { type: "local_file"; sourcePath: string }
  | { type: "inline"; label: string };

export type ProfileRecord = {
  schemaVersion: number;
  id: string;
  displayName: string;
  source: ProfileSource;
  routingMode: RoutingMode;
  openaiPolicy: OpenAiPolicy;
  activeRevisionId: string | null;
  lastKnownGoodRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubscriptionMetadata = {
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  bytes: number;
};

export type ValidationReport = {
  valid: boolean;
  warnings: string[];
  errors: string[];
  nativeCoreValidated: boolean;
};

export type ConfigRevision = {
  schemaVersion: number;
  id: string;
  profileId: string;
  sourceSha256: string;
  effectiveSha256: string;
  fetchedAt: string;
  subscription: SubscriptionMetadata | null;
  validation: ValidationReport;
  openaiPolicy: OpenAiPolicy;
};

export type ProfileSummary = {
  format: string;
  nodeCount: number;
  proxyGroupCount: number;
  proxyProviderCount: number;
  ruleCount: number;
  ruleProviderCount: number;
  dnsConfigured: boolean;
  tunConfigured: boolean;
  nodeProtocols: string[];
  proxyGroupTypes: string[];
  unsupportedGroupTypes: string[];
  warnings: string[];
};

export type ProfileOperationResult = {
  profile: ProfileRecord;
  revision: ConfigRevision;
  summary: ProfileSummary;
  updated: boolean;
};

export type ProfileDetails = {
  profile: ProfileRecord;
  revisions: ConfigRevision[];
  summary: ProfileSummary | null;
};

export type SubscriptionOverview = {
  profile: ProfileRecord;
  summary: ProfileSummary | null;
  revisionCount: number;
  latestFetchedAt: string | null;
  latestMetadata: SubscriptionMetadata | null;
  latestValidation: ValidationReport | null;
  active: boolean;
};

export type NodeDelaySample = {
  time: string | null;
  delayMs: number;
};

export type CurrentNodeDetails = {
  group: string;
  nodeName: string;
  routeChain: string[];
  nodeType: string;
  alive: boolean | null;
  udp: boolean | null;
  uot: boolean | null;
  xudp: boolean | null;
  tfo: boolean | null;
  mptcp: boolean | null;
  smux: boolean | null;
  providerName: string | null;
  maskedServer: string | null;
  port: number | null;
  network: string | null;
  tls: string | null;
  dialerProxy: string | null;
  interface: string | null;
  history: NodeDelaySample[];
  lastDelayMs: number | null;
};

export type NetworkSafetyCheck = {
  target: string;
  url: string;
  success: boolean;
  expectedStatus: number;
  actualStatus: number | null;
  latencyMs: number;
  detail: string;
};

export type NetworkSafetyReport = {
  success: boolean;
  proxyEndpoint: string;
  checks: NetworkSafetyCheck[];
};

export type BinaryInfo = {
  available: boolean;
  path: string | null;
  version: string | null;
  message: string;
};

export type SystemProxyStatus = {
  active: boolean;
  snapshotPath: string | null;
  platform: string;
};

export type TunHelperState =
  | "unsupported"
  | "not_installed"
  | "requires_approval"
  | "ready"
  | "outdated"
  | "unreachable";

export type TunHelperStatus = {
  supported: boolean;
  state: TunHelperState;
  message: string;
  protocolVersion: number;
  runtimeRunning: boolean;
  runtimePid: number | null;
  runtimeVersion: string | null;
  lastError: string | null;
};

export type AppInfo = {
  productName: string;
  version: string;
  targetOs: string;
  targetArch: string;
};

export type AppError = {
  code?: string;
  stage?: string;
  message?: string;
  retryable?: boolean;
};
