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
    return runApplyInCwd(reviewPath, path.resolve(__dirname, '..'));
  }

  function runApplyInCwd(
    reviewPath: string,
    cwd: string
  ): { stdout: string; stderr: string; code: number } {
    const { execFileSync } = require('node:child_process');
    const repoRoot = path.resolve(__dirname, '..');
    const tsxBin = path.join(repoRoot, 'node_modules/.bin/tsx');
    const scriptPath = path.join(repoRoot, 'scripts/apply-review.ts');
    try {
      const stdout = execFileSync(tsxBin, [scriptPath, reviewPath], {
        encoding: 'utf-8',
        cwd,
      });
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

  it('resolves relative paths from current working directory before review directory', () => {
    const target = writeFile('target.md', '这是原文内容。');
    const reviewDir = path.join(tmpdir, 'reviews');
    fs.mkdirSync(reviewDir);
    const review = path.join(reviewDir, 'review.jsonl');
    fs.writeFileSync(review, JSON.stringify({
      path: 'target.md',
      line_start: 1,
      original: '这是原文内容',
      suggestion: '这是修改后内容',
      status: 'ACCEPT',
    }), 'utf-8');

    const result = runApplyInCwd(review, tmpdir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied 1 corrections');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('这是修改后内容。');
  });

  it('skips ambiguous matches when char_offset does not identify one occurrence', () => {
    const target = writeFile('target.md', '重复 重复');
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 1,
      char_offset: 1,
      original: '重复',
      suggestion: '改写',
      status: 'ACCEPT',
    }));

    const result = runApply(review);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied 0 corrections');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('重复 重复');
  });

  it('uses exact char_offset when the same original appears multiple times', () => {
    const target = writeFile('target.md', '重复 重复');
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 1,
      char_offset: 3,
      original: '重复',
      suggestion: '改写',
      status: 'ACCEPT',
    }));

    const result = runApply(review);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Applied 1 corrections');

    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toBe('重复 改写');
  });

  it('preserves file mode when applying corrections', () => {
    const target = writeFile('script.sh', '#!/bin/sh\necho 从新输入\n');
    fs.chmodSync(target, 0o755);
    const review = writeFile('review.jsonl', JSON.stringify({
      path: target,
      line_start: 2,
      original: '从新输入',
      suggestion: '重新输入',
      status: 'ACCEPT',
    }));

    const result = runApply(review);
    expect(result.code).toBe(0);

    const mode = fs.statSync(target).mode & 0o777;
    expect(mode).toBe(0o755);
    const content = fs.readFileSync(target, 'utf-8');
    expect(content).toContain('重新输入');
  });
});
