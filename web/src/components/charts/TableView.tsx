export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export function TableView({ columns, rows, caption }: TableData & { caption: string }) {
  return (
    <section
      aria-label={`${caption} data table`}
      // A named, overflowed table needs its own focus stop for keyboard scrolling.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WCAG 2.1.1 requires focus on scroll containers
      tabIndex={0}
      className="max-h-80 overflow-auto overscroll-contain"
    >
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface-raised">
          <tr>
            {columns.map((column, i) => (
              <th
                key={column}
                scope="col"
                className={`border-b border-rule py-2 font-medium text-ink-muted ${
                  i === 0 ? "text-left" : "text-right"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Keyed by the full row content rather than just the first cell:
            // two rows can legitimately share a leading label (e.g. the same
            // weekday appearing once per hour in an hour-by-weekday table), and
            // a first-cell-only key would collide and warn React about
            // duplicate keys even though the rows are genuinely different.
            // JSON.stringify keeps cell boundaries unambiguous -- ["a", "bc"]
            // and ["ab", "c"] produce different strings, which a plain
            // separator-joined string could conflate.
            const rowKey = JSON.stringify(row);
            return (
              <tr key={rowKey} className="border-b border-rule/50 last:border-0">
                {row.map((cell, i) => (
                  <td
                    key={`${rowKey}-${columns[i] ?? i}`}
                    className={i === 0 ? "py-2 text-left" : "py-2 text-right tabular"}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
