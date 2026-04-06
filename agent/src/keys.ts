import { ApiKeyModel, WalletModel } from './schema'

export const KEY_NAMES = [
  'anthropic_api_key',
  'openai_api_key',
  'alpaca_api_key',
  'alpaca_api_secret',
  'alpaca_base_url',
] as const

export type KeyName = typeof KEY_NAMES[number]
export interface UserKeySet {
  anthropic_api_key?: string
  openai_api_key?: string
  alpaca_api_key?: string
  alpaca_api_secret?: string
  alpaca_base_url?: string
}

export interface UserWalletInfo {
  id: string
  name: string
  active: boolean
  alpaca_api_key_masked: string
  alpaca_api_secret_masked: string
  alpaca_base_url: string
}

const ENV_MAP: Record<KeyName, string> = {
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  openai_api_key: 'OPENAI_API_KEY',
  alpaca_api_key: 'ALPACA_API_KEY',
  alpaca_api_secret: 'ALPACA_API_SECRET',
  alpaca_base_url: 'ALPACA_BASE_URL',
}
const GLOBAL_SCOPE = '__global__'

// Global cache used by the runtime agent (legacy/global behavior)
const globalCache: Partial<Record<KeyName, string>> = {}

function isAlpacaKey(name: KeyName): boolean {
  return name === 'alpaca_api_key' || name === 'alpaca_api_secret' || name === 'alpaca_base_url'
}

function maskSecret(value: string, plain = false): string {
  if (!value) return ''
  if (plain) return value
  return `***${value.slice(-4)}`
}

async function ensureWalletSeededFromLegacyKeys(userId: string): Promise<void> {
  const count = await WalletModel.countDocuments({ userId })
  if (count > 0) return

  const [legacyApiKey, legacySecret, legacyBase] = await Promise.all([
    ApiKeyModel.findOne({ userId, key: 'alpaca_api_key' }).lean(),
    ApiKeyModel.findOne({ userId, key: 'alpaca_api_secret' }).lean(),
    ApiKeyModel.findOne({ userId, key: 'alpaca_base_url' }).lean(),
  ])

  try {
    await WalletModel.create({
      userId,
      name: 'Default Wallet',
      active: true,
      alpaca_api_key: legacyApiKey?.value || getKey('alpaca_api_key') || '',
      alpaca_api_secret: legacySecret?.value || getKey('alpaca_api_secret') || '',
      alpaca_base_url: legacyBase?.value || getKey('alpaca_base_url') || 'https://paper-api.alpaca.markets',
    })
  } catch {
    // Concurrent first-request race can create the same default wallet twice; ignore.
  }
}

async function getActiveWallet(userId: string) {
  await ensureWalletSeededFromLegacyKeys(userId)
  let wallet = await WalletModel.findOne({ userId, active: true })
  if (!wallet) {
    wallet = await WalletModel.findOne({ userId }).sort({ createdAt: 1 })
    if (wallet) {
      wallet.active = true
      await wallet.save()
    }
  }
  return wallet
}

export function getKey(name: KeyName): string | undefined {
  return process.env[ENV_MAP[name]] || globalCache[name]
}

export async function loadKeysFromDB(): Promise<void> {
  const docs = await ApiKeyModel.find({ userId: { $in: [GLOBAL_SCOPE, null] } }).lean()
  for (const doc of docs) {
    if (KEY_NAMES.includes(doc.key as KeyName)) {
      globalCache[doc.key as KeyName] = doc.value
    }
  }
  console.log(`[keys] Loaded ${docs.length} global API key(s) from DB`)
}

export async function setKey(name: KeyName, value: string): Promise<void> {
  await ApiKeyModel.findOneAndUpdate(
    { userId: GLOBAL_SCOPE, key: name },
    { userId: GLOBAL_SCOPE, key: name, value },
    { upsert: true, returnDocument: 'after' }
  )
  globalCache[name] = value
}

export function getMaskedKeys(): Record<KeyName, string> {
  const result = {} as Record<KeyName, string>
  for (const name of KEY_NAMES) {
    const val = getKey(name)
    if (!val) {
      result[name] = ''
    } else if (name === 'alpaca_base_url') {
      result[name] = val
    } else {
      result[name] = `***${val.slice(-4)}`
    }
  }
  return result
}

export async function getUserKey(userId: string, name: KeyName): Promise<string | undefined> {
  if (isAlpacaKey(name)) {
    const wallet = await getActiveWallet(userId)
    if (wallet) {
      if (name === 'alpaca_api_key') return wallet.alpaca_api_key || undefined
      if (name === 'alpaca_api_secret') return wallet.alpaca_api_secret || undefined
      if (name === 'alpaca_base_url') return wallet.alpaca_base_url || undefined
    }
  }
  const doc = await ApiKeyModel.findOne({ userId, key: name }).lean()
  if (doc?.value) return doc.value
  // Fallback to env/global for compatibility during migration.
  return getKey(name)
}

export async function setUserKey(userId: string, name: KeyName, value: string): Promise<void> {
  if (isAlpacaKey(name)) {
    const wallet = await getActiveWallet(userId)
    if (!wallet) return
    if (name === 'alpaca_api_key') wallet.alpaca_api_key = value
    if (name === 'alpaca_api_secret') wallet.alpaca_api_secret = value
    if (name === 'alpaca_base_url') wallet.alpaca_base_url = value
    await wallet.save()
    return
  }
  await ApiKeyModel.findOneAndUpdate(
    { userId, key: name },
    { userId, key: name, value },
    { upsert: true, returnDocument: 'after' }
  )
}

export async function getMaskedKeysForUser(userId: string): Promise<Record<KeyName, string>> {
  const [docs, wallet] = await Promise.all([
    ApiKeyModel.find({ userId }).lean(),
    getActiveWallet(userId),
  ])
  const map = new Map<KeyName, string>()
  for (const doc of docs) {
    if (KEY_NAMES.includes(doc.key as KeyName)) {
      map.set(doc.key as KeyName, doc.value)
    }
  }
  if (wallet) {
    map.set('alpaca_api_key', wallet.alpaca_api_key)
    map.set('alpaca_api_secret', wallet.alpaca_api_secret)
    map.set('alpaca_base_url', wallet.alpaca_base_url)
  }

  const result = {} as Record<KeyName, string>
  for (const name of KEY_NAMES) {
    const val = map.get(name) || getKey(name)
    if (!val) {
      result[name] = ''
    } else if (name === 'alpaca_base_url') {
      result[name] = val
    } else {
      result[name] = `***${val.slice(-4)}`
    }
  }
  return result
}

export async function getUserKeySet(userId: string): Promise<UserKeySet> {
  return {
    anthropic_api_key: await getUserKey(userId, 'anthropic_api_key'),
    openai_api_key: await getUserKey(userId, 'openai_api_key'),
    alpaca_api_key: await getUserKey(userId, 'alpaca_api_key'),
    alpaca_api_secret: await getUserKey(userId, 'alpaca_api_secret'),
    alpaca_base_url: await getUserKey(userId, 'alpaca_base_url'),
  }
}

export async function listUserWallets(userId: string): Promise<UserWalletInfo[]> {
  await ensureWalletSeededFromLegacyKeys(userId)
  const rows = await WalletModel.find({ userId }).sort({ createdAt: 1 }).lean()
  return rows.map((w) => ({
    id: w._id.toString(),
    name: w.name,
    active: Boolean((w as any).active),
    alpaca_api_key_masked: maskSecret((w as any).alpaca_api_key || ''),
    alpaca_api_secret_masked: maskSecret((w as any).alpaca_api_secret || ''),
    alpaca_base_url: (w as any).alpaca_base_url || '',
  }))
}

export async function createUserWallet(
  userId: string,
  payload: { name: string; alpaca_api_key: string; alpaca_api_secret: string; alpaca_base_url?: string }
): Promise<UserWalletInfo> {
  const name = payload.name.trim()
  const existing = await WalletModel.findOne({ userId, name }).lean()
  if (existing) throw new Error('Wallet name already exists')

  const hasAny = await WalletModel.exists({ userId })
  const wallet = await WalletModel.create({
    userId,
    name,
    active: !hasAny,
    alpaca_api_key: payload.alpaca_api_key.trim(),
    alpaca_api_secret: payload.alpaca_api_secret.trim(),
    alpaca_base_url: (payload.alpaca_base_url || 'https://paper-api.alpaca.markets').trim(),
  })

  return {
    id: wallet._id.toString(),
    name: wallet.name,
    active: wallet.active,
    alpaca_api_key_masked: maskSecret(wallet.alpaca_api_key),
    alpaca_api_secret_masked: maskSecret(wallet.alpaca_api_secret),
    alpaca_base_url: wallet.alpaca_base_url,
  }
}

export async function activateUserWallet(userId: string, walletId: string): Promise<boolean> {
  const target = await WalletModel.findOne({ _id: walletId, userId })
  if (!target) return false
  await WalletModel.updateMany({ userId, active: true }, { active: false })
  target.active = true
  await target.save()
  return true
}

export async function deleteUserWallet(userId: string, walletId: string): Promise<boolean> {
  const target = await WalletModel.findOne({ _id: walletId, userId })
  if (!target) return false
  await WalletModel.deleteOne({ _id: target._id })
  if (target.active) {
    const fallback = await WalletModel.findOne({ userId }).sort({ createdAt: 1 })
    if (fallback) {
      fallback.active = true
      await fallback.save()
    }
  }
  return true
}
