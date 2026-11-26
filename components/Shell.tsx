"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Library, LogOut, Settings, Sparkles } from "lucide-react";
import { ToastHost } from "@/components/ui";

const NAV = [["/brands", "Brands", Library], ["/create", "Create", Sparkles], ["/settings", "Settings", Settings]] as const;

export default function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const path = usePathname();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center gap-1 px-3 py-2.5 sm:px-4">
          <Link href="/brands" className="mr-3 flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-white"><Sparkles size={15} /></span>
            <span className="hidden sm:inline">Carousel Studio</span>
          </Link>
          <nav className="flex gap-0.5" aria-label="Main">
            {NAV.map(([href, label, Icon]) => {
              const on = path.startsWith(href) || (href === "/brands" && path.startsWith("/carousel"));
              return <Link key={href} href={href} aria-current={on ? "page" : undefined} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${on ? "bg-white shadow-sm ring-1 ring-[var(--line)]" : "text-neutral-600 hover:bg-white/70"}`}><Icon size={15} /><span className={on ? "" : "hidden sm:inline"}>{label}</span></Link>;
            })}
          </nav>
          <button className="ml-auto flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-600 hover:bg-white/70" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; }}><LogOut size={15} /><span className="hidden sm:inline">Log out</span></button>
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? "max-w-[1500px]" : "max-w-6xl"}`}>{children}</main>
      <ToastHost />
    </div>
  );
}
