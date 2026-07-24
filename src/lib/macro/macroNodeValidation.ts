import {
  validateCaptureNode,
  validateExtract,
  validateInput,
  validateNotify,
  validateSend,
  validateWait,
} from './macroActionValidation'
import {
  validateFor,
  validateIf,
  validateParallel,
  validateTerminalControl,
} from './macroControlValidation'
import { add, type ValidationContext } from './macroValidationContext'
import { object, validateIdentifier } from './macroValidationPrimitives'

export function validateNodeList(value: unknown, path: string, context: ValidationContext, requireNonEmpty: boolean, actionOnly: boolean): void {
  if (!Array.isArray(value)) {
    add(context.issues, 'expected_array', path, 'body must be an array')
    return
  }
  if (requireNonEmpty && value.length === 0) add(context.issues, 'invalid_range', path, 'body must not be empty')
  value.forEach((node, index) => validateNode(node, `${path}[${index}]`, context, actionOnly, undefined))
}

function validateNode(value: unknown, path: string, context: ValidationContext, actionOnly: boolean, inheritedTerminalIndex: number | null | undefined): void {
  context.onNodeVisited?.()
  const node = object(value, context.issues, path)
  if (!node) return
  validateIdentifier(node.id, context.issues, `${path}.id`, context.nodeIds)
  if (typeof node.type !== 'string') {
    add(context.issues, 'expected_string', `${path}.type`, 'node type must be a string')
    return
  }
  if (actionOnly && ['if', 'for', 'break', 'continue', 'finish'].includes(node.type)) {
    add(context.issues, 'semantic_conflict', `${path}.type`, 'this body only supports action nodes')
    return
  }
  switch (node.type) {
    case 'send': validateSend(node, path, context, inheritedTerminalIndex); break
    case 'notify': validateNotify(node, path, context); break
    case 'input': validateInput(node, path, context, inheritedTerminalIndex); break
    case 'wait': validateWait(node, path, context, inheritedTerminalIndex); break
    case 'capture-source': validateCaptureNode(node, path, context, inheritedTerminalIndex); break
    case 'extract_text': validateExtract(node, path, context); break
    case 'parallel': validateParallel(node, path, context, validateNode); break
    case 'if': validateIf(node, path, context, validateNodeList); break
    case 'for': validateFor(node, path, context, validateNodeList); break
    case 'break':
    case 'continue':
    case 'finish': validateTerminalControl(node, path, context, validateNodeList); break
    default: add(context.issues, 'invalid_literal', `${path}.type`, 'unsupported Flow node type')
  }
}
