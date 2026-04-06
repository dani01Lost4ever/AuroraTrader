import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../api'
import type { AuthUser, WalletInfo } from '../api'

export function Profile({ me }: { me: AuthUser | null }) {
  const [wallets, setWallets] = useState<WalletInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [alpacaKey, setAlpacaKey] = useState('')
  const [alpacaSecret, setAlpacaSecret] = useState('')
  const [alpacaBase, setAlpacaBase] = useState('https://paper-api.alpaca.markets')
  const [saving, setSaving] = useState(false)

  const loadWallets = async () => {
    try {
      setError(null)
      const res = await api.wallets()
      setWallets(res.wallets)
    } catch (e: any) {
      setError(e.message || 'Failed to load wallets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadWallets().catch(() => {})
  }, [])

  const onCreate = async () => {
    if (!name.trim() || !alpacaKey.trim() || !alpacaSecret.trim()) return
    setSaving(true)
    try {
      await api.createWallet({
        name: name.trim(),
        alpaca_api_key: alpacaKey.trim(),
        alpaca_api_secret: alpacaSecret.trim(),
        alpaca_base_url: alpacaBase.trim() || 'https://paper-api.alpaca.markets',
      })
      setName('')
      setAlpacaKey('')
      setAlpacaSecret('')
      setAlpacaBase('https://paper-api.alpaca.markets')
      await loadWallets()
    } catch (e: any) {
      setError(e.message || 'Failed to create wallet')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 28, maxWidth: 980, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontSize: 16, marginBottom: 8 }}>PROFILE</h2>
      <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: 11, marginBottom: 20 }}>
        User: {me?.username || '-'} | Active wallets are used by trading engine and Alpaca API calls.
      </p>

      {loading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div>}
      {error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)', marginBottom: 10 }}>{error}</div>}

      <section style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>WALLETS</div>
        <div style={{ display: 'grid', gap: 10 }}>
          {wallets.map((w) => (
            <div key={w.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>
                  {w.name} {w.active ? <span style={{ color: 'var(--green)' }}>[ACTIVE]</span> : null}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                  Key {w.alpaca_api_key_masked} | Secret {w.alpaca_api_secret_masked} | {w.alpaca_base_url}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {!w.active && (
                  <button onClick={async () => { await api.activateWallet(w.id); await loadWallets() }} style={btn}>
                    SWITCH
                  </button>
                )}
                <button onClick={async () => {
                  if (!window.confirm(`Delete wallet "${w.name}"?`)) return
                  await api.deleteWallet(w.id)
                  await loadWallets()
                }} style={btnDanger}>
                  DELETE
                </button>
              </div>
            </div>
          ))}
          {wallets.length === 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>No wallets yet.</div>
          )}
        </div>
      </section>

      <section style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>ADD WALLET</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Wallet name" style={inp} />
          <input value={alpacaBase} onChange={(e) => setAlpacaBase(e.target.value)} placeholder="Base URL" style={inp} />
          <input value={alpacaKey} onChange={(e) => setAlpacaKey(e.target.value)} placeholder="Alpaca API Key" style={inp} />
          <input type="password" value={alpacaSecret} onChange={(e) => setAlpacaSecret(e.target.value)} placeholder="Alpaca API Secret" style={inp} />
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={onCreate} disabled={saving} style={btnPrimary}>{saving ? 'SAVING...' : 'ADD WALLET'}</button>
        </div>
      </section>
    </div>
  )
}

const inp: CSSProperties = {
  padding: '8px 10px',
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  borderRadius: 6,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
}

const btn: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 6,
  border: '1px solid var(--border2)',
  background: 'var(--bg3)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
}

const btnDanger: CSSProperties = {
  ...btn,
  color: 'var(--danger)',
}

const btnPrimary: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 6,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#00131b',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
}
