module browser_preparation {
  pure val BROKEN = false
  type Preparation = { epoch: int, captured: int, stage: str, issued: int, revision: int,
    published: int, status: str, catalogue: bool, live: List[bool], actionable: List[bool] }
  var preparation: Preparation
  var op: str
  var target: int
  action init = all {
    preparation' = { epoch: 0, captured: -1, stage: "idle", issued: 0, revision: 0,
      published: -1, status: "idle", catalogue: false, live: List(true, true), actionable: List(false, false) },
    op' = "init", target' = -1,
  }
  action change(replacement, name) = all { preparation' = replacement, op' = name, target' = -1 }
  action request = all {
    preparation.stage == "idle", preparation.issued < 3,
    change({ ...preparation, captured: preparation.epoch, stage: "request", issued: preparation.issued + 1,
      status: if (preparation.status == "idle") "loading" else preparation.status }, "request"),
  }
  action advance(from, towards, name) = all {
    preparation.stage == from,
    change({ ...preparation, stage: if (preparation.captured == preparation.epoch) towards else "idle" }, name),
  }
  action admit = all {
    preparation.stage == "admission",
    val current = preparation.captured == preparation.epoch or BROKEN
    change(if (current) { ...preparation, stage: "idle", catalogue: true, status: "ready",
      published: preparation.captured, revision: preparation.issued, actionable: preparation.live }
      else { ...preparation, stage: "idle" }, "admit"),
  }
  action failure = all {
    preparation.stage == "request",
    change(if (preparation.captured == preparation.epoch)
      { ...preparation, stage: "idle", status: "error", actionable: List(false, false) }
      else { ...preparation, stage: "idle" }, "failure"),
  }
  action disconnect = all {
    preparation.epoch < 3,
    change({ ...preparation, epoch: preparation.epoch + 1, status: "error", actionable: List(false, false) }, "disconnect"),
  }
  action retire(h) = all {
    preparation.live[h],
    preparation' = { ...preparation, live: preparation.live.replaceAt(h, false) },
    op' = "retire", target' = h,
  }
  action step = any {
    request, advance("request", "decode", "reply"), advance("decode", "object", "project"),
    advance("object", "admission", "prepareOffice"), admit, failure, disconnect,
    retire(0), retire(1),
  }
  val currentPublication = preparation.status != "ready" or preparation.published == preparation.epoch
  val admissionAuthority = op != "admit" or preparation.status != "ready" or preparation.actionable == preparation.live
  val safety = currentPublication and admissionAuthority
  val decodeInterrupted = op == "disconnect" and preparation.stage == "decode"
  val objectInterrupted = op == "disconnect" and preparation.stage == "object"
  val admissionInterrupted = op == "disconnect" and preparation.stage == "admission"
  val siblingSurvives = op == "admit" and preparation.status == "ready" and preparation.actionable == List(false, true)
  val requestFailure = op == "failure" and preparation.status == "error"
}
