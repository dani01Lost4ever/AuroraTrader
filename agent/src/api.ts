import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { TradeModel, EquityModel, TokenUsageModel, AuditLogModel, PromptModel, BacktestResultModel, OptimizeResultModel, UserModel, WalletModel } from './schema'
import { executeOrder } from './executor'
import { markExecuted, markExecutionFailed, exportDataset, expireStaleManualApprovals } from './logger'
import { getLogs } from './logs'
import { getConfig, getUserConfig, setUserConfig } from './config'
import {
  requireAuth,
  loginHandler,
  login2faVerifyHandler,
  registerHandler,
  meHandler,
  start2faSetupHandler,
  verify2faSetupHandler,
  disable2faHandler,
  changePasswordHandler,
  isAdminUser,
} from './auth'
import { getKey, getMaskedKeysForUser, getUserKey, getUserKeySet, setUserKey, KEY_NAMES, listUserWallets, createUserWallet, activateUserWallet, deleteUserWallet, getAdapterForUser } from './keys'
import { logAudit } from './audit'
import { engineManager } from './engineManager'
import type { KeyName } from './keys'
import axios from 'axios'
import path from 'path'
import fs from 'fs'
import rateLimit from 'express-rate-limit'

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
})

const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many 2FA attempts, please try again later.' },
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later.' },
})

const ALPACA_DATA = 'https://data.alpaca.markets'
const MANUAL_PENDING_FILTER = {
  approved: false,
  approval_mode: { $ne: 'auto' },
  'decision.action': { $ne: 'hold' },
}
const MANUAL_APPROVAL_TTL_MINUTES = Math.max(1, parseInt(process.env.MANUAL_APPROVAL_TTL_MINUTES || '30', 10))

const currentUser = (req: express.Request) => (req as any).user?.username || 'unknown'
const currentUserId = (req: express.Request) => (req as any).user?.id || ''
const isAdmin = (req: express.Request) => isAdminUser(req)

async function userAlpacaBase(req: express.Request): Promise<string> {
  const userId = currentUserId(req)
  if (!userId) return getKey('alpaca_base_url') || 'https://paper-api.alpaca.markets'
  return (await getUserKey(userId, 'alpaca_base_url')) || 'https://paper-api.alpaca.markets'
}

async function userAlpacaHeaders(req: express.Request): Promise<Record<string, string>> {
  const userId = currentUserId(req)
  if (!userId) {
    return {
      'APCA-API-KEY-ID': getKey('alpaca_api_key') || '',
      'APCA-API-SECRET-KEY': getKey('alpaca_api_secret') || '',
    }
  }
  return {
    'APCA-API-KEY-ID': (await getUserKey(userId, 'alpaca_api_key')) || '',
    'APCA-API-SECRET-KEY': (await getUserKey(userId, 'alpaca_api_secret')) || '',
  }
}

export function createApiServer(): express.Application {
  const app = express()
  app.use(express.json())

  // CORS for local dashboard dev
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // ── Public routes (no auth needed) ────────────────────────────────────────
  app.post('/api/auth/register', registerLimiter, async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (res.statusCode < 400 && body?.user?.username) {
        logAudit('register', body.user.username + ' registered', body.user.username, req).catch(() => {})
        if (body.user.id) {
          engineManager.ensureUser(body.user.id).catch(() => {})
        }
      }
      return originalJson(body)
    }
    return registerHandler(req, res)
  })

  app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.token) {
        const username: string = req.body?.username || 'unknown'
        logAudit('login', username + ' logged in', username, req).catch(() => {})
      } else if (body?.requires2fa) {
        const username: string = req.body?.username || 'unknown'
        logAudit('login_2fa_challenge', username + ' passed password step', username, req).catch(() => {})
      }
      return originalJson(body)
    }
    return loginHandler(req, res)
  })

  app.post('/api/auth/login/2fa', twoFaLimiter, async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.token) {
        logAudit('login_2fa', '2FA login success', 'unknown', req).catch(() => {})
      }
      return originalJson(body)
    }
    return login2faVerifyHandler(req, res)
  })

  // GET /api/health — public health check
  app.get('/api/health', async (_req, res) => {
    let mongodb = false
    try {
      const { connection } = await import('mongoose')
      mongodb = connection.readyState === 1
    } catch { /* ignore */ }

    const anthropicKeySet = Boolean(getKey('anthropic_api_key'))
    const openaiKeySet    = Boolean(getKey('openai_api_key'))
    const alpacaKeySet    = Boolean(getKey('alpaca_api_key') && getKey('alpaca_api_secret'))

    let lastCycleAt: string | null = null
    try {
      const latest = await TradeModel.findOne().sort({ timestamp: -1 }).lean()
      lastCycleAt = latest?.timestamp?.toISOString() ?? null
    } catch { /* ignore */ }

    const status = mongodb && (anthropicKeySet || openaiKeySet) ? 'ok' : 'degraded'
    res.json({ status, mongodb, anthropicKeySet, openaiKeySet, alpacaKeySet, lastCycleAt, uptime: process.uptime() })
  })

  // GET /api/prices/live — public live price feed
  app.get('/api/prices/live', async (_req, res) => {
    try {
      const assets  = getConfig().assets
      const result: Record<string, { price: number; change24h: number }> = {}

      for (const asset of assets) {
        try {
          const response = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/latest/bars`, {
            headers: {
              'APCA-API-KEY-ID': getKey('alpaca_api_key') || '',
              'APCA-API-SECRET-KEY': getKey('alpaca_api_secret') || '',
            },
            params: { symbols: asset },
          })
          const bar = response.data.bars?.[asset]
          if (bar) result[asset] = { price: bar.c, change24h: 0 }
        } catch { /* skip asset */ }
      }

      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── All routes below require a valid JWT ──────────────────────────────────
  app.use('/api', requireAuth)

  app.get('/api/auth/me', meHandler)
  app.post('/api/auth/2fa/setup', async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (res.statusCode < 400 && body?.secret) {
        logAudit('2fa_setup_started', '2FA setup started', currentUser(req), req).catch(() => {})
      }
      return originalJson(body)
    }
    return start2faSetupHandler(req, res)
  })
  app.post('/api/auth/2fa/verify', async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.success) {
        logAudit('2fa_enabled', '2FA enabled', currentUser(req), req).catch(() => {})
      }
      return originalJson(body)
    }
    return verify2faSetupHandler(req, res)
  })
  app.post('/api/auth/2fa/disable', async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.success) {
        logAudit('2fa_disabled', '2FA disabled', currentUser(req), req).catch(() => {})
      }
      return originalJson(body)
    }
    return disable2faHandler(req, res)
  })

  app.get('/api/admin/engines', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    res.json({ engines: engineManager.list() })
  })
  app.get('/api/admin/users', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const users = await UserModel.find({}, '_id username role blocked blockedAt blockedReason twoFactorEnabled').sort({ username: 1 }).lean()
    res.json({
      users: users.map((u) => ({
        id: u._id.toString(),
        username: u.username,
        role: u.role,
        blocked: Boolean((u as any).blocked),
        blockedAt: (u as any).blockedAt ?? null,
        blockedReason: (u as any).blockedReason ?? null,
        twoFactorEnabled: Boolean((u as any).twoFactorEnabled),
      })),
    })
  })
  app.post('/api/admin/users/:userId/block', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const userId = req.params.userId
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : ''
    const user = await UserModel.findById(userId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') return res.status(400).json({ error: 'Admin account cannot be blocked' })

    user.blocked = true
    user.blockedAt = new Date()
    user.blockedReason = reason || undefined
    await user.save()
    await engineManager.ensureUser(userId)
    engineManager.setBlocked(userId, true)
    engineManager.pause(userId)
    await logAudit('admin.user.block', `${user.username} blocked${reason ? `: ${reason}` : ''}`, currentUser(req), req)
    res.json({ success: true })
  })
  app.post('/api/admin/users/:userId/unblock', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    const userId = req.params.userId
    const user = await UserModel.findById(userId)
    if (!user) return res.status(404).json({ error: 'User not found' })

    user.blocked = false
    user.blockedAt = undefined
    user.blockedReason = undefined
    await user.save()
    await engineManager.ensureUser(userId)
    engineManager.setBlocked(userId, false)
    await logAudit('admin.user.unblock', `${user.username} unblocked`, currentUser(req), req)
    res.json({ success: true })
  })
  app.post('/api/admin/engines/:userId/pause', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    await engineManager.ensureUser(req.params.userId)
    const ok = engineManager.pause(req.params.userId)
    if (!ok) return res.status(404).json({ error: 'Engine not found' })
    await logAudit('admin.engine.pause', req.params.userId, currentUser(req), req)
    res.json({ success: true })
  })
  app.post('/api/admin/engines/:userId/resume', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    await engineManager.ensureUser(req.params.userId)
    const ok = engineManager.resume(req.params.userId)
    if (!ok) return res.status(400).json({ error: 'Engine not found or blocked user' })
    await logAudit('admin.engine.resume', req.params.userId, currentUser(req), req)
    res.json({ success: true })
  })
  app.post('/api/admin/engines/:userId/trigger', async (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' })
    await engineManager.ensureUser(req.params.userId)
    const ok = await engineManager.triggerCycle(req.params.userId)
    if (!ok) return res.status(404).json({ error: 'Engine not found' })
    await logAudit('admin.engine.trigger', req.params.userId, currentUser(req), req)
    res.json({ success: true })
  })

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.success) {
        logAudit('password_changed', currentUser(req) + ' changed password', currentUser(req), req).catch(() => {})
      }
      return originalJson(body)
    }
    return changePasswordHandler(req, res)
  })

  // GET /api/agent/status
  app.get('/api/agent/status', requireAuth, (req, res) => {
    const status = engineManager.get(currentUserId(req))
    res.json({ paused: status?.paused ?? false, blocked: status?.blocked ?? false })
  })

  // POST /api/agent/pause
  app.post('/api/agent/pause', requireAuth, (req, res) => {
    engineManager.pause(currentUserId(req))
    logAudit('agent.pause', 'Agent paused', currentUser(req), req).catch(() => {})
    res.json({ paused: true })
  })

  // POST /api/agent/resume
  app.post('/api/agent/resume', requireAuth, (req, res) => {
    engineManager.resume(currentUserId(req))
    logAudit('agent.resume', 'Agent resumed', currentUser(req), req).catch(() => {})
    res.json({ paused: false })
  })

  // GET /api/positions — live positions from Alpaca
  app.get('/api/positions', requireAuth, async (req, res) => {
    try {
      const adapter = await getAdapterForUser(currentUserId(req))
      const portfolio = await adapter.fetchPortfolio()
      res.json(portfolio.position_details)
    } catch {
      res.json([])
    }
  })

  // GET /api/agent/logs?limit=150
  app.get('/api/agent/logs', requireAuth, (req, res) => {
    if (!isAdmin(req)) return res.json({ logs: [] })
    const limit = Math.min(Number(req.query.limit ?? 150), 500)
    res.json({ logs: getLogs(limit) })
  })

  // GET /api/keys - masked values for all stored keys
  app.get('/api/keys', async (req, res) => {
    const userId = currentUserId(req)
    res.json(await getMaskedKeysForUser(userId))
  })

  // GET /api/wallets/active-mode — returns mode and exchange of the active wallet
  app.get('/api/wallets/active-mode', requireAuth, async (req, res) => {
    const wallet = await WalletModel.findOne({ userId: currentUserId(req), active: true }).lean()
    res.json({
      id: (wallet as any)?._id?.toString() ?? null,
      mode: (wallet as any)?.mode ?? 'paper',
      exchange: (wallet as any)?.exchange ?? 'alpaca',
      name: (wallet as any)?.name ?? 'Default',
    })
  })

  // GET /api/wallets - per-user Alpaca wallets
  app.get('/api/wallets', async (req, res) => {
    const wallets = await listUserWallets(currentUserId(req))
    res.json({ wallets })
  })

  // POST /api/wallets - create wallet
  app.post('/api/wallets', requireAuth, async (req, res) => {
    try {
      const { name, exchange, mode,
              alpaca_api_key, alpaca_api_secret, alpaca_base_url,
              binance_api_key, binance_api_secret,
              coinbase_api_key, coinbase_api_secret } = req.body
      const wallet = await createUserWallet(currentUserId(req), {
        name, exchange, mode,
        alpaca_api_key, alpaca_api_secret, alpaca_base_url,
        binance_api_key, binance_api_secret,
        coinbase_api_key, coinbase_api_secret,
      })
      res.json(wallet)
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })

  // POST /api/wallets/:walletId/activate - switch active wallet
  app.post('/api/wallets/:walletId/activate', async (req, res) => {
    const ok = await activateUserWallet(currentUserId(req), req.params.walletId)
    if (!ok) return res.status(404).json({ error: 'Wallet not found' })
    await logAudit('wallet.activate', req.params.walletId, currentUser(req), req)
    res.json({ success: true })
  })

  // DELETE /api/wallets/:walletId - remove wallet
  app.delete('/api/wallets/:walletId', async (req, res) => {
    const ok = await deleteUserWallet(currentUserId(req), req.params.walletId)
    if (!ok) return res.status(404).json({ error: 'Wallet not found' })
    await logAudit('wallet.delete', req.params.walletId, currentUser(req), req)
    res.json({ success: true })
  })

  // POST /api/wallets/:id/mode — switch paper/live mode (requires 2FA token for live)
  app.post('/api/wallets/:id/mode', requireAuth, async (req, res) => {
    const userId = currentUserId(req)
    const { mode, token } = req.body
    if (mode !== 'paper' && mode !== 'live') {
      return res.status(400).json({ error: 'mode must be "paper" or "live"' })
    }
    if (mode === 'live') {
      const user = await UserModel.findById(userId).lean()
      if (!user) return res.status(401).json({ error: 'User not found' })
      if (user.twoFactorEnabled) {
        if (!token) return res.status(403).json({ error: '2FA token required to enable live trading' })
        const { verifyTOTP } = await import('./auth')
        const valid = verifyTOTP(user.twoFactorSecret!, token)
        if (!valid) return res.status(403).json({ error: 'Invalid 2FA token' })
      }
    }
    const wallet = await WalletModel.findOne({ _id: req.params.id, userId })
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
    ;(wallet as any).mode = mode
    await wallet.save()
    await logAudit(`wallet.mode.${mode}`, `Wallet "${wallet.name}" switched to ${mode} mode`, currentUser(req), req)
    res.json({ id: wallet._id.toString(), mode })
  })

  // POST /api/keys - set a single key
  app.post('/api/keys', async (req, res) => {
    const { key, value } = req.body
    if (!key || typeof value !== 'string') {
      return res.status(400).json({ error: 'key and value required' })
    }
    if (!KEY_NAMES.includes(key as KeyName)) {
      return res.status(400).json({ error: `Unknown key "${key}"` })
    }
    await setUserKey(currentUserId(req), key as KeyName, value.trim())
    await logAudit('key_set', key + ' updated', currentUser(req), req)
    console.log(`[api] Key "${key}" updated`)
    res.json({ success: true })
  })

  // GET /api/models?provider=claude|openai - fetch available models from the provider API
  app.get('/api/models', async (req, res) => {
    const provider = (req.query.provider as string) || 'claude'
    const userId = currentUserId(req)

    try {
      if (provider === 'claude') {
        const apiKey = await getUserKey(userId, 'anthropic_api_key')
        if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not set' })
        const client = new Anthropic({ apiKey })
        const page = await client.models.list({ limit: 100 })
        const models = page.data.map((m: { id: string; display_name?: string }) => ({
          id: m.id,
          name: m.display_name || m.id,
        }))
        return res.json({ models })
      }

      if (provider === 'openai') {
        const apiKey = await getUserKey(userId, 'openai_api_key')
        if (!apiKey) return res.status(400).json({ error: 'OpenAI API key not set' })
        const client = new OpenAI({ apiKey })
        const page = await client.models.list()
        // Filter to chat-capable models only (exclude embeddings, audio, image, tts, etc.)
        const chatPrefixes = ['gpt-', 'o1', 'o3', 'o4']
        const models = page.data
          .filter(m => chatPrefixes.some(p => m.id.startsWith(p)))
          .sort((a, b) => b.created - a.created)
          .map(m => ({ id: m.id, name: m.id }))
        return res.json({ models })
      }

      res.status(400).json({ error: `Unknown provider "${provider}"` })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/trades?limit=50&page=1
  app.get('/api/trades', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50
    const page = parseInt(req.query.page as string) || 1
    const walletId = req.query.walletId as string | undefined
    const scope: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }
    if (walletId) scope.walletId = walletId
    const trades = await TradeModel.find(scope)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
    const total = await TradeModel.countDocuments(scope)
    res.json({ trades, total, page, limit })
  })

  // GET /api/trades/pending - unapproved non-hold decisions
  app.get('/api/trades/pending', async (req, res) => {
    await expireStaleManualApprovals(currentUserId(req), MANUAL_APPROVAL_TTL_MINUTES)
    const scope = isAdmin(req) ? {} : { userId: currentUserId(req) }
    const pending = await TradeModel.find({ ...MANUAL_PENDING_FILTER, ...scope })
      .sort({ timestamp: -1 })
      .lean()
    res.json(pending)
  })

  // GET /api/stats - summary for dashboard
  app.get('/api/stats', async (req, res) => {
    const walletId = req.query.walletId as string | undefined
    const scope: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }
    if (walletId) scope.walletId = walletId
    const [total, executed, profitable, datasetSize] = await Promise.all([
      TradeModel.countDocuments(scope),
      TradeModel.countDocuments({ ...scope, executed: true }),
      TradeModel.countDocuments({ ...scope, 'outcome.correct': true }),
      TradeModel.countDocuments({ ...scope, 'outcome.correct': true, executed: true }),
    ])

    const pnlAgg = await TradeModel.aggregate([
      { $match: { ...scope, 'outcome.pnl_usd': { $exists: true } } },
      { $group: { _id: null, total_pnl: { $sum: '$outcome.pnl_usd' } } },
    ])

    res.json({
      total_decisions: total,
      executed_trades: executed,
      profitable_trades: profitable,
      win_rate: executed > 0 ? ((profitable / executed) * 100).toFixed(1) : '0',
      total_pnl_usd: pnlAgg[0]?.total_pnl?.toFixed(2) ?? '0.00',
      dataset_size: datasetSize,
    })
  })

  // POST /api/trades/:id/approve - human gate
  app.post('/api/trades/:id/approve', async (req, res) => {
    const id = req.params.id
    const record = await TradeModel.findById(id)
    if (!record) return res.status(404).json({ error: 'Not found' })
    if (!isAdmin(req) && record.userId !== currentUserId(req)) return res.status(403).json({ error: 'Forbidden' })
    if (record.approved) return res.status(400).json({ error: 'Already approved' })
    const ageMs = Date.now() - new Date(record.timestamp).getTime()
    if (ageMs > MANUAL_APPROVAL_TTL_MINUTES * 60_000) {
      await markExecutionFailed(record._id.toString(), `Manual approval expired after ${MANUAL_APPROVAL_TTL_MINUTES} minutes`)
      return res.status(409).json({ error: 'Trade request expired; wait for a fresh signal' })
    }

    try {
      const keys = await getUserKeySet(record.userId)
      const result = await executeOrder(record.decision, {
        alpaca_api_key: keys.alpaca_api_key,
        alpaca_api_secret: keys.alpaca_api_secret,
        alpaca_base_url: keys.alpaca_base_url,
      })
      await markExecuted(record._id.toString(), result.order_id)
      await logAudit('trade_approved', id, currentUser(req), req)
      res.json({ success: true, order: result })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /api/trades/:id/reject - dismiss without executing
  app.post('/api/trades/:id/reject', async (req, res) => {
    const id = req.params.id
    const record = await TradeModel.findById(id).lean()
    if (!record) return res.status(404).json({ error: 'Not found' })
    if (!isAdmin(req) && record.userId !== currentUserId(req)) return res.status(403).json({ error: 'Forbidden' })
    await TradeModel.findByIdAndUpdate(id, { approved: true, executed: false })
    await logAudit('trade_rejected', id, currentUser(req), req)
    res.json({ success: true })
  })

  // GET /api/config - current runtime config
  app.get('/api/config', async (req, res) => {
    res.json(await getUserConfig(currentUserId(req)))
  })

  // POST /api/config - update runtime config
  app.post('/api/config', async (req, res) => {
    const { autoApprove } = req.body
    if (typeof autoApprove !== 'boolean') {
      return res.status(400).json({ error: 'autoApprove must be a boolean' })
    }
    await logAudit('config_change', JSON.stringify(req.body), currentUser(req), req)
    const updated = await setUserConfig(currentUserId(req), { autoApprove })
    console.log(`[api] user ${currentUser(req)} autoApprove set to ${autoApprove}`)

    // When switching TO auto-approve, drain any pending trades immediately
    if (false && autoApprove) {
      const pending = await TradeModel.find(MANUAL_PENDING_FILTER).lean()

      if (pending.length) {
        console.log(`[api] Auto-trade enabled — executing ${pending.length} pending trade(s)...`)
        for (const trade of pending) {
          try {
            const result = await executeOrder(trade.decision)
            await markExecuted(trade._id.toString(), result.order_id)
            console.log(`[api] Auto-executed pending ${trade.decision.action.toUpperCase()} ${trade.decision.asset}`)
          } catch (err: any) {
            await markExecutionFailed(trade._id.toString(), err.message)
            console.error(`[api] Failed to execute pending ${trade.decision.asset}: ${err.message}`)
          }
        }
      }
    }

    res.json(updated)
  })

  // GET /api/training/status - LLM provider, dataset size, Ollama reachability
  app.get('/api/training/status', async (req, res) => {
    const provider = process.env.LLM_PROVIDER || 'claude'
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const ollamaModel = process.env.OLLAMA_MODEL || 'trading-llm'

    const scope = isAdmin(req) ? {} : { userId: currentUserId(req) }
    const datasetSize = await TradeModel.countDocuments({ ...scope, 'outcome.correct': true, executed: true })

    // Find latest export file
    const exportsDir = path.join(process.cwd(), 'exports')
    let lastExport: string | null = null
    let lastExportFile: string | null = null
    if (fs.existsSync(exportsDir)) {
      const files = fs.readdirSync(exportsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(exportsDir, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      if (files.length) {
        lastExport = files[0].mtime.toISOString()
        lastExportFile = files[0].name
      }
    }

    // Ping Ollama
    let ollamaReachable = false
    try {
      await axios.get(`${ollamaBase}/api/tags`, { timeout: 3000 })
      ollamaReachable = true
    } catch { /* not running */ }

    const userId = currentUserId(req)
    const userClaudeKey = await getUserKey(userId, 'anthropic_api_key')
    const userOpenaiKey = await getUserKey(userId, 'openai_api_key')
    const effectiveProvider =
      provider === 'openai'
        ? (userOpenaiKey ? 'openai' : 'claude')
        : (userClaudeKey ? 'claude' : provider)

    res.json({
      provider: effectiveProvider,
      ollamaModel,
      ollamaBase,
      ollamaReachable,
      datasetSize,
      lastExport,
      lastExportFile,
    })
  })

  // GET /api/dataset/download - download the latest exported JSONL
  app.get('/api/dataset/download', (req, res) => {
    const exportsDir = path.join(process.cwd(), 'exports')
    if (!fs.existsSync(exportsDir)) return res.status(404).json({ error: 'No exports yet' })

    const files = fs.readdirSync(exportsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(exportsDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    if (!files.length) return res.status(404).json({ error: 'No exports yet — click Export first' })

    const latest = path.join(exportsDir, files[0].name)
    res.download(latest, files[0].name)
  })

  // GET /api/logs - recent agent log entries from ring buffer
  app.get('/api/logs', (req, res) => {
    if (!isAdmin(req)) return res.json([])
    const limit = parseInt(req.query.limit as string) || 150
    res.json(getLogs(limit))
  })

  // GET /api/assets/available - all tradeable crypto assets from Alpaca
  app.get('/api/assets/available', async (req, res) => {
    try {
      const [base, headers] = await Promise.all([userAlpacaBase(req), userAlpacaHeaders(req)])
      const response = await axios.get(`${base}/v2/assets`, {
        headers,
        params: { asset_class: 'crypto', status: 'active' },
      })
      const assets = (response.data as any[])
        .filter(a => a.tradable && a.status === 'active')
        .map(a => ({ symbol: a.symbol, name: a.name || a.symbol }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
      res.json(assets)
    } catch (err: any) {
      if (err.response) {
        res.status(err.response.status).json({ error: err.response.data })
      } else {
        res.status(500).json({ error: err.message })
      }
    }
  })

  // GET /api/assets/active - currently active trading assets
  app.get('/api/assets/active', async (req, res) => {
    const cfg = await getUserConfig(currentUserId(req))
    res.json(cfg.assets)
  })

  // POST /api/assets/active - update active trading assets
  app.post('/api/assets/active', async (req, res) => {
    const { assets } = req.body
    if (!Array.isArray(assets) || assets.some(a => typeof a !== 'string')) {
      return res.status(400).json({ error: 'assets must be a string array' })
    }
    const updated = await setUserConfig(currentUserId(req), { assets })
    console.log(`[api] Active assets updated: ${assets.join(', ')}`)
    res.json(updated.assets)
  })

  // GET /api/charts/:asset?timeframe=1H&limit=100 - OHLCV bars for charting
  app.get('/api/charts/:asset', async (req, res) => {
    const asset = decodeURIComponent(req.params.asset)
    const timeframe = (req.query.timeframe as string) || '1H'
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    try {
      const response = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/bars`, {
        headers: await userAlpacaHeaders(req),
        params: { symbols: asset, timeframe, limit },
      })
      res.json(response.data.bars[asset] || [])
    } catch (err: any) {
      if (err.response) {
        res.status(err.response.status).json({ error: err.response.data })
      } else {
        res.status(500).json({ error: err.message })
      }
    }
  })

  // POST /api/dataset/export - trigger JSONL export
  app.post('/api/dataset/export', async (req, res) => {
    const outPath = path.join(process.cwd(), 'exports', `dataset_${Date.now()}.jsonl`)
    const { mkdirSync } = await import('fs')
    mkdirSync(path.join(process.cwd(), 'exports'), { recursive: true })
    const count = await exportDataset(outPath, isAdmin(req) ? '__global__' : currentUserId(req))
    res.json({ success: true, count, path: outPath })
  })

  // GET /api/equity/history - for drawdown chart
  app.get('/api/equity/history', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 200
    const walletId = req.query.walletId as string | undefined
    const scope: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }
    if (walletId) scope.walletId = walletId
    const history = await EquityModel.find(scope).sort({ ts: -1 }).limit(limit).lean()
    res.json(history.reverse())
  })

  // GET /api/portfolio/detail - positions with market values
  app.get('/api/portfolio/detail', async (req, res) => {
    try {
      const [base, headers] = await Promise.all([userAlpacaBase(req), userAlpacaHeaders(req)])
      const [accountRes, positionsRes] = await Promise.all([
        axios.get(`${base}/v2/account`, { headers }),
        axios.get(`${base}/v2/positions`, { headers }),
      ])
      const cash = parseFloat(accountRes.data.cash)
      const equity = parseFloat(accountRes.data.equity)
      const positions = positionsRes.data.map((p: any) => ({
        asset: p.symbol.replace(/([A-Z]+)(USD)$/, '$1/USD'),
        qty: parseFloat(p.qty),
        entry_price: parseFloat(p.avg_entry_price),
        current_price: parseFloat(p.current_price),
        market_value: parseFloat(p.market_value),
        unrealized_pl: parseFloat(p.unrealized_pl),
        unrealized_plpc: parseFloat(p.unrealized_plpc) * 100,
      }))
      res.json({ cash, equity, positions })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/stats/per-asset - P&L breakdown by asset
  app.get('/api/stats/per-asset', async (req, res) => {
    const walletId = req.query.walletId as string | undefined
    const scope: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }
    if (walletId) scope.walletId = walletId
    const perAsset = await TradeModel.aggregate([
      { $match: { ...scope, 'outcome.pnl_usd': { $exists: true } } },
      { $group: {
        _id: '$decision.asset',
        total_pnl: { $sum: '$outcome.pnl_usd' },
        trade_count: { $sum: 1 },
        wins: { $sum: { $cond: ['$outcome.correct', 1, 0] } },
      }},
      { $sort: { total_pnl: -1 } },
    ])
    res.json(perAsset.map(a => ({
      asset: a._id,
      total_pnl: parseFloat(a.total_pnl.toFixed(2)),
      trade_count: a.trade_count,
      win_rate: a.trade_count > 0 ? parseFloat(((a.wins / a.trade_count) * 100).toFixed(1)) : 0,
    })))
  })

  // GET /api/stats/per-period?period=daily|weekly|monthly
  app.get('/api/stats/per-period', requireAuth, async (req, res) => {
    const period = (req.query.period as string) || 'daily'
    const walletId = req.query.walletId as string | undefined
    const scope: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }
    if (walletId) scope.walletId = walletId

    let groupId: any
    if (period === 'monthly') {
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
      }
    } else if (period === 'weekly') {
      groupId = {
        year: { $isoWeekYear: '$timestamp' },
        week: { $isoWeek: '$timestamp' },
      }
    } else {
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
      }
    }

    const results = await TradeModel.aggregate([
      { $match: { ...scope, 'outcome.pnl_usd': { $exists: true } } },
      { $group: {
        _id: groupId,
        total_pnl: { $sum: '$outcome.pnl_usd' },
        trade_count: { $sum: 1 },
        wins: { $sum: { $cond: ['$outcome.correct', 1, 0] } },
        avg_win: { $avg: { $cond: [{ $gt: ['$outcome.pnl_usd', 0] }, '$outcome.pnl_usd', null] } },
        avg_loss: { $avg: { $cond: [{ $lt: ['$outcome.pnl_usd', 0] }, '$outcome.pnl_usd', null] } },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
    ])

    res.json(results.map(r => {
      let label: string
      if (period === 'monthly') {
        label = `${r._id.year}-${String(r._id.month).padStart(2, '0')}`
      } else if (period === 'weekly') {
        label = `${r._id.year}-W${String(r._id.week).padStart(2, '0')}`
      } else {
        label = `${r._id.year}-${String(r._id.month).padStart(2, '0')}-${String(r._id.day).padStart(2, '0')}`
      }
      return {
        period: label,
        total_pnl: parseFloat((r.total_pnl ?? 0).toFixed(2)),
        trade_count: r.trade_count,
        win_rate: r.trade_count > 0 ? parseFloat(((r.wins / r.trade_count) * 100).toFixed(1)) : 0,
        avg_win: r.avg_win != null ? parseFloat(r.avg_win.toFixed(2)) : null,
        avg_loss: r.avg_loss != null ? parseFloat(r.avg_loss.toFixed(2)) : null,
      }
    }))
  })

  // GET /api/risk/status
  app.get('/api/risk/status', async (req, res) => {
    try {
      const [base, headers] = await Promise.all([userAlpacaBase(req), userAlpacaHeaders(req)])
      const [accountRes] = await Promise.all([
        axios.get(`${base}/v2/account`, { headers }),
      ])
      const equity = parseFloat(accountRes.data.equity)
      const { getRiskStatus } = await import('./risk')
      const cfg = await getUserConfig(currentUserId(req))
      const status = await getRiskStatus(cfg as any, equity)
      res.json(status)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/tokens/stats - aggregate token usage and cost
  app.get('/api/tokens/stats', async (req, res) => {
    const scope = isAdmin(req) ? {} : { userId: currentUserId(req) }
    const [totals, byModel, daily] = await Promise.all([
      // Overall totals
      TokenUsageModel.aggregate([
        { $match: scope },
        { $group: {
          _id: null,
          total_input:  { $sum: '$input_tokens' },
          total_output: { $sum: '$output_tokens' },
          total_cost:   { $sum: '$cost_usd' },
          total_calls:  { $sum: 1 },
        }},
      ]),
      // Breakdown per model
      TokenUsageModel.aggregate([
        { $match: scope },
        { $group: {
          _id:          '$llm_model',
          input_tokens: { $sum: '$input_tokens' },
          output_tokens:{ $sum: '$output_tokens' },
          cost_usd:     { $sum: '$cost_usd' },
          calls:        { $sum: 1 },
        }},
        { $sort: { cost_usd: -1 } },
      ]),
      // Daily cost for the last 30 days
      TokenUsageModel.aggregate([
        { $match: { ...scope, ts: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } },
          cost_usd:     { $sum: '$cost_usd' },
          input_tokens: { $sum: '$input_tokens' },
          output_tokens:{ $sum: '$output_tokens' },
          calls:        { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ])

    res.json({
      total_calls:   totals[0]?.total_calls   ?? 0,
      total_input:   totals[0]?.total_input   ?? 0,
      total_output:  totals[0]?.total_output  ?? 0,
      total_cost:    parseFloat((totals[0]?.total_cost ?? 0).toFixed(4)),
      by_model: byModel.map(m => ({
        model:         m._id,
        input_tokens:  m.input_tokens,
        output_tokens: m.output_tokens,
        cost_usd:      parseFloat(m.cost_usd.toFixed(4)),
        calls:         m.calls,
      })),
      daily: daily.map(d => ({
        date:          d._id,
        cost_usd:      parseFloat(d.cost_usd.toFixed(4)),
        input_tokens:  d.input_tokens,
        output_tokens: d.output_tokens,
        calls:         d.calls,
      })),
    })
  })

  // GET /api/tokens/history?limit=200 - raw call log
  app.get('/api/tokens/history', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000)
    const scope = isAdmin(req) ? {} : { userId: currentUserId(req) }
    const rows = await TokenUsageModel.find(scope)
      .sort({ ts: -1 })
      .limit(limit)
      .lean()
    res.json(rows.reverse())
  })

  // POST /api/config/risk - update risk + LLM settings
  app.post('/api/config/risk', async (req, res) => {
    const { stopLossPct, takeProfitPct, maxDrawdownPct, maxOpenPositions, claudeModel, cycleMinutes, marketDataMinutes,
            confidenceThreshold, kellyEnabled, consensusMode, consensusModel,
            costAwareTrading, costLookbackCalls, costProfitRatio,
            trailingStopEnabled, trailingStopPct,
            activeStrategy, strategyParams, autoFallbackToLlm } = req.body
    const updates: any = {}
    if (typeof stopLossPct === 'number')           updates.stopLossPct           = stopLossPct
    if (typeof takeProfitPct === 'number')         updates.takeProfitPct         = takeProfitPct
    if (typeof maxDrawdownPct === 'number')        updates.maxDrawdownPct        = maxDrawdownPct
    if (typeof maxOpenPositions === 'number')      updates.maxOpenPositions      = maxOpenPositions
    if (typeof claudeModel === 'string')           updates.claudeModel           = claudeModel
    if (typeof cycleMinutes === 'number')          updates.cycleMinutes          = cycleMinutes
    if (typeof marketDataMinutes === 'number')     updates.marketDataMinutes     = marketDataMinutes
    if (typeof confidenceThreshold === 'number')   updates.confidenceThreshold   = confidenceThreshold
    if (typeof kellyEnabled === 'boolean')         updates.kellyEnabled          = kellyEnabled
    if (typeof consensusMode === 'boolean')        updates.consensusMode         = consensusMode
    if (typeof consensusModel === 'string')        updates.consensusModel        = consensusModel
    if (typeof costAwareTrading === 'boolean')     updates.costAwareTrading      = costAwareTrading
    if (typeof costLookbackCalls === 'number')     updates.costLookbackCalls     = costLookbackCalls
    if (typeof costProfitRatio === 'number')       updates.costProfitRatio       = costProfitRatio
    if (typeof trailingStopEnabled === 'boolean')  updates.trailingStopEnabled   = trailingStopEnabled
    if (typeof trailingStopPct === 'number')       updates.trailingStopPct       = trailingStopPct
    if (typeof activeStrategy === 'string')        updates.activeStrategy        = activeStrategy
    if (strategyParams !== undefined)              updates.strategyParams        = strategyParams
    if (typeof autoFallbackToLlm === 'boolean')    updates.autoFallbackToLlm     = autoFallbackToLlm
    await logAudit('config_change', JSON.stringify(req.body), currentUser(req), req)
    const updated = await setUserConfig(currentUserId(req), updates)
    console.log('[api] Config updated:', updates)
    res.json(updated)
  })

  // GET /api/audit?limit=100
  app.get('/api/audit', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const filter = isAdmin(req) ? {} : { user: currentUser(req) }
    const events = await AuditLogModel.find(filter).sort({ ts: -1 }).limit(limit).lean()
    res.json({ events })
  })

  // GET /api/prompt
  app.get('/api/prompt', async (_req, res) => {
    const doc = await PromptModel.findOne({ key: 'system_prompt' }).lean()
    res.json({ systemPrompt: doc?.value ?? null })
  })

  // POST /api/prompt
  app.post('/api/prompt', async (req, res) => {
    const { systemPrompt } = req.body
    if (typeof systemPrompt !== 'string') {
      return res.status(400).json({ error: 'systemPrompt must be a string' })
    }
    await PromptModel.findOneAndUpdate(
      { key: 'system_prompt' },
      { value: systemPrompt, updatedAt: new Date() },
      { upsert: true, returnDocument: 'after' }
    )
    res.json({ success: true })
  })

  // DELETE /api/prompt
  app.delete('/api/prompt', async (_req, res) => {
    await PromptModel.deleteOne({ key: 'system_prompt' })
    res.json({ success: true })
  })

  // POST /api/backtest
  app.post('/api/backtest', async (req, res) => {
    const { assets, startDate, endDate, cycleHours, mode, model } = req.body
    if (!Array.isArray(assets) || !startDate || !endDate) {
      return res.status(400).json({ error: 'assets, startDate, endDate are required' })
    }
    try {
      const { runBacktest } = await import('./backtest')
      const userCfg = await getUserConfig(currentUserId(req))
      const result = await runBacktest({
        assets,
        startDate,
        endDate,
        cycleHours: typeof cycleHours === 'number' ? cycleHours : 24,
        model:      typeof model === 'string' ? model : userCfg.claudeModel,
        mode:       mode === 'llm' ? 'llm' : 'rules',
        startEquity:    10000,
        maxPositionUsd: 500,
      })
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/backtest/results
  app.get('/api/backtest/results', async (_req, res) => {
    const results = await BacktestResultModel.find()
      .sort({ runAt: -1 })
      .select('-trades')
      .lean()
    res.json(results)
  })

  // GET /api/equity/benchmark
  app.get('/api/equity/benchmark', async (req, res) => {
    try {
      const scope = isAdmin(req) ? {} : { userId: currentUserId(req) }
      const history = await EquityModel.find(scope).sort({ ts: 1 }).lean()
      if (!history.length) return res.json({ points: [], benchmarkAsset: 'BTC/USD' })

      const firstSnap = history[0]
      const firstTs   = new Date(firstSnap.ts).toISOString()

      // Fetch BTC/USD hourly bars from the start date to now
      const btcResponse = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/bars`, {
        headers: await userAlpacaHeaders(req),
        params: { symbols: 'BTC/USD', timeframe: '1H', start: firstTs, limit: 1000 },
      })
      const btcBars: any[] = btcResponse.data.bars?.['BTC/USD'] || []
      if (!btcBars.length) return res.json({ points: [], benchmarkAsset: 'BTC/USD' })

      const btcStartPrice = btcBars[0].c
      const startEquity   = firstSnap.equity

      // Build a map: timestamp (hour) → btc price
      const btcPriceMap = new Map<number, number>()
      for (const bar of btcBars) {
        const hour = Math.floor(new Date(bar.t).getTime() / 3_600_000) * 3_600_000
        btcPriceMap.set(hour, bar.c)
      }

      // Align equity history with BTC benchmark
      const points = history.map(snap => {
        const hour     = Math.floor(new Date(snap.ts).getTime() / 3_600_000) * 3_600_000
        const btcPrice = btcPriceMap.get(hour) ?? btcBars[btcBars.length - 1].c
        const benchmark = startEquity * (btcPrice / btcStartPrice)
        return { ts: snap.ts, equity: snap.equity, benchmark: parseFloat(benchmark.toFixed(2)) }
      })

      res.json({ points, benchmarkAsset: 'BTC/USD' })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/trades/reasoning?asset=&action=&outcome=correct|incorrect&limit=50&page=1
  app.get('/api/trades/reasoning', async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const page   = parseInt(req.query.page as string) || 1
    const filter: Record<string, any> = isAdmin(req) ? {} : { userId: currentUserId(req) }

    if (req.query.asset)  filter['decision.asset']  = req.query.asset
    if (req.query.action) filter['decision.action'] = req.query.action
    if (req.query.outcome === 'correct')   filter['outcome.correct'] = true
    if (req.query.outcome === 'incorrect') filter['outcome.correct'] = false

    const [trades, total] = await Promise.all([
      TradeModel.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('timestamp decision outcome executed approved')
        .lean(),
      TradeModel.countDocuments(filter),
    ])

    res.json({ trades, total, page, limit })
  })

  // GET /api/strategies
  app.get('/api/strategies', requireAuth, (_req, res) => {
    const { listStrategies } = require('./strategies/registry')
    res.json({ strategies: listStrategies() })
  })

  // GET /api/strategy/params?strategyId=momentum
  app.get('/api/strategy/params', requireAuth, async (req, res) => {
    const { getStrategy: gs, mergeWithDefaults: mwd } = require('./strategies/registry')
    const strategyId = String(req.query.strategyId || 'momentum')
    const cfg = await getUserConfig(currentUserId(req))
    const saved = cfg.strategyParams?.[strategyId] ?? {}
    try {
      const strategy = gs(strategyId)
      const merged = mwd(strategy.params, saved as any)
      res.json(merged)
    } catch {
      res.status(404).json({ error: 'Unknown strategy' })
    }
  })

  // POST /api/strategy/params
  app.post('/api/strategy/params', requireAuth, async (req, res) => {
    const { strategyId, params } = req.body
    if (!strategyId || !params) return res.status(400).json({ error: 'strategyId and params required' })
    const cfg = await getUserConfig(currentUserId(req))
    const current = cfg.strategyParams ?? {}
    await setUserConfig(currentUserId(req), { strategyParams: { ...current, [strategyId]: params } })
    logAudit('strategy.params', `Updated params for ${strategyId}`, currentUser(req), req).catch(() => {})
    res.json({ success: true })
  })

  // POST /api/config/strategy
  app.post('/api/config/strategy', requireAuth, async (req, res) => {
    const { activeStrategy, autoFallbackToLlm } = req.body
    const updates: any = {}
    if (activeStrategy !== undefined) updates.activeStrategy = activeStrategy
    if (autoFallbackToLlm !== undefined) updates.autoFallbackToLlm = autoFallbackToLlm
    const cfg = await setUserConfig(currentUserId(req), updates)
    logAudit('strategy.select', `Active strategy set to ${activeStrategy}`, currentUser(req), req).catch(() => {})
    res.json(cfg)
  })

  // POST /api/backtest/compare
  app.post('/api/backtest/compare', requireAuth, async (req, res) => {
    try {
      const { strategyIds, assets, startDate, endDate, cycleHours, startEquity, maxPositionUsd = 500, strategyParams = {} } = req.body
      if (!strategyIds?.length) return res.status(400).json({ error: 'strategyIds required' })

      const { runBacktest: rb } = await import('./backtest')
      const { getStrategy: gs } = await import('./strategies/registry')

      const results = await Promise.all(
        (strategyIds as string[]).map(async (sid: string) => {
          const bt = await rb({
            assets, startDate, endDate, cycleHours,
            strategyId: sid,
            strategyParams: strategyParams[sid] ?? {},
            startEquity, maxPositionUsd, model: '', mode: 'rules',
            saveToDb: false,
          })
          // Build equity curve from trades
          let eq = startEquity
          const equityCurve = (bt.trades || []).map((t: any) => {
            eq += t.pnl_usd
            return { ts: t.ts, equity: Math.round(eq) }
          })
          return { strategyId: sid, label: (() => { try { return gs(sid).label } catch { return sid } })(), result: bt, equityCurve }
        })
      )
      res.json({ strategies: results })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // POST /api/optimize
  app.post('/api/optimize', requireAuth, async (req, res) => {
    try {
      const { strategyId, assets, startDate, endDate, cycleHours, startEquity, maxPositionUsd = 500, paramGrid } = req.body
      if (!strategyId || !paramGrid) return res.status(400).json({ error: 'strategyId and paramGrid required' })

      // Guard against combinatorial explosion
      const combos = Object.values(paramGrid as Record<string, any[]>).reduce((a, b) => a * b.length, 1)
      if (combos > 500) return res.status(400).json({ error: `Too many combinations (${combos}), max 500` })

      const { runOptimization } = await import('./optimizer')
      const result = await runOptimization({ strategyId, assets, startDate, endDate, cycleHours, startEquity, maxPositionUsd, paramGrid })
      res.json(result)
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // GET /api/optimize/results?strategyId=momentum
  app.get('/api/optimize/results', requireAuth, async (req, res) => {
    const filter: any = {}
    if (req.query.strategyId) filter.strategyId = req.query.strategyId
    const results = await OptimizeResultModel.find(filter).sort({ runAt: -1 }).limit(20).lean()
    res.json(results)
  })

  return app
}
