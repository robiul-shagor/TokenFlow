"use client";

import { useState, type ReactNode } from "react";
import { explorerLink } from "@/lib/chain";
import { useNetwork } from "./Providers";

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const TONES = {
  neutral: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`rounded-md px-3 py-2 text-sm ${TONES[tone]}`}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}

export function shorten(value: string, chars = 6): string {
  return value.length <= chars * 2 + 2 ? value : `${value.slice(0, chars + 2)}…${value.slice(-chars)}`;
}

/**
 * Shows a shortened hex value (address / tx hash) with a copy button. With `kind`, it links to the
 * network's block explorer when there is one (testnets); locally there is none.
 */
export function Hex({ value, chars = 6, kind }: { value: string; chars?: number; kind?: "tx" | "address" }) {
  const [copied, setCopied] = useState(false);
  const { explorerUrl } = useNetwork();
  const href = kind ? explorerLink(explorerUrl, kind, value) : null;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-xs" title={value}>
      {href ? (
        <a className="underline decoration-dotted underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">
          {shorten(value, chars)}
        </a>
      ) : (
        shorten(value, chars)
      )}
      <button
        type="button"
        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        aria-label={`Copy ${value}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}
