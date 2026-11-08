/** JSON settings with source spans: edits preserve all unrelated bytes. */
export function claudeSettings(text: string) {
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Claude settings must be a JSON object");
  const tokens = [
    ...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g),
  ];
  const members: { key: string; start: number; from: number; to: number }[] =
    [];
  let i = 1;
  while (i < tokens.length - 1) {
    const key = tokens[i++]!;
    i++; // colon
    const from = tokens[i]!.index!;
    let depth = 0;
    do {
      const token = tokens[i++]![0];
      if (token === "{" || token === "[") depth++;
      if (token === "}" || token === "]") depth--;
    } while (depth || ![",", "}"].includes(tokens[i]![0]));
    const last = tokens[i - 1]!;
    members.push({
      key: JSON.parse(key[0]),
      start: key.index!,
      from,
      to: last.index! + last[0].length,
    });
    if (tokens[i]![0] === ",") i++;
  }
  const matches = members.filter((m) => m.key === "statusLine");
  if (matches.length > 1)
    throw new Error("Claude settings have duplicate statusLine keys");
  const member = matches[0];
  const raw = member ? text.slice(member.from, member.to) : undefined;
  return {
    value,
    raw,
    replace(next: string | undefined) {
      if (member) {
        if (next !== undefined)
          return text.slice(0, member.from) + next + text.slice(member.to);
        const index = members.indexOf(member);
        const following = members[index + 1];
        const previous = members[index - 1];
        const from =
          following || !previous
            ? member.start
            : text.indexOf(",", previous.to);
        const to = following ? following.start : member.to;
        return text.slice(0, from) + text.slice(to);
      }
      if (next === undefined) return text;
      const end = tokens.at(-1)!.index!;
      return (
        text.slice(0, end) +
        `${members.length ? "," : ""}"statusLine":${next}` +
        text.slice(end)
      );
    },
  };
}
