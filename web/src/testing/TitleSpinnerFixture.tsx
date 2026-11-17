import { useState } from "react";
import { agentThreadTitle } from "../world/worldText";

/** Testing-only, synthetic title frames; no runtime or agent is contacted. */
export default function TitleSpinnerFixture() {
  const [frame, setFrame] = useState(0);
  const [review, setReview] = useState(false);
  const frames = ["⠋", "⠴", "✳", "✶", "◐", "◓"];
  const task = review ? "Review results" : "Running tests";
  const title = `π ${frames[frame % frames.length]} ${task} | demo`;
  return (
    <main style={{ padding: 32, maxWidth: 640, margin: "auto" }}>
      <h1>Title spinner preview</h1>
      <p>Synthetic harness title with a letter before its spinner.</p>
      <p>
        Terminal title: <code data-testid="raw-title">{title}</code>
      </p>
      <p>
        Displayed task:{" "}
        <strong data-testid="task-title">
          {agentThreadTitle(title, "claude")}
        </strong>
      </p>
      <button onClick={() => setFrame((value) => value + 1)}>
        Next spinner frame
      </button>{" "}
      <button onClick={() => setReview((value) => !value)}>Change task</button>
      <p>
        Turning the spinner keeps the displayed task unchanged. Changing the
        task updates it immediately. Reload to leave this preview.
      </p>
    </main>
  );
}
