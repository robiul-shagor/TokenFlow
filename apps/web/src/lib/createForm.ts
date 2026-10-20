import { getAddress, isAddress, type Address } from "viem";
import { isValidAllocationId } from "./allocationId";
import { parseTokenAmount } from "./amounts";

export interface CreateFormValues {
  allocationId: string;
  beneficiary: string;
  amount: string;
  /**
   * `YYYY-MM-DDTHH:mm` from <input type="datetime-local">, interpreted as UTC so it lines up with the
   * unix timestamps used in reconciliation CSVs regardless of the browser's time zone.
   */
  start: string;
  cliffDays: string;
  durationDays: string;
}

export interface CreateScheduleArgs {
  allocationId: string;
  beneficiary: Address;
  amountRaw: bigint;
  start: bigint;
  cliffDuration: bigint;
  duration: bigint;
}

const DAY = 86_400n;
const MAX_DAYS = 365n * 50n;

function parseDays(value: string, field: string, errors: Partial<Record<keyof CreateFormValues, string>>) {
  if (!/^\d+$/.test(value.trim())) {
    errors[field as keyof CreateFormValues] = "Enter a whole number of days";
    return null;
  }
  const days = BigInt(value.trim());
  if (days > MAX_DAYS) {
    errors[field as keyof CreateFormValues] = "Too long (max 50 years)";
    return null;
  }
  return days * DAY;
}

/** Client-side mirror of the contract's input rules. The contract still enforces them authoritatively. */
export function validateCreateForm(
  v: CreateFormValues,
  decimals: number,
): { ok: true; args: CreateScheduleArgs } | { ok: false; errors: Partial<Record<keyof CreateFormValues, string>> } {
  const errors: Partial<Record<keyof CreateFormValues, string>> = {};

  if (!isValidAllocationId(v.allocationId.trim())) errors.allocationId = "1-31 characters: A-Z a-z 0-9 . _ -";

  let beneficiary: Address | null = null;
  if (!isAddress(v.beneficiary.trim())) errors.beneficiary = "Enter a valid address";
  else if (/^0x0{40}$/i.test(v.beneficiary.trim())) errors.beneficiary = "Cannot be the zero address";
  else beneficiary = getAddress(v.beneficiary.trim());

  let amountRaw: bigint | null = null;
  try {
    amountRaw = parseTokenAmount(v.amount, decimals);
    if (amountRaw === 0n) errors.amount = "Must be greater than zero";
  } catch (e) {
    errors.amount = (e as Error).message;
  }

  const startMs = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v.start) ? Date.parse(`${v.start}Z`) : NaN;
  if (Number.isNaN(startMs)) errors.start = "Pick a start date and time (UTC)";
  const cliff = parseDays(v.cliffDays, "cliffDays", errors);
  const duration = parseDays(v.durationDays, "durationDays", errors);
  if (duration !== null && duration === 0n) errors.durationDays = "Must be at least 1 day";
  if (cliff !== null && duration !== null && cliff > duration) errors.cliffDays = "Cliff cannot exceed duration";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    args: {
      allocationId: v.allocationId.trim(),
      beneficiary: beneficiary!,
      amountRaw: amountRaw!,
      start: BigInt(Math.floor(startMs / 1000)),
      cliffDuration: cliff!,
      duration: duration!,
    },
  };
}
