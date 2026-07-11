import { assertValidPublicId } from "../identifier"
import { assertStepId } from "./identifier"
import type { ValidationIssue } from "./runEventTypes"

export function validateLoopIterationData(data: Record<string, unknown>, stepId: unknown, issues: ValidationIssue[]): void {
  const iterationIndexValid = Number.isInteger(data.iterationIndex) && Number(data.iterationIndex) >= 0
  const iterationValid = Number.isInteger(data.iteration) && Number(data.iteration) >= 1
  if (!iterationIndexValid) {
    issues.push({ path: "data.iterationIndex", message: "iterationIndex must be a non-negative integer" })
  }
  if (!iterationValid) {
    issues.push({ path: "data.iteration", message: "iteration must be a positive integer" })
  }
  if (iterationIndexValid && iterationValid && Number(data.iteration) !== Number(data.iterationIndex) + 1) {
    issues.push({ path: "data.iteration", message: "iteration must equal iterationIndex + 1" })
  }

  const finiteRange = data.rangeKind === "count" || data.rangeKind === "text-list"
  if (!finiteRange && data.rangeKind !== "forever") {
    issues.push({ path: "data.rangeKind", message: "rangeKind must be count, forever or text-list" })
  }
  if (data.rangeKind === "forever") {
    if (data.total !== null) issues.push({ path: "data.total", message: "forever loop total must be null" })
  } else if (finiteRange) {
    if (!Number.isInteger(data.total) || Number(data.total) < 1) {
      issues.push({ path: "data.total", message: "finite loop total must be a positive integer" })
    } else if (iterationIndexValid && Number(data.iterationIndex) >= Number(data.total)) {
      issues.push({ path: "data.iterationIndex", message: "iterationIndex must be less than total" })
    }
  }

  if (!Object.prototype.hasOwnProperty.call(data, "executionPath")) {
    issues.push({ path: "data.executionPath", message: "executionPath must be an array" })
    return
  }
  if (!Array.isArray(data.executionPath)) return

  const currentSegment = data.executionPath[data.executionPath.length - 1]
  if (!isRecord(currentSegment)
    || currentSegment.kind !== "for"
    || currentSegment.stepId !== stepId
    || currentSegment.iterationIndex !== data.iterationIndex) {
    issues.push({ path: "data.executionPath", message: "executionPath must end at the current loop iteration" })
  }
}

export function validateExecutionPath(value: unknown, path: string, issues: ValidationIssue[]): value is unknown[] {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "executionPath must be an array" })
    return false
  }
  for (const [index, segment] of value.entries()) {
    validateExecutionPathSegment(segment, path + "[" + index + "]", issues)
  }
  return true
}

function validateExecutionPathSegment(segment: unknown, path: string, issues: ValidationIssue[]): void {
  if (!isRecord(segment)) {
    issues.push({ path, message: "executionPath segment must be an object" })
    return
  }
  if (segment.kind === "for") {
    validateId(segment.stepId, path + ".stepId", assertStepId, issues)
    if (!Number.isInteger(segment.iterationIndex) || Number(segment.iterationIndex) < 0) {
      issues.push({ path: path + ".iterationIndex", message: "iterationIndex must be a non-negative integer" })
    }
    return
  }
  if (segment.kind === "parallel-lane") {
    validateId(segment.stepId, path + ".stepId", assertStepId, issues)
    validateId(segment.laneId, path + ".laneId", (input) => assertValidPublicId(input, "genericId"), issues)
    return
  }
  issues.push({ path: path + ".kind", message: "executionPath segment kind must be for or parallel-lane" })
}

function validateId(value: unknown, path: string, assertId: (input: string) => string, issues: ValidationIssue[]): void {
  if (typeof value !== "string") {
    issues.push({ path, message: path + " must be a string" })
    return
  }
  try {
    assertId(value)
  } catch (error) {
    issues.push({ path, message: error instanceof Error ? error.message : String(error) })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
