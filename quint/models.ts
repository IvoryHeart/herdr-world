// Larger independent cases start first to keep a bounded worker pool occupied.
export const verificationModels = [
  "space-admission",
  "browser-preparation",
  "observation-base",
  "browser-refresh",
  "chunk-credits",
  "runtime-leases",
  "runtime-control",
  "runtime-drain",
  "ranger-recovery",
  "creation-flow",
  "chunk-assembly",
  "ranger-authority",
] as const;
