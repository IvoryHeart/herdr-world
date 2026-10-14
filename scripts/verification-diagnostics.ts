import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, resolve } from "node:path";
import { homedir } from "node:os";

const fileLimit = 64 * 1024;
const totalLimit = 512 * 1024;
export function sanitizeDiagnostic(text: string, root: string) {
  return text
    .replaceAll(root, "<checkout>")
    .replaceAll(homedir(), "<home>")
    .replace(
      /(?<![\w/])(?:[A-Za-z]:[\\/]|\/)(?:[^\s"'<>;,()[\]{}]+)/g,
      "<absolute-path>",
    )
    .replace(
      /(authorization\s*:\s*)(?:(?:Bearer|Basic)\s+)?[^\s,;"'{}]+/gi,
      "$1<redacted>",
    )
    .replace(
      /((?:password|token|secret)\s*[:=]\s*)[^\s,;"'{}]+/gi,
      "$1<redacted>",
    );
}

/** Export only bounded diagnostics from one owned run; never tools or bundles. */
export async function retainVerificationDiagnostics(
  run: string,
  root: string,
  label: string,
) {
  const destination = resolve(
    root,
    ".agents/verification/diagnostics",
    basename(run),
  );
  await mkdir(destination, { recursive: true });
  const names = new Set([
    "run.failure.json",
    "commands.json",
    "results.json",
    `${label}.log`,
    `${label}-checker.log`,
    `${label}.failure.json`,
    `${label}-request.json`,
    `${label}-result.json`,
    `${label}-result.json.failure.json`,
  ]);
  try {
    const failurePath = resolve(run, `${label}-result.json.failure.json`);
    const stat = await lstat(failurePath);
    if (!stat.isFile() || stat.size > fileLimit)
      throw new Error("Invalid worker failure metadata");
    const failure = JSON.parse(await readFile(failurePath, "utf8"));
    if (
      typeof failure.trace === "string" &&
      /^[a-zA-Z0-9_.-]+\.itf\.json$/.test(failure.trace)
    )
      names.add(failure.trace);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const name of await readdir(run))
    if (
      names.size < 16 &&
      name.endsWith("-counterexample.itf.json") &&
      label.startsWith(name.split("-counterexample")[0]!)
    )
      names.add(name);
  const retained: string[] = [];
  const omitted: { name: string; reason: string }[] = [];
  let bytes = 0;
  for (const name of names) {
    const path = resolve(run, name);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile()) {
      omitted.push({ name, reason: "not a regular file" });
      continue;
    }
    if (!name.endsWith(".log") && stat.size > 8 * 1024 * 1024) {
      omitted.push({ name, reason: "input exceeds reader limit" });
      continue;
    }
    let contents: string;
    if (name.endsWith(".log") && stat.size > fileLimit) {
      const file = await open(path, "r");
      try {
        const buffer = Buffer.alloc(fileLimit - 128);
        const read = await file.read(
          buffer,
          0,
          buffer.length,
          Math.max(0, stat.size - buffer.length),
        );
        contents =
          "[earlier log output omitted]\n" +
          buffer.subarray(0, read.bytesRead).toString("utf8");
      } finally {
        await file.close();
      }
    } else contents = await readFile(path, "utf8");
    if (name === "commands.json")
      contents = JSON.stringify(JSON.parse(contents).slice(-10), null, 2);
    if (name.endsWith("-request.json")) {
      const request = JSON.parse(contents);
      const trace = [...names].find((item) => item.endsWith(".itf.json"));
      request.files = trace ? [trace] : request.files.slice(0, 1);
      request.reproduction =
        "Use the retained trace with the same model/mode; rerun the focused runner to regenerate omitted mutant bundles.";
      contents = JSON.stringify(request, null, 2);
    }
    contents = sanitizeDiagnostic(contents, root);
    if (Buffer.byteLength(contents) > fileLimit && name.endsWith(".log"))
      contents =
        "[earlier log output omitted]\n" +
        Buffer.from(contents)
          .subarray(-fileLimit + 128)
          .toString("utf8");
    const length = Buffer.byteLength(contents);
    if (length > fileLimit || bytes + length > totalLimit) {
      omitted.push({ name, reason: "diagnostic byte budget" });
      continue;
    }
    await writeFile(resolve(destination, name), contents);
    bytes += length;
    retained.push(name);
  }
  await writeFile(
    resolve(destination, "index.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        run: basename(run),
        label,
        retained,
        omitted,
        bytes,
        limits: { fileBytes: fileLimit, totalBytes: totalLimit },
      },
      null,
      2,
    ),
  );
  return destination;
}
