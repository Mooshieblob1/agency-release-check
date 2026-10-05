import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startFixture } from '../../src/fixture.ts';

// Uses a non-default port so the test can run beside a manually started fixture.
const PORT = 4399;

test('fixture serves both variants on loopback', async () => {
  const fixture = await startFixture('baseline', PORT);
  try {
    const home = await fetch(`${fixture.origin}/`);
    assert.equal(home.status, 200);
    const baselineHtml = await home.text();
    assert.match(baselineHtml, /Websites built for small teams/);
    assert.equal((await fetch(`${fixture.origin}/api/status`)).status, 200);
    assert.equal((await fetch(`${fixture.origin}/assets/contact.js`)).status, 404);

    fixture.variant = 'candidate';
    assert.match(await (await fetch(`${fixture.origin}/`)).text(), /launch on time/);
    assert.equal((await fetch(`${fixture.origin}/api/status`)).status, 500);
    assert.equal((await fetch(`${fixture.origin}/assets/studio-photo.png`)).status, 404);

    const redirect = await fetch(`${fixture.origin}/old-services`, { redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/services');
    assert.equal((await fetch(`${fixture.origin}/contact`, { method: 'POST' })).status, 405);
  } finally {
    await fixture.close();
  }
});
