module connection_registry {
  pure val BROKEN = false
  type Registry = { members: Set[str], defaultId: str }
  type Config = { kind: int, cliFirst: bool, early: bool, failFirst: bool, failSecond: bool }
  pure val initial: Registry = { members: Set("alpha", "beta"), defaultId: "alpha" }
  var registry: Registry
  var expected: Registry
  var snapshot: Registry
  var config: Config
  var phase: str
  var requested: bool
  pure def edit(r: Registry, cli: bool, kind: int): Registry =
    if (not(cli)) { ...r, members: r.members.union(Set("settings")) }
    else if (kind == 0) { ...r, members: r.members.union(Set("gamma")) }
    else if (kind == 1) { ...r, members: r.members.exclude(Set("beta")) }
    else { ...r, defaultId: "beta" }
  action init = all {
    registry' = initial, expected' = initial, snapshot' = initial,
    config' = { kind: 0, cliFirst: false, early: false, failFirst: false, failSecond: false },
    phase' = "init", requested' = false,
  }
  action choose = {
    nondet kind = 0.to(2).oneOf()
    nondet cliFirst = Set(false, true).oneOf()
    nondet early = Set(false, true).oneOf()
    nondet failFirst = Set(false, true).oneOf()
    nondet failSecond = Set(false, true).oneOf()
    all {
      Set("init", "done").contains(phase),
      config' = { kind: kind, cliFirst: cliFirst, early: early, failFirst: failFirst, failSecond: failSecond },
      registry' = initial, expected' = initial, snapshot' = initial,
      phase' = "first", requested' = false,
    }
  }
  action requestSecond = all {
    not(requested), if (config.early) phase == "first" else phase == "firstDone",
    requested' = true, snapshot' = registry,
    registry' = registry, expected' = expected, config' = config, phase' = phase,
  }
  action finishFirst = all {
    phase == "first", not(config.early) or requested,
    registry' = if (config.failFirst) registry else edit(registry, config.cliFirst, config.kind),
    expected' = if (config.failFirst) expected else edit(expected, config.cliFirst, config.kind),
    phase' = "firstDone", snapshot' = snapshot, requested' = requested, config' = config,
  }
  action finishSecond = all {
    phase == "firstDone", requested,
    registry' = if (config.failSecond) registry else edit(if (BROKEN) snapshot else registry, not(config.cliFirst), config.kind),
    expected' = if (config.failSecond) expected else edit(expected, not(config.cliFirst), config.kind),
    phase' = "retryFirst", snapshot' = snapshot, requested' = requested, config' = config,
  }
  action retryFirst = all {
    phase == "retryFirst",
    registry' = if (config.failFirst) edit(registry, config.cliFirst, config.kind) else registry,
    expected' = if (config.failFirst) edit(expected, config.cliFirst, config.kind) else expected,
    phase' = "retrySecond", snapshot' = snapshot, requested' = requested, config' = config,
  }
  action retrySecond = all {
    phase == "retrySecond",
    registry' = if (config.failSecond) edit(registry, not(config.cliFirst), config.kind) else registry,
    expected' = if (config.failSecond) edit(expected, not(config.cliFirst), config.kind) else expected,
    phase' = "done", snapshot' = snapshot, requested' = requested, config' = config,
  }
  action step = any { choose, requestSecond, finishFirst, finishSecond, retryFirst, retrySecond }
  val safety = registry == expected and registry.members.contains(registry.defaultId)
}
