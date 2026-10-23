/** Shortens a name in the middle so both its start and its end stay visible. */
export function middleEllipsis(text: string, max: number) {
  if (text.length <= max) return text;
  const tail = Math.ceil((max - 1) / 2);
  return `${text.slice(0, max - 1 - tail)}…${text.slice(-tail)}`;
}
