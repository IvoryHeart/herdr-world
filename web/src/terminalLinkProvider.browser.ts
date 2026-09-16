import { Terminal, type ILink, type ILinkProvider } from "@xterm/xterm";
import { UnicodeGraphemesAddon } from "@xterm/addon-unicode-graphemes";
import "@xterm/xterm/css/xterm.css";
import { registerTerminalLinkProvider } from "./terminalLinkProvider";

const failures: string[] = [];
const check = (actual: unknown, expected: unknown, label: string) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: ${JSON.stringify(actual)}`);
  }
};

async function run() {
  const container = document.createElement("div");
  document.body.append(container);
  const term = new Terminal({ cols: 20, rows: 10, allowProposedApi: true });
  term.loadAddon(new UnicodeGraphemesAddon());
  term.open(container);
  let provider!: ILinkProvider;
  const register = term.registerLinkProvider.bind(term);
  term.registerLinkProvider = (value) => {
    provider = value;
    return register(value);
  };
  registerTerminalLinkProvider(term, () => {});
  const write = (text: string) =>
    new Promise<void>((done) => term.write(text, done));
  const links = (row: number) =>
    new Promise<ILink[]>((done) =>
      provider.provideLinks(row, (found) => done(found ?? [])),
    );
  try {
    const path = "/tmp/docs/long-guide.md";
    await write(`界界 e\u0301 ${path}`);
    const first = await links(1);
    check(
      first.map((link) => link.text),
      [path],
      "wide/combining prefix path",
    );
    check(
      first[0]?.range,
      { start: { x: 8, y: 1 }, end: { x: 10, y: 2 } },
      "wide/combining cell positions",
    );
    check(
      (await links(2))[0]?.range,
      first[0]?.range,
      "same link from continuation",
    );

    term.reset();
    term.resize(21, 10);
    await write("https://example.com/界");
    const url = await links(2);
    check(
      url.map((link) => link.text),
      ["https://example.com/界"],
      "wide glyph across soft wrap",
    );
    check(
      url[0]?.range,
      { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } },
      "wide final glyph occupies both cells",
    );

    term.reset();
    term.resize(16, 10);
    await write(path);
    check((await links(2))[0]?.text, path, "path before resize");
    term.resize(30, 10);
    check(
      (await links(2))[0]?.text,
      path,
      "path through resize padding on cursor line",
    );
    term.resize(16, 10);
    await write("\r\n");
    term.resize(30, 10);
    check(
      (await links(1))[0]?.range,
      { start: { x: 1, y: 1 }, end: { x: path.length, y: 1 } },
      "path after reflow",
    );

    term.reset();
    term.resize(16, 10);
    await write("/tmp/first.md\r\n/tmp/second.md");
    check(
      (await links(1)).map((link) => link.text),
      ["/tmp/first.md"],
      "explicit newline first file",
    );
    check(
      (await links(2)).map((link) => link.text),
      ["/tmp/second.md"],
      "explicit newline second file",
    );
  } finally {
    term.dispose();
    container.remove();
  }
}

run()
  .catch((error: unknown) => failures.push(String(error)))
  .finally(() =>
    fetch("/result", { method: "POST", body: JSON.stringify(failures) }),
  );
