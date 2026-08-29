import { Ghostty } from "ghostty-web";

let ghosttyPromise;

async function loadGhostty() {
  globalThis.self ??= globalThis;
  ghosttyPromise ??= Ghostty.load();
  return ghosttyPromise;
}

function lineText(cells) {
  return cells
    .map((cell) =>
      cell.codepoint === 0 ? " " : String.fromCodePoint(cell.codepoint),
    )
    .join("")
    .trimEnd();
}

export async function createTerminalScreen(cols, rows) {
  const ghostty = await loadGhostty();
  const terminal = ghostty.createTerminal(cols, rows);

  return {
    write(data) {
      terminal.write(data);
    },
    resize(nextCols, nextRows) {
      terminal.resize(nextCols, nextRows);
    },
    text() {
      const lines = [];
      for (let row = 0; row < terminal.rows; row += 1) {
        lines.push(lineText(terminal.getLine(row) ?? []));
      }
      return lines.join("\n");
    },
    close() {
      terminal.free();
    },
  };
}
