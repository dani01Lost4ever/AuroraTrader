import axios from 'axios'
import crypto from 'crypto'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'

const LIVE_BASE = 'https://api.binance.com'
const PAPER_BASE = 'https://testnet.binance.vision'

function toSymbol(asset: string): string {
  return asset.replace('/', '').replace('USD', 'USDT')
}

export class BinanceAdapter implements ExchangeAdapter {
  readonly exchange = 'binance'
  readonly mode: 'paper' | 'live'
  private apiKey: string
  private apiSecret: string
  private base: string

  constructor(apiKey: string, apiSecret: string, mode: 'paper' | 'live') {
    this.mode = mode
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.base = mode === 'live' ? LIVE_BASE : PAPER_BASE
  }

  private headers() {
    return { 'X-MBX-APIKEY': this.apiKey }
  }

  private sign(params: Record<string, unknown>): string {
    const qs = new URLSearchParams({ ...params as Record<string, string>, timestamp: Date.now().toString() }).toString()
    const sig = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex')
    return `${qs}&signature=${sig}`
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const res = await axios.get(`${this.base}/api/v3/account?${this.sign({})}`, {
      headers: this.headers(),
    })
    const balances: Array<{ asset: string; free: string; locked: string }> = res.data.balances
    const usdtBal = balances.find(b => b.asset === 'USDT')
    const cash_usd = parseFloat(usdtBal?.free || '0') + parseFloat(usdtBal?.locked || '0')

    const nonZero = balances.filter(b => b.asset !== 'USDT' && parseFloat(b.free) + parseFloat(b.locked) > 0.000001)

    let equity_usd = cash_usd
    const positions: Record<string, number> = {}
    const position_details = []

    for (const bal of nonZero) {
      const qty = parseFloat(bal.free) + parseFloat(bal.locked)
      try {
        const priceRes = await axios.get(`${this.base}/api/v3/ticker/price`, {
          headers: this.headers(),
          params: { symbol: `${bal.asset}USDT` },
        })
        const price = parseFloat(priceRes.data.price)
        const market_value = qty * price
        const asset = `${bal.asset}/USD`
        equity_usd += market_value
        positions[asset] = qty
        position_details.push({ asset, qty, market_value, unrealized_pl: 0, unrealized_plpc: 0, current_price: price, entry_price: 0 })
      } catch { /* skip unknown */ }
    }

    return { cash_usd, equity_usd, positions, position_details }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const symbol = toSymbol(asset)
        const [hourlyRes, dailyRes] = await Promise.all([
          axios.get(`${this.base}/api/v3/klines`, { headers: this.headers(), params: { symbol, interval: '1h', limit: 100 } }),
          axios.get(`${this.base}/api/v3/klines`, { headers: this.headers(), params: { symbol, interval: '1d', limit: 60 } }),
        ])
        // Binance kline: [openTime, open, high, low, close, volume, ...]
        const bars = hourlyRes.data.map((k: unknown[]) => ({ o: parseFloat(k[1] as string), h: parseFloat(k[2] as string), l: parseFloat(k[3] as string), c: parseFloat(k[4] as string), v: parseFloat(k[5] as string) }))
        const dailyBars = dailyRes.data.map((k: unknown[]) => ({ c: parseFloat(k[4] as string) }))
        if (!bars.length) continue

        const closes = bars.map((b: { c: number }) => b.c)
        const latest = bars[bars.length - 1]
        const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]

        const rsi = computeRSI(closes, 14)
        const ema9 = computeEMA(closes, 9)
        const ema21 = computeEMA(closes, 21)
        const macd = computeMACD(closes)
        const bb = computeBB(closes)
        const atr = computeATR(bars)
        const volSma20 = bars.length >= 20 ? parseFloat((bars.slice(-20).reduce((s: number, b: { v: number }) => s + b.v, 0) / 20).toFixed(0)) : undefined

        let change_7d: number | undefined, daily_sma50: number | undefined
        if (dailyBars.length >= 7) {
          change_7d = parseFloat((((dailyBars[dailyBars.length-1].c - dailyBars[dailyBars.length-7].c) / dailyBars[dailyBars.length-7].c) * 100).toFixed(2))
        }
        if (dailyBars.length >= 50) {
          daily_sma50 = parseFloat((dailyBars.slice(-50).reduce((a: number, b: { c: number }) => a + b.c, 0) / 50).toFixed(6))
        }

        snapshot[asset] = {
          price: latest.c, change_24h: parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
          change_7d, volume_24h: bars.slice(-24).reduce((s: number, b: { v: number }) => s + b.v, 0),
          volume_sma20: volSma20, high_24h: Math.max(...bars.slice(-24).map((b: { h: number }) => b.h)),
          low_24h: Math.min(...bars.slice(-24).map((b: { l: number }) => b.l)),
          rsi_14: rsi,
          ema_9: ema9.length ? parseFloat(ema9[ema9.length-1].toFixed(6)) : undefined,
          ema_21: ema21.length ? parseFloat(ema21[ema21.length-1].toFixed(6)) : undefined,
          macd: macd?.macd, macd_signal: macd?.signal, macd_hist: macd?.hist,
          bb_upper: bb?.upper, bb_lower: bb?.lower, bb_pct: bb?.pct,
          atr_14: atr ?? undefined, daily_sma50,
        }
      } catch (err: unknown) { console.error(`[binance] ${asset}:`, (err as Error).message) }
    }
    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const res = await axios.get(`${this.base}/api/v3/ticker/price`, { headers: this.headers(), params: { symbol: toSymbol(asset) } })
        snapshot[asset] = { price: parseFloat(res.data.price), change_24h: 0, volume_24h: 0, high_24h: 0, low_24h: 0 }
      } catch { /* ignore */ }
    }
    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') return { order_id: 'HOLD', status: 'skipped' }
    const priceRes = await axios.get(`${this.base}/api/v3/ticker/price`, { headers: this.headers(), params: { symbol: toSymbol(decision.asset) } })
    const price = parseFloat(priceRes.data.price)
    const qty = (decision.amount_usd / price).toFixed(6)
    console.log(`[binance] Placing ${decision.action} ${qty} ${toSymbol(decision.asset)} @ ~$${price}`)
    const params = { symbol: toSymbol(decision.asset), side: decision.action.toUpperCase(), type: 'MARKET', quantity: qty }
    const res = await axios.post(`${this.base}/api/v3/order?${this.sign(params)}`, null, { headers: this.headers() })
    return {
      order_id: String(res.data.orderId), status: res.data.status,
      filled_at: res.data.transactTime ? new Date(res.data.transactTime).toISOString() : undefined,
      filled_avg_price: res.data.fills?.[0]?.price ? parseFloat(res.data.fills[0].price) : undefined,
    }
  }
}

// Indicator helpers (same algorithms as poller.ts)
function computeEMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) { ema = values[i] * k + ema * (1 - k); result.push(ema) }
  return result
}

function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i-1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  return parseFloat((100 - 100 / (1 + (gains / period) / avgLoss)).toFixed(2))
}

function computeMACD(closes: number[]): { macd: number; signal: number; hist: number } | null {
  const e12 = computeEMA(closes, 12), e26 = computeEMA(closes, 26)
  if (!e12.length || !e26.length) return null
  const line = e26.map((v, i) => e12[i + (e12.length - e26.length)] - v)
  const sig = computeEMA(line, 9)
  if (!sig.length) return null
  const m = line[line.length-1], s = sig[sig.length-1]
  return { macd: parseFloat(m.toFixed(6)), signal: parseFloat(s.toFixed(6)), hist: parseFloat((m-s).toFixed(6)) }
}

function computeBB(closes: number[], period = 20): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const sl = closes.slice(-period), sma = sl.reduce((a, b) => a + b, 0) / period
  const sd = Math.sqrt(sl.reduce((a, b) => a + (b-sma)**2, 0) / period)
  const upper = sma + 2*sd, lower = sma - 2*sd
  const pct = upper === lower ? 0.5 : (closes[closes.length-1] - lower) / (upper - lower)
  return { upper: parseFloat(upper.toFixed(6)), lower: parseFloat(lower.toFixed(6)), pct: parseFloat(pct.toFixed(3)) }
}

function computeATR(bars: Array<{ h: number; l: number; c: number }>, period = 14): number | null {
  if (bars.length < period + 1) return null
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)))
  const atr = computeEMA(tr, period)
  return atr.length ? parseFloat(atr[atr.length-1].toFixed(6)) : null
}
