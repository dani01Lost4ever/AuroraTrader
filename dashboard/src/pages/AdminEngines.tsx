import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { api } from '../api'
import type { AdminUser, EngineStatus } from '../api'

export function AdminEngines() {
  const [engines, setEngines] = useState<EngineStatus[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setError(null)
      const [engineRes, userRes] = await Promise.all([api.adminEngines(), api.adminUsers()])
      setEngines(engineRes.engines)
      setUsers(userRes.users)
    } catch (e: any) {
      setError(e.message || 'Failed to load engines')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch(() => {})
    const t = setInterval(() => load().catch(() => {}), 10_000)
    return () => clearInterval(t)
  }, [])

  const act = async (fn: () => Promise<any>) => {
    await fn()
    await load()
  }

  const engineByUserId = new Map(engines.map((e) => [e.userId, e]))
  const totalUsers = users.length
  const blockedUsers = users.filter((u) => u.blocked).length
  const activeEngines = engines.filter((e) => e.active && !e.paused && !e.blocked).length

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 16, color: 'var(--accent)', marginBottom: 8 }}>ENGINE CONTROL</h2>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
        Admin dashboard with user management and per-user scheduler visibility.
      </p>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <Metric label='Registered users' value={String(totalUsers)} />
        <Metric label='Blocked users' value={String(blockedUsers)} />
        <Metric label='Engines running' value={String(activeEngines)} />
      </div>

      {loading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div>}
      {error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>{error}</div>}

      {!loading && !error && (
        <>
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', margin: '0 0 8px' }}>USERS</h3>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                <thead style={{ background: 'var(--bg2)' }}>
                  <tr>
                    {['USERNAME', 'ROLE', '2FA', 'BLOCKED', 'BLOCK REASON', 'ENGINE', 'ACTIONS'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const engine = engineByUserId.get(u.id)
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px' }}>{u.username}</td>
                        <td style={{ padding: '10px 12px' }}>{u.role}</td>
                        <td style={{ padding: '10px 12px' }}>{u.twoFactorEnabled ? 'on' : 'off'}</td>
                        <td style={{ padding: '10px 12px', color: u.blocked ? 'var(--danger)' : 'var(--green)' }}>{u.blocked ? 'yes' : 'no'}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{u.blockedReason || '-'}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                          {engine ? `${engine.paused || engine.blocked ? 'paused' : 'running'} | ${engine.cycles} cycles` : 'not initialized'}
                        </td>
                        <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                          {u.role === 'admin'
                            ? <span style={{ color: 'var(--muted)' }}>locked</span>
                            : u.blocked
                              ? <button onClick={() => act(() => api.adminUnblockUser(u.id))} style={btnStyle}>UNBLOCK</button>
                              : <button onClick={() => act(async () => {
                                  const reason = window.prompt(`Block user ${u.username}. Optional reason:`) || ''
                                  await api.adminBlockUser(u.id, reason)
                                })} style={btnStyle}>BLOCK</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', margin: 0, padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg2)' }}>
              ENGINES & SCHEDULERS
            </h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            <thead style={{ background: 'var(--bg2)' }}>
              <tr>
                {['USER', 'STATE', 'CYCLES', 'NEXT CYCLE', 'NEXT DATA', 'NEXT OUTCOME', 'NEXT RISK', 'LAST ERROR', 'ACTIONS'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {engines.map(e => (
                <tr key={e.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>{e.username}</td>
                  <td style={{ padding: '10px 12px', color: e.blocked ? 'var(--danger)' : (e.paused ? 'var(--warn)' : 'var(--green)') }}>
                    {e.blocked ? 'blocked' : e.paused ? 'paused' : 'running'}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{e.cycles}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {fmtWhen(e.nextCycleAt)} ({e.cycleIntervalMinutes ?? '-'}m)
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {fmtWhen(e.nextDataRefreshAt)} ({e.dataIntervalMinutes ?? '-'}m)
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {fmtWhen(e.nextOutcomeAt)} ({e.outcomeIntervalMinutes}m)
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {fmtWhen(e.nextRiskCheckAt)} ({e.riskIntervalMinutes}m)
                  </td>
                  <td style={{ padding: '10px 12px', color: e.lastError ? 'var(--danger)' : 'var(--muted)' }}>{e.lastError || '-'}</td>
                  <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                    <button onClick={() => act(() => api.adminTriggerEngine(e.userId))} style={btnStyle}>TRIGGER</button>
                    {e.paused
                      ? <button onClick={() => act(() => api.adminResumeEngine(e.userId))} style={btnStyle}>RESUME</button>
                      : <button onClick={() => act(() => api.adminPauseEngine(e.userId))} style={btnStyle}>PAUSE</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '8px 10px',
      minWidth: 140,
      background: 'var(--bg2)',
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function fmtWhen(ts: string | null): string {
  if (!ts) return '-'
  return new Date(ts).toLocaleString()
}

const btnStyle: CSSProperties = {
  padding: '4px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  border: '1px solid var(--border2)',
  background: 'var(--bg2)',
  color: 'var(--text)',
  borderRadius: 4,
  cursor: 'pointer',
}
