/** CSS zoom can make fixed-position CSS pixels differ from DOMRect pixels. */
export function measuredFixedPositionScale(): number {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:100px;left:0;width:1px;height:1px;pointer-events:none;visibility:hidden";
  document.body.append(probe);
  const ratio = probe.getBoundingClientRect().top / 100;
  probe.remove();
  return ratio > 0 ? ratio : 1;
}
