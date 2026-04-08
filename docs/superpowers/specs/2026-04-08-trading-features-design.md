# Trading Features Design — 2026-04-08

## Overview

Five production-hardening features for TradingAgentCore:
1. Rate Limiting
2. Paper/Live Mode Toggle
3. Multi-Exchange Support (Alpaca + Binance + Coinbase)
4. Monthly/Weekly P&L Decomposition
5. Portfolio Allocation UI

---

## 1. Rate Limiting

**Goal:** Prevent brute-force attacks on auth endpoints.

**Implementation:**
- Package: `express-rate-limit` (in-memory store, single-instance)
- Applied in `agent/src/api.ts` before auth route handlers

**Limits:**
| Endpoint | Max requests | Window |
|---|---|---|
| `POST /api/auth/login` | 5 | 15 minutes |
| `POST /api/auth/login/2fa` | 10 | 15 minutes |
| `POST /api/auth/register` | 3 | 1 hour |

**Response on limit:** HTTP 429 with `{ error: "Too many requests", retryAfter: <seconds> }` and `Retry-After` header.

**No database required** — in-memory store is sufficient for single-instance deployment. If multi-instance is needed later, swap to `rate-limit-redis`.

---

## 2. Paper/Live Mode Toggle

**Goal:** Explicit, guarded distinction between paper (sandbox) and live trading per wallet.

### Schema Change
Add to `Wallet` document:
```typescript
mode: 'paper' | 'live'  // default: 'paper'
```

### Backend
- `engineManager.ts`: reads `wallet.mode`, passes to adapter
- Adapters use `mode` to select sandbox vs production endpoint (see §3)
- No trade execution blocked by mode — adapters handle routing

### Frontend
- **Wallet selector** (Overview/Settings): shows mode badge (`PAPER` green / `LIVE` red) next to each wallet
- **Toggle button**: switching to `live` opens a confirmation modal requiring TOTP input (reuses existing 2FA flow via `POST /api/auth/2fa/verify-once`)
- **Persistent banner**: red `⚠ LIVE TRADING ACTIVE` banner pinned at top of every page when active wallet is in live mode
- **New API endpoint:** `POST /api/wallets/:id/mode` — sets mode, requires 2FA token in body if switching to live

### Safety
- Admin can set `DISABLE_LIVE_TRADING=true` env var to block all live execution at engine level
- Live mode switch is logged to audit log

---

## 3. Multi-Exchange Support

**Goal:** Pluggable exchange adapter pattern. Ship Alpaca (migrated), Binance, and Coinbase adapters.

### Exchange Adapter Interface
New file: `agent/src/exchanges/adapter.ts`

```typescript
export interface ExchangeAdapter {
  fetchPortfolio(mode: 'paper' | 'live'): Promise<Portfolio>
  fetchMarketSnapshot(assets: string[], mode: 'paper' | 'live'): Promise<Record<string, AssetSnapshot>>
  fetchLatestPrices(assets: string[], mode: 'paper' | 'live'): Promise<Record<string, number>>
  executeOrder(decision: Decision, mode: 'paper' | 'live'): Promise<{ order_id: string }>
  fetchHistoricalBars(asset: string, timeframe: string, limit: number, mode: 'paper' | 'live'): Promise<Bar[]>
}
```

### Adapter Files
| File | Exchange | Auth method |
|---|---|---|
| `agent/src/exchanges/alpaca.ts` | Alpaca | API key + secret header |
| `agent/src/exchanges/binance.ts` | Binance | HMAC-SHA256 signed query |
| `agent/src/exchanges/coinbase.ts` | Coinbase Advanced Trade | JWT (ES256, CDP key) |

### Factory
`agent/src/exchanges/index.ts` — `createAdapter(exchange, credentials): ExchangeAdapter`

### Wallet Schema Change
```typescript
exchange: 'alpaca' | 'binance' | 'coinbase'  // default: 'alpaca'
// Credential fields stored as flat keys in existing ApiKey collection keyed by walletId
```

**Credential keys per exchange:**
- Alpaca: `alpaca_api_key`, `alpaca_api_secret`, `alpaca_base_url`
- Binance: `binance_api_key`, `binance_api_secret`
- Coinbase: `coinbase_api_key`, `coinbase_api_secret` (CDP private key PEM)

### Endpoint/URL routing per adapter
| Exchange | Paper endpoint | Live endpoint |
|---|---|---|
| Alpaca | `https://paper-api.alpaca.markets` | `https://api.alpaca.markets` |
| Binance | `https://testnet.binance.vision` | `https://api.binance.com` |
| Coinbase | `https://api-public.sandbox.exchange.coinbase.com` | `https://api.coinbase.com` |

### Refactoring
- `poller.ts`: replace direct Alpaca calls with adapter calls
- `executor.ts`: replace direct Alpaca calls with adapter calls
- `engineManager.ts`: resolve adapter via `createAdapter(wallet.exchange, creds)` before each cycle
- `keys.ts`: add helpers to load credentials by exchange type from wallet

### Dashboard — Wallet Creation UI
- Exchange selector (Alpaca / Binance / Coinbase) shown first
- Credential input fields rendered conditionally based on selected exchange
- Mode toggle (paper/live) in creation form, defaults to paper

---

## 4. Monthly/Weekly P&L Decomposition

**Goal:** Group P&L by week or month in addition to existing daily/per-asset view.

### Backend
Extend `GET /api/pnl` with query param `?period=daily|weekly|monthly` (default: `daily`).

Grouping logic in `api.ts`:
- `weekly`: group by ISO week (`YYYY-WNN`)
- `monthly`: group by calendar month (`YYYY-MM`)
- Each group: `{ period, totalPnl, tradeCount, winRate, bestAsset, worstAsset }`

No schema changes — aggregates from existing `Trade` collection.

### Frontend
- Period toggle (pill buttons: Daily / Weekly / Monthly) above existing P&L chart in Overview
- Table columns adapt to period label
- Chart x-axis label adapts accordingly

---

## 5. Portfolio Allocation UI

**Goal:** Show current allocation breakdown and sizing recommendations in the dashboard.

### Data Sources (no new endpoints)
- Current cash + positions: `GET /api/positions` (already returns Alpaca position data)
- Portfolio totals: existing portfolio broadcast via WebSocket
- Kelly/ATR sizing: computed client-side from existing position data + config

### New "Allocation" Card (Overview.tsx)
**Visual:** Horizontal stacked bar — one segment per asset + cash, color-coded.

**Table below bar:**
| Asset | Value ($) | Allocation (%) | Kelly Size ($) | ATR Size ($) | Over/Under |
|---|---|---|---|---|---|
| BTC/USD | $1,240 | 42% | $480 | $320 | Over |
| ETH/USD | $580 | 20% | $300 | $280 | Under |
| Cash | $1,080 | 37% | — | — | — |

**Kelly Size** = `(winRate - (1-winRate)/payoffRatio) * equity * 0.5` using last 30 days win rate from stats.
**ATR Size** = `targetVolatility * equity / (ATR * price)` — displayed from most recent market snapshot.
**Over/Under** = compare current value vs Kelly Size.

### Implementation
- New `AllocationCard` component in `dashboard/src/components/`
- Consumes existing `usePositions` hook + portfolio WebSocket state
- No backend changes required

---

## Affected Files Summary

### New Files
- `agent/src/exchanges/adapter.ts` — interface + types
- `agent/src/exchanges/alpaca.ts` — Alpaca adapter
- `agent/src/exchanges/binance.ts` — Binance adapter
- `agent/src/exchanges/coinbase.ts` — Coinbase adapter
- `agent/src/exchanges/index.ts` — factory function
- `dashboard/src/components/AllocationCard.tsx` — allocation UI

### Modified Files
- `agent/src/schema.ts` — add `exchange`, `mode` to Wallet; add `Bar` type
- `agent/src/poller.ts` — use adapter interface
- `agent/src/executor.ts` — use adapter interface
- `agent/src/engineManager.ts` — resolve adapter per cycle
- `agent/src/keys.ts` — credential helpers per exchange
- `agent/src/api.ts` — rate limiters, `/api/pnl?period=`, `POST /api/wallets/:id/mode`
- `dashboard/src/pages/Overview.tsx` — AllocationCard, live banner, P&L period toggle
- `dashboard/src/pages/Settings.tsx` — exchange selector in wallet creation
- `dashboard/src/api.ts` — new API calls
- `package.json` (agent) — add `express-rate-limit`

---

## Out of Scope
- Redis-backed rate limiting (single-instance assumed)
- Binance Futures / Coinbase Pro legacy API
- Cross-exchange order routing / arbitrage
- Exchange-specific order types (limit, stop-limit) — market orders only for now
- Real-time order book data
