import { Command, LayoutDashboard, Link2, Plus, Settings, Tags } from "lucide-react";
import type { ComponentType } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { BrandMark } from "./BrandMark";

export const SECTIONS = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/links", label: "Links", icon: Link2 },
  { to: "/tags", label: "Tags", icon: Tags },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

type IconComponent = ComponentType<{ className?: string }>;

function NavItem({ to, label, Icon }: { to: string; label: string; Icon: IconComponent }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        `group flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition-all hover:bg-white/6 hover:text-rail-ink lg:w-full lg:flex-none lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm ${
          isActive
            ? "bg-accent text-accent-ink shadow-[0_8px_24px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
            : "text-rail-muted"
        }`
      }
    >
      <Icon className="size-5 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

/** One navigation landmark, visually a rail on desktop and a bottom bar on
 * mobile. The brand and creation action stay inside this one landmark but
 * move to the mobile utility row with fixed positioning, avoiding duplicate
 * controls in the accessibility tree. */
export function PrimaryNav() {
  const { pathname } = useLocation();

  return (
    <nav
      aria-label="Primary"
      className="
        fixed inset-x-0 bottom-0 z-30 flex h-17 items-stretch justify-around
        border-t border-white/10 bg-rail/96 px-2 pb-[env(safe-area-inset-bottom)]
        lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:flex-col lg:justify-start lg:gap-1
        lg:border-t-0 lg:border-r lg:border-white/8 lg:px-4 lg:py-5 lg:backdrop-blur-xl
      "
    >
      <div className="fixed top-3 left-4 z-30 text-rail-ink lg:static lg:mb-7 lg:px-2">
        <span className="lg:hidden">
          <BrandMark compact />
        </span>
        <span className="hidden lg:inline-flex">
          <BrandMark />
        </span>
      </div>

      {SECTIONS.map((section) => (
        <NavItem key={section.to} to={section.to} label={section.label} Icon={section.icon} />
      ))}

      {pathname !== "/links" ? (
        <Link
          to="/links?new=1"
          className="fixed top-3 right-15 z-30 inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-ink shadow-[0_8px_24px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-transform hover:-translate-y-0.5 lg:static lg:mt-6 lg:w-full lg:justify-center lg:px-4"
        >
          <Plus className="size-4" aria-hidden="true" />
          New link
        </Link>
      ) : null}

      <div className="mt-auto hidden flex-col gap-3 pt-8 lg:flex">
        <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/4 px-3 py-2.5 text-xs text-rail-muted">
          <span className="flex items-center gap-2">
            <Command className="size-4" aria-hidden="true" />
            Command menu
          </span>
          <kbd className="rounded-md border border-white/12 bg-black/20 px-1.5 py-0.5 font-sans text-[10px] text-rail-ink">
            ⌘K
          </kbd>
        </div>
        <p className="px-2 text-[11px] leading-relaxed text-rail-muted">
          Private analytics. No IP addresses. No third-party scripts.
        </p>
      </div>
    </nav>
  );
}
