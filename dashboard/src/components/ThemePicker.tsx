import { THEMES } from '../theme'
import type { Theme } from '../theme'

interface ThemePickerProps {
  value: Theme
  onChange: (theme: Theme) => void
  compact?: boolean
}

export function ThemePicker({ value, onChange, compact = false }: ThemePickerProps) {
  if (compact) {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {THEMES.map(t => {
          const selected = value === t.id
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              style={{
                borderRadius: 999,
                padding: '6px 10px',
                border: selected ? `1px solid ${t.accent}` : '1px solid var(--border2)',
                background: selected ? `${t.accent}22` : 'var(--bg3)',
                color: selected ? 'var(--text)' : 'var(--muted)',
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                letterSpacing: '0.06em',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
      {THEMES.map(t => {
        const selected = value === t.id
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            padding: 0, border: 'none', background: 'none', borderRadius: 10, overflow: 'hidden',
            outline: selected ? `2px solid ${t.accent}` : '2px solid transparent',
            outlineOffset: 2, cursor: 'pointer', transition: 'outline 0.15s', textAlign: 'left',
          }}>
            <div style={{ background: t.bg, padding: '16px 14px', borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.accent }} />
                <div style={{ flex: 1, height: 4, borderRadius: 2, background: `${t.accent}44` }} />
              </div>
              <div style={{ height: 4, borderRadius: 2, background: `${t.accent}66`, marginBottom: 6 }} />
              <div style={{ height: 3, borderRadius: 2, background: `${t.accent}33`, marginBottom: 5, width: '70%' }} />
              <div style={{ height: 3, borderRadius: 2, background: `${t.accent}22`, width: '85%' }} />
              <div style={{ marginTop: 10, borderRadius: 4, background: `${t.accent}11`, border: `1px solid ${t.accent}22`, padding: '5px 8px' }}>
                <div style={{ height: 3, borderRadius: 2, background: `${t.accent}55`, width: '60%' }} />
              </div>
            </div>
            <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: selected ? 'var(--accent)' : 'var(--text)', fontWeight: selected ? 700 : 400 }}>{t.label}</span>
              {selected && <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>OK</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}
