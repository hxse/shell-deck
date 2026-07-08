import type { ProfileCatalogSummary } from "./profileCatalogSummary"
import { PROFILE_CATALOG_SUMMARY } from "./profileCatalogSummary"
import { validateFlowV2Template } from "./flowV2Schema"
import type { MacroTemplate, ValidationIssue, ValidationResult } from "./templateTypes"

const PROFILE_BUNDLE_KEYS = ["prompt", "schema", "jsonSchema", "checkSet", "fixtures", "model", "replicas"]
const BRANCH_OPERATORS = ["==", "!=", "is_null"]

export function validateMacroTemplate(value: unknown, options: { indexMap?: unknown[]; terminals?: unknown[] } = {}): ValidationResult {
  return validateFlowV2Template(value, options as never)
}

export function assertValidMacroTemplate(value: unknown, options: { indexMap?: unknown[]; terminals?: unknown[] } = {}): MacroTemplate {
  const result = validateMacroTemplate(value, options)
  if (!result.ok) throw new Error("invalid_macro_template:" + result.issues.map((issue) => issue.path + ":" + issue.message).join("; "))
  return value as MacroTemplate
}

export function validateProfileCatalogSummary(catalog: ProfileCatalogSummary = PROFILE_CATALOG_SUMMARY): ValidationResult {
  const issues: ValidationIssue[] = []
  if (!catalog || typeof catalog !== "object") return invalid("catalog", "profile catalog must be an object")
  if (catalog.schemaVersion !== 1) issues.push({ path: "schemaVersion", message: "profile catalog schemaVersion must be 1" })
  if (!Array.isArray(catalog.profiles)) {
    issues.push({ path: "profiles", message: "profiles must be an array" })
    return { ok: false, issues }
  }
  const profileIds = new Set<string>()
  for (const [profileIndex, profile] of catalog.profiles.entries()) {
    const path = "profiles[" + profileIndex + "]"
    if (!isPublicId(profile.profileId)) issues.push({ path: path + ".profileId", message: "profileId must be a public id" })
    if (profileIds.has(profile.profileId)) issues.push({ path: path + ".profileId", message: "duplicate profileId" })
    profileIds.add(profile.profileId)
    rejectDisallowedProfileSummaryKeys(issues, profile as unknown as Record<string, unknown>, path)
    if (profile.parserKind !== "ai-json") issues.push({ path: path + ".parserKind", message: "V0 built-in profiles must use ai-json" })
    validateString(issues, path + ".name", profile.name, 1)
    validateString(issues, path + ".description", profile.description, 1)
    validateOperators(issues, path + ".branchOperators", profile.branchOperators)
    validateSignals(issues, path + ".signals", profile.signals)
  }
  return { ok: issues.length === 0, issues }
}

function rejectDisallowedProfileSummaryKeys(issues: ValidationIssue[], profile: Record<string, unknown>, path: string) {
  for (const key of PROFILE_BUNDLE_KEYS) if (key in profile) issues.push({ path: path + "." + key, message: "full parser profile fields are out of scope for summary catalog" })
}

function validateSignals(issues: ValidationIssue[], path: string, signals: unknown) {
  if (!Array.isArray(signals) || signals.length === 0) {
    issues.push({ path, message: "signals must be a non-empty array" })
    return
  }
  const signalIds = new Set<string>()
  for (const [index, signal] of signals.entries()) {
    const signalPath = path + "[" + index + "]"
    if (!signal || typeof signal !== "object") {
      issues.push({ path: signalPath, message: "signal must be an object" })
      continue
    }
    const record = signal as { id?: unknown; type?: unknown }
    if (!isPublicId(record.id)) issues.push({ path: signalPath + ".id", message: "signal id must be a public id" })
    if (signalIds.has(String(record.id))) issues.push({ path: signalPath + ".id", message: "duplicate signal id" })
    signalIds.add(String(record.id))
    if (record.type !== "boolean-null" && record.type !== "string-enum") issues.push({ path: signalPath + ".type", message: "unsupported signal type" })
  }
}

function validateOperators(issues: ValidationIssue[], path: string, operators: unknown) {
  if (!Array.isArray(operators) || operators.length === 0) {
    issues.push({ path, message: "branchOperators must be a non-empty array" })
    return
  }
  for (const [index, operator] of operators.entries()) if (!BRANCH_OPERATORS.includes(String(operator))) issues.push({ path: path + "[" + index + "]", message: "unsupported branch operator" })
}

function validateString(issues: ValidationIssue[], path: string, value: unknown, minLength: number) {
  if (typeof value !== "string" || value.length < minLength) issues.push({ path, message: "value must be a string with length >= " + minLength })
}

function isPublicId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length > 0
}

function invalid(path: string, message: string): ValidationResult {
  return { ok: false, issues: [{ path, message }] }
}
