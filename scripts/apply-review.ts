#!/usr/bin/env tsx
/**
 * 应用已批准的中文校对修改。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ── 类型定义 ──────────────────────────────────────────────

interface ReviewItem {
  path: string;
  line_start: number;
  line_end?: number;
  char_offset?: number;
  original: string;
  text?: string;
  suggestion?: string;
  correction?: string;
  status: string;
}

interface AcceptedItem {
  path: string;
  original: string;
  replacement: string;
  line_start: number;
  line_end: number;
  char_offset: number;
}

// ── 工具函数 ──────────────────────────────────────────────

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function normalizeStatus(value: unknown): string {
  if (value == null) return '';
  return String(value).replace(/[_-]/g, ' ').trim().toUpperCase().replace(/\s+/g, ' ');
}

// ── 加载审查文件 ──────────────────────────────────────────

function loadReview(reviewPath: string): { accepted: AcceptedItem[]; skipped: number } {
  const accepted: AcceptedItem[] = [];
  let skipped = 0;
  const errors: string[] = [];

  let content: string;
  try {
    content = fs.readFileSync(reviewPath, 'utf-8');
  } catch (e) {
    die(`cannot read review file: ${e}`);
  }

  const lines = content.split('\n').filter(l => l.trim());

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    let item: ReviewItem;
    try {
      item = JSON.parse(lines[idx]);
    } catch (e) {
      errors.push(`${reviewPath}:${lineNum}: invalid JSON: ${e}`);
      continue;
    }

    const status = normalizeStatus(item.status);
    if (!status || status === 'PENDING') {
      errors.push(`${reviewPath}:${lineNum}: status is PENDING or missing`);
      continue;
    }

    if (['FALSE POSITIVE', 'FALSEPOSITIVE', 'SKIP', 'REJECT'].includes(status)) {
      skipped++;
      continue;
    }

    if (!['ACCEPT', 'CUSTOM'].includes(status)) {
      errors.push(`${reviewPath}:${lineNum}: unsupported status: ${item.status}`);
      continue;
    }

    // 验证必填字段
    const filePath = item.path;
    const original = item.original ?? item.text;
    const suggestion = item.suggestion;

    if (!filePath?.trim()) {
      errors.push(`${reviewPath}:${lineNum}: missing path`);
      continue;
    }
    if (!original) {
      errors.push(`${reviewPath}:${lineNum}: missing original text`);
      continue;
    }

    let replacement: string;
    if (status === 'CUSTOM') {
      const correction = item.correction;
      if (!correction?.trim()) {
        errors.push(`${reviewPath}:${lineNum}: CUSTOM requires correction`);
        continue;
      }
      replacement = correction;
    } else {
      if (!suggestion) {
        errors.push(`${reviewPath}:${lineNum}: ACCEPT but no suggestion`);
        continue;
      }
      replacement = suggestion;
    }

    // 解析路径
    let resolvedPath = path.resolve(filePath);
    if (!path.isAbsolute(filePath)) {
      resolvedPath = path.resolve(path.dirname(reviewPath), filePath);
    }

    const lineStart = item.line_start;
    if (lineStart == null) {
      errors.push(`${reviewPath}:${lineNum}: missing line_start`);
      continue;
    }

    accepted.push({
      path: resolvedPath,
      original: String(original),
      replacement: String(replacement),
      line_start: lineStart,
      line_end: item.line_end ?? lineStart,
      char_offset: item.char_offset ?? 0,
    });
  }

  if (errors.length) {
    die(errors.join('\n'));
  }

  return { accepted, skipped };
}

// ── 应用修改 ──────────────────────────────────────────────

function applyChanges(accepted: AcceptedItem[], dryRun = false): Record<string, number> {
  // 按文件分组
  const changesByFile = new Map<string, AcceptedItem[]>();
  for (const item of accepted) {
    const list = changesByFile.get(item.path) ?? [];
    list.push(item);
    changesByFile.set(item.path, list);
  }

  const results: Record<string, number> = {};

  for (const [filepath, items] of changesByFile) {
    if (!fs.existsSync(filepath)) {
      die(`Missing file: ${filepath}`);
    }

    let content: string;
    try {
      content = fs.readFileSync(filepath, 'utf-8');
    } catch (e) {
      die(`${filepath}: unable to read file: ${e}`);
    }

    const lines = content.split('\n');

    // 按行号从后往前排序，避免修改影响后续行号
    items.sort((a, b) => (b.line_start - a.line_start) || (b.char_offset - a.char_offset));

    let appliedCount = 0;
    for (const item of items) {
      const lineIdx = item.line_start - 1;
      if (lineIdx < 0 || lineIdx >= lines.length) {
        console.error(`Warning: line ${item.line_start} out of range in ${filepath}`);
        continue;
      }

      const line = lines[lineIdx];
      const { original, replacement } = item;

      // 尝试在行内定位原文
      let foundIdx = line.indexOf(original, item.char_offset);
      if (foundIdx < 0) {
        foundIdx = line.indexOf(original);
      }

      if (foundIdx < 0) {
        // 尝试跨行匹配
        const multiLineText = lines.slice(item.line_start - 1, item.line_end).join('\n');
        const multiIdx = multiLineText.indexOf(original);
        if (multiIdx >= 0) {
          if (dryRun) {
            console.log(`--- ${filepath}:${item.line_start}`);
            console.log(`- ${original}`);
            console.log(`+ ${replacement}`);
            console.log('');
          } else {
            const newText = multiLineText.slice(0, multiIdx) + replacement + multiLineText.slice(multiIdx + original.length);
            const newLines = newText.split('\n');
            lines.splice(item.line_start - 1, item.line_end! - item.line_start + 1, ...newLines);
          }
          appliedCount++;
          continue;
        } else {
          console.error(`Warning: cannot find "${original}" in ${filepath}:${item.line_start}`);
          continue;
        }
      }

      if (dryRun) {
        console.log(`--- ${filepath}:${item.line_start}`);
        console.log(`- ${original}`);
        console.log(`+ ${replacement}`);
        console.log('');
      } else {
        // 单行替换
        lines[lineIdx] = line.slice(0, foundIdx) + replacement + line.slice(foundIdx + original.length);
      }
      appliedCount++;
    }

    if (!dryRun && appliedCount > 0) {
      const newContent = lines.join('\n');
      const tmpFile = path.join(
        path.dirname(filepath),
        `.${path.basename(filepath)}.zh-lint-${Date.now()}.tmp`
      );
      try {
        fs.writeFileSync(tmpFile, newContent, 'utf-8');
        fs.renameSync(tmpFile, filepath);
        results[filepath] = appliedCount;
      } catch (e) {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        die(`${filepath}: failed to write: ${e}`);
      }
    } else if (dryRun) {
      results[filepath] = appliedCount;
    }
  }

  return results;
}

// ── CLI ───────────────────────────────────────────────────

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const args = process.argv.slice(2).filter(a => a !== '--dry-run');

  if (args.length < 1) {
    die('Usage: apply-review.ts [--dry-run] <review.jsonl>');
  }

  const reviewPath = args[0];
  if (!fs.existsSync(reviewPath)) {
    die(`Review file not found: ${reviewPath}`);
  }

  const { accepted, skipped } = loadReview(reviewPath);

  if (!accepted.length) {
    console.log('No accepted corrections to apply.');
    if (skipped) {
      console.log(`Skipped ${skipped} items marked as false positives.`);
    }
    return;
  }

  if (dryRun) {
    console.log(`预览 ${accepted.length} 条待应用的修改:\n`);
  }

  const results = applyChanges(accepted, dryRun);

  const total = Object.values(results).reduce((a, b) => a + b, 0);
  if (dryRun) {
    console.log(`共 ${total} 条修改，涉及 ${Object.keys(results).length} 个文件。`);
    console.log(`\n如需应用修改，请去掉 --dry-run 参数重新运行。`);
  } else {
    console.log(`Applied ${total} corrections across ${Object.keys(results).length} files.`);
  }
  if (skipped) {
    console.log(`Skipped ${skipped} items marked as false positives.`);
  }
}

main();
