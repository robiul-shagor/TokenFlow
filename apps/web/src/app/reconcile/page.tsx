"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConnection, useSignMessage } from "wagmi";
import { useAppConfig } from "@/components/Providers";
import { Badge, Card, EmptyState, Notice } from "@/components/ui";
import { CSV_COLUMNS, MAX_CSV_BYTES } from "@/lib/csv";
import { classifyTxError } from "@/lib/txState";
import { buildReportAuthMessage, sha256Hex, type ReportAuth } from "@/lib/reportAuth";
import { useMounted } from "@/hooks/useMounted";

interface ValidationResult {
  fileErrors: string[];
  totalDataRows: number;
  validRows: number;
  issues: { rowNumber: number; kind: string; allocationId: string | null; message: string }[];
}

export default function ReconcilePage() {
  const { chainId, registry, reportSignatureRequired } = useAppConfig();
  const { address, status } = useConnection();
  const signMessage = useSignMessage();
  const mounted = useMounted();
  const canSign = mounted && status === "connected" && !!address;
  const router = useRouter();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState<"validating" | "signing" | "running" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: async () => {
      const res = await fetch("/api/reconciliation?limit=10");
      if (!res.ok) throw new Error("Could not load reports");
      return (await res.json()) as {
        reports: { id: number; sourceFilename: string | null; indexedBlockNumber: string; stale: boolean; summaryJson: Record<string, number>; createdAt: string }[];
      };
    },
  });

  async function onFile(f: File | undefined) {
    setValidation(null);
    setError(null);
    setFile(null);
    if (!f) return;
    if (f.size > MAX_CSV_BYTES) {
      setError(`File is larger than ${MAX_CSV_BYTES} bytes`);
      return;
    }
    const text = await f.text();
    setFile({ name: f.name, text });
    setBusy("validating");
    try {
      const res = await fetch("/api/reconciliation/validate", { method: "POST", headers: { "content-type": "text/csv" }, body: text });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Validation failed");
      setValidation(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!file) return;
    setError(null);
    try {
      // Public networks: prove the caller holds SCHEDULE_MANAGER_ROLE by signing the file's hash.
      let auth: ReportAuth | undefined;
      if (reportSignatureRequired) {
        if (!address) throw new Error("Connect a schedule manager wallet to save reports");
        setBusy("signing");
        const issuedAt = new Date().toISOString();
        const message = buildReportAuthMessage({ chainId, registry, csvSha256: await sha256Hex(file.text), issuedAt });
        try {
          auth = { address, issuedAt, signature: await signMessage.mutateAsync({ message }) };
        } catch (err) {
          const c = classifyTxError(err);
          throw new Error(c.kind === "rejected" ? "Signature request was rejected; nothing was saved." : c.message);
        }
      }
      setBusy("running");
      const res = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv: file.text, filename: file.name, chainId, contractAddress: registry, auth }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error([body.error, ...(body.details?.fileErrors ?? [])].join(": "));
      router.push(`/reconcile/${body.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Allocation reconciliation</h1>
      <p className="text-sm text-slate-500">
        Compare a CSV of expected allocations with the indexed on-chain schedules. Matching key: <code>allocation_id</code>.
        Amounts are human-readable decimals, converted exactly to raw units with the token&apos;s decimals.
      </p>

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <Card title="1. Upload CSV">
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="block text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 dark:file:bg-slate-800"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <p className="mt-2 text-xs text-slate-500">Required columns: {CSV_COLUMNS.join(", ")}</p>

          {busy === "validating" && <p className="mt-3 text-sm text-slate-500">Validating…</p>}
          {error && (
            <div className="mt-3">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}
          {validation && (
            <div className="mt-4 space-y-3">
              {validation.fileErrors.length > 0 ? (
                <Notice tone="bad" title="The file cannot be reconciled">
                  <ul className="list-disc pl-5">
                    {validation.fileErrors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                </Notice>
              ) : (
                <>
                  <Notice tone={validation.issues.length ? "warn" : "good"} title="2. Validation">
                    {validation.validRows} of {validation.totalDataRows} rows are valid.
                    {validation.issues.length > 0 && " Invalid and duplicate rows will be listed in the report, not silently dropped."}
                  </Notice>
                  {validation.issues.length > 0 && (
                    <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                      {validation.issues.map((i) => (
                        <li key={`${i.rowNumber}-${i.kind}`}>
                          <Badge tone={i.kind === "duplicate" ? "warn" : "bad"}>line {i.rowNumber}</Badge> {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {reportSignatureRequired && (
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Saving a report on this network needs a signature from an account with SCHEDULE_MANAGER_ROLE.
                      Signing is free and sends no transaction.
                    </p>
                  )}
                  <button
                    className="btn-primary"
                    onClick={run}
                    disabled={busy !== null || (reportSignatureRequired && !canSign)}
                  >
                    {busy === "signing"
                      ? "Confirm the signature in your wallet…"
                      : busy === "running"
                        ? "Reconciling…"
                        : reportSignatureRequired
                          ? canSign
                            ? "3. Sign and run reconciliation"
                            : "Connect a wallet to run reconciliation"
                          : "3. Run reconciliation"}
                  </button>
                </>
              )}
            </div>
          )}
        </Card>

        <Card title="Sample files">
          <ul className="space-y-2 text-sm">
            <li>
              <a className="underline" download href="/api/reconciliation/sample?variant=example">allocations.example.csv</a>
              <p className="text-xs text-slate-500">Matches the local seeded demo schedules.</p>
            </li>
            <li>
              <a className="underline" download href="/api/reconciliation/sample?variant=issues">allocations.with-issues.csv</a>
              <p className="text-xs text-slate-500">Shows mismatches, missing rows, duplicates and invalid data.</p>
            </li>
          </ul>
        </Card>
      </div>

      <Card title="Recent reports">
        {reports.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : !reports.data || reports.data.reports.length === 0 ? (
          <EmptyState>No reports yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-800">
            {reports.data.reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link className="underline" href={`/reconcile/${r.id}`}>
                  #{r.id} {r.sourceFilename ?? "untitled"}
                </Link>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {r.summaryJson.matched}/{r.summaryJson.totalRows} matched · block {r.indexedBlockNumber}
                  {r.stale && <Badge tone="warn">stale</Badge>} · {new Date(r.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
