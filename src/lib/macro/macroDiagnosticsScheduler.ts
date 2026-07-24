import {
  diagnoseTrustedMacroDefinitionV5,
  type MacroDefinitionDiagnostics,
} from './macroDefinitionValidation'
import type { MacroDefinitionV5 } from './macroDefinitionTypes'

export class MacroDiagnosticsScheduler {
  #timer: ReturnType<typeof setTimeout> | null = null
  #diagnosticsRevision = -1
  #current: MacroDefinitionDiagnostics | null = null

  constructor(
    private readonly read: () => { definition: MacroDefinitionV5 | null; revision: number },
    private readonly commit: (diagnostics: MacroDefinitionDiagnostics) => void,
    private readonly delayMs = 40,
    private readonly diagnose = diagnoseTrustedMacroDefinitionV5,
  ) {}

  schedule(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.#timer = null
      this.flush()
    }, this.delayMs)
  }

  flush(): MacroDefinitionDiagnostics {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    const current = this.read()
    if (current.revision === this.#diagnosticsRevision && this.#current) return this.#current
    const diagnostics = this.diagnose(current.definition)
    this.#diagnosticsRevision = current.revision
    this.#current = diagnostics
    this.commit(diagnostics)
    return diagnostics
  }

  invalidate(): void {
    this.#diagnosticsRevision = -1
  }

  dispose(): void {
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
  }
}
