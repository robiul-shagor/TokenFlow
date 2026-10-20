"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/allocations/new", label: "Create allocation" },
  { href: "/me", label: "My allocations" },
  { href: "/reconcile", label: "Reconcile" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded px-2 py-1 ${active ? "bg-slate-200 font-medium dark:bg-slate-800" : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
