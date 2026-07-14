import { expect, test } from "bun:test"
import {
  BRACKETED_PASTE_BEGIN,
  BRACKETED_PASTE_END,
  buildTerminalInputPayload,
  resolveTerminalInputDelivery,
} from "../../src/lib/terminal/terminalInputDelivery"

test("auto resolves from the target tab capability while explicit delivery is preserved", () => {
  expect(resolveTerminalInputDelivery("auto", "shell")).toBe("bracketed-paste")
  expect(resolveTerminalInputDelivery("auto", "text")).toBe("direct")
  expect(resolveTerminalInputDelivery("direct", "shell")).toBe("direct")
  expect(resolveTerminalInputDelivery("direct", "text")).toBe("direct")
  expect(resolveTerminalInputDelivery("bracketed-paste", "shell")).toBe("bracketed-paste")
  expect(resolveTerminalInputDelivery("bracketed-paste", "text")).toBe("bracketed-paste")
})

test("auto resolver fails loudly for unsupported delivery and target kinds", () => {
  expect(() => resolveTerminalInputDelivery("paste" as never, "shell")).toThrow("unsupported_terminal_input_delivery:paste")
  expect(() => resolveTerminalInputDelivery("direct", "canvas" as never)).toThrow("unsupported_terminal_input_target_kind:canvas")
  expect(() => resolveTerminalInputDelivery("auto", "canvas" as never)).toThrow("unsupported_terminal_input_target_kind:canvas")
})

test("payload builder only accepts resolved delivery modes", () => {
  expect(buildTerminalInputPayload("hello", "direct", "cr")).toEqual({ ok: true, payload: "hello\r" })
  expect(buildTerminalInputPayload("hello", "bracketed-paste", "cr")).toEqual({
    ok: true,
    payload: BRACKETED_PASTE_BEGIN + "hello" + BRACKETED_PASTE_END + "\r",
  })
  expect(() => buildTerminalInputPayload("hello", "auto" as never, "cr")).toThrow("unsupported_resolved_terminal_input_delivery:auto")
  expect(() => buildTerminalInputPayload("hello", "paste" as never, "cr")).toThrow("unsupported_resolved_terminal_input_delivery:paste")
})
