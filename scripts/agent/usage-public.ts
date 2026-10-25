export function publicModel(model: string, family: string) {
  if (
    family === "codex" &&
    /^gpt-[0-9]+(?:\.[0-9]+)?(?:-(?:sol|astra|luna|codex|mini|nano|pro|turbo|preview|latest))*$/.test(
      model,
    )
  )
    return model;
  if (
    family === "claude" &&
    /^claude-(?:opus|sonnet|haiku)(?:-[0-9]+)+(?:-thinking)?$/.test(model)
  )
    return model;
  return "unknown";
}
