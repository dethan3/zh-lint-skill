import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SegmentExtractor } from '../scripts/extract-segments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_DIR = path.join(__dirname, 'golden');

// 黄金样本中忽略的字段（路径因环境而异）
const IGNORE_FIELDS = new Set(['path', 'surrounding_code']);

function loadJsonl(filepath: string): Record<string, unknown>[] {
  return fs.readFileSync(filepath, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => JSON.parse(l));
}

function normalizeSegment(seg: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(seg).filter(([k]) => !IGNORE_FIELDS.has(k))
  );
}

function compareSegments(
  actual: Record<string, unknown>[],
  expected: Record<string, unknown>[],
  name: string
): void {
  expect(actual.length, `${name}: segment count mismatch`).toBe(expected.length);

  for (let i = 0; i < actual.length; i++) {
    const aNorm = normalizeSegment(actual[i]);
    const eNorm = normalizeSegment(expected[i]);
    expect(aNorm, `${name}: segment ${i} mismatch`).toEqual(eNorm);
  }
}

describe('Golden Samples', () => {
  const fixtures = [
    { name: 'translation-article.md', golden: 'translation-article.jsonl' },
    { name: 'code-with-comments.py', golden: 'code-with-comments.jsonl' },
    { name: 'plain-text.md', golden: 'plain-text.jsonl' },
  ];

  for (const { name, golden } of fixtures) {
    it(`matches golden sample: ${name}`, () => {
      const fixturePath = path.join(FIXTURES_DIR, name);
      const goldenPath = path.join(GOLDEN_DIR, golden);

      expect(fs.existsSync(fixturePath), `Fixture not found: ${fixturePath}`).toBe(true);
      expect(fs.existsSync(goldenPath), `Golden sample not found: ${goldenPath}`).toBe(true);

      const extractor = new SegmentExtractor(fixturePath);
      const actual = extractor.extract();
      const expected = loadJsonl(goldenPath);

      compareSegments(actual, expected, name);
    });
  }
});
