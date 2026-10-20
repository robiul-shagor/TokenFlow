"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ReconciliationResult } from "@/components/ReconciliationResult";
import { Notice } from "@/components/ui";
import type { SerializedReport } from "@/server/reports";

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useQuery({
    queryKey: ["report", id],
    queryFn: async () => {
      const res = await fetch(`/api/reconciliation/${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load report");
      return body as SerializedReport;
    },
  });

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-slate-600 dark:text-slate-400">
        <Link className="underline" href="/reconcile">
          Reconcile
        </Link>{" "}
        / Report #{id}
      </nav>
      {isLoading && <p className="text-sm text-slate-500">Loading report…</p>}
      {error && <Notice tone="bad">{(error as Error).message}</Notice>}
      {data && <ReconciliationResult report={data} />}
    </>
  );
}
