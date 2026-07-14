const EXACT_MESSAGES: Record<string, string> = {
  room_disconnected: 'This Room is disconnected. Reconnect before changing shared state.',
  room_control_required: 'This device is read-only. Take control of the Room to make shared changes.',
  room_control_lost: 'Control moved to another device. Take control again before changing shared state.',
  room_control_held: 'Another connected device currently controls this Room.',
  room_control_epoch_conflict: 'Room control changed before this action completed. Try again after taking control.',
  room_destroying: 'This Room is being destroyed and no longer accepts changes.',
  room_not_found: 'This Room no longer exists.',
  room_structure_locked_by_run: 'Terminal structure is locked while the Macro run is active.',
  terminal_structure_revision_conflict: 'Terminal order changed before this action completed. Review the current layout and try again.',
  content_edit_lease_required: 'Open Edit and obtain the content edit lease before saving this record.',
  content_edit_lease_held: 'This saved content is being edited elsewhere. Take over its edit lease or try again later.',
  content_edit_lease_lost: 'This content edit lease moved elsewhere. Re-open Edit before saving.',
  content_edit_lease_expired: 'This content edit lease expired. Re-open Edit before saving.',
  content_revision_conflict: 'The saved record changed elsewhere. Reload it before saving again.',
  clipboard_write_failed: 'The browser could not write this content to the clipboard.',
  macro_revision_conflict: 'The saved Macro changed elsewhere. Reload it before starting or saving.',
  operation_pending: 'Wait for the current operation to finish.',
  runner_not_waiting_input: 'The Macro is no longer waiting for runtime input.',
  runner_input_invocation_mismatch: 'The active runtime input changed. Review the current prompt and try again.',
  runner_input_revision_conflict: 'Runtime input changed on the server. The latest Room value has been reloaded.',
  run_not_active: 'There is no active Macro run for this action.',
  run_not_running: 'The current Macro run cannot be paused from its present state.',
  run_not_paused: 'The current Macro run is not paused.',
}

export function sharedMutationFeedback(reason: string): string {
  const exact = EXACT_MESSAGES[reason]
  if (exact) return exact
  if (reason.startsWith('room_control_')) return 'Room control changed before this action completed. Take control and try again. (' + reason + ')'
  if (reason.startsWith('content_edit_')) return 'The saved content is being edited elsewhere or its lease changed. (' + reason + ')'
  return reason
}

export function isRoomControlFeedback(reason: string | undefined): boolean {
  return Boolean(reason && (reason === 'room_control_required' || reason === 'room_control_lost' || reason.startsWith('room_control_')))
}
