import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { command, repoRoot, jsonFile, errorExit } from './lib.mjs';

export function proposeRuleset(current, policy) {
  const result = structuredClone(current);
  let pr = result.rules.find(r => r.type === 'pull_request');
  if (!pr) throw new Error('Expected an existing PR rule; inspect the repository policy first');
  pr.parameters.required_approving_review_count = Math.max(pr.parameters.required_approving_review_count, policy.approvingReviews);
  pr.parameters.dismiss_stale_reviews_on_push = policy.dismissStaleReviews;
  pr.parameters.require_last_push_approval = policy.requireLastPushApproval;
  let checks = result.rules.find(r => r.type === 'required_status_checks');
  if (!checks) throw new Error('Expected existing required checks; inspect the repository policy first');
  checks.parameters.strict_required_status_checks_policy = policy.strictChecks;
  if (!checks.parameters.required_status_checks.some(c => c.context === policy.requiredCheck)) {
    checks.parameters.required_status_checks.push({ context: policy.requiredCheck });
  }
  return Object.fromEntries(['name', 'target', 'enforcement', 'bypass_actors', 'conditions', 'rules'].filter(k => k in result).map(k => [k, result[k]]));
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function ghJson(args) {
  const result = await command(['gh', ...args], { stream: false, timeoutMs: 30000 });
  if (result.code !== 0) throw new Error(result.output);
  return JSON.parse(result.stdout);
}
async function main() {
  const policy = JSON.parse(await readFile(join(repoRoot, 'harness/github-policy.json')));
  const { nameWithOwner: repository } = await ghJson(['repo', 'view', '--json', 'nameWithOwner']);
  const action = process.argv[2] ?? 'check';
  if (action === 'check') {
    const rules = await ghJson(['api', 'repos/' + repository + '/rules/branches/' + policy.branch]);
    const pr = rules.find(r => r.type === 'pull_request')?.parameters;
    const checks = rules.find(r => r.type === 'required_status_checks')?.parameters;
    if (!pr || pr.required_approving_review_count < policy.approvingReviews
      || !pr.dismiss_stale_reviews_on_push || !pr.require_last_push_approval
      || !checks?.strict_required_status_checks_policy
      || !checks.required_status_checks.some(c => c.context === policy.requiredCheck)) {
      throw new Error('GitHub policy differs from harness/github-policy.json; agent:rules -- plan prepares a reviewable update');
    }
    console.log('Main requires current independent approval and Delivery checks.');
    return;
  }
  const path = join(repoRoot, '.agents/state/github-rules-plan.json');
  if (action === 'plan') {
    const sets = await ghJson(['api', 'repos/' + repository + '/rulesets']);
    const set = sets.find(r => r.name === 'branch-locking' && r.target === 'branch' && r.enforcement === 'active');
    if (!set) throw new Error('No active branch-locking ruleset; configure the desired target explicitly');
    const current = await ghJson(['api', 'repos/' + repository + '/rulesets/' + set.id]);
    const payload = proposeRuleset(current, policy);
    await jsonFile(path, { repository, rulesetId: set.id, beforeHash: digest(current), payload });
    console.log('Prepared ' + path + '; existing restrictions and bypass actors are preserved.');
    return;
  }
  if (action === 'apply') {
    const plan = JSON.parse(await readFile(path));
    if (plan.repository !== repository) throw new Error('Rules plan belongs to another repository');
    const endpoint = 'repos/' + repository + '/rulesets/' + plan.rulesetId;
    const current = await ghJson(['api', endpoint]);
    if (digest(current) !== plan.beforeHash) throw new Error('GitHub rules changed after planning; prepare a new plan');
    const payloadPath = join(repoRoot, '.agents/state/github-rules-payload.json');
    await jsonFile(payloadPath, plan.payload);
    await ghJson(['api', '--method', 'PUT', endpoint, '--input', payloadPath]);
    console.log('Applied reviewed branch rules; run agent:rules to verify effective policy.');
    return;
  }
  throw new Error('Usage: agent:rules -- check | plan | apply');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(errorExit);
