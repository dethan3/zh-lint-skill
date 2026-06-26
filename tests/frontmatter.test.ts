import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SegmentExtractor } from '../scripts/extract-segments.js';

describe('FrontmatterParsing', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-proofread-fm-'));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filepath = path.join(tmpdir, name);
    fs.writeFileSync(filepath, content, 'utf-8');
    return filepath;
  }

  it('translation article with original and translator', () => {
    const filepath = writeFile('test.md', `\
---
title: 如何快速学习
original: https://example.com/article
translator: "yiwei"
---

这是正文内容。
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].source_url).toBe('https://example.com/article');
    expect(segments[0].is_translation).toBe(true);
  });

  it('translation article with source field', () => {
    const filepath = writeFile('test.md', `\
---
title: 文章
source: https://example.com/post
translator: "someone"
---

正文内容。
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments[0].source_url).toBe('https://example.com/post');
    expect(segments[0].is_translation).toBe(true);
  });

  it('non-translation article with original', () => {
    const filepath = writeFile('test.md', `\
---
title: 转载文章
original: https://example.com/chinese-article
---

这是中文原文的转载。
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments[0].source_url).toBe('https://example.com/chinese-article');
    expect(segments[0].is_translation).toBeUndefined();
  });

  it('no frontmatter', () => {
    const filepath = writeFile('test.md', `\
# 标题

这是正文内容。
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments.length).toBeGreaterThan(0);
    expect(segments[0].source_url).toBeUndefined();
    expect(segments[0].is_translation).toBeUndefined();
  });

  it('line numbers with frontmatter', () => {
    const filepath = writeFile('test.md', `\
---
title: 测试
original: https://example.com
translator: "test"
---

第一段正文。

第二段正文。
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    // frontmatter 占 5 行（1-5），空行第 6 行，正文从第 7 行开始
    expect(segments[0].line_start).toBe(7);
    expect(segments[1].line_start).toBe(9);
  });

  it('non-markdown file no frontmatter', () => {
    const filepath = writeFile('test.py', `\
# 这是注释
x = "中文字符串"
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    for (const seg of segments) {
      expect(seg.source_url).toBeUndefined();
      expect(seg.is_translation).toBeUndefined();
    }
  });

  it('translation with categories Translation marker', () => {
    const filepath = writeFile('test.md', `\
---
title: 文章
original: https://example.com/en/article
categories:
  - Translation
---

这是翻译后的正文。
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments[0].source_url).toBe('https://example.com/en/article');
  });
});
