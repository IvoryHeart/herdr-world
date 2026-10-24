/** Slash words (including custom/plugin commands); a path with another slash is text. */
export const isSlashCommand = (text: string) =>
  /^\/[^/\s]*(?:\s|$)/u.test(text.trimStart());
