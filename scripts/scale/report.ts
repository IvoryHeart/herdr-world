import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { distribution } from "./support";

export function summarize(rows: any[]) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    if (!["browser", "town-interaction"].includes(row.kind) || row.warmup)
      continue;
    for (const phase of row.browser.phases) {
      const key = `${row.shape.id}/${row.kind === "town-interaction" ? "fit-pan/" : ""}${row.browser.view}/${row.browser.device.id}/${phase.name}`;
      const group = groups.get(key) ?? [];
      group.push({ ...phase, rendered: row.browser.rendered });
      groups.set(key, group);
    }
  }
  return {
    browsers: [...groups].map(([cell, samples]) => ({
      cell,
      elapsedMs: distribution(samples.map((s) => s.elapsedMs)),
      rendererTaskMs: distribution(samples.map((s) => s.rendererTaskMs)),
      commits: distribution(samples.map((s) => s.work.commits)),
      rafCallbacks: distribution(samples.map((s) => s.work.raf)),
      p95FrameIntervalMs: distribution(
        samples.map((s) => s.frameIntervalsMs.p95).filter((x) => x !== null),
      ),
      usedHeapBytes: distribution(samples.map((s) => s.heap.usedSize)),
      rendered: samples.map((s) => s.rendered),
      serviceTickDelta: distribution(
        samples.flatMap((s) =>
          s.serviceWork?.before && s.serviceWork?.after
            ? [s.serviceWork.after.ticks - s.serviceWork.before.ticks]
            : [],
        ),
      ),
      nativeListCalls: distribution(
        samples.flatMap((s) =>
          s.serviceWork
            ? [
                Object.entries(s.serviceWork.nativeMethods)
                  .filter(([m]) =>
                    [
                      "workspace.list",
                      "tab.list",
                      "pane.list",
                      "agent.list",
                    ].includes(m),
                  )
                  .reduce((sum, [, v]) => sum + (v as any).calls, 0),
              ]
            : [],
        ),
      ),
      errors: samples.flatMap((s) => s.errors),
    })),
    services: rows
      .filter((r) => r.kind === "service" && !r.warmup)
      .map((r) => ({
        shape: r.shape.id,
        round: r.round,
        metrics: r.metrics,
        restart: r.restart,
      })),
    observations: rows.filter((r) => r.kind === "observation"),
    nativeBoundaries: rows.filter((r) => r.kind === "native-boundary"),
    diagnostics: rows.filter((r) => r.kind === "diagnostic"),
    boardSizes: rows.filter((r) => r.kind === "board-size" && !r.warmup),
    interactions: rows.filter(
      (r) => r.kind === "town-interaction" && !r.warmup,
    ),
    interactionDiagnostics: rows.filter(
      (r) => r.kind === "town-interaction-diagnostic",
    ),
  };
}

if (import.meta.main) {
  const out = resolve(process.argv[2] ?? ".agents/scale/matrix");
  const result = summarize(
    JSON.parse(readFileSync(join(out, "results.json"), "utf8")),
  );
  const identity = JSON.parse(readFileSync(join(out, "identity.json"), "utf8"));
  writeFileSync(join(out, "summary.json"), JSON.stringify(result, null, 2));
  const fmt = (n: number | null) => (n === null ? "—" : n.toFixed(1));
  const lines = [
    "# Synthetic scale measured browser cells",
    "",
    "Values are medians of per-process phases. Warmups and diagnostics excluded.",
    "",
    "| Shape/view/device/phase | n | Elapsed ms [min–max] | Task ms | Commits | rAF callbacks | Per-run frame p95 ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const r of result.browsers)
    lines.push(
      `| ${r.cell} | ${r.elapsedMs.n} | ${fmt(r.elapsedMs.median)} [${fmt(r.elapsedMs.min)}–${fmt(r.elapsedMs.max)}] | ${fmt(r.rendererTaskMs.median)} | ${fmt(r.commits.median)} | ${fmt(r.rafCallbacks.median)} | ${fmt(r.p95FrameIntervalMs.median)} |`,
    );
  lines.push(
    "",
    "## Compiled service",
    "",
    "Medians of process samples; write entries are per-process nearest-rank p50. RPC includes transport/commit/reply.",
    "",
    "| Shape | n | Initial RPC ms | Invalidated RPC ms | Write p50 ms | RSS MiB |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const shape of [...new Set(result.services.map((r) => r.shape))]) {
    const a = result.services.filter((r) => r.shape === shape);
    const metric = (fn: (r: any) => number) => distribution(a.map(fn)).median;
    lines.push(
      `| ${shape} | ${a.length} | ${fmt(metric((r) => r.metrics.calls[0].ms))} | ${fmt(metric((r) => r.metrics.calls[3].ms))} | ${fmt(metric((r) => r.metrics.writeMs.median))} | ${fmt(metric((r) => r.metrics.rssMiB))} |`,
    );
  }
  lines.push(
    "",
    "## Direct observation and native admission",
    "",
    "One source-executed observation sample per phase, without service composition or persistence.",
    "",
    "| Shape | Initial ms | Cache ms | Invalidated ms | Initial stringify ms | JSON bytes |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const row of result.observations) {
    const p = row.result.phases;
    lines.push(
      `| ${row.shape.id} | ${fmt(p[0].generationMs)} | ${fmt(p[1].generationMs)} | ${fmt(p[2].generationMs)} | ${fmt(p[0].serializationMs)} | ${p[0].jsonBytes} |`,
    );
  }
  for (const row of result.nativeBoundaries)
    lines.push(
      "",
      `Native boundary: ${row.shape.id}, ${row.rawReplyBytes} reply bytes, ${row.limitBytes} limit; ${row.refusal}. ${row.browser}.`,
    );
  lines.push(
    "",
    "## Board save size",
    "",
    "Each process has ten dependent measured saves after one operation warmup. Seeds are separate. CPU is process-wide, coarse and includes helper/worker threads; the sum of per-save windows excludes intervening gets. Tail means pooled nearest-rank p95, not independent-process evidence.",
    "",
    "| Notes | Processes | Process p50 median [min–max] ms | Pooled p95 ms | Sum save CPU windows median ms | Seed median ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const noteCount of [
    ...new Set(result.boardSizes.map((r) => r.noteCount)),
  ]) {
    const a = result.boardSizes.filter((r) => r.noteCount === noteCount),
      p50 = distribution(a.map((r) => r.latencyMs.median));
    const writes = a.flatMap((r) => r.writes.filter((w: any) => !w.warmup));
    const cpu = identity.resourceUnits
      ? distribution(
          a.map(
            (r) =>
              (r.writes
                .filter((w: any) => !w.warmup)
                .reduce((n: number, w: any) => n + (w.cpuTicks ?? 0), 0) *
                1000) /
              identity.resourceUnits.ticksPerSecond,
          ),
        ).median
      : null;
    lines.push(
      `| ${noteCount} | ${a.length} | ${fmt(p50.median)} [${fmt(p50.min)}–${fmt(p50.max)}] | ${fmt(distribution(writes.map((w: any) => w.ms)).p95)} | ${fmt(cpu)} | ${fmt(distribution(a.map((r) => r.seedMs)).median)} |`,
    );
  }
  const refusals = result.boardSizes.filter((r) => r.refusal);
  if (refusals.length)
    lines.push(
      "",
      `The attempted ${refusals[0].refusal.attemptedNotes}-note state was refused in ${refusals.length} measured processes; exact committed state and restart contents were verified.`,
    );
  lines.push(
    "",
    "## Default viewport counts after burst",
    "",
    "Town columns count admitted DOM semantic targets, not GPU sprites or draw calls. Board columns distinguish topology from notes. Zero topology means no card-draw latency claim.",
    "",
    "| Cell | Town desks/agents (samples) | Board workspaces/tabs/notes (samples) |",
    "| --- | --- | --- |",
  );
  for (const r of result.browsers.filter((r) => r.cell.endsWith("/burst-100")))
    lines.push(
      `| ${r.cell.replace(/\/burst-100$/, " ")} | ${r.rendered.map((v: any) => `${v.townDesks}/${v.townAgents}`).join(", ")} | ${r.rendered.map((v: any) => `${v.boardWorkspaces}/${v.boardTabs}/${v.boardNotes}`).join(", ")} |`,
    );
  const owners = new Map<string, number>();
  for (const row of [...result.diagnostics, ...result.interactionDiagnostics])
    for (const p of row.browser.phases)
      for (const o of p.owners.selfOwners)
        if (!["(idle)", "(program)"].includes(o.owner))
          owners.set(o.owner, (owners.get(o.owner) ?? 0) + o.ms);
  lines.push(
    "",
    "## Sampled owner ranking",
    "",
    "Sum of retained top self samples across the fixed diagnostic matrix. Throttled elapsed weights are not process CPU, inclusive costs, or causal allocations. Unprofiled timing controls remain separate.",
    "",
    "| Owner | Sample-weight ms |",
    "| --- | ---: |",
  );
  for (const [owner, ms] of [...owners]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15))
    lines.push(`| ${owner} | ${fmt(ms)} |`);
  writeFileSync(join(out, "summary.md"), lines.join("\n") + "\n");
  console.log(
    `Wrote ${result.browsers.length} phase summaries; raw process samples retained.`,
  );
}
