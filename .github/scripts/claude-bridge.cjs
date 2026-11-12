const fs = require('node:fs');
const path = require('node:path');

const marker = sha => `<!-- cryptoscope-bridge:claude:${sha} -->`;
const command = body => /^@claude\s+review(?:\s|$)/i.test((body || '').trim());
const canWrite = permission => ['admin', 'maintain', 'write'].includes(permission);

async function prepare({ github, context, core, directory = process.env.RUNNER_TEMP }) {
  core.setOutput('run', 'false');
  const event = context.eventName;
  const payload = context.payload;
  if (event === 'issue_comment' && (!payload.issue?.pull_request || !command(payload.comment?.body))) return;
  if (event === 'issue_comment' && payload.comment?.user?.type === 'Bot') return;
  if (!['issue_comment', 'pull_request_target', 'workflow_dispatch'].includes(event)) return;
  const rawNumber = payload.pull_request?.number || payload.issue?.number || payload.inputs?.pr_number;
  if (!/^[1-9]\d*$/.test(String(rawNumber))) throw new Error('A positive PR number is required');
  const number = Number(rawNumber);
  const repo = { ...context.repo, pull_number: number };
  const { data: pr } = await github.rest.pulls.get(repo);
  if (pr.state !== 'open' || pr.head.repo?.full_name !== `${context.repo.owner}/${context.repo.repo}`) return;
  if (event === 'pull_request_target' && (pr.draft || !pr.head.ref.startsWith('codex/'))) return;
  const { data: access } = await github.rest.repos.getCollaboratorPermissionLevel({
    ...context.repo, username: context.actor,
  });
  if (!canWrite(access.permission)) return;
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: number, per_page: 100 });
  if (comments.some(c => c.user?.type === 'Bot' && c.body?.includes(marker(pr.head.sha)))) {
    core.notice('This exact head SHA already has a Claude bridge review');
    return;
  }
  const files = await github.paginate(github.rest.pulls.listFiles, { ...repo, per_page: 100 });
  const input = {
    repository: `${context.repo.owner}/${context.repo.repo}`, pr_number: number,
    base_sha: pr.base.sha, head_sha: pr.head.sha, title: pr.title,
    tests_executed_by_this_workflow: false,
    coverage: 'GitHub file patches only. Patches may be absent or truncated. Do not claim a full audit.',
    expected_changed_files: pr.changed_files,
    files: files.map(f => ({ filename: f.filename, status: f.status, patch: f.patch || null })),
  };
  if (JSON.stringify(input).length > 240000) throw new Error('Diff exceeds the bridge limit; request a focused manual review');
  fs.writeFileSync(path.join(directory, 'cryptoscope-review-input.json'), JSON.stringify(input, null, 2));
  core.setOutput('pr_number', String(number));
  core.setOutput('head_sha', pr.head.sha);
  core.setOutput('input_file', path.join(directory, 'cryptoscope-review-input.json'));
  core.setOutput('run', 'true');
}

async function publish({ github, context, core, number, sha, output }) {
  const result = JSON.parse(output || '{}');
  if (typeof result.review_markdown !== 'string' || !result.review_markdown.trim()) {
    throw new Error('Claude did not return a review; no success comment was published');
  }
  if (result.review_markdown.length > 45000) throw new Error('Review exceeds the comment size limit');
  const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
  if (pr.state !== 'open' || pr.head.sha !== sha) {
    core.notice('PR changed during review; stale results were discarded');
    return;
  }
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: number, per_page: 100 });
  if (comments.some(c => c.user?.type === 'Bot' && c.body?.includes(marker(sha)))) return;
  const body = [marker(sha), '## Проверка Claude', `SHA: \`${sha}\``, result.review_markdown,
    'Тесты этим workflow не запускались. Результат AI-проверки не разрешает автоматическое слияние.'].join('\n\n');
  await github.rest.issues.createComment({ ...context.repo, issue_number: number, body });
}

module.exports = { prepare, publish };
