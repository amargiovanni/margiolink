import { LayoutDashboard, Link2, Settings, Tags } from "lucide-react";
import type { ComponentType } from "react";
import { NavLink } from "react-router";

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
        `flex flex-col items-center gap-1 rounded px-2 py-1 text-xs text-ink-muted lg:flex-row lg:gap-3 lg:px-3 lg:py-2 lg:text-sm ${
          isActive ? "text-accent" : ""
        }`
      }
    >
      <Icon className="size-5 shrink-0" />
      <span>{label}</span>
    </NavLink>
  );
}

/** One nav element, positioned by CSS as a rail on the left above 1024px and
 *  a bottom bar below it. Two `<nav>`s — one hidden by a media query — would
 *  offer a screen-reader user the same navigation twice, since assistive
 *  technology does not evaluate media queries. `NavLink` stamps
 *  `aria-current="page"` on the active item itself, so the current section is
 *  never carried by colour alone. */
export function PrimaryNav() {
  return (
    <nav
      aria-label="Primary"
      className="
        fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-rule
        bg-surface-raised px-2 py-1
        lg:static lg:h-full lg:w-56 lg:flex-col lg:justify-start lg:gap-1
        lg:border-t-0 lg:border-r lg:px-3 lg:py-4
      "
    >
      {SECTIONS.map((section) => (
        <NavItem key={section.to} to={section.to} label={section.label} Icon={section.icon} />
      ))}
    </nav>
  );
}
