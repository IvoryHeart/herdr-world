/** Keep a managed Inspector's name readable as its inline controls change. */
export function observeInspectorHeaderLayout(
  head: HTMLElement,
  onNeedsChange: (width: number) => void,
): () => void {
  // Inspector controls use border-box sizing. Computed widths retain fractions
  // in CSS pixels, independent of interface zoom and window transforms.
  const width = (element: Element) => {
    const style = getComputedStyle(element);
    return style.display === "none" ? 0 : parseFloat(style.width);
  };
  const measure = () => {
    const identity = head.querySelector(
      ".workspace-inspector-agent-identity, .workspace-inspector-identity",
    );
    if (!identity) return;
    const style = getComputedStyle(head);
    const shown = [...head.children].filter((child) => width(child) > 0);
    // Labels show from 640px. Leave them out of the narrow layout's need,
    // otherwise a window that narrows retains its wide-layout threshold.
    const labels = [
      ...head.querySelectorAll(".workspace-inspector-tab-label"),
    ].reduce((total, label) => {
      const labelWidth = width(label);
      return (
        total +
        labelWidth +
        (labelWidth
          ? parseFloat(getComputedStyle(label.parentElement!).columnGap) || 0
          : 0)
      );
    }, 0);
    onNeedsChange(
      Math.max(
        360,
        Math.ceil(
          shown.reduce(
            (total, child) => total + (child === identity ? 0 : width(child)),
            0,
          ) -
            labels +
            120 +
            (parseFloat(style.columnGap) || 0) * (shown.length - 1) +
            parseFloat(style.paddingLeft) +
            parseFloat(style.paddingRight),
        ),
      ),
    );
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(head);
  for (const child of head.children) observer.observe(child);
  return () => observer.disconnect();
}
