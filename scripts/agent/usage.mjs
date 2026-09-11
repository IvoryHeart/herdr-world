// Shared token validation for native Codex session accounting.
const tokenFields = ['input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens'];

export function normalizeUsage(usage) {
  if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) return null;
  const result = Object.fromEntries(tokenFields.map(key => [key, usage[key] ?? 0]));
  if (Object.values(result).some(value => !Number.isSafeInteger(value) || value < 0)
    || result.cached_input_tokens > result.input_tokens
    || result.reasoning_output_tokens > result.output_tokens) return null;
  return result;
}
