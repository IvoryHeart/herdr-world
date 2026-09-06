export function artifactFor(entry) {
  if (entry.kind === 'implementation') return ['web/src/terminalReconnectPolicy.ts', 'candidate.ts'];
  if (entry.kind === 'feature') return ['web/src/deploymentHealthLabel.ts', 'candidate.ts'];
  if (entry.kind === 'knowledge') return ['docs/eval-knowledge.md', 'knowledge.md'];
  return ['answer.json', 'answer.json'];
}
