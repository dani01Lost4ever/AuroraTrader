import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import axios from 'axios'
import { z } from 'zod'
import { AssetSnapshot, TokenUsageModel } from './schema'
import { Portfolio } from './poller'
import type { FearGreedData } from './sentiment'
import { computeAtrPositionSize } from './risk'
import { getConfig } from './config'
import { getKey } from './keys'

// â”€â”€ Pricing table (USD per 1M tokens) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514':  { input:  3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022':{ input:  3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input:  0.80, output:  4.00 },
  'claude-3-5-haiku-20241022': { input:  0.80, output:  4.00 },
  'claude-3-opus-20240229':    { input: 15.00, output: 75.00 },
  // OpenAI
  'babbage-002':                { input:  0.40, output:  1.60 },
  'chatgpt-4o-latest':          { input:  5.00, output: 15.00 },
  'codex-mini-latest':          { input:  1.50, output:  6.00 },
  'computer-use-preview':       { input:  3.00, output: 12.00 },
  'davinci-002':                { input:  2.00, output:  8.00 },
  'gpt-3.5-turbo':              { input:  0.50, output:  1.50 },
  'gpt-3.5-turbo-instruct':     { input:  1.50, output:  2.00 },
  'gpt-4':                      { input: 30.00, output: 60.00 },
  'gpt-4-turbo':                { input: 10.00, output: 30.00 },
  'gpt-4-turbo-preview':        { input: 10.00, output: 30.00 },
  'gpt-4.1':                    { input:  2.00, output:  8.00 },
  'gpt-4.1-mini':               { input:  0.40, output:  1.60 },
  'gpt-4.1-nano':               { input:  0.10, output:  0.40 },
  'gpt-4.5-preview':            { input: 75.00, output: 150.00 },
  'gpt-4o':                     { input:  2.50, output: 10.00 },
  'gpt-4o-mini':                { input:  0.15, output:  0.60 },
  'gpt-4o-mini-search-preview': { input:  0.15, output:  0.60 },
  'gpt-4o-search-preview':      { input:  2.50, output: 10.00 },
  'gpt-5':                      { input:  1.25, output: 10.00 },
  'gpt-5-codex':                { input:  1.25, output: 10.00 },
  'gpt-5-chat':                 { input:  1.25, output: 10.00 },
  'gpt-5-mini':                 { input:  0.25, output:  2.00 },
  'gpt-5-nano':                 { input:  0.05, output:  0.40 },
  'gpt-5-pro':                  { input: 15.00, output: 120.00 },
  'gpt-5.1-chat':               { input:  1.25, output: 10.00 },
  'gpt-5.1-codex':              { input:  1.25, output: 10.00 },
  'gpt-5.1-codex-max':          { input:  1.25, output: 10.00 },
  'gpt-5.1-codex-mini':         { input:  0.25, output:  2.00 },
  'gpt-5.2':                    { input:  1.75, output: 14.00 },
  'gpt-5.2-codex':              { input:  1.75, output: 14.00 },
  'gpt-5.2-chat':               { input:  1.75, output: 14.00 },
  'gpt-5.2-pro':                { input: 21.00, output: 168.00 },
  'gpt-5.3-chat':               { input:  1.75, output: 14.00 },
  'gpt-5.3-codex':              { input:  1.75, output: 14.00 },
  'gpt-5.4':                    { input:  2.50, output: 15.00 },
  'gpt-5.4-mini':               { input:  0.75, output:  4.50 },
  'gpt-5.4-nano':               { input:  0.20, output:  1.25 },
  'gpt-5.4-pro':                { input: 30.00, output: 180.00 },
  'o1':                         { input: 15.00, output: 60.00 },
  'o1-mini':                    { input:  1.10, output:  4.40 },
  'o1-pro':                     { input: 150.00, output: 600.00 },
  'o1-preview':                 { input: 15.00, output: 60.00 },
  'o3':                         { input:  1.00, output:  4.00 },
  'o3-deep-research':           { input: 10.00, output: 40.00 },
  'o3-mini':                    { input:  1.10, output:  4.40 },
  'o3-pro':                     { input: 20.00, output: 80.00 },
  'o4-mini':                    { input:  1.10, output:  4.40 },
  'o4-mini-deep-research':      { input:  2.00, output:  8.00 },
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 3.00, output: 15.00 }
  return (inputTokens / 1_000_000) * pricing.input
       + (outputTokens / 1_000_000) * pricing.output
}

async function saveTokenUsage(model: string, inputTokens: number, outputTokens: number, context = 'trade_decision') {
  try {
    const cost_usd = computeCost(model, inputTokens, outputTokens)
    await TokenUsageModel.create({ llm_model: model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd, context })
  } catch (err) {
    console.warn('[brain] Failed to save token usage:', err)
  }
}

/** Returns true for OpenAI model IDs */
function isOpenAIModel(model: string): boolean {
  return model.startsWith('gpt-')
      || model.startsWith('o1')
      || model.startsWith('o3')
      || model.startsWith('o4')
      || model.startsWith('chatgpt-')
      || model.startsWith('codex-')
      || model === 'computer-use-preview'
      || model === 'davinci-002'
      || model === 'babbage-002'
}

// â”€â”€ Known valid Claude models â€” used to warn about unknown IDs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const KNOWN_CLAUDE_MODELS = new Set(Object.keys(MODEL_PRICING).filter(k => k.startsWith('claude')))

const DecisionSchema = z.object({
  action:     z.enum(['buy', 'sell', 'hold']),
  asset:      z.string(),
  amount_usd: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning:  z.string().min(10),
})

export type Decision = z.infer<typeof DecisionSchema>

const SYSTEM_PROMPT = `You are a crypto trading agent operating a paper trading account.
You receive a market snapshot with technical indicators for multiple assets and your current portfolio.
You must evaluate EVERY listed asset independently and return one decision per asset.

Indicator guide:
- RSI(14): >70 overbought (consider sell/hold), <30 oversold (consider buy), 40-60 neutral
- EMA9 vs EMA21: EMA9 > EMA21 = bullish short-term trend, EMA9 < EMA21 = bearish
- MACD hist: positive & rising = bullish momentum, negative & falling = bearish momentum
- BB %B: >1.0 above upper band (overbought), <0.0 below lower band (oversold), ~0.5 neutral
- ATR(14): higher = more volatile; prefer smaller positions in high-ATR environments
- Vol/SMA20: >1.5 = volume confirms the move; <0.5 = weak move
- Price vs daily SMA50: above = macro uptrend, below = macro downtrend
- 7d change: broader context beyond 24h

Sentiment guide:
- Fear & Greed 0-25: Extreme Fear â€” contrarian buy signal in oversold conditions
- Fear & Greed 25-45: Fear â€” cautious, look for quality setups
- Fear & Greed 55-75: Greed â€” reduce size, tighten stops
- Fear & Greed 75-100: Extreme Greed â€” avoid buying, watch for reversals
- Market Regime: adjust position sizing and risk tolerance to match regime

Rules:
- Never risk more than MAX_POSITION_USD per trade (use ATR-adjusted suggested sizes)
- Prefer hold when signals are mixed or ambiguous
- Do NOT favour cheap assets â€” confidence and signal quality matter, not price
- Diversify: avoid concentrating all activity on a single asset cycle after cycle
- Reference the specific indicators that drove your decision in the reasoning
- Use recent news as a sentiment signal but do not trade on news alone

Respond ONLY with a valid JSON array â€” one object per asset, in the same order as listed.
No extra text, no markdown fences. Pure JSON array only.
Keep reasoning to ONE short sentence (max 15 words) â€” brevity is required.

[
  { "action": "buy"|"sell"|"hold", "asset": "BTC/USD", "amount_usd": 0, "confidence": 0.0, "reasoning": "..." },
  ...
]`

function buildUserPrompt(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number,
  recentAssets: string[],
  fearGreed: FearGreedData | null,
  news: Record<string, string[]>,
  regime: string,
): string {
  const marketLines = Object.entries(market)
    .map(([asset, s]) => {
      const trend = s.ema_9 != null && s.ema_21 != null
        ? (s.ema_9 > s.ema_21 ? 'bullish' : 'bearish')
        : 'unknown'
      const volRatio = s.volume_sma20 && s.volume_sma20 > 0
        ? (s.volume_24h / 24 / s.volume_sma20).toFixed(2)
        : 'N/A'
      const sma50gap = s.daily_sma50
        ? `${((s.price - s.daily_sma50) / s.daily_sma50 * 100).toFixed(1)}%`
        : 'N/A'
      const atrSize = computeAtrPositionSize(s.atr_14, s.price, maxPositionUsd)

      const lines = [
        `${asset}:`,
        `  Price: $${s.price.toLocaleString()}  |  24h: ${s.change_24h}%  |  7d: ${s.change_7d ?? 'N/A'}%`,
        `  RSI(14): ${s.rsi_14 ?? 'N/A'}  |  EMA9: $${s.ema_9?.toLocaleString() ?? 'N/A'}  |  EMA21: $${s.ema_21?.toLocaleString() ?? 'N/A'}  |  Trend: ${trend}`,
        `  MACD: ${s.macd ?? 'N/A'}  |  Signal: ${s.macd_signal ?? 'N/A'}  |  Hist: ${s.macd_hist ?? 'N/A'}`,
        `  BB upper: $${s.bb_upper?.toLocaleString() ?? 'N/A'}  |  BB lower: $${s.bb_lower?.toLocaleString() ?? 'N/A'}  |  BB %B: ${s.bb_pct ?? 'N/A'}`,
        `  ATR(14): $${s.atr_14 ?? 'N/A'}  |  Vol/SMA20: ${volRatio}x  |  24h High: $${s.high_24h.toLocaleString()}  |  24h Low: $${s.low_24h.toLocaleString()}`,
        `  Daily SMA50: $${s.daily_sma50?.toLocaleString() ?? 'N/A'}  (price ${sma50gap} vs SMA50)`,
        `  Suggested size: $${atrSize} (ATR-adjusted)`,
      ]

      const assetNews = news[asset]
      if (assetNews && assetNews.length > 0) {
        lines.push(`  Recent news: ${assetNews.map(h => `"${h}"`).join(', ')}`)
      }

      return lines.join('\n')
    })
    .join('\n\n')

  const posLines = Object.entries(portfolio.positions)
    .map(([asset, qty]) => `  ${asset}: ${qty}`)
    .join('\n') || '  (none)'

  const recentNote = recentAssets.length
    ? `\nRECENTLY TRADED (last 3 cycles): ${recentAssets.join(', ')} â€” consider other assets if signals are equal.`
    : ''

  return `MACRO CONTEXT:
  Market Regime: ${regime}
  Fear & Greed: ${fearGreed ? `${fearGreed.value}/100 (${fearGreed.classification})` : 'N/A'}

MARKET SNAPSHOT (${new Date().toISOString()}):
${marketLines}

PORTFOLIO:
  Cash: $${portfolio.cash_usd.toFixed(2)}
  Equity: $${portfolio.equity_usd.toFixed(2)}
  Positions:
${posLines}

MAX TRADE SIZE: $${maxPositionUsd}${recentNote}

Evaluate every asset above and return one decision per asset as a JSON array.`
}

async function getSystemPrompt(): Promise<string> {
  try {
    const { PromptModel } = await import('./schema')
    const doc = await PromptModel.findOne({ key: 'system_prompt' }).lean()
    return doc?.value || SYSTEM_PROMPT
  } catch { return SYSTEM_PROMPT }
}

async function callClaude(model: string, userPrompt: string): Promise<string> {
  const apiKey = getKey('anthropic_api_key')
  if (!apiKey) throw new Error('[brain] Anthropic API key not set â€” add it in Settings')

  if (!KNOWN_CLAUDE_MODELS.has(model)) {
    console.warn(`[brain] Unknown Claude model "${model}" â€” attempting anyway`)
  }

  const systemPrompt = await getSystemPrompt()

  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const { input_tokens, output_tokens } = msg.usage
  console.log(`[brain] Claude tokens â€” in: ${input_tokens}  out: ${output_tokens}  cost: $${computeCost(model, input_tokens, output_tokens).toFixed(4)}`)
  saveTokenUsage(model, input_tokens, output_tokens)

  const block = msg.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}

async function callOpenAI(model: string, userPrompt: string): Promise<string> {
  const apiKey = getKey('openai_api_key')
  if (!apiKey) throw new Error('[brain] OpenAI API key not set â€” add it in Settings')

  const systemPrompt = await getSystemPrompt()

  const client = new OpenAI({ apiKey })
  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  })

  const inputTokens  = response.usage?.prompt_tokens     ?? 0
  const outputTokens = response.usage?.completion_tokens ?? 0
  console.log(`[brain] OpenAI tokens â€” in: ${inputTokens}  out: ${outputTokens}  cost: $${computeCost(model, inputTokens, outputTokens).toFixed(4)}`)
  saveTokenUsage(model, inputTokens, outputTokens)

  return response.choices[0]?.message?.content ?? ''
}

async function callOllama(userPrompt: string): Promise<string> {
  const systemPrompt = await getSystemPrompt()
  const res = await axios.post(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    model:   process.env.OLLAMA_MODEL || 'trading-llm',
    stream:  false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  })
  return res.data.message.content
}

async function callLLM(model: string, userPrompt: string): Promise<string> {
  const provider = isOpenAIModel(model) ? 'openai' : 'claude'
  return provider === 'openai' ? callOpenAI(model, userPrompt) : callClaude(model, userPrompt)
}

function parseDecisions(raw: string, assetList: string[], maxPositionUsd: number): Decision[] {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const recovered = cleaned.replace(/,?\s*\{[^}]*$/, '').replace(/^\[/, '').trim()
    try {
      parsed = JSON.parse(`[${recovered}]`)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const decisions: Decision[] = []
  for (const item of parsed) {
    const result = DecisionSchema.safeParse(item)
    if (!result.success) continue
    if (!assetList.includes(result.data.asset)) continue
    result.data.amount_usd = Math.min(result.data.amount_usd, maxPositionUsd)
    decisions.push(result.data)
  }
  return decisions
}

export async function getDecisions(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number,
  recentAssets: string[] = [],
  fearGreed: FearGreedData | null = null,
  news: Record<string, string[]> = {},
  regime = 'Unknown',
): Promise<Decision[]> {
  const assetList  = Object.keys(market)
  const userPrompt = buildUserPrompt(market, portfolio, maxPositionUsd, recentAssets, fearGreed, news, regime)
  const model      = getConfig().claudeModel || 'claude-haiku-4-5-20251001'

  // Provider resolution: model name always wins (gpt-*/o1/o3 â†’ openai, claude-* â†’ claude).
  // LLM_PROVIDER=ollama still works as an explicit override; 'claude'/'openai' values are
  // ignored when the model name already makes the provider unambiguous.
  const envProvider = process.env.LLM_PROVIDER
  const provider = envProvider === 'ollama'   ? 'ollama'
                 : isOpenAIModel(model)        ? 'openai'
                 : model.startsWith('claude-') ? 'claude'
                 : envProvider === 'openai'    ? 'openai'
                 : 'claude'

  console.log(`[brain] Calling ${provider} (${model}) for ${assetList.length} assets...`)

  const raw = provider === 'ollama'  ? await callOllama(userPrompt)
            : provider === 'openai'  ? await callOpenAI(model, userPrompt)
            :                          await callClaude(model, userPrompt)

  const cleaned = raw.replace(/```json|```/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const recovered = cleaned.replace(/,?\s*\{[^}]*$/, '').replace(/^\[/, '').trim()
    try {
      parsed = JSON.parse(`[${recovered}]`)
      console.warn(`[brain] Response was truncated â€” recovered ${(parsed as any[]).length} complete decisions.`)
    } catch {
      throw new Error(`[brain] LLM returned invalid JSON:\n${raw.slice(0, 300)}`)
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[brain] Expected JSON array, got: ${typeof parsed}`)
  }

  const decisions: Decision[] = []
  for (const item of parsed) {
    const result = DecisionSchema.safeParse(item)
    if (!result.success) {
      console.warn(`[brain] Skipping invalid decision for ${item?.asset}: ${result.error.message}`)
      continue
    }
    if (!assetList.includes(result.data.asset)) {
      console.warn(`[brain] Skipping unknown asset in response: ${result.data.asset}`)
      continue
    }
    result.data.amount_usd = Math.min(result.data.amount_usd, maxPositionUsd)
    decisions.push(result.data)
  }

  // Consensus mode: run a second model and merge decisions
  const cfg = getConfig()
  if (cfg.consensusMode && cfg.consensusModel) {
    console.log(`[brain] Consensus mode â€” calling ${cfg.consensusModel}`)
    try {
      const consensusRaw = await callLLM(cfg.consensusModel, userPrompt)
      const consensusDecisions = parseDecisions(consensusRaw, assetList, maxPositionUsd)

      const consensusMap = new Map(consensusDecisions.map(d => [d.asset, d]))
      for (const decision of decisions) {
        const consensus = consensusMap.get(decision.asset)
        if (!consensus) continue
        if (consensus.action !== decision.action) {
          console.log(`[brain] Consensus disagreement on ${decision.asset}: primary=${decision.action} consensus=${consensus.action} â€” setting to hold`)
          decision.action = 'hold'
          decision.amount_usd = 0
        }
      }
    } catch (err: any) {
      console.warn(`[brain] Consensus model call failed: ${err.message}`)
    }
  }

  return decisions
}

import { registerLlmStrategy } from './strategies/registry'
import type { StrategyMeta, StrategyContext, StrategyResult, ResolvedParams } from './strategies/types'

export const llmStrategy: StrategyMeta = {
  id: 'llm',
  label: 'LLM (AI)',
  description: 'Claude or OpenAI evaluates all indicators and decides each cycle.',
  params: [],
  evaluate: async (ctx: StrategyContext, _params: ResolvedParams): Promise<StrategyResult> => {
    const decs = await getDecisions(
      { [ctx.asset]: ctx.snapshot },
      ctx.portfolio,
      ctx.maxPositionUsd,
      [], null, {}, ctx.regime
    )
    const dec = decs.find(d => d.asset === ctx.asset)
    if (!dec || dec.action === 'hold') {
      return { action: 'hold', confidence: 0.5, amount_usd: 0, reasoning: dec?.reasoning ?? 'No signal', signal: 'none', indicatorsUsed: ['LLM'] }
    }
    return {
      action:         dec.action,
      confidence:     dec.confidence,
      amount_usd:     dec.amount_usd,
      reasoning:      dec.reasoning,
      signal:         dec.confidence >= 0.75 ? 'strong' : dec.confidence >= 0.6 ? 'moderate' : 'weak',
      indicatorsUsed: ['LLM'],
    }
  },
}
// Register at module load time
registerLlmStrategy(llmStrategy)



