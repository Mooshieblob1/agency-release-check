import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConflictError, currentDecisions, Store, StoreError } from '../../src/store.ts';
import { tempRoot, writeRun } from './helpers.ts';

const review = (expectedRevision: number, decision = 'accept') => ({
  item: 'home@desktop', aspect: 'visual', decision, reviewer: 'Synthetic demo agent',
  rationale: 'Heading copy change is intended.', severity: 'none', comment: '', expectedRevision,
});

test('run IDs are validated and never reused', async () => {
  const store = new Store(await tempRoot());
  await assert.rejects(store.createRun('../escape'), StoreError);
  await assert.rejects(store.createRun('UPPER'), StoreError);
  await store.createRun('run-one');
  await assert.rejects(store.createRun('run-one'), /already exists/);
});

test('evidence and manifests use exclusive creation', async () => {
  const store = new Store(await tempRoot());
  const manifest = await writeRun(store, 'base-1', 'baseline');
  await assert.rejects(store.writeEvidence('base-1', 'home@desktop.png', new Uint8Array([1])), /EEXIST/);
  await assert.rejects(store.writeManifest(manifest), /EEXIST/);
});

test('verifyRun detects modified evidence', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'base-1', 'baseline');
  assert.deepEqual(await store.verifyRun('base-1'), []);
  await writeFile(join(store.runDir('base-1'), 'home@desktop.png'), 'tampered');
  assert.deepEqual(await store.verifyRun('base-1'), ['home@desktop.png: hash mismatch']);
});

test('baselines need promotion, and promotion pins the manifest hash', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'base-1', 'baseline');
  assert.equal((await store.baselineApproval('base-1')).approved, false);
  assert.equal((await store.baselineApproval('missing-run')).approved, false);
  await store.promote('base-1', 'Synthetic demo agent', 'Reviewed synthetic baseline');
  assert.equal((await store.baselineApproval('base-1')).approved, true);

  const path = join(store.runDir('base-1'), 'manifest.json');
  await writeFile(path, (await readFile(path, 'utf8')).replace('"test"', '"edited"'));
  const after = await store.baselineApproval('base-1');
  assert.equal(after.approved, false);
  assert.match(after.approved ? '' : after.reason, /changed after promotion/);
});

test('candidates cannot be promoted and baselines cannot be reviewed', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'cand-1', 'candidate');
  await writeRun(store, 'base-1', 'baseline');
  await assert.rejects(store.promote('cand-1', 'Reviewer', 'x'), /Only baseline runs/);
  await assert.rejects(store.addReview('base-1', review(0)), /candidate runs/);
});

test('reviews append hash-linked revisions and reject stale writes', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'cand-1', 'candidate');
  const first = await store.addReview('cand-1', review(0, 'defer'));
  const second = await store.addReview('cand-1', review(1, 'accept'));
  assert.equal(second.previousHash, first.hash);
  await assert.rejects(store.addReview('cand-1', review(1, 'reject')), ConflictError);

  const chain = await store.readRevisions('cand-1');
  assert.equal(chain.length, 2);
  assert.equal(currentDecisions(chain).get('home@desktop#visual')?.decision, 'accept');
});

test('review input is validated', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'cand-1', 'candidate');
  const bad: Record<string, unknown>[] = [
    { ...review(0), item: 'nope@desktop' },
    { ...review(0), aspect: 'layout' },
    { ...review(0), decision: 'maybe' },
    { ...review(0), severity: 'urgent' },
    { ...review(0), reviewer: '  ' },
    { ...review(0), extra: 1 },
    { ...review(0), expectedRevision: -1 },
  ];
  for (const input of bad) await assert.rejects(store.addReview('cand-1', input), StoreError, JSON.stringify(input));
  const { comment: _omit, ...missing } = review(0);
  await assert.rejects(store.addReview('cand-1', missing), /missing "comment"/);
});

test('tampered revisions break the chain', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'cand-1', 'candidate');
  await store.addReview('cand-1', review(0));
  await store.addReview('cand-1', review(1, 'reject'));
  const path = join(store.reviewDir('cand-1'), '000001.json');
  await writeFile(path, (await readFile(path, 'utf8')).replace('"accept"', '"reject"'));
  await assert.rejects(store.readRevisions('cand-1'), /fails its hash check/);
});

test('a held lock blocks concurrent writers', async () => {
  const store = new Store(await tempRoot());
  await writeRun(store, 'cand-1', 'candidate');
  await store.addReview('cand-1', review(0));
  await writeFile(`${store.reviewDir('cand-1')}.lock`, '');
  await assert.rejects(store.addReview('cand-1', review(1)), /locked/);
});
