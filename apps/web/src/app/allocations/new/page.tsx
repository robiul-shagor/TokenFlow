"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { formatUnits, keccak256, toBytes } from "viem";
import { useBlock, useConnection, useReadContracts } from "wagmi";
import { useAppConfig } from "@/components/Providers";
import { Hex, Notice } from "@/components/ui";
import { RequireLocalWallet } from "@/components/WalletPanel";
import { useAllocations } from "@/hooks/useIndexedData";
import { useTxFlow } from "@/hooks/useTxFlow";
import { erc20Abi, vestingRegistryAbi } from "@/lib/abi";
import { encodeAllocationId } from "@/lib/allocationId";
import { formatTokenAmount } from "@/lib/amounts";
import { validateCreateForm, type CreateFormValues, type CreateScheduleArgs } from "@/lib/createForm";
import { isTxBusy, type TxState } from "@/lib/txState";
import { DAY_SECONDS, utcDate, vestedAt } from "@/lib/unlocks";

// Mirrors `keccak256("SCHEDULE_MANAGER_ROLE")` in VestingRegistry.sol.
const SCHEDULE_MANAGER_ROLE = keccak256(toBytes("SCHEDULE_MANAGER_ROLE"));

const panel = "rounded-xl border border-[var(--border)] bg-[var(--surface)]";
const muted = "text-slate-600 dark:text-slate-400";

/** Current time as a UTC `YYYY-MM-DDTHH:mm` value for the datetime-local input. */
function nowUtcInput(): string {
  return new Date().toISOString().slice(0, 16);
}

export default function CreateAllocationPage() {
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className={`text-sm ${muted}`}>
        <Link className="underline" href="/">
          Overview
        </Link>{" "}
        / New allocation
      </nav>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create allocation</h1>
        <p className={`mt-1 text-sm ${muted}`}>
          Creates and funds one vesting schedule in the registry with local test tokens. Requires SCHEDULE_MANAGER_ROLE
          (Anvil #0 after deployment).
        </p>
      </div>
      <RequireLocalWallet purpose="create allocations">
        <Suspense fallback={<p className="text-sm text-slate-500">Loading form…</p>}>
          <CreateForm />
        </Suspense>
      </RequireLocalWallet>
    </div>
  );
}

type Field = keyof CreateFormValues;

function CreateForm() {
  const { registry, token } = useAppConfig();
  const { address } = useConnection();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const approveFlow = useTxFlow();
  const createFlow = useTxFlow();
  const { data: block } = useBlock({ watch: true });
  const indexed = useAllocations();

  // Prefill from a reconciliation report row ("missing on-chain"): id, beneficiary, raw amount.
  const fromReport = params.get("fromReport");
  const [values, setValues] = useState<CreateFormValues>(() => ({
    allocationId: params.get("id") ?? "",
    beneficiary: params.get("beneficiary") ?? "",
    amount: "",
    start: nowUtcInput(),
    cliffDays: "0",
    durationDays: "365",
  }));
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>(() => ({
    allocationId: !!params.get("id"),
    beneficiary: !!params.get("beneficiary"),
  }));
  const [submitted, setSubmitted] = useState<CreateScheduleArgs | null>(null);

  const reads = useReadContracts({
    contracts: [
      { address: token, abi: erc20Abi, functionName: "decimals" },
      { address: token, abi: erc20Abi, functionName: "symbol" },
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address!] },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [address!, registry] },
      { address: registry, abi: vestingRegistryAbi, functionName: "hasRole", args: [SCHEDULE_MANAGER_ROLE, address!] },
    ],
    query: { enabled: !!address, refetchInterval: 4_000 },
  });
  const decimals = reads.data?.[0]?.result as number | undefined;
  const symbol = (reads.data?.[1]?.result as string | undefined) ?? "";
  const balance = reads.data?.[2]?.result as bigint | undefined;
  const allowance = reads.data?.[3]?.result as bigint | undefined;
  const hasRole = reads.data?.[4]?.result as boolean | undefined;

  // The raw prefill amount needs the token's decimals, so it is applied once they are known.
  const prefillRaw = params.get("amountRaw");
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && decimals !== undefined && prefillRaw && /^\d+$/.test(prefillRaw)) {
    setPrefilled(true);
    setValues((v) => ({ ...v, amount: formatUnits(BigInt(prefillRaw), decimals) }));
    setTouched((t) => ({ ...t, amount: true }));
  }

  const result = decimals === undefined ? null : validateCreateForm(values, decimals);
  const errors: Partial<Record<Field, string>> = result && !result.ok ? { ...result.errors } : {};
  const args = result?.ok ? result.args : null;
  if (args && balance !== undefined && args.amountRaw > balance) {
    errors.amount = `More than your balance (${formatTokenAmount(balance, decimals!)} ${symbol})`;
  }
  const valid = !!args && Object.keys(errors).length === 0;

  const fmt = (v: bigint) => formatTokenAmount(v, decimals ?? 18);
  const busy = isTxBusy(approveFlow.state) || isTxBusy(createFlow.state);
  const created = createFlow.state.status === "confirmed";
  const locked = busy || created;
  const txArgs = submitted ?? args;
  const needsApproval = txArgs !== null && allowance !== undefined && allowance < txArgs.amountRaw;
  const isIndexed =
    created && !!submitted && (indexed.data?.allocations ?? []).some((a) => a.allocationId === submitted.allocationId);

  async function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    setTouched({ allocationId: true, beneficiary: true, amount: true, start: true, cliffDays: true, durationDays: true });
    if (!valid || !args) return;
    setSubmitted(args);
    approveFlow.reset();
    createFlow.reset();
    if ((allowance ?? 0n) < args.amountRaw) {
      const ok = await approveFlow.run("Approve test tokens", {
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [registry, args.amountRaw],
      });
      if (!ok) return;
      await reads.refetch();
    }
    const receipt = await createFlow.run("Create schedule", {
      address: registry,
      abi: vestingRegistryAbi,
      functionName: "createSchedule",
      args: [encodeAllocationId(args.allocationId), args.beneficiary, args.amountRaw, args.start, args.cliffDuration, args.duration],
    });
    if (receipt) {
      await queryClient.invalidateQueries({ queryKey: ["allocations"] });
      await reads.refetch();
    }
  }

  function startOver() {
    if (created) setValues((v) => ({ ...v, allocationId: "", beneficiary: "", amount: "" }));
    if (created) setTouched({});
    setSubmitted(null);
    approveFlow.reset();
    createFlow.reset();
  }

  const fieldBorder = (name: Field) =>
    touched[name] && errors[name] ? "border-red-600 dark:border-red-500" : "border-slate-300 dark:border-slate-700";
  const inputCls = (name: Field) =>
    `min-h-11 w-full rounded-lg border ${fieldBorder(name)} bg-[var(--surface)] px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60`;
  const bind = (name: Field) => ({
    id: `f-${name}`,
    name,
    value: values[name],
    disabled: locked,
    "aria-invalid": !!(touched[name] && errors[name]),
    "aria-describedby": `f-${name}-hint`,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [name]: e.target.value })),
    onBlur: () => setTouched((t) => ({ ...t, [name]: true })),
  });
  const hint = (name: Field, ok: React.ReactNode, okTone = muted) => {
    const err = touched[name] ? errors[name] : undefined;
    return (
      <span id={`f-${name}-hint`} className={`text-[12.5px] ${err ? "text-red-700 dark:text-red-400" : okTone}`}>
        {err ?? ok}
      </span>
    );
  };

  return (
    <>
      {fromReport && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:bg-blue-950/40 dark:text-blue-200">
          <span className="font-mono font-medium" aria-hidden="true">
            −
          </span>
          <span className="min-w-0 flex-[1_1_360px]">
            Prefilled from report #{fromReport}: <strong className="font-semibold">{params.get("id")}</strong> is in the
            CSV but missing on-chain. Reports don&apos;t store the schedule, so copy start, cliff and duration from your
            CSV.
          </span>
          <Link className="inline-flex min-h-11 items-center font-medium underline" href={`/reconcile/${fromReport}`}>
            Back to report
          </Link>
        </div>
      )}

      {hasRole === false && (
        <Notice tone="warn" title="This account cannot create schedules">
          The contract will reject the transaction. Connect Anvil #0 (the deployer/admin).
        </Notice>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <form
          aria-label="Allocation details"
          onSubmit={onSubmit}
          noValidate
          className={`${panel} flex min-w-0 flex-[999_1_520px] flex-col gap-7 p-6`}
        >
          <fieldset className="flex flex-col gap-4">
            <legend className="pb-3 text-[15px] font-semibold">1 · Who and what</legend>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="f-allocationId" className="font-medium">
                Allocation ID
              </label>
              <input {...bind("allocationId")} placeholder="team-002" autoComplete="off" className={inputCls("allocationId")} />
              {hint("allocationId", "Stored on-chain as bytes32 text, so reports and claims can name it.")}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="f-beneficiary" className="font-medium">
                Beneficiary address
              </label>
              <input
                {...bind("beneficiary")}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                className={inputCls("beneficiary")}
              />
              {hint(
                "beneficiary",
                values.beneficiary && !errors.beneficiary ? "Valid address" : "The only account that can claim.",
                values.beneficiary && !errors.beneficiary ? "text-emerald-800 dark:text-emerald-400" : muted,
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="f-amount" className="font-medium">
                Amount
              </label>
              <div
                className={`flex items-stretch overflow-hidden rounded-lg border ${fieldBorder("amount")} bg-[var(--surface)] focus-within:ring-2 focus-within:ring-blue-600`}
              >
                <input
                  {...bind("amount")}
                  inputMode="decimal"
                  placeholder="1000"
                  className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none disabled:opacity-60"
                />
                <span className="inline-flex items-center bg-slate-100 px-3 font-mono text-[13px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {symbol || "…"}
                </span>
              </div>
              <span className="break-all">
                {hint(
                  "amount",
                  args && !errors.amount ? (
                    <span className="font-mono">
                      = {args.amountRaw.toString()} raw units ({decimals} decimals)
                    </span>
                  ) : (
                    "Exact amount; never rounded."
                  ),
                )}
              </span>
              <span className={`text-[12.5px] ${muted}`}>
                Your balance: {balance === undefined ? "…" : `${fmt(balance)} ${symbol}`}
              </span>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="pb-3 text-[15px] font-semibold">2 · Schedule</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="f-start" className="font-medium">
                  Start (UTC)
                </label>
                <input {...bind("start")} type="datetime-local" className={inputCls("start")} />
                {hint("start", "")}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="f-cliffDays" className="font-medium">
                  Cliff (days)
                </label>
                <input {...bind("cliffDays")} inputMode="numeric" className={inputCls("cliffDays")} />
                {hint("cliffDays", "")}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="f-durationDays" className="font-medium">
                  Duration (days)
                </label>
                <input {...bind("durationDays")} inputMode="numeric" className={inputCls("durationDays")} />
                {hint("durationDays", "")}
              </div>
            </div>
            <p className={`text-[12.5px] ${muted}`}>
              Tokens vest linearly from the start; nothing is claimable before the cliff ends.
            </p>
          </fieldset>
        </form>

        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5">
          <SchedulePreview args={valid ? args : null} now={block?.timestamp} fmt={fmt} symbol={symbol} />

          <section aria-label="Transactions" className={`${panel} flex flex-col gap-3.5 p-5`}>
            <h2 className="text-[15px] font-semibold">Transactions</h2>
            <ol className="flex flex-col gap-1">
              <Step
                title={`Approve ${txArgs ? `${fmt(txArgs.amountRaw)} ${symbol}` : symbol}`}
                {...approveStep(approveFlow.state, needsApproval)}
              />
              <Step title="Create and fund allocation" {...createStep(createFlow.state)} />
              <Step
                title="Indexed"
                {...(isIndexed
                  ? { status: "done" as const, sub: "ScheduleCreated stored; it now shows in reports." }
                  : created
                    ? { status: "active" as const, sub: "Waiting for the indexer…" }
                    : { status: "todo" as const, sub: "Shows up in reports once the indexer sees it." })}
              />
            </ol>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={!valid || locked || decimals === undefined}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 disabled:bg-slate-200 disabled:text-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-400"
              >
                {primaryLabel({
                  valid,
                  approve: approveFlow.state,
                  create: createFlow.state,
                  needsApproval,
                  amount: args ? `${fmt(args.amountRaw)} ${symbol}` : "",
                })}
              </button>
              {(submitted || approveFlow.state.status !== "idle") && !busy && (
                <button
                  type="button"
                  onClick={startOver}
                  className="inline-flex min-h-12 items-center rounded-lg border border-[var(--border)] px-4 font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  {created ? "Create another" : "Start over"}
                </button>
              )}
            </div>
            {created && (
              <div className="flex flex-wrap gap-x-4">
                <Link
                  className="inline-flex min-h-11 items-center font-medium text-blue-700 underline dark:text-blue-400"
                  href="/reconcile"
                >
                  Re-run reconciliation
                </Link>
                <Link className="inline-flex min-h-11 items-center font-medium text-blue-700 underline dark:text-blue-400" href="/">
                  Back to overview
                </Link>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

type StepStatus = "todo" | "active" | "done" | "error";

function approveStep(s: TxState, needed: boolean): { status: StepStatus; sub: React.ReactNode } {
  switch (s.status) {
    case "preparing":
      return { status: "active", sub: "Simulating against the local chain…" };
    case "awaiting_signature":
      return { status: "active", sub: "Waiting for your signature in the wallet…" };
    case "pending":
      return { status: "active", sub: <TxRef text="Pending" hash={s.hash} /> };
    case "confirmed":
      return { status: "done", sub: <TxRef text={`Confirmed · block ${s.blockNumber}`} hash={s.hash} /> };
    case "rejected":
    case "failed":
      return { status: "error", sub: s.error };
    default:
      return needed
        ? { status: "todo", sub: "Lets the registry pull exactly this amount." }
        : { status: "done", sub: "Not needed: your allowance already covers this amount." };
  }
}

function createStep(s: TxState): { status: StepStatus; sub: React.ReactNode } {
  switch (s.status) {
    case "preparing":
      return { status: "active", sub: "Simulating against the local chain…" };
    case "awaiting_signature":
      return { status: "active", sub: "Waiting for your signature in the wallet…" };
    case "pending":
      return { status: "active", sub: <TxRef text="Pending" hash={s.hash} /> };
    case "confirmed":
      return { status: "done", sub: <TxRef text={`Confirmed · block ${s.blockNumber}`} hash={s.hash} /> };
    case "rejected":
      return { status: "error", sub: s.error };
    case "failed":
      return { status: "error", sub: `${s.error} No tokens moved.` };
    default:
      return { status: "todo", sub: "One transaction: stores the schedule and transfers the tokens." };
  }
}

function TxRef({ text, hash }: { text: string; hash: string | null }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1 font-mono">
      {text}
      {hash && (
        <>
          {" · "}
          <Hex value={hash} chars={4} />
        </>
      )}
    </span>
  );
}

function primaryLabel(p: { valid: boolean; approve: TxState; create: TxState; needsApproval: boolean; amount: string }) {
  if (p.approve.status === "awaiting_signature" || p.create.status === "awaiting_signature") return "Confirm in your wallet…";
  if (isTxBusy(p.approve)) return "Approving…";
  if (isTxBusy(p.create)) return "Creating allocation…";
  if (p.create.status === "confirmed") return "Allocation created";
  if (!p.valid) return "Fix the form to continue";
  if (p.approve.status === "rejected" || p.approve.status === "failed" || p.create.status === "rejected" || p.create.status === "failed")
    return "Try again";
  return p.needsApproval ? `Approve ${p.amount} and create` : "Create allocation";
}

const STEP_STYLE: Record<StepStatus, { glyph: string; dot: string; row: string; sub: string; label: string }> = {
  todo: {
    glyph: "",
    dot: "border-slate-300 bg-[var(--surface)] dark:border-slate-600",
    row: "",
    sub: muted,
    label: "not started",
  },
  active: {
    glyph: "…",
    dot: "border-blue-700 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300",
    row: "bg-blue-50/60 dark:bg-blue-950/30",
    sub: "text-blue-800 dark:text-blue-300",
    label: "in progress",
  },
  done: {
    glyph: "✓",
    dot: "border-emerald-600 bg-emerald-600 text-white",
    row: "",
    sub: "text-emerald-800 dark:text-emerald-400",
    label: "done",
  },
  error: {
    glyph: "×",
    dot: "border-red-700 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
    row: "bg-red-50/70 dark:bg-red-950/30",
    sub: "text-red-800 dark:text-red-300",
    label: "failed",
  },
};

function Step({ title, status, sub }: { title: string; status: StepStatus; sub: React.ReactNode }) {
  const st = STEP_STYLE[status];
  return (
    <li className={`grid grid-cols-[28px_minmax(0,1fr)] gap-2.5 rounded-lg p-2.5 ${st.row}`}>
      <span
        aria-hidden="true"
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] font-mono text-[13px] font-semibold ${st.dot}`}
      >
        {st.glyph}
      </span>
      <div className="min-w-0">
        <p className="font-medium">
          {title} <span className="sr-only">({st.label})</span>
        </p>
        <div className={`break-words text-[12.5px] ${st.sub}`}>{sub}</div>
      </div>
    </li>
  );
}

function SchedulePreview({
  args,
  now,
  fmt,
  symbol,
}: {
  args: CreateScheduleArgs | null;
  now: bigint | undefined;
  fmt: (v: bigint) => string;
  symbol: string;
}) {
  if (!args || now === undefined) {
    return (
      <section aria-label="Schedule preview" className={`${panel} flex flex-col gap-3.5 p-5`}>
        <h2 className="text-[15px] font-semibold">What this schedule does</h2>
        <p className="rounded-lg border border-dashed border-slate-300 p-3.5 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300">
          {args ? "Reading chain time…" : "Fill in valid details to see the schedule."}
        </p>
      </section>
    );
  }
  const s = { totalAmount: args.amountRaw, start: args.start, cliffDuration: args.cliffDuration, duration: args.duration };
  const cliffEnd = s.start + s.cliffDuration;
  const end = s.start + s.duration;
  const W = 320;
  const x = (t: bigint) => Math.max(0, Math.min(W, (Number(t - s.start) / Number(s.duration)) * W));
  const y = (f: number) => 110 - f * 100;
  const cf = Number(s.cliffDuration) / Number(s.duration);
  const cx = x(cliffEnd).toFixed(1);
  const path = `M0 110 L${cx} 110 L${cx} ${y(cf).toFixed(1)} L${W} 10`;
  const todayX = now > s.start && now < end ? x(now) : null;
  const claimNow = vestedAt(s, now);
  const note =
    now >= s.start
      ? now < cliffEnd
        ? "The start is in the past, but the cliff hasn't ended, so nothing is claimable yet."
        : `The start is in the past: ${fmt(claimNow)} ${symbol} is claimable as soon as it is created.`
      : s.cliffDuration > 0n
        ? "Nothing is claimable until the cliff ends."
        : `Tokens start vesting on ${utcDate(s.start)}.`;

  return (
    <section aria-label="Schedule preview" className={`${panel} flex flex-col gap-3.5 p-5`}>
      <h2 className="text-[15px] font-semibold">What this schedule does</h2>
      <svg
        viewBox="0 0 320 130"
        role="img"
        aria-label={`Vesting curve: ${s.cliffDuration > 0n ? `nothing until ${utcDate(cliffEnd)}, then ${Math.round(cf * 100)}% unlocks, then` : ""} linear to ${utcDate(end)}.`}
        className="block h-auto w-full"
      >
        <line x1="0" y1="110" x2="320" y2="110" className="stroke-slate-300 dark:stroke-slate-700" strokeWidth="1" />
        {todayX !== null && (
          <>
            <line x1={todayX} y1="6" x2={todayX} y2="110" className="stroke-slate-400" strokeWidth="1" strokeDasharray="3 3" />
            <text x={Math.min(290, todayX + 4)} y="14" fontSize="10" className="fill-slate-500">
              today
            </text>
          </>
        )}
        <path d={path} fill="none" className="stroke-blue-700 dark:stroke-blue-400" strokeWidth="2.5" strokeLinejoin="round" />
        <text x="0" y="126" fontSize="10" className="fill-slate-500 font-mono">
          {utcDate(s.start)}
        </text>
        <text x="320" y="126" fontSize="10" textAnchor="end" className="fill-slate-500 font-mono">
          {utcDate(end)}
        </text>
      </svg>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13.5px]">
        <dt className={muted}>Cliff ends</dt>
        <dd className="text-right font-mono">{s.cliffDuration > 0n ? utcDate(cliffEnd) : "no cliff"}</dd>
        {s.cliffDuration > 0n && (
          <>
            <dt className={muted}>Unlocks at cliff</dt>
            <dd className="break-all text-right font-mono">
              ≈{fmt(vestedAt(s, cliffEnd))} {symbol}
            </dd>
          </>
        )}
        <dt className={muted}>{s.cliffDuration > 0n ? "Then per day" : "Per day"}</dt>
        <dd className="break-all text-right font-mono">
          ≈{fmt((s.totalAmount * DAY_SECONDS) / s.duration)} {symbol}
        </dd>
        <dt className={muted}>Fully vested</dt>
        <dd className="text-right font-mono">{utcDate(end)}</dd>
        <dt className={muted}>Claimable right after creation</dt>
        <dd className="break-all text-right font-mono font-medium">
          {fmt(claimNow)} {symbol}
        </dd>
      </dl>
      <p className="rounded-lg bg-slate-100 px-3 py-2.5 text-[13px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {note} Projection uses chain time; the contract decides.
      </p>
    </section>
  );
}
