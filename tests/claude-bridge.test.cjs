const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { prepare, publish } = require('../.github/scripts/claude-bridge.cjs');

const sha = 'a'.repeat(40);
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cryptoscope-bridge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const state = { comments: [], permission: 'write', posts: [], fileReads: 0, outputs: {} };
  state.pr = { state: 'open', draft: false, title: 'Fix live quotes', changed_files: 1,
    base: { sha: 'b'.repeat(40) }, head: { sha, ref: 'codex/fix-live', repo: { full_name: 'owner/repo' } } };
  const listComments = () => {};
  const listFiles = () => {};
  const github = { rest: {
    pulls: { get: async () => ({ data: state.pr }), listFiles },
    issues: { listComments, createComment: async value => state.posts.push(value) },
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: state.permission } }) },
  }, paginate: async method => {
    if (method === listComments) return state.comments;
    state.fileReads++;
    return [{ filename: 'assets/app.js', status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }];
  } };
  const context = { repo: { owner: 'owner', repo: 'repo' }, actor: 'owner',
    eventName: 'issue_comment', payload: { issue: { number: 9, pull_request: {} },
      comment: { body: '@claude review', user: { type: 'User' } } } };
  const core = { setOutput: (k, v) => { state.outputs[k] = v; }, notice: () => {} };
  return { github, context, core, directory, state };
}

test('authorized PR command captures exact head/base SHA and patch data', async t => {
  const f = fixture(t);
  await prepare(f);
  assert.equal(f.state.outputs.run, 'true');
  const input = JSON.parse(fs.readFileSync(f.state.outputs.input_file, 'utf8'));
  assert.equal(input.head_sha, sha);
  assert.equal(input.base_sha, 'b'.repeat(40));
  assert.equal(input.files[0].filename, 'assets/app.js');
  assert.equal(input.tests_executed_by_this_workflow, false);
});

test('ordinary comments, issues and bot commands never start a review', async t => {
  for (const variant of ['ordinary', 'issue', 'bot']) {
    const f = fixture(t);
    if (variant === 'ordinary') f.context.payload.comment.body = 'Please explain @claude review';
    if (variant === 'issue') delete f.context.payload.issue.pull_request;
    if (variant === 'bot') f.context.payload.comment.user.type = 'Bot';
    await prepare(f);
    assert.equal(f.state.outputs.run, 'false', variant);
    assert.equal(f.state.fileReads, 0, variant);
  }
});

test('users without write permission and fork PRs are ignored', async t => {
  for (const variant of ['read', 'fork']) {
    const f = fixture(t);
    if (variant === 'read') f.state.permission = 'read';
    else f.state.pr.head.repo.full_name = 'external/repo';
    await prepare(f);
    assert.equal(f.state.outputs.run, 'false');
    assert.equal(f.state.fileReads, 0);
  }
});

test('automatic events only review ready codex branches', async t => {
  for (const variant of ['codex', 'draft', 'other']) {
    const f = fixture(t);
    f.context.eventName = 'pull_request_target';
    f.context.payload = { pull_request: { number: 9 } };
    if (variant === 'draft') f.state.pr.draft = true;
    if (variant === 'other') f.state.pr.head.ref = 'someone/feature';
    await prepare(f);
    assert.equal(f.state.outputs.run, variant === 'codex' ? 'true' : 'false');
  }
});

test('an existing bot review deduplicates only the same head SHA', async t => {
  const f = fixture(t);
  f.state.comments = [{ user: { type: 'Bot' }, body: `<!-- cryptoscope-bridge:claude:${sha} -->` }];
  await prepare(f);
  assert.equal(f.state.outputs.run, 'false');
  f.state.pr.head.sha = 'c'.repeat(40);
  await prepare(f);
  assert.equal(f.state.outputs.run, 'true');
});

test('manual dispatch resolves the requested PR and rejects malformed numbers', async t => {
  const f = fixture(t);
  f.context.eventName = 'workflow_dispatch';
  f.context.payload = { inputs: { pr_number: '9' } };
  await prepare(f);
  assert.equal(f.state.outputs.pr_number, '9');
  f.context.payload.inputs.pr_number = '9; echo unsafe';
  await assert.rejects(prepare(f), /positive PR number/);
});

test('publishing discards results for changed or closed PRs', async t => {
  const f = fixture(t);
  f.state.pr.head.sha = 'c'.repeat(40);
  const params = { ...f, number: 9, sha, output: JSON.stringify({ review_markdown: 'Report' }) };
  await publish(params);
  assert.equal(f.state.posts.length, 0);
  f.state.pr.head.sha = sha;
  f.state.pr.state = 'closed';
  await publish(params);
  assert.equal(f.state.posts.length, 0);
});

test('publishing validates model output and deduplicates repeated delivery', async t => {
  const f = fixture(t);
  await assert.rejects(publish({ ...f, number: 9, sha, output: '{}' }), /did not return/);
  const params = { ...f, number: 9, sha, output: JSON.stringify({ review_markdown: 'No confirmed findings' }) };
  await publish(params);
  assert.equal(f.state.posts.length, 1);
  const body = f.state.posts[0].body;
  assert.ok(body.includes(`cryptoscope-bridge:claude:${sha}`));
  assert.ok(body.includes('Тесты этим workflow не запускались'));
  f.state.comments = [{ user: { type: 'Bot' }, body }];
  await publish(params);
  assert.equal(f.state.posts.length, 1);
});

test('large diffs fail before invoking Claude', async t => {
  const f = fixture(t);
  const paginate = f.github.paginate;
  f.github.paginate = async (method, args) => method === f.github.rest.pulls.listFiles
    ? [{ filename: 'large.js', patch: 'x'.repeat(240001) }] : paginate(method, args);
  await assert.rejects(prepare(f), /Diff exceeds/);
  assert.equal(f.state.outputs.run, 'false');
});
