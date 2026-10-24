#!/usr/bin/env python3
"""Deterministic owner brief: crew agents and their latest message, PRs, merges,
open questions and disk. No LLM. Prints Markdown to stdout.

Usage: brief.py --repo OWNER/NAME [--crew a,b,c] [--questions FILE] [--disk PATH]
"""
import argparse, datetime, glob, json, os, re, subprocess

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True, help="GitHub repository, OWNER/NAME")
ap.add_argument("--crew", default="", help="comma-separated agent names; default: every named agent")
ap.add_argument("--questions", help="Markdown table of owner questions: | Qn | question | ... | status |")
ap.add_argument("--disk", default=os.path.expanduser("~"), help="filesystem to report free space for")
args = ap.parse_args()


def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout


agents = {a["name"]: a for a in json.loads(sh("herdr", "agent", "list"))["result"]["agents"] if a.get("name")}
crew = [n for n in args.crew.split(",") if n] or sorted(agents)


def last_claude_text(sid):
    """Last assistant text and timestamp from a Claude Code transcript."""
    fs = glob.glob(os.path.expanduser(f"~/.claude/projects/*/{sid}.jsonl"))
    if not fs:
        return None, None
    last = ts = None
    with open(fs[0], errors="ignore") as f:
        for line in f:
            if '"assistant"' not in line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") != "assistant":
                continue
            for c in e.get("message", {}).get("content", []) or []:
                if isinstance(c, dict) and c.get("type") == "text" and c["text"].strip():
                    last, ts = c["text"].strip(), e.get("timestamp")
    return last, ts


# Terminal chrome to skip when falling back to the screen: rules, prompts, status bars.
CHROME = re.compile(r"───|auto mode|^[❯›>$]|for shortcuts|Context \d+%|\S+@\S+[:$]")


def short(t, n=220):
    t = re.sub(r"\s+", " ", re.sub(r"[#*`|]", "", t)).strip()
    return t[:n] + "…" if len(t) > n else t


print(f"# Brief — {datetime.date.today():%a %d %b %Y}\n")
print("## Crew\n\n| Agent | Status | Last said (time) |\n|---|---|---|")
for n in crew:
    a = agents.get(n)
    if not a:
        continue
    msg = ts = None
    s = a.get("agent_session") or {}
    if s.get("agent") == "claude":
        msg, ts = last_claude_text(s.get("value"))
    if not msg:
        lines = [l.strip() for l in sh("herdr", "agent", "read", n, "--lines", "30").splitlines()
                 if l.strip() and not CHROME.search(l)]
        msg = lines[-1] if lines else "(nothing on screen)"
    when = ts[11:16] + "Z" if ts else "screen"
    print(f"| {n} | {a['agent_status']} | {short(msg)} ({when}) |")

prs = json.loads(sh("gh", "pr", "list", "--repo", args.repo, "--state", "open", "--limit", "50",
                    "--json", "number,title,isDraft,mergeable,statusCheckRollup,reviews"))


def ci(p):
    s = [(c.get("conclusion") or c.get("state") or "") for c in p.get("statusCheckRollup") or []]
    if "FAILURE" in s:
        return "red"
    return "running" if any(x in ("", "PENDING", "IN_PROGRESS", "QUEUED") for x in s) else "green"


print("\n## Pull requests\n\n| PR | Title | Draft | Merge | CI | Reviews |\n|---|---|---|---|---|---|")
for p in sorted(prs, key=lambda p: p["number"]):
    print(f"| #{p['number']} | {p['title'][:60]} | {'draft' if p['isDraft'] else ''} "
          f"| {p['mergeable']} | {ci(p)} | {len(p['reviews'])} |")

merged = json.loads(sh("gh", "pr", "list", "--repo", args.repo, "--state", "merged", "--limit", "30",
                       "--json", "number,title,mergedAt"))
cut = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
print("\n## Merged in the last 24 h\n")
for p in merged:
    if p["mergedAt"] >= cut:
        print(f"- #{p['number']} {p['title']} ({p['mergedAt'][11:16]}Z)")

print("\n## Needs you\n")
if args.questions and os.path.exists(args.questions):
    for q, text, status in re.findall(r"^\| (Q\d+) \| (.+?) \| .+? \| (.+?) \|", open(args.questions).read(), re.M):
        if "answered" not in status.lower():
            print(f"- {q}: {short(text, 160)}")
blocked = [n for n in crew if agents.get(n, {}).get("agent_status") == "blocked"]
if blocked:
    print(f"- Agents blocked on a prompt: {', '.join(blocked)}")

du = sh("df", "-h", args.disk).splitlines()[-1].split()
print(f"\n## Machine\n\n- {args.disk}: {du[3]} free ({du[4]} used)")
