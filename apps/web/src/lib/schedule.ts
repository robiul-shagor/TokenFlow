export type ScheduleState = "not_started" | "cliff" | "vesting" | "fully_vested" | "completed";

export const SCHEDULE_STATE_LABELS: Record<ScheduleState, string> = {
  not_started: "Not started",
  cliff: "In cliff",
  vesting: "Vesting",
  fully_vested: "Fully vested",
  completed: "Completed",
};

/**
 * Display-only schedule phase at chain time `now` (seconds). Claimable amounts always come from the
 * contract's `releasable` view, never from this function.
 */
export function scheduleState(
  s: { start: bigint; cliffDuration: bigint; duration: bigint; totalAmount: bigint; released: bigint },
  now: bigint,
): ScheduleState {
  if (s.released >= s.totalAmount) return "completed";
  if (now < s.start) return "not_started";
  if (now < s.start + s.cliffDuration) return "cliff";
  if (now < s.start + s.duration) return "vesting";
  return "fully_vested";
}
