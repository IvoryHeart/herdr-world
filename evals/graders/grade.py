"""Held-out grading. Runs as root in Harbor's separate, networkless verifier."""
import json
import os
from pathlib import Path
import subprocess
import sys


def grade(case, artifacts):
    def read(name):
        path = artifacts / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 1_000_000:
            raise ValueError("Missing, unsafe, or oversized candidate artifact")
        return path.read_text()

    kind = case["kind"]
    if kind == "json":
        answer = json.loads(read("answer.json"))
        return all(type(answer.get(k)) is type(v) and answer[k] == v for k, v in case["expected"].items())
    if kind == "review":
        findings = json.loads(read("answer.json"))["findings"]
        if not case["expectedFinding"]:
            return findings == []
        return isinstance(findings, list) and any(
            f.get("path") == "web/src/terminalReconnectPolicy.ts"
            and f.get("severity") in ("high", "medium", "P1", "P2")
            and "delay" in f.get("explanation", "").lower()
            and any(w in f.get("explanation", "").lower() for w in ("cap", "maximum", "5000", "max"))
            for f in findings if isinstance(f, dict)
        )
    if kind == "knowledge":
        text = read("knowledge.md").lower()
        # The task asks to correct authentication and preserve ownership. Session
        # implementation details are valid extra context, not a required answer.
        return all(term in text for term in ("optional", "password", "authenticat", "herdr owns runtime topology")) and "cannot authenticate" not in text
    if kind == "feature":
        read("candidate.ts")
        inputs = [dict(connected=c, lastSeenMs=seen, nowMs=100000)
                  for c in (False, True) for seen in (None, 0, 69999, 70000, 70001, 99999, 100001)]
        program = "import {deploymentHealthLabel} from './candidate.ts'; let text=''; for await(const chunk of process.stdin) text+=chunk; console.log(JSON.stringify(JSON.parse(text).map(deploymentHealthLabel)));"
        kwargs = {"user": 65534, "group": 65534, "extra_groups": []} if os.getuid() == 0 else {}
        result = subprocess.run(["node", "--experimental-strip-types", "--input-type=module", "-e", program],
                                cwd=artifacts, input=json.dumps(inputs), text=True, capture_output=True,
                                timeout=8, env={"PATH": os.environ["PATH"]}, **kwargs)
        if result.returncode != 0:
            return False
        expected = ["Connected" if x["connected"] else "Never connected" if x["lastSeenMs"] is None
                    else "Recently disconnected" if max(0, x["nowMs"] - x["lastSeenMs"]) < 30000
                    else "Offline" for x in inputs]
        return json.loads(result.stdout) == expected
    if kind == "implementation":
        read("candidate.ts")  # Validate the artifact before invoking any candidate code.
        inputs = [
            dict(attempt=a, mode=m, immediate=i, foregroundFastAttemptsRemaining=f)
            for a in (0, 1, 2, 4, 10, 30)
            for m in ("normal", "foreground")
            for i in (False, True) for f in (0, 1, 2)
        ]
        program = """
import {terminalReconnectPolicy} from './candidate.ts';
let text=''; for await(const chunk of process.stdin) text+=chunk;
console.log(JSON.stringify(JSON.parse(text).map(terminalReconnectPolicy)));
"""
        # Candidate code gets no grader privileges. The root parent owns the reward.
        kwargs = {"user": 65534, "group": 65534, "extra_groups": []} if os.getuid() == 0 else {}
        result = subprocess.run(
            ["node", "--experimental-strip-types", "--input-type=module", "-e", program],
            cwd=artifacts, input=json.dumps(inputs), text=True, capture_output=True,
            timeout=8, env={"PATH": os.environ["PATH"]}, **kwargs
        )
        if result.returncode != 0:
            return False
        actual = json.loads(result.stdout)
        expected = []
        for x in inputs:
            fast = x["mode"] == "foreground" and x["foregroundFastAttemptsRemaining"] > 0
            expected.append(dict(
                delayMs=0 if x["immediate"] else min(500 * 2 ** x["attempt"], 5000),
                connectTimeoutMs=1200 if fast else 3500,
                nextAttempt=x["attempt"] if x["immediate"] else x["attempt"] + 1,
                nextForegroundFastAttemptsRemaining=x["foregroundFastAttemptsRemaining"] - int(fast),
            ))
        return actual == expected
    raise ValueError("Unknown case kind")


if __name__ == "__main__":
    reward = 0
    try:
        reward = int(grade(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2])))
    except Exception as error:
        print(type(error).__name__ + ": " + str(error))
    target = Path("/logs/verifier/reward.txt")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(str(reward))
    print("reward=" + str(reward))
