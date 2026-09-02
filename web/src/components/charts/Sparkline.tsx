import { scaleLinear } from "d3-scale";
import { line as d3Line } from "d3-shape";

/** The one chart form spec §6.4 exempts from a hover layer: no axes, no
 *  labels, no tooltip — it exists only to show shape beside a number. */
export function Sparkline({
  values,
  label,
  width = 96,
  height = 28,
  color = "var(--color-series-1)",
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length === 0) {
    return <svg role="img" aria-label={label} width={width} height={height} />;
  }

  const max = Math.max(...values, 1);
  const x = scaleLinear()
    .domain([0, Math.max(values.length - 1, 1)])
    .range([1, width - 1]);
  // 2px of headroom top and bottom keeps the 2px stroke from clipping.
  const y = scaleLinear()
    .domain([0, max])
    .range([height - 2, 2]);

  const path = d3Line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))(values);

  const lastValue = values.at(-1) ?? 0;

  return (
    <svg role="img" aria-label={label} width={width} height={height} className="overflow-visible">
      <path
        data-line
        d={path ?? undefined}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The end dot answers "where does it stand now?" without a label. */}
      <circle cx={x(values.length - 1)} cy={y(lastValue)} r={2.5} fill={color} />
    </svg>
  );
}
