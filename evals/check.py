"""Fast grader controls; no model, Docker or Harbor installation required."""
import importlib.util
import json
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("world_grade", ROOT / "evals/graders/grade.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cases = json.loads((ROOT / "evals/tasks.json").read_text())["cases"]
assert len({c["id"] for c in cases}) == len(cases)
for case in cases:
    with tempfile.TemporaryDirectory(prefix="world-eval-control-") as tmp:
        artifacts = Path(tmp)
        artifacts.chmod(0o755)
        try:
            assert module.grade(case, artifacts) is False
        except (ValueError, FileNotFoundError, KeyError):
            pass
        if case["kind"] == "implementation":
            original = (ROOT / "web/src/terminalReconnectPolicy.ts").read_text()
            path = artifacts / "candidate.ts"
            path.write_text(original.replace("Math.min(", "Math.max(", 1))
            assert module.grade(case, artifacts) is False, case["id"] + " mutant accepted"
            path.write_text(original)
        elif case["kind"] == "knowledge":
            (artifacts / "knowledge.md").write_text(case["oracle"].replace("\\n", "\n"))
        else:
            answer = case.get("expected", {"findings": [
                {"path": "web/src/terminalReconnectPolicy.ts", "severity": "high",
                 "explanation": "The retry delay uses Math.max and exceeds the maximum cap."}
            ] if case.get("expectedFinding") else []})
            (artifacts / "answer.json").write_text(json.dumps(answer))
        assert module.grade(case, artifacts) is True, case["id"] + " oracle rejected"
        if case["kind"] != "implementation":
            for p in artifacts.iterdir():
                p.write_text("{}")
            try:
                assert module.grade(case, artifacts) is False, case["id"] + " invalid answer accepted"
            except KeyError:
                pass
        print(case["id"] + ": oracle passed; negative control rejected")
print("Grader controls passed. No model performance measured.")
