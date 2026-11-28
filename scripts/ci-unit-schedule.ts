type UnitJob = Record<string, unknown> & {
  name?: string;
  strategy?: Record<string, unknown> & {
    matrix?: Record<string, unknown> & {
      shard?: number[];
      include?: Array<Record<string, unknown>>;
    };
  };
  steps?: Array<{ run?: string; [key: string]: unknown }>;
};

/** Unit execution inputs; appended static/web/reporting steps own no unit work. @internal */
export function unitSchedule(job: UnitJob) {
  const schedule = structuredClone(job);
  delete schedule.name;
  const matrix = schedule.strategy?.matrix;
  if (matrix && schedule.strategy) {
    const { shard, include, ...axes } = matrix;
    schedule.strategy.matrix = {
      ...axes,
      include: include
        ? include.map((row) => {
            const unit = { ...row };
            delete unit.group;
            delete unit.web;
            return unit;
          })
        : shard?.map((shard: number) => ({ shard })),
    };
  }
  const steps = schedule.steps as Array<{ run?: string }> | undefined;
  if (steps) {
    const last = steps.findLastIndex((step) =>
      /^bun scripts\/(?:ci-tests\.ts unit|ci-unit-comparison\.ts run) /.test(
        step.run || "",
      ),
    );
    if (last >= 0) schedule.steps = steps.slice(0, last + 1);
  }
  return JSON.stringify(schedule);
}

/** A failure watchdog owns no test selection, parallelism, command or arguments. @internal */
export function unitRunnerSchedule(source: string) {
  return source
    .replace(
      /^import \{ spawnTestBatch \} from "\.\/testing\/file-deadline";\r?\n/m,
      "",
    )
    .replace(/\bspawnTestBatch\(command, \{/g, "Bun.spawn(command, {");
}
