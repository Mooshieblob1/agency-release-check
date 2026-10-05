// Capture configuration: parsing, validation and the fail-closed target policy.
import { readFile } from 'node:fs/promises';
import { FIXTURE_ORIGIN } from './fixture.ts';

export interface PageConfig {
  id: string;
  path: string;
  /** CSS selectors hidden before screenshots and diffing. */
  masks: string[];
}

export interface ProfileConfig {
  id: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
}

export interface CaptureConfig {
  schemaVersion: 1;
  name: string;
  mode: 'fixture' | 'real';
  origin: string;
  pages: PageConfig[];
  profiles: ProfileConfig[];
  /** Share of differing pixels (0..1) above which an item is "changed". */
  diffThreshold: number;
  /** pixelmatch per-pixel colour threshold (0..1). */
  pixelThreshold: number;
  stabilityFrames: number;
  stabilityIntervalMs: number;
  navigationTimeoutMs: number;
  maxRedirects: number;
  /** Upper bound for one PNG; larger screenshots are recorded as oversized. */
  maxScreenshotBytes: number;
  /** Upper bound for all PNGs written by a run. */
  maxRunBytes: number;
  maxObservationsPerItem: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function fail(message: string): never {
  throw new ConfigError(message);
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${where} must be an object`);
  return value as Record<string, unknown>;
}

function only(o: Record<string, unknown>, keys: string[], where: string): void {
  for (const key of Object.keys(o)) if (!keys.includes(key)) fail(`${where} has unknown key "${key}"`);
}

function str(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${where} must be a non-empty string`);
  return value;
}

function int(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${where} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function ratio(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(`${where} must be from 0 to 1`);
  return value;
}

function uniqueIds(items: { id: string }[], where: string): void {
  const seen = new Set<string>();
  for (const { id } of items) {
    if (seen.has(id)) fail(`${where} id "${id}" is duplicated`);
    seen.add(id);
  }
}

function parsePath(value: unknown, where: string): string {
  const path = str(value, where);
  // Query strings and fragments are out of scope; paths stay on the configured origin.
  if (!/^\/[A-Za-z0-9\-._~/]*$/.test(path) || path.includes('//') || path.split('/').includes('..')) {
    fail(`${where} must be a plain absolute path without query, fragment or traversal`);
  }
  return path;
}

/**
 * Real-site capture stays disabled until connection-time destination enforcement
 * exists. Host allowlists and a DNS check at start are not enough, so the only
 * reachable origin is the owned loopback fixture.
 */
export function assertCaptureAllowed(config: CaptureConfig): void {
  if (config.mode !== 'fixture') {
    throw new ConfigError('Real-site capture is disabled: connection-time destination enforcement is not implemented.');
  }
  if (config.origin !== FIXTURE_ORIGIN) {
    throw new ConfigError(`Fixture mode only allows ${FIXTURE_ORIGIN}; got ${config.origin}.`);
  }
}

export function parseConfig(input: unknown): CaptureConfig {
  const o = obj(input, 'config');
  const keys = ['schemaVersion', 'name', 'mode', 'origin', 'pages', 'profiles', 'diffThreshold', 'pixelThreshold',
    'stabilityFrames', 'stabilityIntervalMs', 'navigationTimeoutMs', 'maxRedirects', 'maxScreenshotBytes',
    'maxRunBytes', 'maxObservationsPerItem'];
  only(o, keys, 'config');
  if (o.schemaVersion !== 1) fail('config.schemaVersion must be 1');
  if (o.mode !== 'fixture' && o.mode !== 'real') fail('config.mode must be "fixture" or "real"');
  const origin = str(o.origin, 'config.origin');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    fail('config.origin must be a URL');
  }
  if (parsed.origin !== origin) fail('config.origin must be an origin without path, e.g. http://127.0.0.1:4317');

  if (!Array.isArray(o.pages) || o.pages.length === 0 || o.pages.length > 50) fail('config.pages must have 1 to 50 entries');
  const pages = o.pages.map((raw, i): PageConfig => {
    const p = obj(raw, `pages[${i}]`);
    only(p, ['id', 'path', 'masks'], `pages[${i}]`);
    const id = str(p.id, `pages[${i}].id`);
    if (!ID.test(id)) fail(`pages[${i}].id must match ${ID}`);
    const masks = p.masks === undefined ? [] : p.masks;
    if (!Array.isArray(masks) || masks.length > 20) fail(`pages[${i}].masks must be an array of up to 20 selectors`);
    return { id, path: parsePath(p.path, `pages[${i}].path`), masks: masks.map((m, j) => str(m, `pages[${i}].masks[${j}]`)) };
  });
  uniqueIds(pages, 'page');

  if (!Array.isArray(o.profiles) || o.profiles.length === 0 || o.profiles.length > 6) fail('config.profiles must have 1 to 6 entries');
  const profiles = o.profiles.map((raw, i): ProfileConfig => {
    const p = obj(raw, `profiles[${i}]`);
    only(p, ['id', 'width', 'height', 'deviceScaleFactor', 'isMobile'], `profiles[${i}]`);
    const id = str(p.id, `profiles[${i}].id`);
    if (!ID.test(id)) fail(`profiles[${i}].id must match ${ID}`);
    if (typeof p.isMobile !== 'boolean') fail(`profiles[${i}].isMobile must be a boolean`);
    return {
      id,
      width: int(p.width, `profiles[${i}].width`, 240, 2560),
      height: int(p.height, `profiles[${i}].height`, 240, 2560),
      deviceScaleFactor: int(p.deviceScaleFactor, `profiles[${i}].deviceScaleFactor`, 1, 3),
      isMobile: p.isMobile,
    };
  });
  uniqueIds(profiles, 'profile');

  return {
    schemaVersion: 1,
    name: str(o.name, 'config.name'),
    mode: o.mode,
    origin,
    pages,
    profiles,
    diffThreshold: ratio(o.diffThreshold, 'config.diffThreshold'),
    pixelThreshold: ratio(o.pixelThreshold, 'config.pixelThreshold'),
    stabilityFrames: int(o.stabilityFrames, 'config.stabilityFrames', 2, 5),
    stabilityIntervalMs: int(o.stabilityIntervalMs, 'config.stabilityIntervalMs', 0, 5000),
    navigationTimeoutMs: int(o.navigationTimeoutMs, 'config.navigationTimeoutMs', 1000, 60000),
    maxRedirects: int(o.maxRedirects, 'config.maxRedirects', 0, 5),
    maxScreenshotBytes: int(o.maxScreenshotBytes, 'config.maxScreenshotBytes', 10_000, 20_000_000),
    maxRunBytes: int(o.maxRunBytes, 'config.maxRunBytes', 100_000, 500_000_000),
    maxObservationsPerItem: int(o.maxObservationsPerItem, 'config.maxObservationsPerItem', 1, 200),
  };
}

export async function loadConfig(file: string): Promise<CaptureConfig> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new ConfigError(`Cannot read config ${file}: ${(err as Error).message}`);
  }
  return parseConfig(raw);
}
