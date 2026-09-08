export function assessActivation({ entry, before, after, expectedParent, publicationAttempted }) {
  const failures = [];
  if (entry?.mode !== 'ralph' || !/^[a-f0-9-]{36}$/.test(entry?.runId ?? '')) failures.push('No recorded entrypoint invocation');
  if (entry?.parent !== expectedParent) failures.push('Wrong parent PR');
  if (entry?.sourceFingerprint !== before || after !== before) failures.push('Candidate edited before managed intake returned owner questions');
  if (publicationAttempted) failures.push('Attempted publication before a reviewed run');
  return failures;
}
