import { useState } from 'react'

const SECTIONS = [
  { id: 'rsi',            label: 'RSI' },
  { id: 'macd',           label: 'MACD' },
  { id: 'bbands',         label: 'Bollinger Bands' },
  { id: 'ema',            label: 'EMA' },
  { id: 'atr',            label: 'ATR' },
  { id: 'kelly',          label: 'Kelly Criterion' },
  { id: 'sharpe',         label: 'Sharpe Ratio' },
  { id: 'sortino',        label: 'Sortino Ratio' },
  { id: 'sizing',         label: 'Position Sizing' },
  { id: 'stops',          label: 'Stop Loss / TP / Trailing' },
  { id: 'regime',         label: 'Market Regime' },
  { id: 'feargreed',      label: 'Fear & Greed' },
  { id: 'confidence',     label: 'Confidence Threshold' },
  { id: 'backtesting',    label: 'Backtesting' },
  { id: 'algo-divider',   label: '── Algorithms ──', divider: true },
  { id: 'algo-momentum',  label: 'Momentum (RSI)' },
  { id: 'algo-mean',      label: 'Mean Reversion (BB)' },
  { id: 'algo-breakout',  label: 'Breakout (Volume)' },
  { id: 'algo-trend',     label: 'Trend Following (EMA)' },
  { id: 'algo-auto',      label: 'Auto (Regime-based)' },
  { id: 'algo-llm',       label: 'LLM (AI)' },
  { id: 'algo-compare',   label: 'Choosing a Strategy' },
]

const s = {
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '24px 28px',
    marginBottom: 24,
    width: '100%',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  heading: {
    fontFamily: 'var(--font-mono)',
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--accent)',
    letterSpacing: '0.06em',
    marginBottom: 14,
  } as React.CSSProperties,
  body: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--text)',
    lineHeight: 1.8,
  } as React.CSSProperties,
  muted: {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--muted)',
    lineHeight: 1.7,
  } as React.CSSProperties,
  formula: {
    background: 'var(--bg3)',
    border: '1px solid var(--border2)',
    borderRadius: 6,
    padding: '10px 16px',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    color: 'var(--accent)',
    margin: '12px 0',
    display: 'block',
    letterSpacing: '0.04em',
    whiteSpace: 'pre-wrap',
  } as React.CSSProperties,
  hero: {
    background: 'linear-gradient(135deg, rgba(var(--accent-rgb,0,212,170),0.12), rgba(255,255,255,0.02))',
    border: '1px solid rgba(var(--accent-rgb,0,212,170),0.22)',
    borderRadius: 10,
    padding: '28px 32px',
    marginBottom: 24,
    width: '100%',
    boxSizing: 'border-box',
  } as React.CSSProperties,
  heroTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: 24,
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '0.04em',
    marginBottom: 8,
  } as React.CSSProperties,
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 14,
    marginTop: 20,
  } as React.CSSProperties,
  miniCard: {
    background: 'rgba(0,0,0,0.12)',
    border: '1px solid var(--border2)',
    borderRadius: 8,
    padding: '14px 16px',
  } as React.CSSProperties,
  sectionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 10,
    marginTop: 16,
  } as React.CSSProperties,
  sectionLink: {
    display: 'block',
    padding: '10px 12px',
    borderRadius: 6,
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    textDecoration: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    color: 'var(--muted)',
    cursor: 'pointer',
    boxSizing: 'border-box',
  } as React.CSSProperties,
}

function Badge({ label, color }: { label: string; color: string }) {
  const bg = color === 'green' ? 'rgba(34,197,94,0.15)' : color === 'red' ? 'rgba(239,68,68,0.15)' : color === 'warn' ? 'rgba(245,158,11,0.15)' : 'rgba(var(--accent-rgb,0,212,170),0.12)'
  const fg = color === 'green' ? 'var(--green)' : color === 'red' ? 'var(--danger)' : color === 'warn' ? 'var(--warn)' : 'var(--accent)'
  const border = color === 'green' ? 'var(--green)' : color === 'red' ? 'var(--danger)' : color === 'warn' ? 'var(--warn)' : 'var(--accent)'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px', borderRadius: 4,
      background: bg, color: fg,
      border: `1px solid ${border}`,
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em',
      margin: '0 4px',
    }}>
      {label}
    </span>
  )
}

function DetailBox({ title, children, tone = 'accent' }: {
  title: string
  children: React.ReactNode
  tone?: 'accent' | 'green' | 'warn' | 'red'
}) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'warn' ? 'var(--warn)' : tone === 'red' ? 'var(--danger)' : 'var(--accent)'
  const bg = tone === 'green' ? 'rgba(34,197,94,0.06)' : tone === 'warn' ? 'rgba(245,158,11,0.07)' : tone === 'red' ? 'rgba(239,68,68,0.06)' : 'rgba(var(--accent-rgb,0,212,170),0.06)'
  return (
    <div style={{ background: bg, border: `1px solid ${color}`, borderRadius: 6, padding: '10px 14px', marginTop: 14 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color, letterSpacing: '0.06em', marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ ...s.muted, margin: 0 }}>{children}</div>
    </div>
  )
}

export function Wiki() {
  const [active, setActive] = useState('rsi')
  const topics = SECTIONS.filter(sec => !(sec as any).divider)
  const activeTopic = topics.find(sec => sec.id === active)

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 52px)', background: 'var(--bg)' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220, flexShrink: 0, position: 'sticky', top: 52,
        height: 'calc(100vh - 52px)', overflowY: 'auto',
        background: 'var(--bg2)', borderRight: '1px solid var(--border)',
        padding: '20px 0',
      }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', letterSpacing: '0.1em', padding: '0 20px 10px' }}>
          TRADING WIKI
        </div>
        {SECTIONS.map(sec => (
          (sec as any).divider ? (
            <div key={sec.id} style={{
              padding: '10px 20px 4px',
              fontFamily: 'var(--font-mono)', fontSize: 9,
              color: 'var(--muted)', letterSpacing: '0.1em',
              opacity: 0.6, marginTop: 8,
            }}>{sec.label}</div>
          ) : (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              onClick={e => { e.preventDefault(); setActive(sec.id); document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth' }) }}
              style={{
                display: 'block', padding: '8px 20px',
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: active === sec.id ? 'var(--accent)' : 'var(--muted)',
                background: active === sec.id ? 'rgba(var(--accent-rgb,0,212,170),0.07)' : 'transparent',
                borderLeft: active === sec.id ? '2px solid var(--accent)' : '2px solid transparent',
                textDecoration: 'none', transition: 'all 0.15s', cursor: 'pointer',
              }}
            >
              {sec.label}
            </a>
          )
        ))}
      </aside>

      {/* ── Content ── */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '32px 40px' }}>

        <div style={s.hero}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.12em', marginBottom: 10 }}>
                TRADING KNOWLEDGE BASE
              </div>
              <div style={s.heroTitle}>Wiki</div>
              <p style={{ ...s.body, margin: 0, maxWidth: 960 }}>
                Indicator definitions, risk management rules, and strategy notes used by this project.
                The content area now fills the available page width instead of staying capped to a narrow column.
              </p>
            </div>
            <div style={{ ...s.miniCard, minWidth: 220, flex: '0 0 auto' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 6 }}>
                SELECTED TOPIC
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--accent)', fontWeight: 700 }}>
                {activeTopic?.label ?? 'RSI'}
              </div>
              <div style={{ ...s.muted, marginTop: 6 }}>
                Use the left menu or the quick links below to jump directly.
              </div>
            </div>
          </div>

          <div style={s.heroGrid}>
            <div style={s.miniCard}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 6 }}>LEARN</div>
              <div style={s.body}>What each indicator means and how the agent interprets it.</div>
            </div>
            <div style={s.miniCard}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 6 }}>APPLY</div>
              <div style={s.body}>How the settings, stops, and sizing controls affect live trading.</div>
            </div>
            <div style={s.miniCard}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 6 }}>COMPARE</div>
              <div style={s.body}>When to use Momentum, Mean Reversion, Breakout, Trend, Auto, or LLM.</div>
            </div>
          </div>
        </div>

        <div style={s.card}>
          <div style={s.heading}>Quick Navigation</div>
          <p style={{ ...s.muted, margin: 0 }}>
            Direct links to every topic in the wiki.
          </p>
          <div style={s.sectionGrid}>
            {topics.map(sec => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                onClick={e => { e.preventDefault(); setActive(sec.id); document.getElementById(sec.id)?.scrollIntoView({ behavior: 'smooth' }) }}
                style={{
                  ...s.sectionLink,
                  color: active === sec.id ? 'var(--accent)' : 'var(--muted)',
                  border: active === sec.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: active === sec.id ? 'rgba(var(--accent-rgb,0,212,170),0.08)' : 'var(--bg3)',
                }}
              >
                {sec.label}
              </a>
            ))}
          </div>
        </div>

        {/* RSI */}
        <div id="rsi" style={s.card}>
          <div style={s.heading}>RSI — Relative Strength Index</div>
          <p style={s.body}>
            RSI is a momentum oscillator that measures the speed and magnitude of recent price changes.
            It oscillates between 0 and 100 and is typically calculated over a 14-period window.
          </p>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="RSI > 70 = Overbought" color="red" />
            <Badge label="RSI < 30 = Oversold" color="green" />
            <Badge label="RSI 40–60 = Neutral" color="accent" />
          </div>
          <p style={s.muted}>
            When RSI crosses above 70 the asset may be overextended and due for a pullback.
            When it falls below 30 it may be undervalued. The agent uses RSI 14 as one signal
            when deciding whether to buy, sell, or hold. High RSI alone does not guarantee a sell —
            it is combined with other indicators and the LLM reasoning step.
          </p>
          <p style={s.muted}>
            RSI measures the speed of recent movement, not whether an asset is objectively cheap or expensive.
            In strong uptrends RSI can stay elevated for a long time, and in hard selloffs it can stay depressed.
            That is why RSI is most useful as a timing layer around other context rather than as a standalone trigger.
          </p>
          <code style={s.formula}>{'RSI = 100 - (100 / (1 + RS))\nRS  = Average Gain over N periods / Average Loss over N periods'}</code>
          <DetailBox title="HOW THE AGENT USES IT">
            RSI matters more when it agrees with other signals. RSI below 30 plus stabilising momentum is stronger than RSI below 30 alone.
            In trend-following mode, high RSI can also be interpreted as trend strength, not automatically as a sell.
          </DetailBox>
        </div>

        {/* MACD */}
        <div id="macd" style={s.card}>
          <div style={s.heading}>MACD — Moving Average Convergence Divergence</div>
          <p style={s.body}>
            MACD shows the relationship between two exponential moving averages (EMA 12 and EMA 26).
            The MACD line is the difference between them. The signal line is a 9-period EMA of the MACD line.
            The histogram shows the gap between MACD and its signal line.
          </p>
          <code style={s.formula}>{'MACD Line   = EMA(12) - EMA(26)\nSignal Line = EMA(9) of MACD Line\nHistogram   = MACD Line - Signal Line'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="MACD crosses above signal = Bullish" color="green" />
            <Badge label="MACD crosses below signal = Bearish" color="red" />
            <Badge label="Histogram expanding = Momentum building" color="warn" />
          </div>
          <p style={s.muted}>
            A bullish crossover (MACD line crossing above the signal line) is considered a buy signal.
            A bearish crossover suggests selling pressure. Divergence between price and MACD can signal
            trend reversals before they happen.
          </p>
          <p style={s.muted}>
            MACD usually reacts more slowly than RSI. That lag is useful because it acts like a confirmation layer.
            RSI may show the first bounce, but MACD tells you whether the move is actually developing into a broader momentum shift.
          </p>
          <DetailBox title="PRACTICAL READ" tone="warn">
            The histogram slope often matters more than the raw crossover. Negative but rising histogram means bearish pressure is fading.
            Positive but falling histogram means the up move may be losing strength before price fully rolls over.
          </DetailBox>
        </div>

        {/* Bollinger Bands */}
        <div id="bbands" style={s.card}>
          <div style={s.heading}>Bollinger Bands</div>
          <p style={s.body}>
            Bollinger Bands consist of a middle band (SMA 20) and two outer bands placed two standard deviations
            above and below it. They expand during high volatility and contract during low volatility.
          </p>
          <code style={s.formula}>{'Upper Band = SMA(20) + 2 × StdDev\nMiddle     = SMA(20)\nLower Band = SMA(20) - 2 × StdDev\nBB%        = (Price - Lower) / (Upper - Lower)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="BB% near 1 = Near upper band (overbought)" color="red" />
            <Badge label="BB% near 0 = Near lower band (oversold)" color="green" />
            <Badge label="Squeeze = Volatility contraction" color="warn" />
          </div>
          <p style={s.muted}>
            A Bollinger squeeze (bands very tight) often precedes a large price move.
            BB% (percent bandwidth) normalises price within the bands: 0 = at lower band, 1 = at upper band.
            The agent uses BB% as part of the market snapshot fed to the LLM.
          </p>
          <p style={s.muted}>
            A common mistake is treating every upper-band touch as a sell and every lower-band touch as a buy.
            That works better in quiet, ranging markets than in directional trends. In strong moves, price can ride the band for a long time.
            Bands are best understood as a volatility map, not a guaranteed reversal map.
          </p>
          <DetailBox title="BEST USE CASE">
            Bollinger Bands are strongest for mean reversion during sideways conditions and for spotting squeezes before expansion.
            They are weaker as fade signals when the market is already trending hard.
          </DetailBox>
        </div>

        {/* EMA */}
        <div id="ema" style={s.card}>
          <div style={s.heading}>EMA — Exponential Moving Average</div>
          <p style={s.body}>
            An EMA gives more weight to recent prices than a simple moving average, making it react faster
            to price changes. The agent tracks EMA 9 (short-term) and EMA 21 (medium-term).
          </p>
          <code style={s.formula}>{'EMA(t) = Price(t) × k + EMA(t-1) × (1 - k)\nwhere k = 2 / (N + 1)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="EMA9 > EMA21 = Uptrend" color="green" />
            <Badge label="EMA9 < EMA21 = Downtrend" color="red" />
            <Badge label="Crossover = Trend change signal" color="warn" />
          </div>
          <p style={s.muted}>
            When EMA 9 crosses above EMA 21 (golden cross) it signals an emerging uptrend.
            The opposite is a death cross. Price above both EMAs is generally bullish context.
            EMAs lag price, so they confirm trends rather than predict reversals.
          </p>
          <p style={s.muted}>
            The distance and slope of the averages matter too. A tiny cross with flat averages is often noise.
            A wide separation with both lines rising is usually a healthier trend. This is why the strategy layer applies a crossover buffer.
          </p>
        </div>

        {/* ATR */}
        <div id="atr" style={s.card}>
          <div style={s.heading}>ATR — Average True Range</div>
          <p style={s.body}>
            ATR measures market volatility by decomposing the entire range of an asset price for a given period.
            It is the moving average (typically 14 periods) of the True Range.
          </p>
          <code style={s.formula}>{'True Range = max(High-Low, |High-PrevClose|, |Low-PrevClose|)\nATR(14)    = EMA(14) of True Range'}</code>
          <p style={s.muted}>
            The agent uses ATR for position sizing: higher volatility assets get a smaller position
            to normalise risk. For example, a position size proportional to Account Risk / ATR
            keeps dollar risk per trade roughly constant regardless of asset volatility.
            ATR can also be used to set dynamic stop-loss distances (e.g. 2× ATR from entry).
          </p>
          <DetailBox title="WHY ATR BEATS RAW PRICE">
            A $20 move in BTC is noise, while a $20 move in a smaller coin can be enormous. ATR converts movement into a volatility-aware unit,
            which makes it much better for sizing and stop placement than simply looking at nominal price.
          </DetailBox>
        </div>

        {/* Kelly Criterion */}
        <div id="kelly" style={s.card}>
          <div style={s.heading}>Kelly Criterion</div>
          <p style={s.body}>
            The Kelly Criterion is a formula for bet sizing that maximises the expected logarithm of wealth.
            In trading, it tells you what fraction of capital to risk on a trade.
          </p>
          <code style={s.formula}>{'f* = (b × p - q) / b\n\nf* = optimal fraction of capital\nb  = net odds (profit per $1 risked, e.g. win_avg / loss_avg)\np  = probability of winning\nq  = 1 - p (probability of losing)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="Full Kelly = aggressive, high variance" color="red" />
            <Badge label="Half Kelly = safer, recommended default" color="green" />
          </div>
          <p style={s.muted}>
            The agent uses half-Kelly by default to reduce volatility: it scales down the full Kelly
            fraction by 50%. Kelly sizing helps avoid the two failure modes: betting too little
            (leaving money on the table) and betting too much (risking ruin). When win rate is
            unreliable (few trades), Kelly can overfits to noise — use with caution early on.
          </p>
          <DetailBox title="IMPORTANT LIMITATION" tone="red">
            Kelly assumes your edge estimate is reasonably accurate. In live trading that estimate is always noisy, especially early on.
            Treat Kelly as an adaptive sizing hint, not as a mathematically perfect answer.
          </DetailBox>
        </div>

        {/* Sharpe Ratio */}
        <div id="sharpe" style={s.card}>
          <div style={s.heading}>Sharpe Ratio</div>
          <p style={s.body}>
            The Sharpe Ratio measures risk-adjusted return: how much excess return you receive per unit
            of total volatility (standard deviation of returns).
          </p>
          <code style={s.formula}>{'Sharpe = (R_p - R_f) / σ_p\n\nR_p = portfolio return\nR_f = risk-free rate (often 0 for crypto)\nσ_p = standard deviation of returns (annualized)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="Sharpe < 1 = Below average" color="red" />
            <Badge label="Sharpe 1–2 = Good" color="warn" />
            <Badge label="Sharpe > 2 = Excellent" color="green" />
          </div>
          <p style={s.muted}>
            A higher Sharpe means better return per unit of risk. Values above 1 are generally
            considered acceptable; above 2 is excellent. Be wary of very high Sharpe ratios in
            backtests — they may indicate overfitting. Sharpe penalises upside and downside
            volatility equally, which is why Sortino is often preferred for asymmetric strategies.
          </p>
        </div>

        {/* Sortino Ratio */}
        <div id="sortino" style={s.card}>
          <div style={s.heading}>Sortino Ratio</div>
          <p style={s.body}>
            The Sortino Ratio is similar to Sharpe but only penalises downside deviation
            (negative returns), not upside volatility. This makes it more appropriate for
            strategies with skewed return distributions.
          </p>
          <code style={s.formula}>{'Sortino = (R_p - R_f) / σ_d\n\nσ_d = downside deviation (std dev of negative returns only)'}</code>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="Sortino > Sharpe = Good upside skew" color="green" />
            <Badge label="Sortino ≈ Sharpe = Symmetric returns" color="warn" />
          </div>
          <p style={s.muted}>
            When your strategy has large upside outliers (e.g. catching strong breakouts),
            Sortino will score it better than Sharpe. Use Sortino when you care more about
            downside risk than total volatility. A Sortino ratio above 2 indicates excellent
            risk-adjusted performance on the downside.
          </p>
        </div>

        {/* Position Sizing */}
        <div id="sizing" style={s.card}>
          <div style={s.heading}>Position Sizing</div>
          <p style={s.body}>
            Position sizing determines how much capital to allocate to each trade.
            It is one of the most important risk management decisions.
          </p>
          <code style={s.formula}>{'ATR-based:  Size = (Account × Risk%) / ATR\nKelly-based: Size = Kelly fraction × Available capital\nMax cap:    Size = min(Size, MaxPositionPct × Account)'}</code>
          <p style={s.muted}>
            The agent supports two sizing modes, configured in Settings:
          </p>
          <ul style={{ ...s.muted, paddingLeft: 20, margin: '8px 0' }}>
            <li><strong style={{ color: 'var(--text)' }}>Fixed %:</strong> Each trade uses a fixed percentage of available capital.</li>
            <li><strong style={{ color: 'var(--text)' }}>ATR-scaled:</strong> Volatile assets get smaller positions to normalise dollar risk.</li>
            <li><strong style={{ color: 'var(--text)' }}>Kelly (optional):</strong> Scales the base size by the Kelly fraction derived from recent win rate and P&L ratio.</li>
          </ul>
          <p style={s.muted}>
            The max open positions limit acts as a hard cap regardless of sizing formula.
            Over-diversification can reduce returns; under-diversification increases single-position risk.
          </p>
        </div>

        {/* Stop Loss / Take Profit / Trailing Stop */}
        <div id="stops" style={s.card}>
          <div style={s.heading}>Stop Loss / Take Profit / Trailing Stop</div>
          <p style={s.body}>
            These are automatic exit orders that protect profits and limit losses.
          </p>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>Stop Loss</div>
            <p style={s.muted}>
              Closes the position when price falls X% below entry. Limits the maximum loss on a single trade.
              Set too tight and you get stopped out by normal noise. Set too wide and losses become large.
              Typical range: 2–8% depending on asset volatility.
            </p>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', marginBottom: 6 }}>Take Profit</div>
            <p style={s.muted}>
              Closes the position when price rises X% above entry. Locks in gains before a reversal.
              Should generally be larger than stop loss (reward:risk ratio &gt; 1). Typical: 5–20%.
            </p>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)', marginBottom: 6 }}>Trailing Stop</div>
            <p style={s.muted}>
              A dynamic stop loss that moves up with price. It triggers when price drops X% from its
              highest point since entry. Allows you to ride a trend while protecting gains.
              For example, a 5% trailing stop on a position that has risen 20% will trigger at 15% gain
              (20% - 5%), rather than at the original stop price.
            </p>
          </div>
          <code style={s.formula}>{'Trailing stop trigger = Peak price since entry × (1 - trailingStopPct / 100)'}</code>
          <DetailBox title="HOW TO THINK ABOUT EXITS" tone="warn">
            Stop loss controls downside, take profit defines your planned payoff, and trailing stop lets winners breathe.
            Tight exits increase win rate but can cap upside. Loose exits reduce win rate but can improve average win size.
            Good settings balance noise tolerance and capital protection.
          </DetailBox>
        </div>

        {/* Market Regime */}
        <div id="regime" style={s.card}>
          <div style={s.heading}>Market Regime</div>
          <p style={s.body}>
            Market regime describes the overall state of the market: bull (uptrend), bear (downtrend),
            or sideways (ranging). The agent attempts to detect regime to adjust its behaviour.
          </p>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="BTC > SMA50 = Bull regime" color="green" />
            <Badge label="BTC < SMA50 = Bear regime" color="red" />
            <Badge label="Low volatility, tight range = Sideways" color="warn" />
          </div>
          <p style={s.muted}>
            Bitcoin is used as the primary regime indicator because it has the highest correlation with
            the broader crypto market. When BTC is above its 50-period SMA, the agent is more likely to
            take long positions. In a bear regime it may reduce position sizes or shift to more
            conservative thresholds.
          </p>
          <p style={s.muted}>
            Regime is a top-level filter. It does not replace signal generation, but it changes how aggressive the system should be.
            The same RSI dip can be a good buy in a bull market and a trap in a bear market.
          </p>
          <DetailBox title="WHY THIS IMPROVES RESULTS">
            Many trading systems fail because they apply one logic everywhere. Regime detection first asks whether trend-following,
            mean reversion, or patience is the more appropriate behavior right now.
          </DetailBox>
        </div>

        {/* Fear & Greed */}
        <div id="feargreed" style={s.card}>
          <div style={s.heading}>Fear & Greed Index</div>
          <p style={s.body}>
            The Crypto Fear & Greed Index aggregates multiple data sources (volatility, market momentum,
            social media, dominance, trends) into a single 0–100 sentiment score.
          </p>
          <div style={{ margin: '12px 0', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge label="0–24 = Extreme Fear" color="green" />
            <Badge label="25–49 = Fear" color="warn" />
            <Badge label="50–74 = Greed" color="warn" />
            <Badge label="75–100 = Extreme Greed" color="red" />
          </div>
          <p style={s.muted}>
            Contrarian signal: extreme fear often precedes reversals to the upside; extreme greed
            often precedes corrections. The classic adage: "Be fearful when others are greedy, and
            greedy when others are fearful." The agent includes the Fear & Greed value in its market
            context snapshot when making trade decisions.
          </p>
          <p style={s.muted}>
            This indicator works best as a sentiment overlay, not as a direct trigger. Extreme fear does not mean buy immediately;
            it means technical reversal setups deserve more attention. Extreme greed means chasing new longs should be more selective.
          </p>
        </div>

        {/* Confidence Threshold */}
        <div id="confidence" style={s.card}>
          <div style={s.heading}>Confidence Threshold</div>
          <p style={s.body}>
            The confidence threshold filters out low-conviction trade signals. When the LLM returns a
            trade decision, it also returns a confidence value between 0 and 1. If the confidence is
            below the threshold, the trade is skipped.
          </p>
          <code style={s.formula}>{'0    = No filter (all trades pass)\n0.5  = Only take trades with ≥50% confidence\n0.75 = Only high-conviction signals\n1.0  = Nothing passes (effectively disables trading)'}</code>
          <p style={s.muted}>
            A higher threshold reduces trade frequency but may improve win rate by only trading when
            the agent is confident. A threshold of 0 allows all signals through. Tuning this value
            is a trade-off between selectivity and opportunity capture. Start at 0, observe the win
            rate on low-confidence trades, then raise the threshold if those trades underperform.
          </p>
          <DetailBox title="GOOD TUNING METHOD">
            Review performance by confidence bucket, for example 0.50-0.60, 0.60-0.70, 0.70-0.80, and 0.80+.
            If the lower buckets clearly underperform, raising the threshold is justified. If performance is similar, the filter may only be reducing opportunity.
          </DetailBox>
        </div>

        {/* Backtesting */}
        <div id="backtesting" style={s.card}>
          <div style={s.heading}>Backtesting</div>
          <p style={s.body}>
            Backtesting simulates a strategy on historical data to estimate how it would have performed.
            The agent supports two backtest modes:
          </p>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>Rules Mode</div>
            <p style={s.muted}>
              Fast, deterministic backtesting using pure technical indicator rules (RSI, MACD, EMA crossovers).
              No LLM calls, so it runs in seconds. Good for testing indicator combinations.
            </p>
          </div>
          <div style={{ margin: '12px 0' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', marginBottom: 6 }}>LLM Mode</div>
            <p style={s.muted}>
              Replays each time period with the LLM making decisions as if it were live. Much slower and
              costs API credits, but tests the actual model you will run in production.
            </p>
          </div>
          <div style={{ margin: '14px 0', background: 'rgba(239,68,68,0.07)', border: '1px solid var(--danger)', borderRadius: 6, padding: '10px 14px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.06em', marginBottom: 4 }}>OVERFITTING WARNING</div>
            <p style={{ ...s.muted, margin: 0 }}>
              Backtests are always optimistic. The model "sees" history it was never meant to see.
              Do not optimise parameters on the same data you evaluate on. Use walk-forward testing:
              optimise on train set, evaluate on unseen forward period. High Sharpe on backtest +
              poor live performance = overfitting.
            </p>
          </div>
          <p style={s.muted}>
            Key metrics to evaluate: Total Return, Max Drawdown, Win Rate, Sharpe Ratio, Sortino Ratio.
            A good backtest result is not sufficient — live market conditions include slippage,
            latency, liquidity constraints, and regime shifts that historical data may not capture.
          </p>
        </div>

        {/* ── ALGORITHMS ─────────────────────────────────── */}

        {/* Section header */}
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.12em', marginBottom: 20, marginTop: 8, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          BUILT-IN STRATEGIES
        </div>

        {/* Momentum */}
        <div id="algo-momentum" style={s.card}>
          <div style={s.heading}>Momentum (RSI)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Indicators: RSI · Volume" color="accent" />
            <Badge label="Style: Trend-following" color="warn" />
            <Badge label="Best in: Trending markets" color="green" />
          </div>
          <p style={s.body}>
            The simplest and most battle-tested strategy. It buys when RSI falls into oversold territory
            (default &lt; 35) with a volume confirmation, and sells when RSI reaches overbought (default &gt; 65).
            Volume confirmation avoids false signals from low-liquidity moves.
          </p>
          <code style={s.formula}>{`BUY  when RSI < rsiOversold  AND hourly_volume / SMA20_volume >= minVolRatio
SELL when RSI > rsiOverbought
HOLD otherwise`}</code>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Confidence scaling:</strong> the further RSI is from the threshold,
            the higher the confidence — a RSI of 20 generates stronger conviction than 34.
            Confidence directly maps to position size.
          </p>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Tunable parameters:</strong> RSI Oversold (20–50), RSI Overbought (55–85),
            Min Volume Ratio (0.5–3×). Use the Optimize tab in Backtest to find the best combo for each asset.
          </p>
          <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid var(--green)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)', letterSpacing: '0.06em', marginBottom: 4 }}>WHEN TO USE</div>
            <p style={{ ...s.muted, margin: 0 }}>Works well in ranging or gently trending crypto markets. RSI-based systems underperform in strong directional trends where RSI can stay overbought for days.</p>
          </div>
        </div>

        {/* Mean Reversion */}
        <div id="algo-mean" style={s.card}>
          <div style={s.heading}>Mean Reversion (Bollinger Bands)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Indicators: BB%B · RSI" color="accent" />
            <Badge label="Style: Counter-trend" color="warn" />
            <Badge label="Best in: Range-bound markets" color="green" />
          </div>
          <p style={s.body}>
            Mean reversion assumes that extreme price moves eventually snap back toward the average.
            This strategy uses the Bollinger Band %B (position within the bands) as its primary signal,
            optionally confirmed by RSI. It is counter-trend by nature — it buys weakness and sells strength.
          </p>
          <code style={s.formula}>{`BB%B = (Price - Lower Band) / (Upper Band - Lower Band)

BUY  when BB%B < bbBuy  (e.g. 0.10 = near lower band)
       AND (rsiConfirm=false OR RSI < rsiConfirmBuy)
SELL when BB%B > bbSell (e.g. 0.90 = near upper band)
       AND (rsiConfirm=false OR RSI > rsiConfirmSell)
HOLD otherwise`}</code>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>RSI confirmation:</strong> requiring RSI to be oversold (&lt; 40) on
            buys reduces false signals during genuine breakdowns where price stays at the lower band for a long time.
          </p>
          <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid var(--danger)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.06em', marginBottom: 4 }}>RISK</div>
            <p style={{ ...s.muted, margin: 0 }}>Counter-trend strategies can suffer large drawdowns in strong trending moves. Always pair with a stop loss. Do not use in bear markets without the RSI filter enabled.</p>
          </div>
        </div>

        {/* Breakout */}
        <div id="algo-breakout" style={s.card}>
          <div style={s.heading}>Breakout (Volume)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Indicators: BB%B · Volume · ATR" color="accent" />
            <Badge label="Style: Momentum entry" color="warn" />
            <Badge label="Best in: Consolidating → trending" color="green" />
          </div>
          <p style={s.body}>
            Breakout trading waits for price to escape a consolidation zone (measured by the upper Bollinger Band)
            with a volume surge confirming real conviction. Without volume, a BB upper touch is often a false signal.
            ATR-based position sizing automatically reduces exposure during high-volatility breakouts.
          </p>
          <code style={s.formula}>{`BUY  when BB%B > bbBreakout  (e.g. 0.95 = near/above upper band)
       AND (hourly_volume / SMA20_volume) >= volMultiplier
       AND RSI < rsiMaxBuy         (not already parabolic)
SELL when RSI > rsiSell OR BB%B < 0.50 (breakout failed)
HOLD otherwise`}</code>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Volume multiplier:</strong> a value of 1.5× means hourly volume must be
            50% above its 20-bar average. In crypto, genuine breakouts are almost always accompanied by volume spikes of 2–5×.
          </p>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Exit logic:</strong> the strategy sells when RSI becomes parabolic
            (suggesting exhaustion) or when BB%B collapses back below 0.5 (failed breakout). This avoids holding
            through a full reversal.
          </p>
          <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid var(--green)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)', letterSpacing: '0.06em', marginBottom: 4 }}>WHEN TO USE</div>
            <p style={{ ...s.muted, margin: 0 }}>Ideal for sideways/consolidating markets where you're waiting for direction. The Auto strategy picks this during "Sideways" regime. Avoid in already-trending markets where entries are expensive.</p>
          </div>
        </div>

        {/* Trend Following */}
        <div id="algo-trend" style={s.card}>
          <div style={s.heading}>Trend Following (EMA Crossover)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Indicators: EMA9 · EMA21 · MACD · SMA50" color="accent" />
            <Badge label="Style: Trend-riding" color="warn" />
            <Badge label="Best in: Bull markets" color="green" />
          </div>
          <p style={s.body}>
            Trend following is the classic systematic trading approach: ride winners, cut losers early.
            It uses the EMA9/21 crossover as a primary signal — when the fast EMA crosses above the slow EMA,
            the short-term trend is turning bullish. MACD histogram confirms momentum. The SMA50 filter
            ensures you only buy assets that are in a macro uptrend.
          </p>
          <code style={s.formula}>{`BUY  when EMA9 > EMA21 × (1 + emaCrossBuffer%)  ← golden cross zone
       AND (macdConfirm=false OR MACD_hist > 0)   ← momentum positive
       AND (sma50Filter=false OR price > SMA50 × (1 + sma50Buffer%))
SELL when EMA9 < EMA21 × (1 - emaCrossBuffer%)  ← dead cross zone
       AND (sma50Filter=false OR price < SMA50)
HOLD when EMAs are close together (choppy)`}</code>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>SMA50 filter:</strong> when enabled, this prevents buying assets that
            are in a long-term downtrend even if the short-term EMA cross looks bullish. It significantly
            reduces whipsaws in bear markets at the cost of slower entries in early bull runs.
          </p>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>EMA cross buffer:</strong> a small buffer (e.g. 0.1%) around the crossover
            filters out micro-crosses that generate noise in flat markets. Increase it in choppy conditions.
          </p>
          <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid var(--green)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--green)', letterSpacing: '0.06em', marginBottom: 4 }}>WHEN TO USE</div>
            <p style={{ ...s.muted, margin: 0 }}>The Auto strategy picks this in bull markets. Works best when BTC is &gt; 5% above SMA50. Struggles in sideways/bear conditions — the EMA cross whipsaws frequently.</p>
          </div>
        </div>

        {/* Auto */}
        <div id="algo-auto" style={s.card}>
          <div style={s.heading}>Auto (Regime-based)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Meta-strategy" color="accent" />
            <Badge label="Uses: Market Regime · Fear & Greed" color="warn" />
            <Badge label="Style: Adaptive" color="green" />
          </div>
          <p style={s.body}>
            Auto does not trade directly. Instead, it inspects the current market regime and Fear & Greed
            index each cycle and delegates to the best-fit rule-based strategy. It is the recommended
            choice for hands-off operation.
          </p>
          <code style={s.formula}>{`Regime selection:
  Fear & Greed > 80 (Extreme Greed) → Mean Reversion  (fade the top)
  Fear & Greed < 20 (Extreme Fear)  → Momentum        (contrarian buy)
  BTC > SMA50 + 5%  (Bull Market)   → Trend Following  (ride the trend)
  BTC < SMA50 - 10% (Bear Market)   → Mean Reversion   (oversold bounces)
  Otherwise         (Sideways)       → Breakout          (wait for range break)`}</code>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Auto-fallback to LLM:</strong> when enabled in Settings, if the selected
            rule-based strategy produces no signal (e.g. RSI is neutral, no BB extremes), Auto falls back to
            the LLM strategy for that cycle. This gives you rule-based efficiency with AI coverage for edge cases.
          </p>
          <p style={s.muted}>
            Each cycle's reasoning will include <code style={{ color: 'var(--accent)' }}>[Auto→Strategy Name]</code> so you
            can see which strategy was active in the trade log and reasoning history.
          </p>
          <div style={{ background: 'rgba(var(--accent-rgb,0,212,170),0.06)', border: '1px solid var(--accent)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.06em', marginBottom: 4 }}>RECOMMENDED FOR</div>
            <p style={{ ...s.muted, margin: 0 }}>Users who don't want to monitor market conditions manually. The regime detection runs every cycle using BTC's distance from its 50-day SMA and the Fear & Greed index.</p>
          </div>
          <p style={s.muted}>
            This is usually the best default because it solves the "one strategy everywhere" problem. Auto is not smarter because it predicts
            more; it is smarter because it first narrows the market context and then hands control to a strategy built for that context.
          </p>
        </div>

        {/* LLM */}
        <div id="algo-llm" style={s.card}>
          <div style={s.heading}>LLM (AI)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Uses: All indicators + News + Sentiment" color="accent" />
            <Badge label="Style: Reasoning-based" color="warn" />
            <Badge label="Cost: API credits per cycle" color="red" />
          </div>
          <p style={s.body}>
            The LLM strategy sends a structured prompt containing all indicator data, portfolio state,
            Fear & Greed index, recent news headlines, market regime, and recently traded assets
            to a large language model (Claude or GPT). The model reasons about all inputs simultaneously
            and returns a structured JSON decision with action, confidence, and explanation.
          </p>
          <code style={s.formula}>{`Input → LLM prompt:
  • All technical indicators (RSI, EMA9/21, MACD, BB, ATR, SMA50)
  • Portfolio: cash, open positions, recent trades
  • Market regime + Fear & Greed
  • Recent news headlines per asset
  • Custom system prompt (if set)

Output → JSON:
  { asset, action, amount_usd, confidence, reasoning }`}</code>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Consensus mode:</strong> when enabled, two different models must agree
            on direction. Disagreements are downgraded to HOLD, reducing trade frequency but improving signal quality.
          </p>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Custom system prompt:</strong> you can inject domain knowledge,
            risk preferences, or asset-specific context into every LLM call from the Settings → System Prompt editor.
          </p>
          <p style={s.muted}>
            <strong style={{ color: 'var(--text)' }}>Cost:</strong> each cycle makes one API call per asset
            (or two in consensus mode). At 30-minute cycles with 2 assets and Haiku, expect ~$5–15/month.
            Use the Cost page to monitor spend.
          </p>
          <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid var(--danger)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', letterSpacing: '0.06em', marginBottom: 4 }}>CANNOT BE BACKTESTED CHEAPLY</div>
            <p style={{ ...s.muted, margin: 0 }}>LLM backtests use real API credits for every simulated bar. A 3-month backtest at 4h cycles on 2 assets = ~540 LLM calls. Use rule-based strategies for parameter search and LLM for live trading.</p>
          </div>
          <p style={s.muted}>
            The advantage of the LLM path is not magical prediction. It is flexible synthesis. The model can weigh trend, momentum,
            volatility, sentiment, portfolio state, and recent concentration all at once. Rule-based strategies are cheaper and easier
            to test; LLM reasoning is broader but noisier and more expensive.
          </p>
          <DetailBox title="NEW COST-AWARE LOGIC" tone="warn">
            This project now tracks recent prompt spend and can refuse trades whose expected edge is too small to justify the cost.
            The model is no longer deciding only whether a trade looks attractive, but whether it looks attractive enough after inference cost.
          </DetailBox>
        </div>

        {/* Choosing */}
        <div id="algo-compare" style={s.card}>
          <div style={s.heading}>Choosing the Right Strategy</div>
          <p style={s.body}>Use the table below as a starting point, then validate with the Backtest → Compare tab.</p>
          <div style={{ overflowX: 'auto', marginTop: 16 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Strategy', 'Market', 'Signals', 'Trades/mo', 'API cost', 'Complexity'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 12px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Momentum',       'Ranging',    'RSI + Volume',              'Medium',  'None',   'Low'],
                  ['Mean Reversion', 'Sideways',   'BB%B + RSI',                'Medium',  'None',   'Low'],
                  ['Breakout',       'Sideways→▲', 'BB%B + Volume spike',       'Low',     'None',   'Low'],
                  ['Trend Following','Bull',        'EMA cross + MACD + SMA50', 'Low',     'None',   'Medium'],
                  ['Auto',           'Any',        'Regime-adaptive',           'Varies',  'None',   'Low'],
                  ['LLM (AI)',       'Any',        'All indicators + news',     'Medium',  '$5–15+', 'High'],
                ].map(([strat, market, signals, freq, cost, complexity], i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--accent)', fontWeight: 600 }}>{strat}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{market}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{signals}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--text)' }}>{freq}</td>
                    <td style={{ padding: '8px 12px', color: cost === 'None' ? 'var(--green)' : 'var(--warn)' }}>{cost}</td>
                    <td style={{ padding: '8px 12px', color: complexity === 'Low' ? 'var(--green)' : complexity === 'Medium' ? 'var(--warn)' : 'var(--danger)' }}>{complexity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ ...s.muted, marginTop: 16 }}>
            <strong style={{ color: 'var(--text)' }}>Workflow recommendation:</strong> start with Auto to get a feel for the system.
            Then run Compare in Backtest on your date range to see which strategy would have performed best historically.
            Use Optimize to tune that strategy's parameters. Apply the best params and switch to the specific strategy,
            or keep Auto if regimes shift frequently.
          </p>
          <DetailBox title="SIMPLE DECISION FRAMEWORK" tone="green">
            If you want low maintenance, use Auto. If you trust one market condition strongly, choose the specialist strategy for it.
            If you want maximum flexibility and accept higher cost plus extra variance, use LLM. Start simple, measure results, then add complexity only if it helps.
          </DetailBox>
          <div style={{ background: 'rgba(var(--accent-rgb,0,212,170),0.06)', border: '1px solid var(--accent)', borderRadius: 6, padding: '10px 14px', marginTop: 12 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.06em', marginBottom: 4 }}>PRO TIP: STRATEGY COMPARISON</div>
            <p style={{ ...s.muted, margin: 0 }}>
              Go to Backtest → Compare tab, select all strategies, pick a 3-month date range on your asset, and run.
              The equity curves and Sharpe ratios will immediately show you which approach fits the current regime.
              Re-run every month as market conditions change.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
