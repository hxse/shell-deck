const runOnline = process.argv.includes("--run-online") || process.env.SHELL_DECK_RUN_ONLINE === "1"

if (!runOnline) {
  console.log("missing --run-online; skipping .008 online parallel_all probe")
  process.exit(0)
}

console.log(".008 online parallel_all probe is superseded by .016 parallel_send_capture; use just test-016 for the current macro language path.")
process.exit(0)
