import { ApiKeyModel } from './schema'

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
  const doc = await ApiKeyModel.findOne({ userId, key: name }).lean()
  if (doc?.value) return doc.value
  // Fallback to env/global for compatibility during migration.
  return getKey(name)
}

export async function setUserKey(userId: string, name: KeyName, value: string): Promise<void> {
  await ApiKeyModel.findOneAndUpdate(
    { userId, key: name },
    { userId, key: name, value },
    { upsert: true, returnDocument: 'after' }
  )
}

export async function getMaskedKeysForUser(userId: string): Promise<Record<KeyName, string>> {
  const docs = await ApiKeyModel.find({ userId }).lean()
  const map = new Map<KeyName, string>()
  for (const doc of docs) {
    if (KEY_NAMES.includes(doc.key as KeyName)) {
      map.set(doc.key as KeyName, doc.value)
    }
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
