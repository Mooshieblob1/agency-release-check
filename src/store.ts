// Evidence store: immutable run directories plus append-only, hash-linked review revisions.
//
// artifacts/runs/<runId>/manifest.json and PNG evidence (written once, never overwritten)
// artifacts/reviews/<runId>/000001.json ... (one file per revision, each linking the previous hash)
import { createHash } from 'node:crypto';
import { mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureConfig } from './config.ts';

export const SCHEMA_VERSION = 1;

export const ASPECTS = ['visual', 'browser'] as const;
export const DECISIONS = ['accept', 'reject', 'defer'] as const;
export const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'] as const;

export type Aspect = (typeof ASPECTS)[number];
export type Decision = (typeof DECISIONS)[number];
export type Severity = (typeof SEVERITIES)[number];

export interface FileRef {
  /** Path relative to the run directory. */
  path: string;
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
}

export type ObservationType = 'console-error' | 'page-error' | 'request-failed' | 'http-error' | 'blocked-request';

export interface Observation {
  type: ObservationType;
  message: string;
  url?: string;
}

export type VisualResult = 'unchanged' | 'changed' | 'new' | 'not-compared';

export interface ManifestItem {
  /** `${pageId}@${profileId}` */
  id: string;
  pageId: string;
  profileId: string;
  url: string;
  finalUrl: string | null;
  status: 'captured' | 'failed';
  httpStatus: number | null;
  redirects: string[];
  screenshot: FileRef | null;
  screenshotNote: string | null;
  frames: FileRef[];
  stable: boolean;
  visual: {
    result: VisualResult;
    reason: string;
    before: FileRef | null;
    diff: FileRef | null;
    diffPixels: number | null;
    diffRatio: number | null;
  };
  observations: Observation[];
  observationsTruncated: number;
  outOfScopeLinks: string[];
  error: string | null;
}

export interface Manifest {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  kind: 'baseline' | 'candidate';
  baselineId: string | null;
  /** sha256 of the baseline manifest this candidate was compared against. */
  baselineManifestSha256: string | null;
  createdAt: string;
  completedAt: string;
  status: 'complete' | 'interrupted';
  config: CaptureConfig;
  configSha256: string;
  browser: { source: string; version: string; fingerprint: string };
  items: ManifestItem[];
  pngBytes: number;
}

export interface PromotionBody {
  reviewer: string;
  attestation: string;
  manifestSha256: string;
}

export interface ReviewBody {
  item: string;
  aspect: Aspect;
  decision: Decision;
  reviewer: string;
  rationale: string;
  severity: Severity;
  comment: string;
}

export type RevisionBody = { kind: 'promotion'; promotion: PromotionBody } | { kind: 'review'; review: ReviewBody };

export type Revision = RevisionBody & {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  revision: number;
  previousHash: string | null;
  createdAt: string;
  hash: string;
};

export class StoreError extends Error {
  override name = 'StoreError';
}

export class ConflictError extends StoreError {
  override name = 'ConflictError';
}

const RUN_ID = /^[a-z0-9][a-z0-9-]{2,79}$/;

export function assertRunId(runId: string): void {
  if (!RUN_ID.test(runId)) throw new StoreError(`Invalid run ID "${runId}": use 3-80 lowercase letters, digits and hyphens.`);
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** JSON with sorted keys, so hashes do not depend on property order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    }
    return v;
  });
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === code;
}

export class Store {
  constructor(readonly root: string) {}

  runDir(runId: string): string {
    assertRunId(runId);
    return join(this.root, 'runs', runId);
  }

  reviewDir(runId: string): string {
    assertRunId(runId);
    return join(this.root, 'reviews', runId);
  }

  /** Creates a new run directory; refuses to reuse an existing run ID. */
  async createRun(runId: string): Promise<string> {
    const dir = this.runDir(runId);
    await mkdir(join(this.root, 'runs'), { recursive: true });
    try {
      await mkdir(dir);
    } catch (err) {
      if (isErrno(err, 'EEXIST')) throw new StoreError(`Run "${runId}" already exists; evidence is never overwritten.`);
      throw err;
    }
    return dir;
  }

  /** Writes one evidence file with exclusive creation and returns its reference. */
  async writeEvidence(runId: string, name: string, data: Uint8Array, size?: { width: number; height: number }): Promise<FileRef> {
    if (!/^[a-z0-9][a-z0-9@._-]{0,120}\.png$/.test(name)) throw new StoreError(`Invalid evidence file name "${name}"`);
    await writeFile(join(this.runDir(runId), name), data, { flag: 'wx' });
    return { path: name, sha256: sha256(data), bytes: data.byteLength, ...size };
  }

  async writeManifest(manifest: Manifest): Promise<string> {
    const text = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(join(this.runDir(manifest.runId), 'manifest.json'), text, { flag: 'wx' });
    return sha256(text);
  }

  async readManifestText(runId: string): Promise<string> {
    try {
      return await readFile(join(this.runDir(runId), 'manifest.json'), 'utf8');
    } catch (err) {
      if (isErrno(err, 'ENOENT')) throw new StoreError(`Run "${runId}" has no manifest (missing or incomplete).`);
      throw err;
    }
  }

  async readManifest(runId: string): Promise<{ manifest: Manifest; sha256: string }> {
    const text = await this.readManifestText(runId);
    const manifest = JSON.parse(text) as Manifest;
    if (manifest.schemaVersion !== SCHEMA_VERSION) throw new StoreError(`Run "${runId}" has unsupported schema ${String(manifest.schemaVersion)}.`);
    if (manifest.runId !== runId) throw new StoreError(`Manifest in "${runId}" names run "${manifest.runId}".`);
    return { manifest, sha256: sha256(text) };
  }

  /** Re-hashes every evidence file the manifest references. Returns the problems found. */
  async verifyRun(runId: string): Promise<string[]> {
    const { manifest } = await this.readManifest(runId);
    const dir = this.runDir(runId);
    const refs: FileRef[] = [];
    for (const item of manifest.items) {
      if (item.screenshot) refs.push(item.screenshot);
      refs.push(...item.frames);
      if (item.visual.diff) refs.push(item.visual.diff);
    }
    const problems: string[] = [];
    for (const ref of refs) {
      try {
        const data = await readFile(join(dir, ref.path));
        if (sha256(data) !== ref.sha256) problems.push(`${ref.path}: hash mismatch`);
      } catch {
        problems.push(`${ref.path}: missing`);
      }
    }
    return problems;
  }

  /** Reads and verifies the revision chain for a run. */
  async readRevisions(runId: string): Promise<Revision[]> {
    let names: string[];
    try {
      names = (await readdir(this.reviewDir(runId))).filter((n) => /^\d{6}\.json$/.test(n)).sort();
    } catch (err) {
      if (isErrno(err, 'ENOENT')) return [];
      throw err;
    }
    const revisions: Revision[] = [];
    let previousHash: string | null = null;
    for (const [index, name] of names.entries()) {
      const revision = JSON.parse(await readFile(join(this.reviewDir(runId), name), 'utf8')) as Revision;
      const { hash, ...unsigned } = revision;
      if (revision.revision !== index + 1 || name !== `${String(index + 1).padStart(6, '0')}.json`) {
        throw new StoreError(`Revision chain for "${runId}" has a gap at ${name}.`);
      }
      if (revision.runId !== runId) throw new StoreError(`Revision ${name} belongs to "${revision.runId}".`);
      if (revision.previousHash !== previousHash) throw new StoreError(`Revision ${name} does not link to the previous revision.`);
      if (sha256(canonicalJson(unsigned)) !== hash) throw new StoreError(`Revision ${name} fails its hash check.`);
      revisions.push(revision);
      previousHash = hash;
    }
    return revisions;
  }

  /**
   * Appends one revision if `expectedRevision` matches the current head
   * (0 for an empty chain). A lock file serialises writers on this machine.
   */
  async appendRevision(runId: string, body: RevisionBody, expectedRevision: number, now = new Date()): Promise<Revision> {
    const dir = this.reviewDir(runId);
    await mkdir(dir, { recursive: true });
    const lockPath = `${dir}.lock`;
    let lock;
    try {
      lock = await open(lockPath, 'wx');
    } catch (err) {
      if (isErrno(err, 'EEXIST')) throw new ConflictError(`Reviews for "${runId}" are locked by another writer (${lockPath}).`);
      throw err;
    }
    try {
      const chain = await this.readRevisions(runId);
      const head = chain.at(-1);
      const current = head?.revision ?? 0;
      if (expectedRevision !== current) {
        throw new ConflictError(`Expected revision ${expectedRevision} but "${runId}" is at revision ${current}; reload and retry.`);
      }
      const unsigned = {
        ...body,
        schemaVersion: SCHEMA_VERSION,
        runId,
        revision: current + 1,
        previousHash: head?.hash ?? null,
        createdAt: now.toISOString(),
      };
      const revision = { ...unsigned, hash: sha256(canonicalJson(unsigned)) } as Revision;
      const name = `${String(revision.revision).padStart(6, '0')}.json`;
      await writeFile(join(dir, name), `${JSON.stringify(revision, null, 2)}\n`, { flag: 'wx' });
      return revision;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  /** Records an explicit local attestation that a complete baseline was reviewed. */
  async promote(runId: string, reviewer: string, attestation: string, expectedRevision?: number): Promise<Revision> {
    const { manifest, sha256: manifestSha256 } = await this.readManifest(runId);
    if (manifest.kind !== 'baseline') throw new StoreError(`Only baseline runs can be promoted; "${runId}" is a ${manifest.kind}.`);
    if (manifest.status !== 'complete') throw new StoreError(`Run "${runId}" is ${manifest.status}; only complete runs can be promoted.`);
    if (manifest.items.some((i) => i.status !== 'captured' || !i.screenshot)) {
      throw new StoreError(`Run "${runId}" has failed or missing captures; it cannot become an approved baseline.`);
    }
    const problems = await this.verifyRun(runId);
    if (problems.length) throw new StoreError(`Run "${runId}" failed integrity checks: ${problems.join('; ')}`);
    const promotion: PromotionBody = {
      reviewer: text(reviewer, 'reviewer', 80),
      attestation: text(attestation, 'attestation', 500),
      manifestSha256,
    };
    const head = expectedRevision ?? (await this.readRevisions(runId)).length;
    return this.appendRevision(runId, { kind: 'promotion', promotion }, head);
  }

  /** The approval that lets a baseline be compared against, or a reason it cannot be. */
  async baselineApproval(runId: string): Promise<{ approved: true; manifestSha256: string } | { approved: false; reason: string }> {
    let manifestSha256: string;
    try {
      ({ sha256: manifestSha256 } = await this.readManifest(runId));
    } catch (err) {
      return { approved: false, reason: (err as Error).message };
    }
    const promotions = (await this.readRevisions(runId)).filter((r) => r.kind === 'promotion');
    const last = promotions.at(-1);
    if (!last || last.kind !== 'promotion') return { approved: false, reason: `Baseline "${runId}" has not been promoted.` };
    if (last.promotion.manifestSha256 !== manifestSha256) {
      return { approved: false, reason: `Baseline "${runId}" manifest changed after promotion.` };
    }
    return { approved: true, manifestSha256 };
  }

  async addReview(runId: string, input: unknown): Promise<Revision> {
    const { manifest } = await this.readManifest(runId);
    const { review, expectedRevision } = parseReviewInput(input, manifest);
    return this.appendRevision(runId, { kind: 'review', review }, expectedRevision);
  }
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new StoreError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw new StoreError(`${field} must not be empty`);
  if (trimmed.length > max) throw new StoreError(`${field} must be at most ${max} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed)) throw new StoreError(`${field} contains control characters`);
  return trimmed;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new StoreError(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

const REVIEW_KEYS = ['item', 'aspect', 'decision', 'reviewer', 'rationale', 'severity', 'comment', 'expectedRevision'];

/** Validates a review submitted by the CLI or the review UI against the run it targets. */
export function parseReviewInput(input: unknown, manifest: Manifest): { review: ReviewBody; expectedRevision: number } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new StoreError('Review must be a JSON object');
  const o = input as Record<string, unknown>;
  for (const key of REVIEW_KEYS) if (!(key in o)) throw new StoreError(`Review is missing "${key}"`);
  for (const key of Object.keys(o)) if (!REVIEW_KEYS.includes(key)) throw new StoreError(`Review has unknown key "${key}"`);
  if (manifest.kind !== 'candidate') throw new StoreError('Reviews apply to candidate runs; baselines are promoted instead.');
  const item = text(o.item, 'item', 120);
  if (!manifest.items.some((i) => i.id === item)) throw new StoreError(`Run "${manifest.runId}" has no item "${item}"`);
  const expectedRevision = o.expectedRevision;
  if (typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new StoreError('expectedRevision must be a non-negative integer');
  }
  return {
    expectedRevision,
    review: {
      item,
      aspect: oneOf(o.aspect, ASPECTS, 'aspect'),
      decision: oneOf(o.decision, DECISIONS, 'decision'),
      reviewer: text(o.reviewer, 'reviewer', 80),
      rationale: text(o.rationale, 'rationale', 2000),
      severity: oneOf(o.severity, SEVERITIES, 'severity'),
      comment: text(o.comment, 'comment', 2000, true),
    },
  };
}

/** Latest decision per item and aspect; later revisions supersede earlier ones. */
export function currentDecisions(revisions: Revision[]): Map<string, ReviewBody & { revision: number }> {
  const state = new Map<string, ReviewBody & { revision: number }>();
  for (const r of revisions) if (r.kind === 'review') state.set(`${r.review.item}#${r.review.aspect}`, { ...r.review, revision: r.revision });
  return state;
}
