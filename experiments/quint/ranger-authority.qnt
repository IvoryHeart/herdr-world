module ranger_authority {
  pure val BROKEN = false
  type Authority = { phase: str, permission: bool, taskActive: bool, serviceActive: bool, runtimeCurrent: bool, workspaceCurrent: bool, writes: int, result: str }
  var authority: Authority
  var op: str
  action init = all { authority' = { phase: "idle", permission: true, taskActive: true, serviceActive: true, runtimeCurrent: true, workspaceCurrent: true, writes: 0, result: "none" }, op' = "init" }
  pure def allowed(s) = s.permission and s.taskActive and s.serviceActive and s.runtimeCurrent and s.workspaceCurrent
  action change(replacement, name) = all { authority' = replacement, op' = name }
  action prepare = all { authority.phase == "idle", change({ ...authority, phase: "prepared" }, "prepare") }
  action execute = all { authority.phase == "prepared", change({ ...authority, phase: if (authority.runtimeCurrent and authority.workspaceCurrent) "checking" else "done", result: if (authority.runtimeCurrent and authority.workspaceCurrent) "none" else "failed" }, "execute") }
  action checked = all { authority.phase == "checking", change({ ...authority, phase: if (allowed(authority) or BROKEN) "dispatch" else "done", result: if (allowed(authority) or BROKEN) "none" else "failed" }, "checked") }
  action release = all { authority.phase == "dispatch", change({ ...authority, phase: "done", writes: if (allowed(authority) or BROKEN) 1 else 0, result: if (allowed(authority) or BROKEN) "succeeded" else "failed" }, "release") }
  action duplicate = all { Set("checking", "dispatch", "done").contains(authority.phase), change(authority, "duplicate") }
  action revoke = all { authority.permission, not(Set("idle", "done").contains(authority.phase)), change({ ...authority, permission: false }, "revoke") }
  action stopTask = all { authority.taskActive, not(Set("idle", "done").contains(authority.phase)), change({ ...authority, taskActive: false }, "stopTask") }
  action dispose = all { authority.serviceActive, not(Set("idle", "done").contains(authority.phase)), change({ ...authority, serviceActive: false }, "dispose") }
  action retire = all { authority.runtimeCurrent, not(Set("idle", "done").contains(authority.phase)), change({ ...authority, runtimeCurrent: false }, "retire") }
  action replaceWorkspace = all { authority.workspaceCurrent, authority.phase == "prepared", change({ ...authority, workspaceCurrent: false }, "replaceWorkspace") }
  action mutateInput = all { authority.phase != "idle", change(authority, "mutateInput") }
  action step = any { prepare, execute, execute, checked, checked, release, release, duplicate, revoke, stopTask, dispose, retire, replaceWorkspace, mutateInput }
  val writesNeedAuthority = authority.writes == 0 or allowed(authority)
  val noRetry = authority.writes <= 1
  val safety = writesNeedAuthority and noRetry
  val permissionBlocked = authority.phase == "done" and not(authority.permission) and authority.writes == 0
  val taskBlocked = authority.phase == "done" and not(authority.taskActive) and authority.writes == 0
  val serviceBlocked = authority.phase == "done" and not(authority.serviceActive) and authority.writes == 0
  val runtimeBlocked = authority.phase == "done" and not(authority.runtimeCurrent) and authority.writes == 0
  val workspaceBlocked = authority.phase == "done" and not(authority.workspaceCurrent) and authority.writes == 0
  val authorizedWrite = authority.writes == 1
  val duplicateExecution = op == "duplicate"
}
