import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children: ReactNode;
}

export function Panel({ as: Component = "div", className, children, ...props }: PanelProps) {
  return (
    <Component className={cn("editorial-panel", className)} {...props}>
      {children}
    </Component>
  );
}
