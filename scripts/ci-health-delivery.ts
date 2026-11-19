import type { HealthData, Pull } from "./ci-health-github";

export function percentile(
  values: number[],
  fraction: number,
): number | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
    : undefined;
}
export const hours = (value: number | undefined) =>
  value === undefined ? "n/a" : `${(value / 3_600_000).toFixed(1)}h`;
export const distribution = (values: number[]) =>
  `${hours(percentile(values, 0.5))} / ${hours(percentile(values, 0.9))}`;
export const isFix = (pull: Pull) =>
  /^(?:fix(?:\([^)]*\))?[:\s]|revert\b)/i.test(pull.title) ||
  pull.labels.nodes.some(({ name }) =>
    /^(?:bug|fix|regression)$/i.test(name),
  ) ||
  /^(?:Regression-of|Affected-release):/im.test(pull.body);

/** Explicit incident attribution only: an ordinary bug fix does not establish
 * which earlier deployment failed. Unlinked fixes are visible missing data.
 */
export function deliveryLines(
  data: HealthData,
  since: Date,
  now: Date,
): string[] {
  const days = (+now - +since) / 86_400_000;
  const releases = data.releases.filter(
    (release) => Date.parse(release.publishedAt) >= +since,
  );
  const fixes = data.pulls.filter(isFix);
  const firstCommit = (pull: Pull) =>
    Date.parse(pull.commits.nodes[0]?.commit.committedDate ?? "");
  const published = (pull: Pull) =>
    data.releases.find(
      (release) =>
        pull.mergeCommit &&
        data.shipped.get(release.tagName)?.has(pull.mergeCommit.oid),
    );
  const mergeLead = data.pulls
    .map((pull) => Date.parse(pull.mergedAt) - firstCommit(pull))
    .filter((value) => value >= 0);
  const releaseLead = data.pulls.flatMap((pull) => {
    const release = published(pull);
    const value = release
      ? Date.parse(release.publishedAt) - firstCommit(pull)
      : NaN;
    return value >= 0 ? [value] : [];
  });
  const mergeFailures = new Set<number>();
  const releaseFailures = new Set<string>();
  const recoveries: number[] = [];
  const open: number[] = [];
  const incidents = new Map<string, { broken: number; repaired?: number }>();
  let unattributed = 0;
  for (const fix of fixes) {
    const prior = [...fix.body.matchAll(/^Regression-of:\s*#(\d+)\s*$/gim)].map(
      (match) => Number(match[1]),
    );
    const affected = [
      ...fix.body.matchAll(/^Affected-release:\s*(\S+)\s*$/gim),
    ].map((match) => match[1]!);
    let attributed = false;
    for (const number of prior)
      if (
        data.pulls.some(
          (pull) =>
            pull.number === number &&
            Date.parse(pull.mergedAt) < Date.parse(fix.mergedAt),
        )
      ) {
        mergeFailures.add(number);
        attributed = true;
      }
    for (const tag of affected) {
      const broken = data.releases.find((release) => release.tagName === tag);
      if (!broken || Date.parse(broken.publishedAt) > Date.parse(fix.mergedAt))
        continue;
      releaseFailures.add(tag);
      attributed = true;
      const repaired = published(fix);
      const prior = incidents.get(tag);
      const publishedAt = repaired
        ? Date.parse(repaired.publishedAt)
        : undefined;
      incidents.set(tag, {
        broken: Date.parse(broken.publishedAt),
        repaired:
          publishedAt === undefined
            ? prior?.repaired
            : Math.min(publishedAt, prior?.repaired ?? Infinity),
      });
    }
    if (!attributed) unattributed++;
  }
  for (const incident of incidents.values()) {
    if (incident.repaired !== undefined)
      recoveries.push(incident.repaired - incident.broken);
    else open.push(+now - incident.broken);
  }
  const latest = data.releases.at(-1);
  const unshippedFixes = fixes.filter(
    (fix) =>
      !published(fix) &&
      (!latest || Date.parse(fix.mergedAt) > Date.parse(latest.publishedAt)),
  );
  const mergeShare = data.pulls.length
    ? `${mergeFailures.size}/${data.pulls.length}`
    : "n/a";
  const releaseShare = releases.length
    ? `${releases.filter((release) => releaseFailures.has(release.tagName)).length}/${releases.length}`
    : "n/a";
  return [
    `Delivery: main ${data.pulls.length} merges (${(data.pulls.length / days).toFixed(1)}/day); stable releases ${releases.length} (${(releases.length / days).toFixed(2)}/day)`,
    `First commit → merge p50/p90 ${distribution(mergeLead)} (n=${mergeLead.length}); → release ${distribution(releaseLead)} (n=${releaseLead.length})`,
    `PR opened → merge p50/p90 ${distribution(data.pulls.map((pull) => Date.parse(pull.mergedAt) - Date.parse(pull.createdAt)))}`,
    `Follow-up failure share: merges ${mergeShare}; releases ${releaseShare} explicitly linked; ${unattributed} fixes unattributed (rates incomplete)`,
    `Recovery release → published fix p50/p90 ${distribution(recoveries)} (n=${recoveries.length}); linked unreleased ${open.length}, oldest ${hours(percentile(open, 1))}`,
    `Fix mix ${fixes.length}/${data.pulls.length} merges; merged fixes awaiting release ${unshippedFixes.length}${latest ? `; latest ${latest.tagName}, age ${hours(+now - Date.parse(latest.publishedAt))}` : ""}`,
  ];
}
