import type { ReactNode } from "react";

export function SectionHeading({
  id,
  eyebrow,
  title,
  description,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div id={id} className="section-heading scroll-mt-24">
      {eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}
      <h2
        id={`${id}-heading`}
        className="font-display text-2xl font-semibold tracking-tight text-ink"
      >
        {title}
      </h2>
      {description ? <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p> : null}
    </div>
  );
}
