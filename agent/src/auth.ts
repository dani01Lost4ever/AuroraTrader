import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { UserModel } from './schema'

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production'
const JWT_EXPIRY = '7d'
const LOGIN_2FA_TOKEN_EXPIRY = '10m'
const TOTP_PERIOD_SECONDS = 30

interface JwtClaims {
  sub: string
  uid?: string
  role?: 'admin' | 'user'
  purpose?: 'auth' | 'login_2fa'
}

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    username: string
    role: 'admin' | 'user'
    blocked?: boolean
  }
}

function base32Encode(input: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }

  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '')
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let value = 0
  const out: number[] = []

  for (const char of clean) {
    const idx = alphabet.indexOf(char)
    if (idx < 0) continue
    value = (value << 5) | idx
    bits += 5
    while (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return Buffer.from(out)
}

function generateTotpCode(secretBase32: string, timestampMs = Date.now()): string {
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS)
  const counterBuf = Buffer.alloc(8)
  counterBuf.writeBigUInt64BE(BigInt(counter))
  const key = base32Decode(secretBase32)
  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, '0')
}

function verifyTotpCode(secretBase32: string, code: string): boolean {
  const clean = code.trim()
  if (!/^\d{6}$/.test(clean)) return false
  const now = Date.now()
  const windows = [-1, 0, 1]
  return windows.some((windowOffset) => {
    const at = now + windowOffset * TOTP_PERIOD_SECONDS * 1000
    return generateTotpCode(secretBase32, at) === clean
  })
}

function buildOtpAuthUrl(username: string, secretBase32: string): string {
  const issuer = encodeURIComponent('TradingAI')
  const label = encodeURIComponent(`TradingAI:${username}`)
  const secret = encodeURIComponent(secretBase32)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_SECONDS}`
}

function generateSecretBase32(): string {
  return base32Encode(crypto.randomBytes(20))
}

export function signToken(user: { id: string; username: string; role: 'admin' | 'user' }): string {
  return jwt.sign({ sub: user.username, uid: user.id, role: user.role, purpose: 'auth' }, JWT_SECRET, { expiresIn: JWT_EXPIRY })
}

function signLogin2faToken(user: { id: string; username: string }): string {
  return jwt.sign({ sub: user.username, uid: user.id, purpose: 'login_2fa' }, JWT_SECRET, { expiresIn: LOGIN_2FA_TOKEN_EXPIRY })
}

export function verifyToken(token: string): JwtClaims | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtClaims
  } catch {
    return null
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authedReq = req as AuthenticatedRequest
  const header = req.headers.authorization

  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const claims = verifyToken(header.slice(7))
  if (!claims || claims.purpose !== 'auth' || !claims.uid || !claims.sub) {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  const user = await UserModel.findById(claims.uid).lean()
  if (!user) {
    res.status(401).json({ error: 'User not found' })
    return
  }
  if (user.blocked) {
    res.status(403).json({ error: 'User is blocked' })
    return
  }

  authedReq.user = {
    id: user._id.toString(),
    username: user.username,
    role: user.role === 'admin' ? 'admin' : 'user',
    blocked: Boolean(user.blocked),
  }
  next()
}

export async function ensureAdminExists(): Promise<void> {
  const existingAdmin = await UserModel.findOne({ role: 'admin' }).lean()
  if (!existingAdmin) {
    const adminUsername = (process.env.ADMIN_USERNAME || 'superadmin').trim().toLowerCase()
    const password = process.env.ADMIN_PASSWORD || 'change-me-now'
    const passwordHash = await bcrypt.hash(password, 10)
    await UserModel.create({
      username: adminUsername,
      passwordHash,
      role: 'admin',
      blocked: false,
      twoFactorEnabled: false,
    })
    console.log(`[auth] Created bootstrap admin user "${adminUsername}" (set ADMIN_PASSWORD env in production)`)
  }
}

export async function registerHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body ?? {}
  const normalizedUsername = typeof username === 'string' ? username.trim().toLowerCase() : ''

  if (!/^[a-z0-9_.-]{3,32}$/.test(normalizedUsername)) {
    res.status(400).json({ error: 'username must be 3-32 chars: a-z, 0-9, _, ., -' })
    return
  }
  if (['admin', 'root', 'superadmin'].includes(normalizedUsername)) {
    res.status(400).json({ error: 'reserved username' })
    return
  }
  if (typeof password !== 'string' || password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' })
    return
  }

  const existing = await UserModel.findOne({ username: normalizedUsername }).lean()
  if (existing) {
    res.status(409).json({ error: 'username already exists' })
    return
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await UserModel.create({
    username: normalizedUsername,
    passwordHash,
    role: 'user',
    blocked: false,
    twoFactorEnabled: false,
  })

  res.status(201).json({
    user: {
      id: user._id.toString(),
      username: user.username,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
    },
  })
}

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body ?? {}

  if (!username || !password) {
    res.status(400).json({ error: 'username and password required' })
    return
  }

  const normalizedUsername = String(username).trim().toLowerCase()
  const user = await UserModel.findOne({ username: normalizedUsername })

  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }
  if (user.blocked) {
    res.status(403).json({ error: 'User is blocked' })
    return
  }

  if (user.twoFactorEnabled) {
    res.json({
      requires2fa: true,
      tempToken: signLogin2faToken({ id: user._id.toString(), username: user.username }),
    })
    return
  }

  res.json({ token: signToken({ id: user._id.toString(), username: user.username, role: user.role }) })
}

export async function login2faVerifyHandler(req: Request, res: Response): Promise<void> {
  const { tempToken, code } = req.body ?? {}

  if (!tempToken || !code) {
    res.status(400).json({ error: 'tempToken and code required' })
    return
  }

  const claims = verifyToken(String(tempToken))
  if (!claims || claims.purpose !== 'login_2fa' || !claims.uid || !claims.sub) {
    res.status(401).json({ error: 'Invalid or expired temporary token' })
    return
  }

  const user = await UserModel.findById(claims.uid)
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    res.status(401).json({ error: '2FA not enabled for user' })
    return
  }
  if (user.blocked) {
    res.status(403).json({ error: 'User is blocked' })
    return
  }

  if (!verifyTotpCode(user.twoFactorSecret, String(code))) {
    res.status(401).json({ error: 'Invalid authenticator code' })
    return
  }

  res.json({ token: signToken({ id: user._id.toString(), username: user.username, role: user.role }) })
}

export async function meHandler(req: Request, res: Response): Promise<void> {
  const authedReq = req as AuthenticatedRequest
  if (!authedReq.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const user = await UserModel.findById(authedReq.user.id).lean()
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  res.json({
    user: {
      id: user._id.toString(),
      username: user.username,
      role: user.role,
      blocked: Boolean(user.blocked),
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
    },
  })
}

export async function start2faSetupHandler(req: Request, res: Response): Promise<void> {
  const authedReq = req as AuthenticatedRequest
  if (!authedReq.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const user = await UserModel.findById(authedReq.user.id)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const secret = generateSecretBase32()
  user.twoFactorTempSecret = secret
  await user.save()

  res.json({
    secret,
    otpauthUrl: buildOtpAuthUrl(user.username, secret),
  })
}

export async function verify2faSetupHandler(req: Request, res: Response): Promise<void> {
  const authedReq = req as AuthenticatedRequest
  const { code } = req.body ?? {}

  if (!authedReq.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!code) {
    res.status(400).json({ error: 'code required' })
    return
  }

  const user = await UserModel.findById(authedReq.user.id)
  if (!user || !user.twoFactorTempSecret) {
    res.status(400).json({ error: 'No pending 2FA setup' })
    return
  }

  if (!verifyTotpCode(user.twoFactorTempSecret, String(code))) {
    res.status(401).json({ error: 'Invalid authenticator code' })
    return
  }

  user.twoFactorEnabled = true
  user.twoFactorSecret = user.twoFactorTempSecret
  user.twoFactorTempSecret = undefined
  await user.save()
  res.json({ success: true })
}

export async function disable2faHandler(req: Request, res: Response): Promise<void> {
  const authedReq = req as AuthenticatedRequest
  const { password, code } = req.body ?? {}

  if (!authedReq.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  if (!password || !code) {
    res.status(400).json({ error: 'password and code required' })
    return
  }

  const user = await UserModel.findById(authedReq.user.id)
  if (!user) {
    res.status(404).json({ error: 'User not found' })
    return
  }

  const passOk = await bcrypt.compare(String(password), user.passwordHash)
  const codeOk = user.twoFactorSecret ? verifyTotpCode(user.twoFactorSecret, String(code)) : false
  if (!passOk || !codeOk) {
    res.status(401).json({ error: 'Invalid credentials' })
    return
  }

  user.twoFactorEnabled = false
  user.twoFactorSecret = undefined
  user.twoFactorTempSecret = undefined
  await user.save()
  res.json({ success: true })
}

export async function changePasswordHandler(req: Request, res: Response): Promise<void> {
  const authedReq = req as AuthenticatedRequest
  const { currentPassword, newPassword } = req.body ?? {}

  if (!currentPassword || !newPassword || String(newPassword).length < 6) {
    res.status(400).json({ error: 'currentPassword and newPassword (min 6 chars) required' })
    return
  }
  if (!authedReq.user) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const user = await UserModel.findById(authedReq.user.id)
  if (!user || !(await bcrypt.compare(String(currentPassword), user.passwordHash))) {
    res.status(401).json({ error: 'Current password incorrect' })
    return
  }

  user.passwordHash = await bcrypt.hash(String(newPassword), 10)
  await user.save()
  res.json({ success: true })
}

export function isAdminUser(req: Request): boolean {
  const authedReq = req as AuthenticatedRequest
  return authedReq.user?.role === 'admin'
}
