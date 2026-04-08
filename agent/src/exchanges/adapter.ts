import type { AssetSnapshot } from '../schema'

export interface PositionDetail {
  asset: string
  qty: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
  current_price: number
  entry_price: number
}

export interface Portfolio {
  cash_usd: number
  equity_usd: number
  positions: Record<string, number>
  position_details: PositionDetail[]
}

export interface OrderResult {
  order_id: string
  status: string
  filled_at?: string
  filled_avg_price?: number
}

export interface Decision {
  action: 'buy' | 'sell' | 'hold'
  asset: string
  amount_usd: number
  confidence: number
  reasoning: string
}

export interface ExchangeAdapter {
  readonly exchange: string
  readonly mode: 'paper' | 'live'
  fetchPortfolio(): Promise<Portfolio>
  fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>>
  fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>>
  executeOrder(decision: Decision): Promise<OrderResult>
}
