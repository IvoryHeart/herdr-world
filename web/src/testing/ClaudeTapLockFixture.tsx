import { useState } from "react";
import { claudeTapLockFixture } from "../../../shared/testing/claude-tap-lock-fixture";

/** Testing-only walkthrough; these histories are validated by the real tap tests. */
export default function ClaudeTapLockFixture() {
  const [scenario, setScenario] = useState<"live" | "dead" | null>(null);
  const result = scenario && claudeTapLockFixture[scenario];
  return (
    <main style={{ padding: 32, maxWidth: 640, margin: "auto" }}>
      <h1>Claude tap ownership preview</h1>
      <p>
        Synthetic walkthrough of the filesystem regression. Each reading uses
        the same reset time. No Claude account or running agent is needed.
      </p>
      <button onClick={() => setScenario("live")}>Suspend live writer</button>{" "}
      <button onClick={() => setScenario("dead")}>Recover dead writer</button>
      <p aria-live="polite">
        Committed usage:{" "}
        <strong>{result ? result.commits.join(" → ") : "20"}</strong>
      </p>
      {result && <p>{result.explanation}</p>}
      <p>
        The real tap regression checks both histories. Reload to leave this
        preview.
      </p>
    </main>
  );
}
