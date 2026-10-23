// Claude Code records pasted and multi-line input wrapped in a
// pasted_content tag pair that carries one id. Chat shows the words inside.
const PASTED_BLOCK =
  /<pasted_content id="([^"]*)">\n?([\s\S]*?)\n?<\/pasted_content id="\1">/g;

/** The text as typed, and whether any of it arrived as a paste. */
export function unwrapPastedContent(text: string): {
  text: string;
  pasted: boolean;
} {
  let pasted = false;
  const unwrapped = text.replace(PASTED_BLOCK, (_, _id, inner: string) => {
    pasted = true;
    return inner;
  });
  return { text: unwrapped, pasted };
}
