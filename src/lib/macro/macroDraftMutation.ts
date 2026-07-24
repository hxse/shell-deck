import type { MacroDefinitionV5 } from './macroDefinitionTypes'

type DefinitionSerializer = (definition: MacroDefinitionV5) => string

export function createMacroDraftMutationTracker(
  serialize: DefinitionSerializer = (definition) => JSON.stringify(definition),
) {
  let baseFingerprint: string | null = null

  return {
    replaceBase(definition: MacroDefinitionV5 | null): void {
      baseFingerprint = definition === null ? null : serialize(definition)
    },
    apply(
      definition: MacroDefinitionV5,
      mutator: (definition: MacroDefinitionV5) => void,
    ): boolean {
      mutator(definition)
      return baseFingerprint === null || serialize(definition) !== baseFingerprint
    },
  }
}
