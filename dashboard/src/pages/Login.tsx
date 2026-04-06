import { useState, FormEvent } from 'react'
import { api, auth } from '../api'
import { applyTheme, getTheme } from '../theme'
import type { Theme } from '../theme'
import { ThemePicker } from '../components/ThemePicker'

interface LoginProps {
  onLogin: () => void
  onBack?: () => void
}

type AuthMode = 'login' | 'register'

export function Login({ onLogin, onBack }: LoginProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [pending2faToken, setPending2faToken] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => getTheme())

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    boxSizing: 'border-box',
    background: 'var(--bg3)',
    border: '1px solid var(--border2)',
    borderRadius: 6,
    color: 'var(--text)',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    outline: 'none',
  }

  const submitAuth = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setLoading(true)
    try {
      if (mode === 'register') {
        if (password.length < 8) throw new Error('Password must be at least 8 characters')
        if (password !== confirmPassword) throw new Error('Passwords do not match')
        await api.register(username, password)
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setNotice('Registration completed. Log in with your new account.')
      } else {
        const result = await api.login(username, password)
        if ('requires2fa' in result && result.requires2fa) {
          setPending2faToken(result.tempToken)
          setTwoFactorCode('')
          setNotice('Enter the 6-digit code from your authenticator app.')
        } else if ('token' in result) {
          auth.setToken(result.token)
          onLogin()
        } else {
          throw new Error('Unexpected authentication response')
        }
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const submit2fa = async (e: FormEvent) => {
    e.preventDefault()
    if (!pending2faToken) return
    setError(null)
    setLoading(true)
    try {
      const { token } = await api.login2fa(pending2faToken, twoFactorCode)
      auth.setToken(token)
      onLogin()
    } catch (err: any) {
      setError(err.message || 'Invalid 2FA code')
    } finally {
      setLoading(false)
    }
  }

  const resetToLogin = () => {
    setMode('login')
    setPending2faToken(null)
    setError(null)
    setNotice(null)
    setPassword('')
    setConfirmPassword('')
    setTwoFactorCode('')
  }

  const in2faStep = Boolean(pending2faToken)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 390, background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: '32px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <span style={{ fontSize: 28, color: 'var(--accent)' }}>◆</span>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.06em', marginTop: 8 }}>
            TRADING<span style={{ color: 'var(--accent)' }}>AGENT</span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4, letterSpacing: '0.08em' }}>
            {in2faStep ? 'TWO-FACTOR VERIFICATION' : mode === 'register' ? 'CREATE ACCOUNT' : 'SECURE LOGIN'}
          </div>
        </div>

        {!in2faStep && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <button
              onClick={() => { setMode('login'); setError(null); setNotice(null) }}
              type="button"
              style={{
                padding: '8px 10px',
                background: mode === 'login' ? 'var(--accent)' : 'transparent',
                color: mode === 'login' ? '#000' : 'var(--muted)',
                border: '1px solid var(--border2)',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
              }}
            >
              LOGIN
            </button>
            <button
              onClick={() => { setMode('register'); setError(null); setNotice(null) }}
              type="button"
              style={{
                padding: '8px 10px',
                background: mode === 'register' ? 'var(--accent)' : 'transparent',
                color: mode === 'register' ? '#000' : 'var(--muted)',
                border: '1px solid var(--border2)',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
              }}
            >
              REGISTER
            </button>
          </div>
        )}

        {!in2faStep ? (
          <form onSubmit={submitAuth} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>USERNAME</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>PASSWORD</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required style={inputStyle} />
            </div>
            {mode === 'register' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>CONFIRM PASSWORD</label>
                <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" required style={inputStyle} />
              </div>
            )}
            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 4,
                padding: '11px',
                background: 'var(--accent)',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'PROCESSING...' : mode === 'register' ? 'CREATE ACCOUNT' : 'SIGN IN'}
            </button>
          </form>
        ) : (
          <form onSubmit={submit2fa} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em' }}>AUTHENTICATOR CODE</label>
              <input type="text" inputMode="numeric" pattern="\d{6}" maxLength={6} value={twoFactorCode} onChange={e => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required style={inputStyle} />
            </div>
            <button
              type="submit"
              disabled={loading || twoFactorCode.length !== 6}
              style={{
                padding: '11px',
                background: 'var(--accent)',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.08em',
                cursor: loading ? 'wait' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'VERIFYING...' : 'VERIFY 2FA'}
            </button>
            <button
              type="button"
              onClick={resetToLogin}
              style={{
                padding: '9px',
                background: 'transparent',
                color: 'var(--muted)',
                border: '1px solid var(--border2)',
                borderRadius: 6,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.08em',
              }}
            >
              CANCEL
            </button>
          </form>
        )}

        {(error || notice) && (
          <div style={{
            marginTop: 14,
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: error ? 'var(--danger)' : 'var(--green)',
            background: error ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.1)',
            border: error ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(34,197,94,0.3)',
            borderRadius: 4,
            padding: '8px 12px',
          }}>
            {error || notice}
          </div>
        )}

        <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.07em', marginBottom: 10, textAlign: 'center' }}>
            THEME
          </div>
          <ThemePicker compact value={theme} onChange={(next) => { setTheme(next); applyTheme(next) }} />
        </div>

        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              marginTop: 14,
              width: '100%',
              padding: '9px',
              background: 'transparent',
              color: 'var(--muted)',
              border: '1px solid var(--border2)',
              borderRadius: 6,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
            }}
          >
            BACK TO LANDING
          </button>
        )}
      </div>
    </div>
  )
}
