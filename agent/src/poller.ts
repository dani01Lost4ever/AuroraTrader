import axios from 'axios'
import { AssetSnapshot } from './schema'
import { getKey } from './keys'
import type { AlpacaCredentials } from './executor'

const DATA = 'https://data.alpaca.markets'

const base = (creds?: AlpacaCredentials) => creds?.alpaca_base_url || getKey('alpaca_base_url') || 'https://paper-api.alpaca.markets'
const headers = (creds?: AlpacaCredentials) => ({
  'APCA-API-KEY-ID':     creds?.alpaca_api_key || getKey('alpaca_api_key') || '',
  'APCA-API-SECRET-KEY': creds?.alpaca_api_secret || getKey('alpaca_api_secret') || '',
})

export interface Portfolio {
  cash_usd: number
  positions: Record<string, number> // asset → qty
  equity_usd: number
}

// Fetch current portfolio from Alpaca paper account
export async function fetchPortfolio(creds?: AlpacaCredentials): Promise<Portfolio> {
  const [accountRes, positionsRes] = await Promise.all([
    axios.get(`${base(creds)}/v2/account`, { headers: headers(creds) }),
    axios.get(`${base(creds)}/v2/positions`, { headers: headers(creds) }),
  ])

  const positions: Record<string, number> = {}
  for (const p of positionsRes.data) {
    positions[p.symbol] = parseFloat(p.qty)
  }

  return {
    cash_usd: parseFloat(accountRes.data.cash),
    equity_usd: parseFloat(accountRes.data.equity),
    positions,
  }
}

// Fetch 100 hourly bars + 60 daily bars and compute a full indicator suite
export async function fetchMarketSnapshot(
  assets: string[],
  creds?: AlpacaCredentials,
): Promise<Record<string, AssetSnapshot>> {
  const snapshot: Record<string, AssetSnapshot> = {}

  for (const asset of assets) {
    try {
      // Explicit start timestamps — Alpaca ignores `limit` alone without a time range
      const hourlyStart = new Date(Date.now() - 110 * 60 * 60 * 1000).toISOString() // 110h ago → 100+ bars
      const dailyStart  = new Date(Date.now() -  65 * 24 * 60 * 60 * 1000).toISOString() // 65d ago → 60+ bars

      // Fetch hourly (100 bars for indicator warmup) and daily (60 bars for trend) in parallel
      const [barRes, dailyRes] = await Promise.all([
        axios.get(`${DATA}/v1beta3/crypto/us/bars`, {
          headers: headers(creds),
          params: { symbols: asset, timeframe: '1H', start: hourlyStart, limit: 100 },
        }),
        axios.get(`${DATA}/v1beta3/crypto/us/bars`, {
          headers: headers(creds),
          params: { symbols: asset, timeframe: '1D', start: dailyStart, limit: 60 },
        }),
      ])

      const bars: any[] = barRes.data.bars[asset] || []
      const dailyBars: any[] = dailyRes.data.bars[asset] || []

      if (!bars.length) {
        console.warn(`[poller] ${asset}: no hourly bars returned — asset may not be available on Alpaca US`)
        continue
      }
      if (bars.length < 15) {
        console.warn(`[poller] ${asset}: only ${bars.length} hourly bars returned (need 15+ for RSI, 26+ for MACD)`)
      } else {
        console.log(`[poller] ${asset}: ${bars.length} hourly bars, ${dailyBars.length} daily bars`)
      }

      const latest = bars[bars.length - 1]
      const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]
      const closes = bars.map((b: any) => b.c)

      // — Hourly indicators —
      const rsi        = computeRSI(closes, 14)
      const ema9arr    = computeEMA(closes, 9)
      const ema21arr   = computeEMA(closes, 21)
      const macdData   = computeMACD(closes)
      const bb         = computeBollingerBands(closes)
      const atr        = computeATR(bars)
      const volSma20   = bars.length >= 20
        ? parseFloat((bars.slice(-20).reduce((s: number, b: any) => s + b.v, 0) / 20).toFixed(0))
        : undefined

      // — Daily indicators —
      let change_7d: number | undefined
      let daily_sma50: number | undefined
      if (dailyBars.length >= 7) {
        const d   = dailyBars[dailyBars.length - 1]
        const d7  = dailyBars[dailyBars.length - 7]
        change_7d = parseFloat((((d.c - d7.o) / d7.o) * 100).toFixed(2))
      }
      if (dailyBars.length >= 50) {
        const sma50slice = dailyBars.slice(-50).map((b: any) => b.c)
        daily_sma50 = parseFloat((sma50slice.reduce((a: number, b: number) => a + b, 0) / 50).toFixed(6))
      }

      snapshot[asset] = {
        price:        latest.c,
        change_24h:   parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
        change_7d,
        volume_24h:   bars.slice(-24).reduce((s: number, b: any) => s + b.v, 0),
        volume_sma20: volSma20,
        high_24h:     Math.max(...bars.slice(-24).map((b: any) => b.h)),
        low_24h:      Math.min(...bars.slice(-24).map((b: any) => b.l)),
        rsi_14:       rsi,
        ema_9:        ema9arr.length  ? parseFloat(ema9arr[ema9arr.length - 1].toFixed(6))   : undefined,
        ema_21:       ema21arr.length ? parseFloat(ema21arr[ema21arr.length - 1].toFixed(6)) : undefined,
        macd:         macdData?.macd,
        macd_signal:  macdData?.signal,
        macd_hist:    macdData?.hist,
        bb_upper:     bb?.upper,
        bb_lower:     bb?.lower,
        bb_pct:       bb?.pct,
        atr_14:       atr ?? undefined,
        daily_sma50,
      }
    } catch (err: any) {
      if (err.response) {
        console.error(
          `[poller] ${asset}: HTTP ${err.response.status} ${err.response.config?.url ?? ''} — ` +
          JSON.stringify(err.response.data).slice(0, 200)
        )
      } else {
        console.error(`[poller] ${asset}:`, err.message)
      }
    }
  }

  return snapshot
}

// ─── Indicator helpers ────────────────────────────────────────────────────────

/** EMA over an array of values. Returns array aligned to the tail. */
function computeEMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  // Seed with SMA of the first `period` values
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

/** Classic RSI(period) from closing prices. Returns 50 when insufficient data. */
function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50

  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}

/** MACD(12,26,9): returns line, signal, and histogram. */
function computeMACD(
  closes: number[]
): { macd: number; signal: number; hist: number } | null {
  const ema12 = computeEMA(closes, 12)
  const ema26 = computeEMA(closes, 26)
  if (!ema12.length || !ema26.length) return null

  // Align ema12 to ema26 — ema26 is shorter by (26-12)=14 items
  const offset = ema12.length - ema26.length
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v)

  const signalLine = computeEMA(macdLine, 9)
  if (!signalLine.length) return null

  const lastMacd   = macdLine[macdLine.length - 1]
  const lastSignal = signalLine[signalLine.length - 1]

  return {
    macd:   parseFloat(lastMacd.toFixed(6)),
    signal: parseFloat(lastSignal.toFixed(6)),
    hist:   parseFloat((lastMacd - lastSignal).toFixed(6)),
  }
}

/** Bollinger Bands(20, 2σ): upper, lower, and %B (0=lower, 1=upper). */
function computeBollingerBands(
  closes: number[],
  period = 20
): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const slice    = closes.slice(-period)
  const sma      = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period
  const sd       = Math.sqrt(variance)
  const upper    = sma + 2 * sd
  const lower    = sma - 2 * sd
  const price    = closes[closes.length - 1]
  const pct      = upper === lower ? 0.5 : (price - lower) / (upper - lower)

  return {
    upper: parseFloat(upper.toFixed(6)),
    lower: parseFloat(lower.toFixed(6)),
    pct:   parseFloat(pct.toFixed(3)),
  }
}

/** ATR(14): average true range using EMA smoothing. */
function computeATR(bars: any[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const trValues: number[] = []
  for (let i = 1; i < bars.length; i++) {
    trValues.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    ))
  }
  const atrArr = computeEMA(trValues, period)
  if (!atrArr.length) return null
  return parseFloat(atrArr[atrArr.length - 1].toFixed(6))
}

// Lightweight price fetch for SL/TP monitoring (no indicator computation)
export async function fetchLatestPrices(assets: string[], creds?: AlpacaCredentials): Promise<Record<string, AssetSnapshot>> {
  const snapshot: Record<string, AssetSnapshot> = {}
  for (const asset of assets) {
    try {
      const res = await axios.get(`${DATA}/v1beta3/crypto/us/latest/bars`, {
        headers: headers(creds),
        params: { symbols: asset },
      })
      const bar = res.data.bars?.[asset]
      if (!bar) continue
      snapshot[asset] = {
        price: bar.c,
        change_24h: 0,
        volume_24h: bar.v,
        high_24h: bar.h,
        low_24h: bar.l,
      }
    } catch { /* ignore */ }
  }
  return snapshot
}
