"""Skillgrade JSON bridge to the existing behavioral grader. No model judge."""
import importlib.util
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "graders" / "grade.py"
spec = importlib.util.spec_from_file_location("world_grade", path)
grader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grader)
try:
    passed = grader.grade({"kind": "implementation"}, Path.cwd())
except Exception:
    passed = False
print(json.dumps({"score": int(passed), "details": "Reconnect delay, immediate retry and foreground behavior",
                  "checks": [{"name": "reconnect-behavior", "passed": passed}]}))
