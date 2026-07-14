/** Clone a JSON-only value while removing Svelte reactive proxies. */
export function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
