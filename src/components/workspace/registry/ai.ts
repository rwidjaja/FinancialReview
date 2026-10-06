import type { SectionMeta } from './types'

// The briefing itself (verdict + narrative + KPIs) renders in the hero band; its
// signal chips and "Versus yesterday" list become the automatic "__hero" section
// ("Signals and versus yesterday", group Summary) registered by PageHero.
const A = 'Ask the portfolio'

export const sections: SectionMeta[] = [
  { id: 'ai_context', group: A, title: 'Portfolio context', adv: true, keys: ['portfolio value', 'annual income', 'total P&L', 'market regime', 'confidence', 'VIX', 'conv room'] },
  { id: 'ai_chat', group: A, title: 'Ask the portfolio', adv: true, keys: ['chat', 'ask', 'AI portfolio analyst', 'local Ollama', 'model', 'API key', 'smart suggestions', 'suggestions', 'context injected', 'tokens', 'portfolio summary', 'risk check', 'income breakdown'] },
]
