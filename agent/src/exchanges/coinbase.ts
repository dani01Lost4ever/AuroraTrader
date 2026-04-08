import axios from 'axios'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'

const CB_BASE = 'https://api.coinbase.com'

function toProductId(asset: string): string {
  return asset.replace('/', '-')
}

export class CoinbaseAdapter implements ExchangeAdapter {
  readonly exchange = 'coinbase'
  readonly mode: 'paper' | 'live'
  private apiKey: string
  private privateKeyPem: string

  constructor(apiKey: string, privateKeyPem: string, mode: 'paper' | 'live') {
    this.mode = mode
    this.apiKey = apiKey
    this.privateKeyPem = privateKeyPem
  }

  private buildJwt(method: string, path: string): string {
    const payload = {
      sub: this.apiKey,
      iss: 'cdp',
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      'com.coinbasecloud.wallet.retail.trading.api.target_uri': `${method} api.coinbase.com${path}`,
    }
    return jwt.sign(payload, this.privateKeyPem, { algorithm: 'ES256' })
  }

  private authHeaders(method: string, path: string) {
    return { Authorization: `Bearer ${this.buildJwt(method, path)}`, 'Content-Type': 'application/json' }
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const path = '/api/v3/brokerage/accounts'
    const res = await axios.get(`${CB_BASE}${path}`, { headers: this.authHeaders('GET', path) })
    const accounts: any[] = res.data.accounts || []

    let cash_usd = 0
    const positions: Record<string, number> = {}
    const position_details = []

    for (const acc of accounts) {
      const currency: string = acc.currency
      const total = parseFloat(acc.available_balance?.value || '0') + parseFloat(acc.hold?.value || '0')
      if (total < 0.000001) continue
      if (currency === 'USD' || currency === 'USDC') {
        cash_usd += total
      } else {
        try {
          const tickerPath = `/api/v3/brokerage/products/${currency}-USD/ticker`
          const tickerRes = await axios.get(`${CB_BASE}${tickerPath}`, { headers: this.authHeaders('GET', tickerPath) })
          const price = parseFloat(tickerRes.data.trades?.[0]?.price || tickerRes.data.best_bid || '0')
          const asset = `${currency}/USD`
          positions[asset] = total
          position_details.push({ asset, qty: total, market_value: total * price, unrealized_pl: 0, unrealized_plpc: 0, current_price: price, entry_price: 0 })
        } catch { /* skip */ }
      }
    }

    const equity_usd = cash_usd + position_details.reduce((s, p) => s + p.market_value, 0)
    return { cash_usd, equity_usd, positions, position_details }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const productId = toProductId(asset)
        const now = Math.floor(Date.now() / 1000)
        const candlePath = `/api/v3/brokerage/products/${productId}/candles`
        const [hourlyRes, dailyRes] = await Promise.all([
          axios.get(`${CB_BASE}${candlePath}`, { headers: this.authHeaders('GET', candlePath), params: { start: String(now - 110 * 3600), end: String(now), granularity: 'ONE_HOUR' } }),
          axios.get(`${CB_BASE}${candlePath}`, { headers: this.authHeaders('GET', candlePath), params: { start: String(now - 65 * 86400), end: String(now), granularity: 'ONE_DAY' } }),
        ])
        // Candle: { start, low, high, open, close, volume }
        const raw: any[] = hourlyRes.data.candles || []
        const bars = raw.map(c => ({ o: parseFloat(c.open), h: parseFloat(c.high), l: parseFloat(c.low), c: parseFloat(c.close), v: parseFloat(c.volume) }))
          .reverse() // Coinbase returns newest first
        const rawDaily: any[] = dailyRes.data.candles || []
        const dailyBars = rawDaily.map(c => ({ c: parseFloat(c.close) })).reverse()

        if (!bars.length) continue
        const closes = bars.map(b => b.c)
        const latest = bars[bars.length - 1]
        const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]

        const rsi = computeRSI(closes, 14)
        const ema9 = computeEMA(closes, 9)
        const ema21 = computeEMA(closes, 21)
        const macd = computeMACD(closes)
        const bb = computeBB(closes)
        const atr = computeATR(bars)
        const volSma20 = bars.length >= 20 ? parseFloat((bars.slice(-20).reduce((s, b) => s + b.v, 0) / 20).toFixed(0)) : undefined

        let change_7d: number | undefined, daily_sma50: number | undefined
        if (dailyBars.length >= 7) {
          change_7d = parseFloat((((dailyBars[dailyBars.length-1].c - dailyBars[dailyBars.length-7].c) / dailyBars[dailyBars.length-7].c) * 100).toFixed(2))
        }
        if (dailyBars.length >= 50) {
          daily_sma50 = parseFloat((dailyBars.slice(-50).reduce((a, b) => a + b.c, 0) / 50).toFixed(6))
        }

        snapshot[asset] = {
          price: latest.c, change_24h: parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
          change_7d, volume_24h: bars.slice(-24).reduce((s, b) => s + b.v, 0),
          volume_sma20: volSma20, high_24h: Math.max(...bars.slice(-24).map(b => b.h)),
          low_24h: Math.min(...bars.slice(-24).map(b => b.l)),
          rsi_14: rsi, ema_9: ema9.length ? parseFloat(ema9[ema9.length-1].toFixed(6)) : undefined,
          ema_21: ema21.length ? parseFloat(ema21[ema21.length-1].toFixed(6)) : undefined,
          macd: macd?.macd, macd_signal: macd?.signal, macd_hist: macd?.hist,
          bb_upper: bb?.upper, bb_lower: bb?.lower, bb_pct: bb?.pct,
          atr_14: atr ?? undefined, daily_sma50,
        }
      } catch (err: any) { console.error(`[coinbase] ${asset}:`, err.message) }
    }
    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const path = `/api/v3/brokerage/products/${toProductId(asset)}/ticker`
        const res = await axios.get(`${CB_BASE}${path}`, { headers: this.authHeaders('GET', path) })
        const price = parseFloat(res.data.trades?.[0]?.price || res.data.best_bid || '0')
        snapshot[asset] = { price, change_24h: 0, volume_24h: 0, high_24h: price, low_24h: price }
      } catch { /* ignore */ }
    }
    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') return { order_id: 'HOLD', status: 'skipped' }
    if (this.mode === 'paper') {
      console.log(`[coinbase:paper] Simulated ${decision.action} $${decision.amount_usd} of ${decision.asset}`)
      return { order_id: `PAPER-${Date.now()}`, status: 'filled' }
    }
    const path = '/api/v3/brokerage/orders'
    const body = {
      client_order_id: uuidv4(),
      product_id: toProductId(decision.asset),
      side: decision.action === 'buy' ? 'BUY' : 'SELL',
      order_configuration: { market_market_ioc: { quote_size: decision.amount_usd.toFixed(2) } },
    }
    console.log(`[coinbase] Placing ${decision.action} $${decision.amount_usd} of ${decision.asset}`)
    const res = await axios.post(`${CB_BASE}${path}`, body, { headers: this.authHeaders('POST', path) })
    const order = res.data.success_response
    return { order_id: order.order_id, status: 'pending' }
  }
}

// Indicator helpers
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
function computeATR(bars: any[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)))
  const atr = computeEMA(tr, period)
  return atr.length ? parseFloat(atr[atr.length-1].toFixed(6)) : null
}
