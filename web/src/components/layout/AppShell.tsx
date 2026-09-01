import type { ReactNode } from "react";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The frame every authenticated page renders inside: a skip link that is the
 * first focusable element and actually moves focus (not just scrolls) to
 * `#main`, one `PrimaryNav` landmark (a rail above 1024px, a bottom bar
 * below it — see PrimaryNav for why it is one element, not two), and the
 * `<main>` landmark itself.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
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
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end border-b border-rule px-4 py-2">
          <ThemeToggle />
        </header>
        {/* tabIndex={-1} makes the skip link's target programmatically
            focusable without adding it to the normal tab order. */}
        <main id="main" tabIndex={-1} className="flex-1 p-4 pb-20 outline-none lg:pb-4">
          {children}
        </main>
      </div>
    </div>
  );
}
