import type { ReactNode } from "react";
import { CommandPalette } from "../links/CommandPalette";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";

/** The shared authenticated frame: one primary navigation landmark, a skip
 * link, one main landmark, and the command palette mounted exactly once. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <CommandPalette />
      <a
        href="#main"
        className="
          sr-only focus:not-sr-only
          focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded
          focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-ink
        "
      >
        Skip to main content
      </a>
      <PrimaryNav />
      <div className="app-workspace flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-end border-b border-rule bg-surface/82 px-4 backdrop-blur-xl lg:px-8">
          <ThemeToggle />
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[100rem] flex-1 px-4 pt-8 pb-28 outline-none sm:px-6 lg:px-8 lg:pt-10 lg:pb-16 xl:px-12"
        >
          <div className="page-enter">{children}</div>
        </main>
      </div>
    </div>
  );
}
