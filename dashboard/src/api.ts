const BASE = import.meta.env.VITE_API_URL || ''

export interface AlpacaAsset { symbol: string; name: string }
export interface OHLCBar { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }

export interface AssetSnapshot {
  price: number; change_24h: number; volume_24h: number
  high_24h: number; low_24h: number; rsi_14?: number
}
export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold'; asset: string
  amount_usd: number; confidence: number; reasoning: string
}
export interface TradeOutcome {
  pnl_pct: number; pnl_usd: number; price_at_resolve: number
  resolved_at: string; correct: boolean
}
export interface Trade {
  _id: string; timestamp: string
  market: Record<string, AssetSnapshot>
  portfolio: { cash_usd: number; positions: Record<string, number> }
  decision: TradeDecision; outcome?: TradeOutcome
  strategy_id?: string; strategy_label?: string
  order_id?: string; approval_mode?: 'manual' | 'auto'; approved: boolean; executed: boolean
  execution_error?: string
  sl_price?: number; tp_price?: number
}
export interface Stats {
  total_decisions: number; executed_trades: number
  profitable_trades: number; win_rate: string
  total_pnl_usd: string; dataset_size: number
}
export interface TradesResponse { trades: Trade[]; total: number; page: number; limit: number }
export interface LogEntry { ts: string; level: 'info' | 'warn' | 'error'; msg: string }
export interface AgentConfig {
  autoApprove: boolean
  stopLossPct: number
  takeProfitPct: number
  maxDrawdownPct: number
  maxOpenPositions: number
  claudeModel: string
  cycleMinutes: number
  marketDataMinutes: number
  confidenceThreshold: number
  kellyEnabled: boolean
  consensusMode: boolean
  consensusModel: string
  costAwareTrading: boolean
  costLookbackCalls: number
  costProfitRatio: number
  trailingStopEnabled: boolean
  trailingStopPct: number
  activeStrategy: string
  strategyParams: Record<string, Record<string, number | boolean | string>>
  autoFallbackToLlm: boolean
}

export interface ParamDef {
  key: string; label: string; type: 'number' | 'boolean' | 'select'
  default: number | boolean | string
  min?: number; max?: number; step?: number; options?: string[]
  gridValues?: (number | boolean | string)[]; help?: string
}

export interface StrategyInfo {
  id: string; label: string; description: string; params: ParamDef[]
}

export interface CompareStrategyResult {
  strategyId: string; label: string
  result: BacktestResult
  equityCurve: { ts: string; equity: number }[]
}

export interface CompareResult {
  strategies: CompareStrategyResult[]
}

export interface OptimizeRun {
  params: Record<string, number | boolean | string>
  sharpe: number; sortino: number; totalReturn: number
  maxDrawdown: number; winRate: number; totalTrades: number
}

export interface OptimizeResult {
  strategyId: string; bestParams: Record<string, number | boolean | string>
  bestSharpe: number; totalRuns: number; runs: OptimizeRun[]
}

export interface HealthStatus {
  status: 'ok' | 'degraded'
  mongodb: boolean; anthropicKeySet: boolean; openaiKeySet: boolean; alpacaKeySet: boolean
  lastCycleAt: string | null; uptime: number
}
export interface AuditEvent { _id: string; ts: string; user: string; action: string; details: string; ip?: string }
export interface BacktestResult {
  _id?: string; runAt: string
  params: { assets: string[]; startDate: string; endDate: string; cycleHours: number; model: string; mode: string }
  startEquity: number; finalEquity: number; totalReturn: number
  maxDrawdown: number; winRate: number; totalTrades: number
  trades?: BacktestTrade[]
  sharpe?: number
  sortino?: number
}
export interface BacktestTrade { ts: string; asset: string; action: string; price: number; amount_usd: number; confidence: number; pnl_usd: number }
export interface BenchmarkPoint { ts: string; equity: number; benchmark: number }
export interface BenchmarkData { points: BenchmarkPoint[]; benchmarkAsset: string }
export interface LivePrices { [asset: string]: { price: number; change24h: number } }
export interface TrainingStatus {
  provider: 'claude' | 'ollama'
  ollamaModel: string; ollamaBase: string; ollamaReachable: boolean
  datasetSize: number; lastExport: string | null; lastExportFile: string | null
}
export interface EquityPoint { ts: string; equity: number; cash: number; peak: number }
export interface PortfolioPosition {
  asset: string; qty: number; entry_price: number; current_price: number
  market_value: number; unrealized_pl: number; unrealized_plpc: number
}
export interface PortfolioDetail {
  cash: number; equity: number; positions: PortfolioPosition[]
}
export interface AssetPnl {
  asset: string; total_pnl: number; trade_count: number; win_rate: number
}
export interface RiskStatus {
  circuitBreakerActive: boolean; circuitBreakerReason?: string
  openPositions: number; todayPnl: number
  maxDrawdownPct: number; maxOpenPositions: number
}
export interface TokenModelStat {
  model: string; input_tokens: number; output_tokens: number; cost_usd: number; calls: number
}
export interface TokenDailyStat {
  date: string; cost_usd: number; input_tokens: number; output_tokens: number; calls: number
}
export interface TokenStats {
  total_calls: number; total_input: number; total_output: number; total_cost: number
  by_model: TokenModelStat[]; daily: TokenDailyStat[]
}
export interface TokenUsageRow {
  _id: string; ts: string; llm_model: string
  input_tokens: number; output_tokens: number; cost_usd: number; context: string
}

export type KeyName = 'anthropic_api_key' | 'openai_api_key' | 'alpaca_api_key' | 'alpaca_api_secret' | 'alpaca_base_url'
export type MaskedKeys = Record<KeyName, string>

export interface AlpacaPosition {
  symbol: string
  qty: string
  avg_entry_price: string
  current_price: string
  market_value: string
  unrealized_pl: string
  unrealized_plpc: string
  side: 'long' | 'short'
}

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'user'
  blocked?: boolean
  twoFactorEnabled: boolean
}

export interface EngineStatus {
  userId: string
  username: string
  role: 'admin' | 'user'
  active: boolean
  paused: boolean
  blocked: boolean
  cycles: number
  lastCycleAt: string | null
  nextCycleAt: string | null
  lastDataRefreshAt: string | null
  nextDataRefreshAt: string | null
  nextOutcomeAt: string | null
  nextRiskCheckAt: string | null
  cycleIntervalMinutes: number | null
  dataIntervalMinutes: number | null
  outcomeIntervalMinutes: number
  riskIntervalMinutes: number
  lastError: string | null
}
export interface AdminUser {
  id: string
  username: string
  role: 'admin' | 'user'
  blocked: boolean
  blockedAt: string | null
  blockedReason: string | null
  twoFactorEnabled: boolean
}
export interface WalletInfo {
  id: string
  name: string
  active: boolean
  alpaca_api_key_masked: string
  alpaca_api_secret_masked: string
  alpaca_base_url: string
}

export interface LoginOkResponse { token: string }
export interface Login2faResponse { requires2fa: true; tempToken: string }
export type LoginResponse = LoginOkResponse | Login2faResponse

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const auth = {
  getToken: () => localStorage.getItem('token'),
  setToken: (t: string) => localStorage.setItem('token', t),
  clearToken: () => localStorage.removeItem('token'),
  isLoggedIn: () => !!localStorage.getItem('token'),
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = auth.getToken()
  const headers: Record<string, string> = {
    ...(opts?.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...opts, headers })

  if (res.status === 401 && token) {
    auth.clearToken()
    window.location.reload()
    throw new Error('Session expired')
  }
  if (!res.ok) {
    let msg = `API error ${res.status}`
    let parsedError = ''
    try {
      const body = await res.json()
      if (body?.error && typeof body.error === 'string') {
        msg = body.error
        parsedError = body.error
      }
    } catch { /* ignore */ }
    if (res.status === 403 && token && parsedError.toLowerCase().includes('blocked')) {
      auth.clearToken()
      window.location.reload()
      throw new Error('Account is blocked')
    }
    throw new Error(msg)
  }
  return res.json()
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  // Models
  fetchModels:    (provider: 'claude' | 'openai') =>
    req<{ models: { id: string; name: string }[] }>(`/api/models?provider=${provider}`),

  // Auth
  login:          (username: string, password: string) =>
    req<LoginResponse>('/api/auth/login', json({ username, password })),
  register:       (username: string, password: string) =>
    req<{ user: AuthUser }>('/api/auth/register', json({ username, password })),
  login2fa:       (tempToken: string, code: string) =>
    req<{ token: string }>('/api/auth/login/2fa', json({ tempToken, code })),
  me:             () =>
    req<{ user: AuthUser }>('/api/auth/me'),
  start2faSetup:  () =>
    req<{ secret: string; otpauthUrl: string }>('/api/auth/2fa/setup', { method: 'POST' }),
  verify2faSetup: (code: string) =>
    req<{ success: boolean }>('/api/auth/2fa/verify', json({ code })),
  disable2fa:     (password: string, code: string) =>
    req<{ success: boolean }>('/api/auth/2fa/disable', json({ password, code })),
  adminEngines:    () =>
    req<{ engines: EngineStatus[] }>('/api/admin/engines'),
  adminUsers:      () =>
    req<{ users: AdminUser[] }>('/api/admin/users'),
  adminBlockUser:  (userId: string, reason?: string) =>
    req<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/block`, json({ reason: reason || '' })),
  adminUnblockUser:(userId: string) =>
    req<{ success: boolean }>(`/api/admin/users/${encodeURIComponent(userId)}/unblock`, { method: 'POST' }),
  adminPauseEngine: (userId: string) =>
    req<{ success: boolean }>(`/api/admin/engines/${encodeURIComponent(userId)}/pause`, { method: 'POST' }),
  adminResumeEngine: (userId: string) =>
    req<{ success: boolean }>(`/api/admin/engines/${encodeURIComponent(userId)}/resume`, { method: 'POST' }),
  adminTriggerEngine: (userId: string) =>
    req<{ success: boolean }>(`/api/admin/engines/${encodeURIComponent(userId)}/trigger`, { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ success: boolean }>('/api/auth/change-password', json({ currentPassword, newPassword })),

  // API Key management
  getKeys:        () => req<MaskedKeys>('/api/keys'),
  setKey:         (key: KeyName, value: string) => req<{ success: boolean }>('/api/keys', json({ key, value })),
  wallets:        () => req<{ wallets: WalletInfo[] }>('/api/wallets'),
  createWallet:   (body: { name: string; alpaca_api_key: string; alpaca_api_secret: string; alpaca_base_url?: string }) =>
    req<{ wallet: WalletInfo }>('/api/wallets', json(body)),
  activateWallet: (walletId: string) =>
    req<{ success: boolean }>(`/api/wallets/${encodeURIComponent(walletId)}/activate`, { method: 'POST' }),
  deleteWallet:   (walletId: string) =>
    req<{ success: boolean }>(`/api/wallets/${encodeURIComponent(walletId)}`, { method: 'DELETE' }),

  stats:          (walletId?: string) => req<Stats>(`/api/stats${walletId ? `?walletId=${walletId}` : ''}`),
  trades:         (page = 1, limit = 50, walletId?: string) => req<TradesResponse>(`/api/trades?page=${page}&limit=${limit}${walletId ? `&walletId=${walletId}` : ''}`),
  pending:        () => req<Trade[]>('/api/trades/pending'),
  approve:        (id: string) => req<{success:boolean}>(`/api/trades/${id}/approve`, {method:'POST'}),
  reject:         (id: string) => req<{success:boolean}>(`/api/trades/${id}/reject`, {method:'POST'}),
  exportDataset:  () => req<{success:boolean;count:number}>('/api/dataset/export', {method:'POST'}),
  logs:           (limit = 150) => req<LogEntry[]>(`/api/logs?limit=${limit}`),
  trainingStatus: () => req<TrainingStatus>('/api/training/status'),
  getConfig:      () => req<AgentConfig>('/api/config'),
  setConfig:      (cfg: Partial<AgentConfig>) => req<AgentConfig>('/api/config', json(cfg)),
  setRiskConfig:  (cfg: Partial<AgentConfig>) => req<AgentConfig>('/api/config/risk', json(cfg)),
  datasetDownloadUrl: () => `${BASE}/api/dataset/download`,

  // Assets
  availableAssets: () => req<AlpacaAsset[]>('/api/assets/available'),
  activeAssets:    () => req<string[]>('/api/assets/active'),
  setActiveAssets: (assets: string[]) => req<string[]>('/api/assets/active', json({ assets })),

  // Charts
  chartBars: (asset: string, timeframe = '1H', limit = 150) =>
    req<OHLCBar[]>(`/api/charts/${encodeURIComponent(asset)}?timeframe=${timeframe}&limit=${limit}`),

  equityHistory:   (limit = 200, walletId?: string) => req<EquityPoint[]>(`/api/equity/history?limit=${limit}${walletId ? `&walletId=${walletId}` : ''}`),
  portfolioDetail: () => req<PortfolioDetail>('/api/portfolio/detail'),
  perAssetPnl:     (walletId?: string) => req<AssetPnl[]>(`/api/stats/per-asset${walletId ? `?walletId=${walletId}` : ''}`),
  riskStatus:      () => req<RiskStatus>('/api/risk/status'),

  tokenStats:      () => req<TokenStats>('/api/tokens/stats'),
  tokenHistory:    (limit = 200) => req<TokenUsageRow[]>(`/api/tokens/history?limit=${limit}`),

  // Public endpoints (no auth)
  health:          async () => { const r = await fetch('/api/health'); return r.json() as Promise<HealthStatus> },
  livePrices:      async () => { const r = await fetch('/api/prices/live'); return r.json() as Promise<LivePrices> },

  // Audit
  audit:           (limit?: number) => req<{ events: AuditEvent[] }>(`/api/audit?limit=${limit ?? 100}`),

  // Prompt
  getPrompt:       () => req<{ systemPrompt: string | null }>('/api/prompt'),
  setPrompt:       (systemPrompt: string) => req<{ success: boolean }>('/api/prompt', json({ systemPrompt })),
  deletePrompt:    () => req<{ success: boolean }>('/api/prompt', { method: 'DELETE' }),

  // Agent control
  agentStatus:    () => req<{ paused: boolean; blocked: boolean }>('/api/agent/status'),
  pauseAgent:     () => req<{ paused: boolean }>('/api/agent/pause', { method: 'POST' }),
  resumeAgent:    () => req<{ paused: boolean }>('/api/agent/resume', { method: 'POST' }),

  // Positions
  positions:      () => req<AlpacaPosition[]>('/api/positions'),

  // Live logs
  agentLogs:      (limit?: number) => req<{ logs: LogEntry[] }>(`/api/agent/logs?limit=${limit ?? 150}`),

  // Backtest
  runBacktest:     (params: object) => req<BacktestResult>('/api/backtest', json(params)),
  backtestResults: () => req<BacktestResult[]>('/api/backtest/results'),

  // Strategy system
  listStrategies:    () => req<{ strategies: StrategyInfo[] }>('/api/strategies'),
  strategyParams:    (id: string) => req<Record<string, number|boolean|string>>(`/api/strategy/params?strategyId=${id}`),
  setStrategyParams: (id: string, params: Record<string, number|boolean|string>) =>
    req<{ success: boolean }>('/api/strategy/params', json({ strategyId: id, params })),
  setActiveStrategy: (activeStrategy: string, autoFallbackToLlm?: boolean) =>
    req<AgentConfig>('/api/config/strategy', json({ activeStrategy, autoFallbackToLlm })),
  backtestCompare:   (body: object) => req<CompareResult>('/api/backtest/compare', json(body)),
  runOptimize:       (body: object) => req<OptimizeResult>('/api/optimize', json(body)),
  optimizeResults:   (strategyId?: string) =>
    req<OptimizeResult[]>(`/api/optimize/results${strategyId ? `?strategyId=${strategyId}` : ''}`),

  // Benchmark
  benchmark:       () => req<BenchmarkData>('/api/equity/benchmark'),

  // Reasoning
  reasoning: (params?: { asset?: string; action?: string; outcome?: string; limit?: number; page?: number }) => {
    const q = new URLSearchParams()
    if (params?.asset)   q.set('asset', params.asset)
    if (params?.action)  q.set('action', params.action)
    if (params?.outcome) q.set('outcome', params.outcome)
    if (params?.limit)   q.set('limit', String(params.limit))
    if (params?.page)    q.set('page', String(params.page))
    return req<{ trades: Trade[]; total: number }>(`/api/trades/reasoning?${q}`)
  },
}

export const platformApi = {
  fetchModels: api.fetchModels,
  login: api.login,
  register: api.register,
  login2fa: api.login2fa,
  me: api.me,
  start2faSetup: api.start2faSetup,
  verify2faSetup: api.verify2faSetup,
  disable2fa: api.disable2fa,
  adminEngines: api.adminEngines,
  adminUsers: api.adminUsers,
  adminBlockUser: api.adminBlockUser,
  adminUnblockUser: api.adminUnblockUser,
  adminPauseEngine: api.adminPauseEngine,
  adminResumeEngine: api.adminResumeEngine,
  adminTriggerEngine: api.adminTriggerEngine,
  changePassword: api.changePassword,
  getKeys: api.getKeys,
  setKey: api.setKey,
  wallets: api.wallets,
  createWallet: api.createWallet,
  activateWallet: api.activateWallet,
  deleteWallet: api.deleteWallet,
  audit: api.audit,
  getPrompt: api.getPrompt,
  setPrompt: api.setPrompt,
  deletePrompt: api.deletePrompt,
  health: api.health,
  livePrices: api.livePrices,
}

export const agentApi = {
  stats: api.stats,
  trades: api.trades,
  pending: api.pending,
  approve: api.approve,
  reject: api.reject,
  exportDataset: api.exportDataset,
  logs: api.logs,
  trainingStatus: api.trainingStatus,
  getConfig: api.getConfig,
  setConfig: api.setConfig,
  setRiskConfig: api.setRiskConfig,
  datasetDownloadUrl: api.datasetDownloadUrl,
  availableAssets: api.availableAssets,
  activeAssets: api.activeAssets,
  setActiveAssets: api.setActiveAssets,
  chartBars: api.chartBars,
  equityHistory: api.equityHistory,
  portfolioDetail: api.portfolioDetail,
  perAssetPnl: api.perAssetPnl,
  riskStatus: api.riskStatus,
  tokenStats: api.tokenStats,
  tokenHistory: api.tokenHistory,
  agentStatus: api.agentStatus,
  pauseAgent: api.pauseAgent,
  resumeAgent: api.resumeAgent,
  positions: api.positions,
  agentLogs: api.agentLogs,
  runBacktest: api.runBacktest,
  backtestResults: api.backtestResults,
  listStrategies: api.listStrategies,
  strategyParams: api.strategyParams,
  setStrategyParams: api.setStrategyParams,
  setActiveStrategy: api.setActiveStrategy,
  backtestCompare: api.backtestCompare,
  runOptimize: api.runOptimize,
  optimizeResults: api.optimizeResults,
  benchmark: api.benchmark,
  reasoning: api.reasoning,
}

export async function getStatsPerPeriod(period: 'daily' | 'weekly' | 'monthly', walletId?: string): Promise<Array<{
  period: string
  total_pnl: number
  trade_count: number
  win_rate: number
  avg_win: number | null
  avg_loss: number | null
}>> {
  return req(`/api/stats/per-period?period=${period}${walletId ? `&walletId=${walletId}` : ''}`)
}

// WebSocket URL with JWT token injected at call time
export function getWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base  = `${proto}//${window.location.host}/ws`
  const token = auth.getToken()
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

// Keep WS_URL for any legacy imports
export const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
})()

function authHeaders(): Record<string, string> {
  const token = auth.getToken()
  return token ? { 'Authorization': `Bearer ${token}` } : {}
}

export async function getActiveWalletMode(): Promise<{ id: string | null; mode: 'paper' | 'live'; exchange: string; name: string }> {
  const res = await fetch('/api/wallets/active-mode', { headers: authHeaders() })
  return res.json()
}

export async function setWalletMode(walletId: string, mode: 'paper' | 'live', token?: string): Promise<{ id: string; mode: string }> {
  const res = await fetch(`/api/wallets/${walletId}/mode`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, token }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to set mode')
  }
  return res.json()
}
