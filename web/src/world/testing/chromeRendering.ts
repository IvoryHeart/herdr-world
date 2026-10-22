import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * How test Chrome renders WebGL. By default (and always in CI) it uses
 * SwiftShader, the deterministic software renderer that CI's pixel and visual
 * comparisons are calibrated against. Locally, HERDR_WORLD_TEST_GPU=1 asks for
 * hardware ANGLE over Vulkan, which saves several CPU cores per Chrome for
 * Town's WebGL. GPU output may differ slightly, so local pixel comparisons in
 * that mode are advisory; CI stays authoritative.
 *
 * The GPU path is probed once per test run: a headless Chrome reports its
 * WebGL renderer, and anything but a hardware renderer (no WebGL, SwiftShader,
 * llvmpipe, a failed start) falls back to SwiftShader with one log line.
 */

export const SWIFTSHADER_FLAGS = [
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
];

export const GPU_FLAGS = [
  "--enable-gpu",
  "--use-gl=angle",
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--ignore-gpu-blocklist",
];

export type GpuProbe = {
  mode: "gpu" | "swiftshader";
  renderer: string;
  at: number;
};

const PROBE_PAGE = `data:text/html,<body></body><script>const c=document.createElement("canvas");const g=c.getContext("webgl2")||c.getContext("webgl");let r="no-webgl";if(g){const e=g.getExtension("WEBGL_debug_renderer_info");r=e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)}document.body.textContent="RENDERER="+r</script>`;

/** A hardware renderer, as opposed to no WebGL or a software one. */
export function isHardwareRenderer(renderer: string): boolean {
  return (
    !!renderer &&
    !/no-webgl|swiftshader|llvmpipe|softpipe|software/i.test(renderer)
  );
}

export async function probeGpu(chrome: string): Promise<GpuProbe> {
  const profile = mkdtempSync(join(tmpdir(), "herdr-gpu-probe-"));
  try {
    const child = Bun.spawn(
      [
        chrome,
        "--headless=new",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${profile}`,
        ...GPU_FLAGS,
        "--dump-dom",
        PROBE_PAGE,
      ],
      { stdout: "pipe", stderr: "ignore" },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    const [output] = await Promise.all([
      new Response(child.stdout).text(),
      child.exited,
    ]);
    clearTimeout(timer);
    const renderer =
      /<body>RENDERER=([^<]*)/.exec(output)?.[1]?.trim() ||
      "Chrome did not report a renderer";
    return {
      mode: isHardwareRenderer(renderer) ? "gpu" : "swiftshader",
      renderer,
      at: Date.now(),
    };
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

// One probe per test run: the runner gives each run its own TMPDIR.
const PROBE_TTL_MS = 10 * 60_000;
let probed: Promise<string[]> | undefined;

export function chromeRenderingFlags(
  chrome: string,
  options: {
    env?: Record<string, string | undefined>;
    probe?: (chrome: string) => Promise<GpuProbe>;
    cacheFile?: string;
    log?: (message: string) => void;
  } = {},
): Promise<string[]> {
  const env = options.env ?? process.env;
  if (env.CI === "true" || env.HERDR_WORLD_TEST_GPU !== "1")
    return Promise.resolve([...SWIFTSHADER_FLAGS]);
  if (probed && !options.probe) return probed;
  const result = (async () => {
    const cacheFile =
      options.cacheFile ?? join(tmpdir(), "herdr-world-gpu-probe.json");
    let probe: GpuProbe | undefined;
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8")) as GpuProbe;
      if (Date.now() - cached.at < PROBE_TTL_MS) probe = cached;
    } catch {
      // No probe yet in this run.
    }
    if (!probe) {
      probe = await (options.probe ?? probeGpu)(chrome);
      const staged = `${cacheFile}.${process.pid}`;
      writeFileSync(staged, JSON.stringify(probe));
      renameSync(staged, cacheFile);
      // The process that probed reports the outcome, once per run.
      (options.log ?? ((message: string) => console.info(message)))(
        probe.mode === "gpu"
          ? `[gpu] test Chrome renders WebGL on the GPU: ${probe.renderer}`
          : `[gpu] HERDR_WORLD_TEST_GPU=1 but the GPU path failed (${probe.renderer}); using SwiftShader`,
      );
    }
    return probe.mode === "gpu" ? [...GPU_FLAGS] : [...SWIFTSHADER_FLAGS];
  })();
  if (!options.probe) probed = result;
  return result;
}
