/** A terminal core's cascade ended without the person's confirmation. */
export type CoreAlsoEnded = { address: string; name: string | null };

/**
 * Names what core's cascade ended beyond a kill's confirmation, or null.
 * herdr-core has no conditional kill (upstream Q11): a program started under
 * a dying terminal after World's last check ends with it, and World can only
 * say so afterwards.
 */
export function coreAlsoEndedText(
  alsoEnded: readonly CoreAlsoEnded[] | undefined,
): string | null {
  if (!alsoEnded?.length) return null;
  const names = alsoEnded.map((t) => t.name ?? t.address);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `herdr-core also ended ${shown}${more}, started after you confirmed.`;
}
