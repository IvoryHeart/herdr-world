module browser_refresh {
  pure val BROKEN = false
  var s: { epoch: int, pending: int, queued: bool, admitted: int,
    issued: int, revision: int, status: str }
  var op: str
  var lateSeen: bool
  var coalescedSeen: bool
  action init = all {
    s' = { epoch: 0, pending: -1, queued: false, admitted: -1,
      issued: 0, revision: 0, status: "idle" },
    op' = "init", lateSeen' = false, coalescedSeen' = false,
  }
  action refresh = all {
    s.issued < 6,
    s' = if (s.pending >= 0) { ...s, queued: true }
      else { ...s, pending: s.epoch, issued: s.issued + 1,
        status: if (s.status == "idle") "loading" else s.status },
    op' = "refresh", lateSeen' = lateSeen, coalescedSeen' = coalescedSeen,
  }
  action disconnect = all {
    s.epoch < 3,
    s' = { ...s, epoch: s.epoch + 1, queued: false, status: "error" },
    op' = "disconnect", lateSeen' = lateSeen, coalescedSeen' = coalescedSeen,
  }
  action complete = all {
    s.pending >= 0, not(s.queued) or s.issued < 6,
    val admit = s.pending == s.epoch or BROKEN
    s' = { ...s,
      pending: if (s.queued) s.epoch else -1,
      queued: false, issued: s.issued + (if (s.queued) 1 else 0),
      admitted: if (admit) s.pending else s.admitted,
      revision: if (admit) s.issued else s.revision,
      status: if (admit) "ready" else s.status },
    op' = "complete",
    lateSeen' = (lateSeen or s.pending != s.epoch),
    coalescedSeen' = (coalescedSeen or s.queued),
  }
  action step = any { refresh, disconnect, complete }
  val currentAdmission = s.status != "ready" or s.admitted == s.epoch
  val queueHasOwner = not(s.queued) or s.pending >= 0
  val safety = currentAdmission and queueHasOwner
  val lateReply = lateSeen
  val coalescedFollowup = coalescedSeen
  val restored = lateSeen and s.status == "ready"
}
