import axios from 'axios'
import { Decision } from './brain'
import { getKey } from './keys'

export interface AlpacaCredentials {
  alpaca_api_key?: string
  alpaca_api_secret?: string
  alpaca_base_url?: string
}

const base = (creds?: AlpacaCredentials) => creds?.alpaca_base_url || getKey('alpaca_base_url') || 'https://paper-api.alpaca.markets'
const headers = (creds?: AlpacaCredentials) => ({
  'APCA-API-KEY-ID':     creds?.alpaca_api_key || getKey('alpaca_api_key') || '',
  'APCA-API-SECRET-KEY': creds?.alpaca_api_secret || getKey('alpaca_api_secret') || '',
  'Content-Type': 'application/json',
})

export interface OrderResult {
  order_id: string
  status: string
  filled_at?: string
  filled_avg_price?: number
}

export async function executeOrder(decision: Decision, creds?: AlpacaCredentials): Promise<OrderResult> {
  if (decision.action === 'hold') {
    return { order_id: 'HOLD', status: 'skipped' }
  }

  const body = {
    symbol: decision.asset.replace('/', ''),  // BTC/USD → BTCUSD
    notional: decision.amount_usd.toFixed(2), // dollar amount, not qty
    side: decision.action,
    type: 'market',
    time_in_force: 'gtc',
  }

  console.log(`[executor] Placing ${decision.action} order: $${decision.amount_usd} of ${decision.asset}`)

  const res = await axios.post(`${base(creds)}/v2/orders`, body, { headers: headers(creds) })

  return {
    order_id: res.data.id,
    status: res.data.status,
    filled_at: res.data.filled_at,
    filled_avg_price: res.data.filled_avg_price
      ? parseFloat(res.data.filled_avg_price)
      : undefined,
  }
}

// Cancel a pending order (safety utility)
export async function cancelOrder(orderId: string, creds?: AlpacaCredentials): Promise<void> {
  await axios.delete(`${base(creds)}/v2/orders/${orderId}`, { headers: headers(creds) })
  console.log(`[executor] Cancelled order ${orderId}`)
}
