import axios from 'axios'
import type { AlpacaCredentials } from './executor'

export interface FearGreedData {
  value: number
  classification: string
}

// 10-minute cache
let fgCache: { data: FearGreedData; ts: number } | null = null
let newsCache: { data: Record<string, string[]>; ts: number } | null = null
const CACHE_TTL = 10 * 60 * 1000

const alpacaHeaders = (creds?: AlpacaCredentials) => ({
  'APCA-API-KEY-ID': creds?.alpaca_api_key || process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': creds?.alpaca_api_secret || process.env.ALPACA_API_SECRET!,
})

export async function fetchFearAndGreed(): Promise<FearGreedData | null> {
  try {
    if (fgCache && Date.now() - fgCache.ts < CACHE_TTL) return fgCache.data
    const res = await axios.get('https://api.alternative.me/fng/?limit=1', { timeout: 5000 })
    const item = res.data.data[0]
    const data: FearGreedData = {
      value: parseInt(item.value),
      classification: item.value_classification,
    }
    fgCache = { data, ts: Date.now() }
    return data
  } catch (err: any) {
    console.warn('[sentiment] Fear & Greed fetch failed:', err.message)
    return null
  }
}

export async function fetchNewsHeadlines(assets: string[], creds?: AlpacaCredentials): Promise<Record<string, string[]>> {
  try {
    if (newsCache && Date.now() - newsCache.ts < CACHE_TTL) return newsCache.data
    const result: Record<string, string[]> = {}
    const symbols = assets.map(a => a.replace('/', '')).join(',')
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const res = await axios.get('https://data.alpaca.markets/v1beta1/news', {
      headers: alpacaHeaders(creds),
      params: { symbols, limit: 20, start, sort: 'desc' },
      timeout: 8000,
    })
    for (const article of (res.data.news || [])) {
      const headline = article.headline || article.title
      if (!headline) continue
      for (const sym of (article.symbols || [])) {
        const formatted = sym.replace(/([A-Z]+)(USD.*)$/, '$1/USD')
        if (!result[formatted]) result[formatted] = []
        if (result[formatted].length < 3) result[formatted].push(headline)
      }
    }
    newsCache = { data: result, ts: Date.now() }
    return result
  } catch (err: any) {
    console.warn('[sentiment] News fetch failed:', err.message)
    return {}
  }
}
