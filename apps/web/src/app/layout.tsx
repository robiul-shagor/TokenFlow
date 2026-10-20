import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { ConfiguredApp } from "@/components/ConfiguredApp";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TokenFlow — local token allocation ops",
  description: "Local-only portfolio prototype: token vesting, event indexing and allocation reconciliation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <div className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950">
          LOCAL DEVELOPMENT ONLY · Anvil chain 31337 · test tokens have no monetary value · not audited
        </div>
        <Suspense fallback={<p className="flex-1 p-8 text-sm text-slate-500">Loading local configuration…</p>}>
          <ConfiguredApp>{children}</ConfiguredApp>
        </Suspense>
        <footer className="px-4 py-4 text-center text-xs text-slate-500">
          Portfolio prototype. On-chain state is authoritative; database tables are an indexed read model.
        </footer>
      </body>
    </html>
  );
}
