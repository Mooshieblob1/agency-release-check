import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertCaptureAllowed, ConfigError, parseConfig } from '../../src/config.ts';
import example from '../../configs/example.json' with { type: 'json' };

const base = () => structuredClone(example) as Record<string, unknown>;

test('example config parses and targets the fixture', () => {
  const config = parseConfig(base());
  assert.equal(config.pages.length, 6);
  assert.equal(config.profiles.length, 2);
  assert.doesNotThrow(() => assertCaptureAllowed(config));
});

test('real mode fails closed', () => {
  const config = parseConfig({ ...base(), mode: 'real', origin: 'https://www.example.com' });
  assert.throws(() => assertCaptureAllowed(config), /Real-site capture is disabled/);
});

test('fixture mode refuses any other origin', () => {
  for (const origin of ['http://localhost:4317', 'http://127.0.0.1:8080', 'http://[::1]:4317', 'https://example.com']) {
    const config = parseConfig({ ...base(), origin });
    assert.throws(() => assertCaptureAllowed(config), ConfigError, origin);
  }
});

test('origin must not carry a path', () => {
  assert.throws(() => parseConfig({ ...base(), origin: 'http://127.0.0.1:4317/app' }), /origin without path/);
});

test('page paths reject queries, fragments, traversal and absolute URLs', () => {
  for (const path of ['/a?b=1', '/a#x', '/../etc', '//evil.test/', 'https://evil.test/', 'relative']) {
    const pages = [{ id: 'p', path }];
    assert.throws(() => parseConfig({ ...base(), pages }), ConfigError, path);
  }
});

test('unknown keys and duplicate ids are rejected', () => {
  assert.throws(() => parseConfig({ ...base(), extra: true }), /unknown key "extra"/);
  const pages = [{ id: 'a', path: '/' }, { id: 'a', path: '/b' }];
  assert.throws(() => parseConfig({ ...base(), pages }), /duplicated/);
});

test('numeric bounds are enforced', () => {
  assert.throws(() => parseConfig({ ...base(), stabilityFrames: 1 }), /stabilityFrames/);
  assert.throws(() => parseConfig({ ...base(), diffThreshold: 2 }), /diffThreshold/);
});
