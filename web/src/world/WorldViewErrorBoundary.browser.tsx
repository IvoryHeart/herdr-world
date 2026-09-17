import { createRoot } from "react-dom/client";
import { WorldViewErrorBoundary } from "./WorldViewErrorBoundary";

function BrokenView(): never {
  throw new Error("synthetic presenter failure");
}

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(
  <div>
    <div data-testid="spaces-owner">Spaces remains mounted</div>
    <div data-testid="inspector-owner">Inspector remains mounted</div>
    <WorldViewErrorBoundary>
      <BrokenView />
    </WorldViewErrorBoundary>
  </div>,
);

setTimeout(() => {
  const result = {
    fallback: host.querySelector(".world-view-failure") !== null,
    spaces: host.querySelector('[data-testid="spaces-owner"]')?.textContent,
    inspector: host.querySelector('[data-testid="inspector-owner"]')
      ?.textContent,
  };
  void fetch("/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
}, 50);
