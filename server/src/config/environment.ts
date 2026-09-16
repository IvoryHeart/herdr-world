/** Read one World-owned environment setting. */
export function worldEnv(
  suffix: string,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  return environment[`HERDR_WORLD_${suffix}`];
}
