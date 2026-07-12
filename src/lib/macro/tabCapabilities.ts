import type { TerminalBackendKind, TerminalIndexMapItem, TerminalSnapshot } from "../protocol"
import type { CaptureSourceConfig, TerminalTarget } from "./templateTypes"

export type TabCapabilityKind = "shell" | "text"
export type CapabilityCaptureKind = CaptureSourceConfig["kind"]

export type TabCapabilities = {
  kind: TabCapabilityKind
  canSend: boolean
  canInput: boolean
  canWaitQuiet: boolean
  captureKinds: CapabilityCaptureKind[]
}

export type TerminalChoice = {
  value: string
  label: string
  title: string
  index: number
  terminalId: string
  terminalAlias: string
  capabilities: TabCapabilities
}

const SHELL_CAPABILITIES: TabCapabilities = {
  kind: "shell",
  canSend: true,
  canInput: true,
  canWaitQuiet: true,
  captureKinds: ["terminal-buffer", "agent-event"],
}

const TEXT_CAPABILITIES: TabCapabilities = {
  kind: "text",
  canSend: true,
  canInput: true,
  canWaitQuiet: false,
  captureKinds: ["text-box"],
}

export function tabCapabilitiesForBackend(backend: TerminalBackendKind): TabCapabilities {
  switch (backend) {
    case "fake":
    case "real":
      return SHELL_CAPABILITIES
    case "text":
      return TEXT_CAPABILITIES
  }
  const unsupportedBackend: never = backend
  throw new Error("unsupported_terminal_backend_kind:" + String(unsupportedBackend))
}

export function isCaptureKindAllowed(capabilities: TabCapabilities, kind: CapabilityCaptureKind): boolean {
  return capabilities.captureKinds.includes(kind)
}

export function terminalChoiceForTarget(target: TerminalTarget, choices: TerminalChoice[]): TerminalChoice | undefined {
  if (target.kind === "id") return choices.find((choice) => choice.terminalId === target.value)
  if (target.kind === "alias") return choices.find((choice) => choice.terminalAlias === target.value)
  return choices.find((choice) => choice.index === target.value)
}

export function tabInfoForTarget(target: TerminalTarget, indexMap?: TerminalIndexMapItem[], terminals?: TerminalSnapshot[]): { item?: TerminalIndexMapItem; terminal?: TerminalSnapshot; capabilities?: TabCapabilities } {
  const item = indexMap?.find((candidate) => target.kind === "id"
    ? candidate.terminalId === target.value
    : target.kind === "alias"
      ? candidate.terminalAlias === target.value
      : candidate.index === target.value)
  const terminal = item ? terminals?.find((candidate) => candidate.terminalId === item.terminalId) : undefined
  return { item, terminal, capabilities: terminal ? tabCapabilitiesForBackend(terminal.backend) : undefined }
}
