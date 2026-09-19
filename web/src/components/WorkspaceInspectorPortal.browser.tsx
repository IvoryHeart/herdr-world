import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceInspectorPortal } from "./WorkspaceInspectorPortal";

const source = document.createElement("div");
source.style.display = "none";
const target = document.createElement("div");
target.style.width = "480px";
target.style.height = "320px";
document.body.append(source, target);

let clicks = 0;

function Fixture() {
  const [label, setLabel] = useState("Files");
  return (
    <WorkspaceInspectorPortal target={target} dock="right" expanded={false}>
      <button
        type="button"
        onClick={() => {
          clicks += 1;
          setLabel("Changes");
        }}
      >
        {label}
      </button>
    </WorkspaceInspectorPortal>
  );
}

const root = createRoot(source);
root.render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);

setTimeout(() => {
  const button = target.querySelector<HTMLButtonElement>("button");
  button?.click();
  requestAnimationFrame(() => {
    const currentButton = target.querySelector<HTMLButtonElement>("button");
    const result = {
      outsideHiddenOwner:
        currentButton !== null &&
        !source.contains(currentButton) &&
        target.contains(currentButton),
      interactive: clicks === 1 && currentButton?.textContent === "Changes",
      portalClass:
        target.firstElementChild?.classList.contains(
          "world-inspector-stage",
        ) === true,
    };
    void fetch("/result", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
    });
  });
}, 50);
