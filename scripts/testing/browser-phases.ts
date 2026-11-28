export type BrowserPhases = Record<string, number | string | undefined> & {
  url: string;
};

/** One summary covers every context, including cases without fixture phase marks. */
export function browserPhasesTable(rows: BrowserPhases[]) {
  if (!rows.length) return "";
  const columns = [
    "launchMs",
    "queueMs",
    "contextMs",
    "pageLoadMs",
    "firstFrameMs",
    "waitMs",
    "assertionsMs",
    "teardownMs",
    "totalMs",
  ];
  const cell = (value: string) =>
    value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    "### Browser context phases (seconds)",
    "",
    `| Case | ${columns.map((key) => key.replace(/Ms$/, "")).join(" | ")} |`,
    `| --- | ${columns.map(() => "---:").join(" | ")} |`,
    ...[...rows]
      .sort((a, b) => Number(b.totalMs) - Number(a.totalMs))
      .map((row) => {
        const url = new URL(row.url);
        return `| ${cell(url.pathname + url.search)} | ${columns.map((key) => (row[key] === undefined ? "" : (Number(row[key]) / 1000).toFixed(3))).join(" | ")} |`;
      }),
    "",
  ].join("\n");
}
