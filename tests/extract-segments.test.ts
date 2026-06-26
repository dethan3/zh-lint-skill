import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  containsChinese,
  getLanguage,
  isTextFile,
  scanPaths,
} from '../scripts/extract-segments.js';
import { SegmentExtractor } from '../scripts/extract-segments.js';

// ── containsChinese ───────────────────────────────────────

describe('containsChinese', () => {
  it('pure chinese', () => {
    expect(containsChinese('你好世界')).toBe(true);
  });

  it('mixed chinese english', () => {
    expect(containsChinese('hello 你好 world')).toBe(true);
  });

  it('pure english', () => {
    expect(containsChinese('hello world')).toBe(false);
  });

  it('empty string', () => {
    expect(containsChinese('')).toBe(false);
  });

  it('chinese punctuation', () => {
    expect(containsChinese('，。！？')).toBe(true);
  });

  it('chinese numbers in context', () => {
    expect(containsChinese('第1章')).toBe(true);
  });

  it('code with chinese comment', () => {
    expect(containsChinese('# 这是注释')).toBe(true);
  });
});

// ── getLanguage ────────────────────────────────────────────

describe('getLanguage', () => {
  it('python', () => expect(getLanguage('test.py')).toBe('python'));
  it('javascript', () => expect(getLanguage('test.js')).toBe('javascript'));
  it('typescript', () => expect(getLanguage('test.ts')).toBe('typescript'));
  it('go', () => expect(getLanguage('test.go')).toBe('go'));
  it('rust', () => expect(getLanguage('test.rs')).toBe('rust'));
  it('markdown', () => expect(getLanguage('test.md')).toBe('markdown'));
  it('unknown extension', () => expect(getLanguage('test.xyz')).toBe('unknown'));
});

// ── isTextFile ─────────────────────────────────────────────

describe('isTextFile', () => {
  it('python file', () => expect(isTextFile('test.py')).toBe(true));
  it('markdown file', () => expect(isTextFile('test.md')).toBe(true));
  it('binary file', () => expect(isTextFile('test.bin')).toBe(false));
  it('image file', () => expect(isTextFile('test.png')).toBe(false));
});

// ── SegmentExtractor ──────────────────────────────────────

describe('SegmentExtractor', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-lint-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filepath = path.join(tmpdir, name);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content, 'utf-8');
    return filepath;
  }

  it('python comments', () => {
    const filepath = writeFile('test.py', `\
# 这是第一行注释
def foo():
    # 这是函数内的注释
    pass
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    const texts = segments.map(s => s.text);
    expect(texts).toContain('这是第一行注释');
    expect(texts).toContain('这是函数内的注释');
  });

  it('python string', () => {
    const filepath = writeFile('test.py', `\
msg = "你好世界"
print('测试字符串')
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    const texts = segments.map(s => s.text);
    expect(texts).toContain('你好世界');
    expect(texts).toContain('测试字符串');
  });

  it('markdown paragraph', () => {
    const filepath = writeFile('test.md', `\
# 标题

这是一个段落，包含中文内容。

这是另一个段落。

\`\`\`python
# 代码块中的注释应该被忽略
x = 1
\`\`\`
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    const texts = segments.map(s => s.text);
    expect(texts.some(t => t.includes('标题'))).toBe(true);
    expect(texts.some(t => t.includes('这是一个段落'))).toBe(true);
    expect(segments.some(s => s.text.includes('代码块中的注释'))).toBe(false);
  });

  it('javascript comment', () => {
    const filepath = writeFile('test.js', `\
// 这是JS注释
function hello() {
    /* 多行
       注释 */
    return "测试";
}
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    const texts = segments.map(s => s.text);
    expect(texts).toContain('这是JS注释');
  });

  it('empty file', () => {
    const filepath = writeFile('empty.py', '');
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments).toHaveLength(0);
  });

  it('no chinese', () => {
    const filepath = writeFile('english.py', `\
# This is a comment
def hello():
    return "world"
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    expect(segments).toHaveLength(0);
  });

  it('context type', () => {
    const filepath = writeFile('test.py', `\
# 注释中的中文
msg = "字符串中的中文"
`);
    const extractor = new SegmentExtractor(filepath);
    const segments = extractor.extract();
    const types = Object.fromEntries(segments.map(s => [s.text, s.context_type]));
    expect(types['注释中的中文']).toBe('comment');
    expect(types['字符串中的中文']).toBe('string');
  });
});

// ── scanPaths ──────────────────────────────────────────────

describe('scanPaths', () => {
  let tmpdir: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'zh-lint-scan-'));
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filepath = path.join(tmpdir, name);
    fs.mkdirSync(path.dirname(filepath), { recursive: true });
    fs.writeFileSync(filepath, content, 'utf-8');
    return filepath;
  }

  it('scan single file', () => {
    writeFile('test.py', '# 中文注释');
    const segments = scanPaths([path.join(tmpdir, 'test.py')]);
    expect(segments.length).toBeGreaterThan(0);
  });

  it('scan directory', () => {
    writeFile('a.py', '# 中文A');
    writeFile('b.py', '# 中文B');
    const segments = scanPaths([tmpdir]);
    const texts = segments.map(s => s.text);
    expect(texts.some(t => t.includes('中文A'))).toBe(true);
    expect(texts.some(t => t.includes('中文B'))).toBe(true);
  });

  it('exclude patterns', () => {
    writeFile('keep.py', '# 保留');
    writeFile('vendor/skip.py', '# 跳过');
    const segments = scanPaths([tmpdir], ['vendor']);
    const texts = segments.map(s => s.text);
    expect(texts.some(t => t.includes('保留'))).toBe(true);
    expect(texts.some(t => t.includes('跳过'))).toBe(false);
  });
});
