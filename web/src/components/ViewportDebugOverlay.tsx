import { useEffect, useState } from "react";

export default function ViewportDebugOverlay() {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;left:0;top:0;width:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const update = () => {
      const viewport = window.visualViewport;
      const styles = getComputedStyle(document.documentElement);
      setLines([
        `mode ${window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser"}`,
        `inner ${window.innerHeight} outer ${window.outerHeight}`,
        `vv ${viewport ? `${Math.round(viewport.height)} @${Math.round(viewport.offsetTop)}` : "n/a"}`,
        `appH ${styles.getPropertyValue("--app-height") || "-"}`,
        `kbd ${styles.getPropertyValue("--keyboard-inset-bottom") || "-"}`,
        `lift ${styles.getPropertyValue("--keyboard-inset-content") || "-"}`,
        `safe-bottom ${probe.offsetHeight}`,
      ]);
    };
    update();
    const timer = window.setInterval(update, 400);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.clearInterval(timer);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      probe.remove();
    };
  }, []);
  return (
    <pre className="viewport-debug-overlay" aria-hidden="true">
      {lines.join("\n")}
    </pre>
  );
}
