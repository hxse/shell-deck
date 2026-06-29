import type { ParserDisagreement, ParserInvocationOutput } from './parserProfileTypes'

export function reduceParserReplicas(profileId: string, variants: ParserInvocationOutput[], strategy: 'agree_or_pause' = 'agree_or_pause'): ParserInvocationOutput | ParserDisagreement {
  if (variants.length === 0) throw new Error('parser_replicas_empty')
  if (variants.length === 1) return variants[0]
  const first = stableSignals(variants[0])
  const allAgree = variants.every((variant) => stableSignals(variant) === first)
  if (allAgree) return variants[0]
  return { status: 'disagreement', profileId, strategy, variants }
}

function stableSignals(output: ParserInvocationOutput): string {
  return JSON.stringify(Object.keys(output.signals).sort().map((key) => [key, output.signals[key]]))
}
