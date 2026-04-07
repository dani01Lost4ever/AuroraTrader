import { UserModel, TradeModel, type AssetSnapshot } from './schema'
import { fetchPortfolio, fetchMarketSnapshot, fetchLatestPrices } from './poller'
import { fetchFearAndGreed, fetchNewsHeadlines } from './sentiment'
import { getDecisions, type Decision } from './brain'
import { getUserConfig, type AgentConfig } from './config'
import { getUserKeySet } from './keys'
import { getStrategy, mergeWithDefaults } from './strategies/registry'
import { logDecision, markExecuted, markExecutionFailed, resolveOutcomes, supersedePendingManualApprovals } from './logger'
import { executeOrder } from './executor'
import { getRiskStatus, kellyPositionSize, monitorStopLossTakeProfit, recordEquitySnapshot } from './risk'
import { broadcast } from './ws'

const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD || '500')
interface UserRuntime {
  userId: string
  username: string
  paused: boolean
  blocked: boolean
  active: boolean
  lastCycleAt: string | null
  nextCycleAt: string | null
  lastDataRefreshAt: string | null
  nextDataRefreshAt: string | null
  nextOutcomeAt: string | null
  nextRiskCheckAt: string | null
  cycleIntervalMinutes: number | null
  dataIntervalMinutes: number | null
  lastError: string | null
  cycles: number
  recentAssets: string[]
  cachedPortfolio: Awaited<ReturnType<typeof fetchPortfolio>> | null
  cachedMarket: Record<string, AssetSnapshot> | null
  cachedAt: number
  cycleTimer: NodeJS.Timeout | null
  refreshTimer: NodeJS.Timeout | null
  outcomeTimer: NodeJS.Timeout | null
  riskTimer: NodeJS.Timeout | null
  role: 'admin' | 'user'
}

function detectRegime(market: Record<string, AssetSnapshot>): string {
  const btc = market['BTC/USD']
  if (!btc?.daily_sma50) return 'Unknown'
  const pctFromSma50 = ((btc.price - btc.daily_sma50) / btc.daily_sma50) * 100
  if (pctFromSma50 > 5) return `Bull Market (BTC +${pctFromSma50.toFixed(1)}% above SMA50)`
  if (pctFromSma50 < -10) return `Bear Market (BTC ${pctFromSma50.toFixed(1)}% below SMA50)`
  return `Sideways (BTC ${(pctFromSma50 >= 0 ? '+' : '')}${pctFromSma50.toFixed(1)}% vs SMA50)`
}

function resolveDecisionStrategy(activeId: string, activeLabel: string, reasoning: string): { id: string; label: string } {
  if (activeId !== 'auto') return { id: activeId, label: activeLabel }
  const match = reasoning.match(/^\[Auto(?:->|→)([^\]]+)\]/i)
  if (!match) return { id: 'auto', label: activeLabel }
  const delegated = match[1].trim()
  return { id: 'auto', label: delegated ? `Auto -> ${delegated}` : activeLabel }
}

function runtimeView(rt: UserRuntime) {
  return {
    userId: rt.userId,
    username: rt.username,
    role: rt.role,
    active: rt.active,
    paused: rt.paused,
    blocked: rt.blocked,
    cycles: rt.cycles,
    lastCycleAt: rt.lastCycleAt,
    nextCycleAt: rt.nextCycleAt,
    lastDataRefreshAt: rt.lastDataRefreshAt,
    nextDataRefreshAt: rt.nextDataRefreshAt,
    nextOutcomeAt: rt.nextOutcomeAt,
    nextRiskCheckAt: rt.nextRiskCheckAt,
    cycleIntervalMinutes: rt.cycleIntervalMinutes,
    dataIntervalMinutes: rt.dataIntervalMinutes,
    outcomeIntervalMinutes: 60,
    riskIntervalMinutes: 2,
    lastError: rt.lastError,
  }
}

export class EngineManager {
  private runtimes = new Map<string, UserRuntime>()
  private syncTimer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
    await this.syncUsers()
    this.syncTimer = setInterval(() => {
      this.syncUsers().catch((e) => console.error('[engine] syncUsers error:', e.message))
    }, 60_000)
  }

  stopAll(): void {
    for (const rt of this.runtimes.values()) this.stopRuntime(rt)
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
  }

  async syncUsers(): Promise<void> {
    const users = await UserModel.find({}, '_id username role blocked').lean()
    const seen = new Set<string>()
    for (const u of users) {
      const userId = u._id.toString()
      seen.add(userId)
      if (!this.runtimes.has(userId)) {
        await this.startForUser(
          userId,
          u.username,
          (u as any).role === 'admin' ? 'admin' : 'user',
          Boolean((u as any).blocked),
        )
      } else {
        const rt = this.runtimes.get(userId)!
        rt.username = u.username
        rt.role = (u as any).role === 'admin' ? 'admin' : 'user'
        rt.blocked = Boolean((u as any).blocked)
        if (rt.blocked) rt.paused = true
      }
    }
    for (const [userId, rt] of this.runtimes.entries()) {
      if (!seen.has(userId)) this.stopRuntime(rt)
    }
  }

  async ensureUser(userId: string): Promise<void> {
    if (this.runtimes.has(userId)) return
    const user = await UserModel.findById(userId).lean()
    if (!user) return
    await this.startForUser(userId, user.username, user.role === 'admin' ? 'admin' : 'user', Boolean((user as any).blocked))
  }

  list(): any[] {
    return [...this.runtimes.values()].map(runtimeView)
  }

  get(userId: string): any | null {
    const rt = this.runtimes.get(userId)
    return rt ? runtimeView(rt) : null
  }

  pause(userId: string): boolean {
    const rt = this.runtimes.get(userId)
    if (!rt) return false
    rt.paused = true
    return true
  }

  resume(userId: string): boolean {
    const rt = this.runtimes.get(userId)
    if (!rt) return false
    if (rt.blocked) return false
    rt.paused = false
    return true
  }

  async triggerCycle(userId: string): Promise<boolean> {
    const rt = this.runtimes.get(userId)
    if (!rt) return false
    await this.runCycle(rt)
    return true
  }

  private stopRuntime(rt: UserRuntime): void {
    rt.active = false
    if (rt.cycleTimer) clearTimeout(rt.cycleTimer)
    if (rt.refreshTimer) clearTimeout(rt.refreshTimer)
    if (rt.outcomeTimer) clearTimeout(rt.outcomeTimer)
    if (rt.riskTimer) clearTimeout(rt.riskTimer)
    this.runtimes.delete(rt.userId)
  }

  setBlocked(userId: string, blocked: boolean): boolean {
    const rt = this.runtimes.get(userId)
    if (!rt) return false
    rt.blocked = blocked
    if (blocked) rt.paused = true
    return true
  }

  private async startForUser(userId: string, username: string, role: 'admin' | 'user', blocked: boolean): Promise<void> {
    const rt: UserRuntime = {
      userId, username, role, blocked, active: true, paused: role === 'admin' || blocked,
      lastCycleAt: null, nextCycleAt: null, lastError: null, cycles: 0,
      lastDataRefreshAt: null, nextDataRefreshAt: null, nextOutcomeAt: null, nextRiskCheckAt: null,
      cycleIntervalMinutes: null, dataIntervalMinutes: null,
      recentAssets: [], cachedPortfolio: null, cachedMarket: null, cachedAt: 0,
      cycleTimer: null, refreshTimer: null, outcomeTimer: null, riskTimer: null,
    }
    this.runtimes.set(userId, rt)
    await this.runCycle(rt).catch((e) => console.error(`[engine:${username}] bootstrap cycle error:`, e.message))
    this.scheduleCycle(rt)
    this.scheduleDataRefresh(rt)
    this.scheduleOutcomeResolution(rt)
    this.scheduleRiskMonitor(rt)
  }

  private scheduleCycle(rt: UserRuntime): void {
    if (!rt.active) return
    const schedule = async () => {
      if (!rt.active) return
      const cfg = await getUserConfig(rt.userId)
      const mins = (cfg.activeStrategy === 'llm' || (cfg.activeStrategy === 'auto' && cfg.autoFallbackToLlm))
        ? cfg.cycleMinutes
        : cfg.marketDataMinutes
      rt.cycleIntervalMinutes = mins
      rt.nextCycleAt = new Date(Date.now() + mins * 60_000).toISOString()
      rt.cycleTimer = setTimeout(async () => {
        await this.runCycle(rt).catch((e) => console.error(`[engine:${rt.username}] cycle error:`, e.message))
        schedule()
      }, mins * 60_000)
    }
    schedule().catch((e) => console.error(`[engine:${rt.username}] scheduleCycle error:`, e.message))
  }

  private rescheduleCycle(rt: UserRuntime): void {
    if (rt.cycleTimer) clearTimeout(rt.cycleTimer)
    rt.cycleTimer = null
    this.scheduleCycle(rt)
  }

  private scheduleDataRefresh(rt: UserRuntime): void {
    if (!rt.active) return
    const schedule = async () => {
      if (!rt.active) return
      const cfg = await getUserConfig(rt.userId)
      rt.dataIntervalMinutes = cfg.marketDataMinutes
      rt.nextDataRefreshAt = new Date(Date.now() + cfg.marketDataMinutes * 60_000).toISOString()
      rt.refreshTimer = setTimeout(async () => {
        try {
          if (cfg.activeStrategy === 'llm' || (cfg.activeStrategy === 'auto' && cfg.autoFallbackToLlm)) {
            await this.refreshMarketData(rt, cfg, true)
            this.rescheduleCycle(rt)
          }
        } catch (e: any) {
          console.error(`[engine:${rt.username}] data refresh error:`, e.message)
        }
        schedule()
      }, cfg.marketDataMinutes * 60_000)
    }
    schedule().catch((e) => console.error(`[engine:${rt.username}] scheduleDataRefresh error:`, e.message))
  }

  private scheduleOutcomeResolution(rt: UserRuntime): void {
    if (!rt.active) return
    const loop = async () => {
      rt.nextOutcomeAt = new Date(Date.now() + 60 * 60_000).toISOString()
      rt.outcomeTimer = setTimeout(async () => {
        try {
          const keys = await getUserKeySet(rt.userId)
          await resolveOutcomes(rt.userId, {
            alpaca_api_key: keys.alpaca_api_key,
            alpaca_api_secret: keys.alpaca_api_secret,
            alpaca_base_url: keys.alpaca_base_url,
          })
        } catch (e: any) {
          console.error(`[engine:${rt.username}] outcome resolution error:`, e.message)
        }
        loop()
      }, 60 * 60_000)
    }
    loop()
  }

  private scheduleRiskMonitor(rt: UserRuntime): void {
    if (!rt.active) return
    const loop = async () => {
      rt.nextRiskCheckAt = new Date(Date.now() + 2 * 60_000).toISOString()
      rt.riskTimer = setTimeout(async () => {
        try {
          const [cfg, keys] = await Promise.all([getUserConfig(rt.userId), getUserKeySet(rt.userId)])
          const creds = { alpaca_api_key: keys.alpaca_api_key, alpaca_api_secret: keys.alpaca_api_secret, alpaca_base_url: keys.alpaca_base_url }
          const prices = await fetchLatestPrices(cfg.assets, creds)
          await monitorStopLossTakeProfit(prices, rt.userId, creds, cfg)
        } catch (e: any) {
          console.error(`[engine:${rt.username}] risk monitor error:`, e.message)
        }
        loop()
      }, 2 * 60_000)
    }
    loop()
  }

  private async refreshMarketData(
    rt: UserRuntime,
    cfg: AgentConfig,
    force = false
  ): Promise<{ portfolio: Awaited<ReturnType<typeof fetchPortfolio>>; market: Record<string, AssetSnapshot> }> {
    const cacheMaxAgeMs = Math.max(15_000, cfg.marketDataMinutes * 60 * 1000 - 5_000)
    const cacheFresh = !force && rt.cachedPortfolio && rt.cachedMarket && (Date.now() - rt.cachedAt) < cacheMaxAgeMs
    if (cacheFresh) return { portfolio: rt.cachedPortfolio!, market: rt.cachedMarket! }

    const keys = await getUserKeySet(rt.userId)
    const creds = { alpaca_api_key: keys.alpaca_api_key, alpaca_api_secret: keys.alpaca_api_secret, alpaca_base_url: keys.alpaca_base_url }
    const [portfolio, market] = await Promise.all([
      fetchPortfolio(creds),
      fetchMarketSnapshot(cfg.assets, creds),
    ])
    rt.cachedPortfolio = portfolio
    rt.cachedMarket = market
    rt.cachedAt = Date.now()
    rt.lastDataRefreshAt = new Date().toISOString()
    broadcast('portfolio', { cash: portfolio.cash_usd, equity: portfolio.equity_usd }, rt.userId)
    return { portfolio, market }
  }

  private async runCycle(rt: UserRuntime): Promise<void> {
    if (!rt.active || rt.paused || rt.blocked) return
    const cfg = await getUserConfig(rt.userId)
    const keys = await getUserKeySet(rt.userId)
    const creds = { alpaca_api_key: keys.alpaca_api_key, alpaca_api_secret: keys.alpaca_api_secret, alpaca_base_url: keys.alpaca_base_url }
    try {
      const { portfolio, market } = await this.refreshMarketData(rt, cfg)
      const riskStatus = await getRiskStatus(cfg as any, portfolio.equity_usd, rt.userId)
      if (riskStatus.circuitBreakerActive) {
        await recordEquitySnapshot(portfolio, rt.userId)
        return
      }

      const [fearGreed, news] = await Promise.all([
        fetchFearAndGreed(),
        fetchNewsHeadlines(cfg.assets, creds),
      ])

      const regime = detectRegime(market)
      const activeStrategyId = cfg.activeStrategy || 'llm'
      const strategy = getStrategy(activeStrategyId)
      const resolvedParams = mergeWithDefaults(strategy.params, (cfg.strategyParams?.[cfg.activeStrategy] as any) ?? {})

      let decisions: Decision[] = []
      if ((cfg.activeStrategy || 'llm') === 'llm') {
        decisions = await getDecisions(
          market, portfolio, MAX_POSITION_USD, rt.recentAssets, fearGreed, news, regime,
          { userId: rt.userId, config: cfg, keys: { anthropic_api_key: keys.anthropic_api_key, openai_api_key: keys.openai_api_key } },
        )
      } else {
        const stratResults = await Promise.all(
          Object.entries(market).map(async ([asset, snapshot]) => {
            const result = await strategy.evaluate({
              asset, snapshot, portfolio, maxPositionUsd: MAX_POSITION_USD, regime, fearGreedValue: fearGreed?.value ?? null,
            }, resolvedParams)
            return { asset, result }
          })
        )
        decisions = stratResults.filter(({ result }) => result.signal !== 'none').map(({ asset, result }) => ({
          action: result.action, asset, amount_usd: result.amount_usd, confidence: result.confidence, reasoning: result.reasoning,
        }))
      }

      const actionable = decisions.filter(d => d.action !== 'hold').sort((a, b) => b.confidence - a.confidence)
      let decision = actionable[0] ?? decisions[0]
      if (!decision) return

      if (cfg.confidenceThreshold > 0 && decision.action !== 'hold' && decision.confidence < cfg.confidenceThreshold) {
        decision = { ...decision, action: 'hold', amount_usd: 0 }
      }
      if (cfg.kellyEnabled && decision.action !== 'hold') {
        decision.amount_usd = await kellyPositionSize(decision.asset, decision.amount_usd, MAX_POSITION_USD, rt.userId)
      }

      if (!cfg.autoApprove && decision.action !== 'hold') {
        await supersedePendingManualApprovals(rt.userId, 'Superseded by newer signal')
      }

      const decisionStrategy = resolveDecisionStrategy(activeStrategyId, strategy.label, decision.reasoning)
      const record = await logDecision(market, portfolio, decision, rt.userId, {
        approved: cfg.autoApprove,
        approval_mode: cfg.autoApprove ? 'auto' : 'manual',
        strategy_id: decisionStrategy.id,
        strategy_label: decisionStrategy.label,
      })
      broadcast('trade:new', record.toObject(), rt.userId)

      if (decision.action !== 'hold') {
        rt.recentAssets = [decision.asset, ...rt.recentAssets].slice(0, 3)
        if (cfg.autoApprove) {
          try {
            const result = await executeOrder(decision, creds)
            await markExecuted(record._id.toString(), result.order_id)
            const executedRecord = await TradeModel.findById(record._id).lean()
            broadcast('trade:executed', executedRecord, rt.userId)
          } catch (err: any) {
            await markExecutionFailed(record._id.toString(), err.message)
            const failedRecord = await TradeModel.findById(record._id).lean()
            if (failedRecord) broadcast('trade:executed', failedRecord, rt.userId)
          }
        }
      }
      await recordEquitySnapshot(portfolio, rt.userId)
      rt.cycles += 1
      rt.lastCycleAt = new Date().toISOString()
      rt.lastError = null
    } catch (err: any) {
      rt.lastError = err.message
      console.error(`[engine:${rt.username}] runCycle failed:`, err.message)
    }
  }
}

export const engineManager = new EngineManager()
