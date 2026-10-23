import { GROUP_LIMITS, groupText } from "./groups";
import type { GroupView } from "./groupViews";

export type PodMarkdownRow = {
  name: string;
  lead: string[];
  builders: string[];
  reviewers: string[];
  now: string[];
};
const encode = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "&#124;")
    .replaceAll("\n", "<br>");
const decode = (text: string) =>
  text
    .replaceAll("&#124;", "|")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
const plain = (text: string) =>
  decode(
    text
      .trim()
      .replace(/^\*\*(.*)\*\*$/, "$1")
      .replace(/^`(.*)`$/, "$1"),
  );
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replaceAll("\\|", "&#124;"));
const names = (text: string) =>
  text.trim() === "" || text.trim() === "—" || text.trim() === "-"
    ? []
    : text.split(/\s*(?:,|\s\+\s|<br\s*\/?>)\s*/i).map(plain);

/** A one-time, explicit Pod table reader; never watches or rewrites a file. */
export function parsePodMarkdown(markdown: string): PodMarkdownRow[] {
  if (markdown.length > 48_000)
    throw new Error(
      "Pod import is limited to 48000 characters; split the explicit migration",
    );
  const rows: PodMarkdownRow[] = [];
  const lines = markdown.split(/\r?\n/);
  let tables = 0;
  for (let index = 0; index + 1 < lines.length; index++) {
    if (!lines[index]!.trim().startsWith("|")) continue;
    const headers = cells(lines[index]!).map((cell) =>
      plain(cell).toLowerCase(),
    );
    if (
      !headers.includes("pod") ||
      !headers.includes("lead") ||
      !headers.includes("builders") ||
      !headers.includes("reviewers")
    )
      continue;
    if (!cells(lines[index + 1]!).every((cell) => /^:?-{3,}:?$/.test(cell)))
      throw new Error("Pod table needs a Markdown separator row");
    if (++tables !== 1)
      throw new Error("import exactly one Pod table at a time");
    const nowColumn = headers.findIndex(
      (header) => header === "now" || header.startsWith("now ("),
    );
    for (
      index += 2;
      index < lines.length && lines[index]!.trim().startsWith("|");
      index++
    ) {
      const values = cells(lines[index]!);
      if (values.length !== headers.length)
        throw new Error(
          "Pod table columns do not match; escape literal pipes as \\|",
        );
      const value = (header: string) => values[headers.indexOf(header)]!;
      const name = groupText(plain(value("pod")), "Pod name");
      if (rows.some((row) => row.name === name))
        throw new Error(`duplicate Pod ${name}`);
      const row: PodMarkdownRow = {
        name,
        lead: names(value("lead")),
        builders: names(value("builders")),
        reviewers: names(value("reviewers")),
        now:
          nowColumn < 0 || !values[nowColumn]
            ? []
            : values[nowColumn]!.split(/<br\s*\/?>/i).map(plain),
      };
      for (const role of [row.lead, row.builders, row.reviewers]) {
        if (
          role.length > GROUP_LIMITS.members ||
          role.some((name) => !name || name.length > GROUP_LIMITS.address)
        )
          throw new Error(`invalid or excessive role members in ${name}`);
      }
      if (row.now.length > GROUP_LIMITS.items)
        throw new Error(`too many Now items in ${name}`);
      row.now = row.now.map((item) =>
        groupText(item, "Now item", GROUP_LIMITS.text),
      );
      rows.push(row);
      if (rows.length > GROUP_LIMITS.podsPerConnection)
        throw new Error("import at most 32 Pods per migration");
    }
    index--;
  }
  if (tables !== 1 || rows.length === 0)
    throw new Error(
      "give one nonempty table with Pod, Lead, Builders and Reviewers columns",
    );
  return rows;
}

/** Human rendering of intent and observations, not a complete Board backup. */
export function renderGroupMarkdown(groups: readonly GroupView[]): string {
  const podsOnly = groups.every((group) => group.kind === "pod");
  const headers = podsOnly
    ? ["Pod", "Lead", "Builders", "Reviewers", "Open PRs", "Now"]
    : ["Kind", "Group", "Members", "Open PRs", "Now"];
  const table = [headers, headers.map(() => "---")];
  for (const group of groups) {
    const refs = (role: string) =>
      group.members
        .filter((member) => member.roles.includes(role))
        .map((member) =>
          typeof member.ref === "string" ? member.ref : member.label,
        )
        .join(", ");
    const work =
      group.workState === "unknown"
        ? "unknown"
        : `${group.openPullRequests.length}${group.openPrLimit === null ? "" : `/${group.openPrLimit}`}${group.workState === "stale" ? " (cached)" : ""}`;
    const values = podsOnly
      ? [group.name, refs("lead"), refs("builder"), refs("reviewer"), work]
      : [
          group.kind,
          group.name,
          group.members.map((member) => member.label).join(", "),
          work,
        ];
    table.push([...values.map(encode), group.now.map(encode).join("<br>")]);
  }
  return table.map((row) => `| ${row.join(" | ")} |`).join("\n");
}
