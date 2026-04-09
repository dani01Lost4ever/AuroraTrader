import mongoose from 'mongoose'
import { TradeModel, TradeRecord } from './schema'
import { Decision } from './brain'
import { Portfolio, fetchMarketSnapshot } from './poller'
import { AssetSnapshot } from './schema'
import type { AlpacaCredentials } from './executor'

const MANUAL_PENDING_SCOPE = {
  approved: false,
  executed: false,
  approval_mode: { $ne: 'auto' as const },
  'decision.action': { $ne: 'hold' as const },
}

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/trading-agent'
  await mongoose.connect(uri)
  console.log('[logger] MongoDB connected')
}

// Save a new decision (outcome will be filled in later)
export async function logDecision(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  decision: Decision,
  userId: string,
  options: {
    approved?: boolean
    approval_mode?: 'manual' | 'auto'
    strategy_id?: string
    strategy_label?: string
    walletId?: string
  } = {}
): Promise<TradeRecord> {
  const record = new TradeModel({
    userId,
    walletId: options.walletId,
    timestamp: new Date(),
    market,
    portfolio: {
      cash_usd: portfolio.cash_usd,
      positions: portfolio.positions,
    },
    decision,
    strategy_id: options.strategy_id,
    strategy_label: options.strategy_label,
    approval_mode: options.approval_mode ?? 'manual',
    approved: options.approved ?? false,
    executed: false,
  })
  await record.save()
  console.log(`[logger] Saved decision ${record._id}: ${decision.action} ${decision.asset}`)
  return record
}

// Mark a record as approved + executed with order ID
export async function markExecuted(
  recordId: string,
  orderId: string
): Promise<void> {
  await TradeModel.findByIdAndUpdate(recordId, {
    approved: true,
    executed: true,
    order_id: orderId,
    $unset: { execution_error: 1 },
  })
}

export async function markExecutionFailed(
  recordId: string,
  errorMessage: string
): Promise<void> {
  await TradeModel.findByIdAndUpdate(recordId, {
    approved: true,
    executed: false,
    execution_error: errorMessage,
  })
}

export async function expireStaleManualApprovals(userId: string, ttlMinutes: number): Promise<number> {
  if (ttlMinutes <= 0) return 0
  const cutoff = new Date(Date.now() - ttlMinutes * 60_000)
  const res = await TradeModel.updateMany(
    { userId, ...MANUAL_PENDING_SCOPE, timestamp: { $lt: cutoff } },
    {
      approved: true,
      executed: false,
      execution_error: `Manual approval expired after ${ttlMinutes} minutes`,
      close_reason: 'timeout',
      closed_at: new Date(),
    }
  )
  return res.modifiedCount ?? 0
}

export async function supersedePendingManualApprovals(userId: string, reason = 'Superseded by newer signal'): Promise<number> {
  const res = await TradeModel.updateMany(
    { userId, ...MANUAL_PENDING_SCOPE },
    {
      approved: true,
      executed: false,
      execution_error: reason,
      close_reason: 'timeout',
      closed_at: new Date(),
    }
  )
  return res.modifiedCount ?? 0
}

// Cron job: resolve outcomes for trades older than OUTCOME_RESOLVE_HOURS
export async function resolveOutcomes(userId = '__global__', creds?: AlpacaCredentials): Promise<void> {
  const resolveAfterHours = parseInt(process.env.OUTCOME_RESOLVE_HOURS || '4')
  const cutoff = new Date(Date.now() - resolveAfterHours * 60 * 60 * 1000)

  const pending = await TradeModel.find({
    userId,
    executed: true,
    outcome: { $exists: false },
    timestamp: { $lt: cutoff },
  })

  if (!pending.length) return
  console.log(`[logger] Resolving outcomes for ${pending.length} trades...`)

  // Gather unique assets needed
  const assets = [...new Set(pending.map(r => r.decision.asset))]
  const currentPrices = await fetchMarketSnapshot(assets, creds)

  for (const record of pending) {
    const snap = currentPrices[record.decision.asset]
    if (!snap) continue

    const entryPrice = record.market[record.decision.asset]?.price
    if (!entryPrice) continue

    const priceDiff = snap.price - entryPrice
    const pnl_pct = parseFloat(((priceDiff / entryPrice) * 100).toFixed(3))
    const pnl_usd = parseFloat(
      ((pnl_pct / 100) * record.decision.amount_usd).toFixed(2)
    )

    // For a buy, profit = price went up. For sell, profit = price went down.
    const correct =
      record.decision.action === 'buy'
        ? pnl_pct > 0
        : record.decision.action === 'sell'
        ? pnl_pct < 0
        : true // hold is always "correct" for labelling purposes

    await TradeModel.findByIdAndUpdate(record._id, {
      outcome: {
        pnl_pct,
        pnl_usd,
        price_at_resolve: snap.price,
        resolved_at: new Date(),
        correct,
      },
    })

    console.log(
      `[logger] Resolved ${record._id}: ${record.decision.action} ${record.decision.asset} → ${pnl_pct}% (${correct ? '✓' : '✗'})`
    )
  }
}

// Export profitable trades as JSONL for fine-tuning
export async function exportDataset(outputPath: string, userId = '__global__'): Promise<number> {
  const { createWriteStream } = await import('fs')
  const stream = createWriteStream(outputPath)

  const trades = await TradeModel.find({
    userId,
    'outcome.correct': true,
    executed: true,
  }).lean()

  for (const t of trades) {
    // Format as Alpaca fine-tuning format (instruction / input / output)
    const record = {
      instruction: 'You are a crypto trading agent. Analyze the market snapshot and portfolio, then make a trading decision.',
      input: JSON.stringify({
        market: t.market,
        portfolio: t.portfolio,
      }),
      output: JSON.stringify({
        action: t.decision.action,
        asset: t.decision.asset,
        amount_usd: t.decision.amount_usd,
        confidence: t.decision.confidence,
        reasoning: t.decision.reasoning,
      }),
    }
    stream.write(JSON.stringify(record) + '\n')
  }

  stream.end()
  console.log(`[logger] Exported ${trades.length} profitable trades to ${outputPath}`)
  return trades.length
}
