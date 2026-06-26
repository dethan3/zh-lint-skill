import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 由于 apply-review.ts 的函数未导出，我们通过 CLI 集成测试来验证

describe('ApplyReview', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-lint-apply-'));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filepath = path.join(tmpdir, name);
    fs.writeFileSync(filepath, content, 'utf-8');
    return filepath;
  }

  function runApply(reviewPath: string): { stdout: string; stderr: string; code: number } {
    const { execSync } = require('node:child_process');
    try {
      const stdout = execSync(
        `npx tsx scripts/apply-review.ts ${reviewPath}`,
        { encoding: 'utf-8', cwd: path.resolve(__dirname, '..') }
      );
      return { stdout, stderr: '', code: 0 };
    } catch (e: any) {
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
    }
  }

  it('applies accepted corrections', () => {
    const target = writeFile('target.md', '这是原文内容。');
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 1,
      original: '这是原文内容',
      suggestion: '这是修改后内容',
      status: 'ACCEPT',
    }));

    const result = runApply(review);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied 1 corrections');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('这是修改后内容。');
  });

  it('skips false positives', () => {
    const target = writeFile('target.md', '这是原文内容。');
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 1,
      original: '这是原文内容',
      suggestion: '',
      status: 'FALSE POSITIVE',
    }));

    const result = runApply(review);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Skipped 1 items');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('这是原文内容。');
  });

  it('applies multiple corrections', () => {
    const target = writeFile('target.md', '第一行\n第二行\n第三行');
    const review = writeFile('review.jsonl', [
      JSON.stringify({ path: target, line_start: 1, original: '第一行', suggestion: '壹', status: 'ACCEPT' }),
      JSON.stringify({ path: target, line_start: 3, original: '第三行', suggestion: '叁', status: 'ACCEPT' }),
    ].join('\n'));

    const result = runApply(review);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied 2 corrections');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('壹\n第二行\n叁');
  });

  it('handles missing original text gracefully', () => {
    const target = writeFile('target.md', '这是原文内容。');
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 1,
      original: '不存在的文本',
      suggestion: '修改',
      status: 'ACCEPT',
    }));

    const result = runApply(review);
    // 应该成功完成（有 warning 但不报错）
    expect(result.code).toBe(0);

    // 原文不变
    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('这是原文内容。');
  });

  it('handles custom corrections', () => {
    const target = writeFile('target.md', '这是原文内容。');
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 1,
      original: '这是原文内容',
      correction: '这是自定义修改',
      status: 'CUSTOM',
    }));

    const result = runApply(review);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied 1 corrections');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('这是自定义修改。');
  });
});
