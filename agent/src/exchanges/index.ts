import { AlpacaAdapter } from './alpaca'
import { BinanceAdapter } from './binance'
import { CoinbaseAdapter } from './coinbase'
import type { ExchangeAdapter } from './adapter'
import type { WalletDoc } from '../schema'

export { ExchangeAdapter } from './adapter'
export type { Portfolio, PositionDetail, OrderResult, Decision } from './adapter'

export function createAdapter(wallet: WalletDoc): ExchangeAdapter {
  const mode = (wallet as any).mode ?? 'paper'
  switch ((wallet as any).exchange ?? 'alpaca') {
    case 'binance':
      return new BinanceAdapter((wallet as any).binance_api_key || '', (wallet as any).binance_api_secret || '', mode)
    case 'coinbase':
      return new CoinbaseAdapter((wallet as any).coinbase_api_key || '', (wallet as any).coinbase_api_secret || '', mode)
    case 'alpaca':
    default:
      return new AlpacaAdapter(wallet.alpaca_api_key, wallet.alpaca_api_secret, mode, wallet.alpaca_base_url)
  }
}
