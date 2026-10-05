import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../../src/config.ts';
import type { Manifest, ManifestItem, Store } from '../../src/store.ts';
import example from '../../configs/example.json' with { type: 'json' };

export async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'release-check-'));
}

export function exampleConfig() {
  return parseConfig(structuredClone(example));
}

/** Writes a minimal complete run with one real evidence file per item. */
export async function writeRun(store: Store, runId: string, kind: 'baseline' | 'candidate'): Promise<Manifest> {
  await store.createRun(runId);
  const config = exampleConfig();
  const items: ManifestItem[] = [];
  for (const page of config.pages.slice(0, 2)) {
    const id = `${page.id}@desktop`;
    const screenshot = await store.writeEvidence(runId, `${page.id}@desktop.png`, new TextEncoder().encode(`png ${runId} ${id}`));
    items.push({
      id, pageId: page.id, profileId: 'desktop', url: config.origin + page.path, finalUrl: config.origin + page.path,
      status: 'captured', httpStatus: 200, redirects: [], screenshot, screenshotNote: null, frames: [], stable: true,
      visual: { result: 'new', reason: 'test', before: null, diff: null, diffPixels: null, diffRatio: null },
      observations: [], observationsTruncated: 0, outOfScopeLinks: [], error: null,
    });
  }
  const manifest: Manifest = {
    schemaVersion: 1, runId, kind, baselineId: null, baselineManifestSha256: null,
    createdAt: '2026-10-05T00:00:00.000Z', completedAt: '2026-10-05T00:00:01.000Z', status: 'complete',
    config, configSha256: 'x', browser: { source: 'test', version: '0', fingerprint: 'test' }, items, pngBytes: 0,
  };
  await store.writeManifest(manifest);
  return manifest;
}
