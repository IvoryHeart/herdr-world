// Shared with the discovery proof so it exercises the shipping build settings.
export const pagesBuildConfig = {
  minify: true,
  target: "browser",
} satisfies Partial<Bun.BuildConfig>;

export const filmBuildConfig = {
  ...pagesBuildConfig,
  format: "iife",
} satisfies Partial<Bun.BuildConfig>;
