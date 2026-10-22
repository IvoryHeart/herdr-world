import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromeRenderingFlags,
  GPU_FLAGS,
  type GpuProbe,
  isHardwareRenderer,
  SWIFTSHADER_FLAGS,
} from "./chromeRendering";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function cacheFile() {
  const dir = mkdtempSync(join(tmpdir(), "gpu-probe-test-"));
  dirs.push(dir);
  return join(dir, "probe.json");
}
const RADV =
  "ANGLE (AMD, Vulkan 1.4.318 (AMD Radeon RX 6700 XT (RADV NAVI22) (0x000073DF)), radv)";
const SWIFTSHADER_RENDERER =
  "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

test("hardware renderers are told apart from software and missing WebGL", () => {
  expect(isHardwareRenderer(RADV)).toBe(true);
  for (const renderer of [
    SWIFTSHADER_RENDERER,
    "no-webgl",
    "llvmpipe (LLVM 17.0.6, 256 bits)",
    "Chrome did not report a renderer",
    "",
  ])
    expect(isHardwareRenderer(renderer)).toBe(renderer.startsWith("Chrome"));
});

test("SwiftShader by default and always in CI, without probing", async () => {
  const probe = () => {
    throw new Error("must not probe");
  };
  for (const env of [{}, { HERDR_WORLD_TEST_GPU: "1", CI: "true" }])
    expect(await chromeRenderingFlags("chrome", { env, probe })).toEqual(
      SWIFTSHADER_FLAGS,
    );
});

test("GPU mode uses hardware ANGLE, and falls back to SwiftShader with one log line", async () => {
  const env = { HERDR_WORLD_TEST_GPU: "1" };
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  const working = async (): Promise<GpuProbe> => ({
    mode: "gpu",
    renderer: RADV,
    at: Date.now(),
  });
  expect(
    await chromeRenderingFlags("chrome", {
      env,
      probe: working,
      cacheFile: cacheFile(),
      log,
    }),
  ).toEqual(GPU_FLAGS);
  expect(logs).toEqual([`[gpu] test Chrome renders WebGL on the GPU: ${RADV}`]);

  logs.length = 0;
  const failing = async (): Promise<GpuProbe> => ({
    mode: "swiftshader",
    renderer: "no-webgl",
    at: Date.now(),
  });
  expect(
    await chromeRenderingFlags("chrome", {
      env,
      probe: failing,
      cacheFile: cacheFile(),
      log,
    }),
  ).toEqual(SWIFTSHADER_FLAGS);
  expect(logs).toEqual([
    "[gpu] HERDR_WORLD_TEST_GPU=1 but the GPU path failed (no-webgl); using SwiftShader",
  ]);
});

test("one probe per run: later Chrome launches reuse it silently", async () => {
  const env = { HERDR_WORLD_TEST_GPU: "1" };
  const file = cacheFile();
  let probes = 0;
  const logs: string[] = [];
  const options = {
    env,
    cacheFile: file,
    log: (message: string) => logs.push(message),
    probe: async (): Promise<GpuProbe> => {
      probes += 1;
      return { mode: "gpu", renderer: RADV, at: Date.now() };
    },
  };
  await chromeRenderingFlags("chrome", options);
  expect(await chromeRenderingFlags("chrome", options)).toEqual(GPU_FLAGS);
  expect(probes).toBe(1);
  expect(logs).toHaveLength(1);
});
