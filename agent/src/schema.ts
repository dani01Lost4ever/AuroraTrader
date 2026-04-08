import mongoose, { Schema, Document } from 'mongoose'

export interface AssetSnapshot {
  price: number
  change_24h: number
  change_7d?: number       // 7-day price change % (from daily bars)
  volume_24h: number
  volume_sma20?: number    // 20-bar average hourly volume
  high_24h: number
  low_24h: number
  rsi_14?: number
  ema_9?: number           // 9-period EMA (short-term trend)
  ema_21?: number          // 21-period EMA (medium-term trend)
  macd?: number            // MACD line (EMA12 - EMA26)
  macd_signal?: number     // Signal line (EMA9 of MACD)
  macd_hist?: number       // Histogram (MACD - signal)
  bb_upper?: number        // Bollinger Band upper (SMA20 + 2σ)
  bb_lower?: number        // Bollinger Band lower (SMA20 - 2σ)
  bb_pct?: number          // Price position within bands: 0=lower, 1=upper
  atr_14?: number          // Average True Range — volatility in price units
  daily_sma50?: number     // 50-day SMA from daily bars
}

export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold'
  asset: string
  amount_usd: number
  confidence: number
  reasoning: string
}

export interface TradeOutcome {
  pnl_pct: number
  pnl_usd: number
  price_at_resolve: number
  resolved_at: Date
  correct: boolean
}

export interface TradeRecord extends Document {
  userId: string
  timestamp: Date
  market: Record<string, AssetSnapshot>
  portfolio: { cash_usd: number; positions: Record<string, number> }
  decision: TradeDecision
  strategy_id?: string
  strategy_label?: string
  outcome?: TradeOutcome
  order_id?: string
  approval_mode: 'manual' | 'auto'
  approved: boolean
  executed: boolean
  execution_error?: string
  sl_price?: number
  tp_price?: number
  close_reason?: 'sl' | 'tp' | 'manual' | 'timeout'
  closed_at?: Date
}

const TradeRecordSchema = new Schema<TradeRecord>({
  userId: { type: String, required: true, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  market: { type: Schema.Types.Mixed, required: true },
  portfolio: { type: Schema.Types.Mixed, required: true },
  decision: {
    action: { type: String, enum: ['buy', 'sell', 'hold'], required: true },
    asset: { type: String, required: true },
    amount_usd: { type: Number, required: true },
    confidence: { type: Number, required: true },
    reasoning: { type: String, required: true },
  },
  strategy_id: String,
  strategy_label: String,
  outcome: {
    pnl_pct: Number,
    pnl_usd: Number,
    price_at_resolve: Number,
    resolved_at: Date,
    correct: Boolean,
  },
  order_id: String,
  approval_mode: { type: String, enum: ['manual', 'auto'], default: 'manual' },
  approved: { type: Boolean, default: false },
  executed: { type: Boolean, default: false },
  execution_error: String,
  sl_price: { type: Number },
  tp_price: { type: Number },
  close_reason: { type: String, enum: ['sl', 'tp', 'manual', 'timeout'] },
  closed_at: { type: Date },
})
TradeRecordSchema.index({ userId: 1, timestamp: -1 })

export const TradeModel = mongoose.model<TradeRecord>('Trade', TradeRecordSchema)

// ─── Agent config (single document, upserted by key) ─────────────────────────
export interface ConfigRecord extends Document {
  key: string
  userId?: string
  autoApprove: boolean
  assets: string[]
  [key: string]: any
}

const ConfigSchema = new Schema<ConfigRecord>({
  key:                 { type: String, default: 'agent' },
  userId:              { type: String, default: '__global__', index: true },
  autoApprove:         { type: Boolean, default: false },
  assets:              { type: [String], default: [] },
  stopLossPct:         { type: Number, default: 5 },
  takeProfitPct:       { type: Number, default: 10 },
  maxDrawdownPct:      { type: Number, default: 10 },
  maxOpenPositions:    { type: Number, default: 3 },
  claudeModel:         { type: String, default: '' },
  cycleMinutes:        { type: Number, default: 30 },
  marketDataMinutes:   { type: Number, default: 5 },
  confidenceThreshold: { type: Number, default: 0 },
  kellyEnabled:        { type: Boolean, default: false },
  consensusMode:       { type: Boolean, default: false },
  consensusModel:      { type: String, default: '' },
  costAwareTrading:    { type: Boolean, default: true },
  costLookbackCalls:   { type: Number, default: 20 },
  costProfitRatio:     { type: Number, default: 1 },
  trailingStopEnabled: { type: Boolean, default: false },
  trailingStopPct:     { type: Number, default: 2.5 },
  activeStrategy:    { type: String, default: 'llm' },
  strategyParams:    { type: Schema.Types.Mixed, default: {} },
  autoFallbackToLlm: { type: Boolean, default: false },
})
ConfigSchema.index({ key: 1, userId: 1 }, { unique: true })

export const ConfigModel = mongoose.model<ConfigRecord>('Config', ConfigSchema)

// ─── Equity snapshots (for drawdown chart) ───────────────────────────────────
export interface EquitySnapshotDoc extends Document {
  userId: string
  ts: Date
  equity: number
  cash: number
  peak: number
}

const EquitySnapshotSchema = new Schema<EquitySnapshotDoc>({
  userId: { type: String, required: true, index: true },
  ts:     { type: Date, default: Date.now, index: true },
  equity: { type: Number, required: true },
  cash:   { type: Number, required: true },
  peak:   { type: Number, required: true },
})

export const EquityModel = mongoose.model<EquitySnapshotDoc>('EquitySnapshot', EquitySnapshotSchema)

// ─── Token usage (LLM cost tracking) ─────────────────────────────────────────
export interface TokenUsageDoc extends Document {
  userId: string
  ts: Date
  llm_model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  context: string   // e.g. 'trade_decision'
}

const TokenUsageSchema = new Schema<TokenUsageDoc>({
  userId:        { type: String, required: true, index: true },
  ts:            { type: Date, default: Date.now, index: true },
  llm_model:     { type: String, required: true },
  input_tokens:  { type: Number, required: true },
  output_tokens: { type: Number, required: true },
  cost_usd:      { type: Number, required: true },
  context:       { type: String, default: 'trade_decision' },
})

export const TokenUsageModel = mongoose.model<TokenUsageDoc>('TokenUsage', TokenUsageSchema)

// ─── Users (for auth) ────────────────────────────────────────────────────────
export interface UserDoc extends Document {
  username: string
  passwordHash: string
  role: 'admin' | 'user'
  blocked: boolean
  blockedAt?: Date
  blockedReason?: string
  twoFactorEnabled: boolean
  twoFactorSecret?: string
  twoFactorTempSecret?: string
}

const UserSchema = new Schema<UserDoc>({
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  blocked: { type: Boolean, default: false, index: true },
  blockedAt: { type: Date },
  blockedReason: { type: String },
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: { type: String },
  twoFactorTempSecret: { type: String },
})
TokenUsageSchema.index({ userId: 1, ts: -1 })
EquitySnapshotSchema.index({ userId: 1, ts: -1 })

export const UserModel = mongoose.model<UserDoc>('User', UserSchema)

// ─── API Keys (stored in DB, editable from dashboard) ────────────────────────
export interface ApiKeyDoc extends Document {
  userId?: string
  key: string
  value: string
}

const ApiKeySchema = new Schema<ApiKeyDoc>({
  userId: { type: String, default: '__global__', index: true },
  key:   { type: String, required: true },
  value: { type: String, required: true },
})
ApiKeySchema.index({ userId: 1, key: 1 }, { unique: true })

export const ApiKeyModel = mongoose.model<ApiKeyDoc>('ApiKey', ApiKeySchema)

// Wallets (per-user Alpaca account profiles)
export interface WalletDoc extends Document {
  userId: string
  name: string
  active: boolean
  exchange: 'alpaca' | 'binance' | 'coinbase'
  mode: 'paper' | 'live'
  alpaca_api_key: string
  alpaca_api_secret: string
  alpaca_base_url: string
  binance_api_key: string
  binance_api_secret: string
  coinbase_api_key: string
  coinbase_api_secret: string
  createdAt: Date
  updatedAt: Date
}

const WalletSchema = new Schema<WalletDoc>({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  active: { type: Boolean, default: false, index: true },
  exchange: { type: String, enum: ['alpaca', 'binance', 'coinbase'], default: 'alpaca' },
  mode: { type: String, enum: ['paper', 'live'], default: 'paper' },
  alpaca_api_key: { type: String, default: '' },
  alpaca_api_secret: { type: String, default: '' },
  alpaca_base_url: { type: String, default: 'https://paper-api.alpaca.markets' },
  binance_api_key: { type: String, default: '' },
  binance_api_secret: { type: String, default: '' },
  coinbase_api_key: { type: String, default: '' },
  coinbase_api_secret: { type: String, default: '' },
}, { timestamps: true })

WalletSchema.index({ userId: 1, name: 1 }, { unique: true })
WalletSchema.index({ userId: 1, active: 1 })

export const WalletModel = mongoose.model<WalletDoc>('Wallet', WalletSchema)

// BacktestResult
export interface BacktestTradeDoc {
  ts: Date; asset: string; action: 'buy'|'sell'|'hold'
  price: number; amount_usd: number; confidence: number; pnl_usd: number
}
export interface BacktestResultDoc extends Document {
  runAt: Date
  params: { assets: string[]; startDate: string; endDate: string; cycleHours: number; model: string; mode: 'rules'|'llm' }
  trades: BacktestTradeDoc[]
  startEquity: number; finalEquity: number
  totalReturn: number; maxDrawdown: number; winRate: number; totalTrades: number
  sharpe?: number
  sortino?: number
}
const BacktestResultSchema = new Schema<BacktestResultDoc>({
  runAt: { type: Date, default: Date.now },
  params: Schema.Types.Mixed,
  trades: [Schema.Types.Mixed],
  startEquity: Number, finalEquity: Number,
  totalReturn: Number, maxDrawdown: Number, winRate: Number, totalTrades: Number,
  sharpe: Number, sortino: Number,
})
export const BacktestResultModel = mongoose.model<BacktestResultDoc>('BacktestResult', BacktestResultSchema)

export interface OptimizeRunDoc {
  params: Record<string, any>
  sharpe: number; totalReturn: number; maxDrawdown: number; winRate: number; totalTrades: number
}
export interface OptimizeResultDoc extends Document {
  runAt: Date
  strategyId: string
  assets: string[]
  dateRange: { start: string; end: string }
  bestParams: Record<string, any>
  bestSharpe: number
  totalRuns: number
  runs: OptimizeRunDoc[]
}
const OptimizeResultSchema = new Schema<OptimizeResultDoc>({
  runAt:      { type: Date, default: Date.now },
  strategyId: { type: String, required: true },
  assets:     [String],
  dateRange:  Schema.Types.Mixed,
  bestParams: Schema.Types.Mixed,
  bestSharpe: Number,
  totalRuns:  Number,
  runs:       [Schema.Types.Mixed],
})
export const OptimizeResultModel = mongoose.model<OptimizeResultDoc>('OptimizeResult', OptimizeResultSchema)

// ─── PositionHigh (trailing stop high water marks) ────────────────────────────
export interface PositionHighDoc extends Document {
  asset: string
  tradeId: string
  highPrice: number
  updatedAt: Date
}
const PositionHighSchema = new Schema<PositionHighDoc>({
  asset:     { type: String, required: true },
  tradeId:   { type: String, required: true, unique: true },
  highPrice: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
})
export const PositionHighModel = mongoose.model<PositionHighDoc>('PositionHigh', PositionHighSchema)

// AuditLog
export interface AuditLogDoc extends Document {
  ts: Date; user: string; action: string; details: string; ip?: string
}
const AuditLogSchema = new Schema<AuditLogDoc>({
  ts: { type: Date, default: Date.now, index: true },
  user: { type: String, default: 'system' },
  action: { type: String, required: true },
  details: String,
  ip: String,
})
export const AuditLogModel = mongoose.model<AuditLogDoc>('AuditLog', AuditLogSchema)

// PromptRecord (stores custom system prompt)
export interface PromptDoc extends Document {
  key: string; value: string; updatedAt: Date
}
const PromptSchema = new Schema<PromptDoc>({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
})
export const PromptModel = mongoose.model<PromptDoc>('Prompt', PromptSchema)
