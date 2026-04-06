import { TradeModel, EquityModel, AssetSnapshot, PositionHighModel } from './schema'
import { AgentConfig, getConfig } from './config'
import { executeOrder } from './executor'
import { markExecuted } from './logger'
import { Portfolio } from './poller'
import type { AlpacaCredentials } from './executor'

// High-correlation groups — avoid trading multiple from same group per cycle
const CORRELATION_GROUPS: string[][] = [
  ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD'],
  ['UNI/USD', 'AAVE/USD', 'LINK/USD'],
]

export interface RiskStatus {
  circuitBreakerActive: boolean
  circuitBreakerReason?: string
  openPositions: number
  todayPnl: number
  maxDrawdownPct: number
  maxOpenPositions: number
}

export async function getRiskStatus(config: AgentConfig, equity: number, userId = '__global__'): Promise<RiskStatus> {
  const openPositions = await TradeModel.countDocuments({
    userId,
    executed: true,
    outcome: { $exists: false },
    'decision.action': 'buy',
  })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTrades = await TradeModel.find({
    userId,
    executed: true,
    'outcome.pnl_usd': { $exists: true },
    'outcome.resolved_at': { $gte: todayStart },
  }).lean()
  const todayPnl = todayTrades.reduce((s, t) => s + (t.outcome?.pnl_usd ?? 0), 0)

  const maxDrawdownUsd = (config.maxDrawdownPct / 100) * equity
  const circuitBreakerActive = todayPnl < -Math.abs(maxDrawdownUsd)

  return {
    circuitBreakerActive,
    circuitBreakerReason: circuitBreakerActive
      ? `Daily P&L $${todayPnl.toFixed(2)} exceeded max drawdown limit of -${config.maxDrawdownPct}%`
      : undefined,
    openPositions,
    todayPnl,
    maxDrawdownPct: config.maxDrawdownPct,
    maxOpenPositions: config.maxOpenPositions,
  }
}

export function isCorrelated(asset: string, recentAssets: string[]): boolean {
  for (const group of CORRELATION_GROUPS) {
    if (group.includes(asset) && recentAssets.some(r => group.includes(r) && r !== asset)) return true
  }
  return false
}

export function computeAtrPositionSize(
  atr: number | undefined,
  price: number,
  maxPositionUsd: number
): number {
  if (!atr || !price) return maxPositionUsd
  const atrPct = (atr / price) * 100
  let scale = 1.0
  if (atrPct > 5)      scale = 0.3
  else if (atrPct > 3) scale = 0.5
  else if (atrPct > 2) scale = 0.7
  else if (atrPct > 1) scale = 0.85
  return parseFloat((maxPositionUsd * scale).toFixed(2))
}

// Record equity snapshot after each cycle
export async function recordEquitySnapshot(portfolio: Portfolio, userId = '__global__'): Promise<void> {
  const lastSnap = await EquityModel.findOne({ userId }).sort({ ts: -1 }).lean()
  const peak = Math.max(portfolio.equity_usd, lastSnap?.peak ?? portfolio.equity_usd)
  await EquityModel.create({ userId, equity: portfolio.equity_usd, cash: portfolio.cash_usd, peak })
}

export async function kellyPositionSize(
  asset: string,
  atrSize: number,
  maxPositionUsd: number,
  userId = '__global__',
): Promise<number> {
  // Get historical win rate and avg win/loss for this asset from TradeModel
  const trades = await TradeModel.find({
    userId,
    'decision.asset': asset,
    'outcome.pnl_usd': { $exists: true },
    executed: true,
  }).lean()

  if (trades.length < 5) return atrSize // not enough history, use ATR

  const wins   = trades.filter(t => (t.outcome?.pnl_usd ?? 0) > 0)
  const losses = trades.filter(t => (t.outcome?.pnl_usd ?? 0) <= 0)
  const p = wins.length / trades.length
  const q = 1 - p
  const avgWin  = wins.length   ? wins.reduce((s, t)   => s + (t.outcome?.pnl_usd ?? 0), 0) / wins.length   : 0
  const avgLoss = losses.length ? Math.abs(losses.reduce((s, t) => s + (t.outcome?.pnl_usd ?? 0), 0) / losses.length) : 1

  const b = avgWin / avgLoss
  const kelly = (p * b - q) / b // Kelly fraction
  const kellySize = Math.max(0, kelly) * maxPositionUsd * 0.5 // half-Kelly for safety

  return parseFloat(Math.min(atrSize, Math.max(kellySize, maxPositionUsd * 0.05)).toFixed(2))
}

// Cron job: check SL/TP for all open buy positions
export async function monitorStopLossTakeProfit(
  currentPrices: Record<string, AssetSnapshot>,
  userId = '__global__',
  creds?: AlpacaCredentials,
  configOverride?: AgentConfig,
): Promise<void> {
  const openTrades = await TradeModel.find({
    userId,
    executed: true,
    outcome: { $exists: false },
    'decision.action': 'buy',
    sl_price: { $exists: true },
  }).lean()

  for (const trade of openTrades) {
    const snap = currentPrices[trade.decision.asset]
    if (!snap) continue
    const currentPrice = snap.price
    const slPrice = (trade as any).sl_price as number | undefined
    const tpPrice = (trade as any).tp_price as number | undefined
    let triggered: 'sl' | 'tp' | null = null
    if (slPrice && currentPrice <= slPrice) triggered = 'sl'
    else if (tpPrice && currentPrice >= tpPrice) triggered = 'tp'
    if (!triggered) continue

    console.log(`[risk] ${triggered.toUpperCase()} triggered for ${trade.decision.asset} @ $${currentPrice}`)
    try {
      const result = await executeOrder({
        action: 'sell',
        asset: trade.decision.asset,
        amount_usd: trade.decision.amount_usd,
        confidence: 1.0,
        reasoning: `${triggered.toUpperCase()} triggered at $${currentPrice}`,
      }, creds)
      await markExecuted(trade._id.toString(), result.order_id)
      await TradeModel.findByIdAndUpdate(trade._id, {
        close_reason: triggered,
        closed_at: new Date(),
      })
      console.log(`[risk] Closed ${trade.decision.asset} via ${triggered.toUpperCase()}`)
    } catch (err: any) {
      console.error(`[risk] Failed to close position: ${err.message}`)
    }
  }

  await updateAndCheckTrailingStops(currentPrices, userId, creds, configOverride)
}

export async function updateAndCheckTrailingStops(
  currentPrices: Record<string, AssetSnapshot>,
  userId = '__global__',
  creds?: AlpacaCredentials,
  configOverride?: AgentConfig,
): Promise<void> {
  const cfg = configOverride || getConfig()
  if (!cfg.trailingStopEnabled) return

  const openTrades = await TradeModel.find({
    userId,
    executed: true,
    outcome: { $exists: false },
    'decision.action': 'buy',
  }).lean()

  for (const trade of openTrades) {
    const snap = currentPrices[trade.decision.asset]
    if (!snap) continue
    const currentPrice = snap.price
    const tradeId = trade._id.toString()

    // Upsert high water mark
    const existing = await PositionHighModel.findOne({ tradeId })
    const newHigh = existing ? Math.max(existing.highPrice, currentPrice) : currentPrice

    await PositionHighModel.findOneAndUpdate(
      { tradeId },
      { highPrice: newHigh, updatedAt: new Date(), asset: trade.decision.asset },
      { upsert: true }
    )

    // Check trailing stop
    const stopLevel = newHigh * (1 - cfg.trailingStopPct / 100)
    if (currentPrice <= stopLevel) {
      console.log(`[risk] TRAILING STOP triggered for ${trade.decision.asset} @ $${currentPrice} (high was $${newHigh}, stop $${stopLevel.toFixed(4)})`)
      try {
        const result = await executeOrder({
          action: 'sell',
          asset: trade.decision.asset,
          amount_usd: trade.decision.amount_usd,
          confidence: 1.0,
          reasoning: `Trailing stop triggered at $${currentPrice} (${cfg.trailingStopPct}% below high of $${newHigh})`,
        }, creds)
        await markExecuted(trade._id.toString(), result.order_id)
        await TradeModel.findByIdAndUpdate(trade._id, { close_reason: 'sl', closed_at: new Date() })
        await PositionHighModel.deleteOne({ tradeId })
        console.log(`[risk] Closed ${trade.decision.asset} via trailing stop`)
      } catch (err: any) {
        console.error(`[risk] Failed to close trailing stop position: ${err.message}`)
      }
    }
  }
}
