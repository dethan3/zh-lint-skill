#!/usr/bin/env tsx
/**
 * 从源文件中提取包含中文的文本段，输出为 JSONL。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ── 类型定义 ──────────────────────────────────────────────

interface Segment {
  path: string;
  line_start: number;
  line_end: number;
  char_offset: number;
  text: string;
  context_type: 'comment' | 'string' | 'prose';
  language: string;
  surrounding_code: string;
  source_url?: string;
  is_translation?: boolean;
}

interface Config {
  exclude?: { paths?: string[] };
  whitelist?: { terms?: string[] };
}

// ── 中文字符检测 ──────────────────────────────────────────

const ZH_PATTERN = new RegExp(
  '[' +
    '\\u4e00-\\u9fff' +       // CJK Unified Ideographs
    '\\u3400-\\u4dbf' +       // CJK Unified Ideographs Extension A
    '\\u{20000}-\\u{2a6df}' + // CJK Unified Ideographs Extension B
    '\\u{2a700}-\\u{2b73f}' + // CJK Unified Ideographs Extension C
    '\\u{2b740}-\\u{2b81f}' + // CJK Unified Ideographs Extension D
    '\\uf900-\\ufaff' +       // CJK Compatibility Ideographs
    '\\u2e80-\\u2eff' +       // CJK Radicals Supplement
    '\\u3000-\\u303f' +       // CJK Symbols and Punctuation
    '\\uff00-\\uffef' +       // Halfwidth and Fullwidth Forms
  ']',
  'u'
);

export function containsChinese(text: string): boolean {
  return ZH_PATTERN.test(text);
}

// ── 语言推断 ──────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  '.py': 'python', '.pyi': 'python',
  '.js': 'javascript', '.mjs': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript',
  '.jsx': 'javascript',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.java': 'java',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.md': 'markdown', '.mdx': 'markdown',
  '.txt': 'text',
  '.rst': 'text',
  '.html': 'html', '.htm': 'html',
  '.xml': 'xml',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.sql': 'sql',
  '.lua': 'lua',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.cs': 'csharp',
  '.vue': 'vue',
  '.svelte': 'svelte',
};

const TEXT_EXTS = new Set([
  '.py', '.pyi', '.js', '.mjs', '.ts', '.tsx', '.jsx',
  '.go', '.rs', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp',
  '.java', '.rb', '.php', '.sh', '.bash', '.zsh',
  '.md', '.mdx', '.txt', '.rst',
  '.html', '.htm', '.xml', '.css', '.scss', '.less',
  '.sql', '.lua', '.swift', '.kt', '.scala', '.cs',
  '.vue', '.svelte', '.toml', '.yaml', '.yml', '.json',
]);

export function getLanguage(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase();
  return LANG_MAP[ext] ?? 'unknown';
}

export function isTextFile(filepath: string): boolean {
  const ext = path.extname(filepath).toLowerCase();
  return TEXT_EXTS.has(ext);
}

// ── 注释和字符串模式 ──────────────────────────────────────

const SINGLE_LINE_PATTERNS: Array<[RegExp, string]> = [
  [/#(.*)/, '#'],
  [/\/\/(.*)/, '//'],
  [/--(.*)/, '--'],
  [/%(.*)/, '%'],
  [/;(.*)/, ';'],
];

const MULTI_LINE_MARKERS: Array<[string, string]> = [
  ['/*', '*/'],
  ['"""', '"""'],
  ["'''", "'''"],
  ['{-', '-}'],
  ['<!--', '-->'],
];

const STRING_PATTERNS = [
  /"((?:[^"\\]|\\.)*)"/g,
  /'((?:[^'\\]|\\.)*)'/g,
  /`((?:[^`\\]|\\.)*)`/g,
];

const COMMENT_PREFIXES: Record<string, string> = {
  python: '#', ruby: '#', shell: '#', yaml: '#',
  javascript: '//', typescript: '//', go: '//',
  rust: '//', c: '//', cpp: '//', java: '//',
  php: '//', swift: '//', kotlin: '//', scala: '//',
  csharp: '//', lua: '--', sql: '--',
};

// ── 提取函数 ──────────────────────────────────────────────

function extractStringsFromLine(line: string): Array<[number, string]> {
  const results: Array<[number, string]> = [];
  for (const pattern of STRING_PATTERNS) {
    const re = new RegExp(pattern.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const text = m[1];
      if (containsChinese(text)) {
        results.push([m.index + 1, text]);
      }
    }
  }
  return results;
}

function extractSingleLineComment(
  line: string, language: string
): [number, string] | null {
  const prefix = COMMENT_PREFIXES[language];
  if (prefix) {
    const idx = line.indexOf(prefix);
    if (idx >= 0) {
      const comment = line.slice(idx + prefix.length).trim();
      if (containsChinese(comment)) {
        return [idx + prefix.length, comment];
      }
    }
    return null;
  }

  // 尝试所有单行注释模式
  for (const [pattern, _pfx] of SINGLE_LINE_PATTERNS) {
    const m = pattern.exec(line);
    if (m && containsChinese(m[1])) {
      return [m.index + m[0].indexOf(m[1]), m[1].trim()];
    }
  }
  return null;
}

// ── 段落提取器 ────────────────────────────────────────────

export class SegmentExtractor {
  private filepath: string;
  private language: string;
  private sourceUrl?: string;
  private isTranslation = false;
  private whitelistTerms: Set<string>;

  // 翻译文章检测字段
  private static SOURCE_URL_FIELDS = ['original', 'source', 'source_url', 'url'];
  private static TRANSLATOR_FIELDS = ['translator', 'translated_by', '译者'];

  constructor(filepath: string, whitelistTerms?: string[]) {
    this.filepath = filepath;
    this.language = getLanguage(filepath);
    this.whitelistTerms = new Set(whitelistTerms ?? []);
  }

  extract(): Segment[] {
    let text: string;
    try {
      text = fs.readFileSync(this.filepath, 'utf-8');
    } catch {
      return [];
    }
    const lines = text.split('\n');

    if (this.language === 'markdown') {
      return this.extractMarkdown(lines);
    } else if (this.language === 'text') {
      return this.extractPlainText(lines);
    } else {
      return this.extractCode(lines);
    }
  }

  // ── Frontmatter 解析 ──

  private parseFrontmatter(lines: string[]): { content: string[]; offset: number } {
    if (!lines.length || lines[0].trim() !== '---') {
      return { content: lines, offset: 0 };
    }

    let endIdx = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        endIdx = i;
        break;
      }
    }

    if (endIdx < 0) {
      return { content: lines, offset: 0 };
    }

    const frontmatter = lines.slice(1, endIdx);

    // 提取原文链接
    for (const field of SegmentExtractor.SOURCE_URL_FIELDS) {
      const pattern = new RegExp(`^${field}\\s*:\\s*(.+)$`, 'i');
      for (const line of frontmatter) {
        const m = pattern.exec(line.trim());
        if (m) {
          const url = m[1].trim().replace(/^["']|["']$/g, '');
          if (url.startsWith('http')) {
            this.sourceUrl = url;
            break;
          }
        }
      }
      if (this.sourceUrl) break;
    }

    // 检测翻译者字段
    for (const field of SegmentExtractor.TRANSLATOR_FIELDS) {
      const pattern = new RegExp(`^${field}\\s*:`, 'i');
      for (const line of frontmatter) {
        if (pattern.test(line.trim())) {
          this.isTranslation = true;
          break;
        }
      }
      if (this.isTranslation) break;
    }

    // 有原文链接但无翻译者，检查其他翻译标记
    if (this.sourceUrl && !this.isTranslation) {
      for (const line of frontmatter) {
        if (['译', 'translation', 'translated'].some(m => line.includes(m))) {
          this.isTranslation = true;
          break;
        }
      }
    }

    return { content: lines.slice(endIdx + 1), offset: endIdx + 1 };
  }

  // ── Markdown 提取 ──

  private extractMarkdown(lines: string[]): Segment[] {
    const { content, offset: fmEnd } = this.parseFrontmatter(lines);

    const segments: Segment[] = [];
    let inCodeBlock = false;
    let currentParagraph: string[] = [];
    let paragraphStart = 0;

    for (let i = 0; i < content.length; i++) {
      const line = content[i];
      const lineNum = i + 1 + fmEnd;

      // 代码块切换
      if (line.trim().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (currentParagraph.length) {
          this.flushParagraph(segments, currentParagraph, paragraphStart, lineNum - 1);
          currentParagraph = [];
        }
        continue;
      }

      if (inCodeBlock) continue;

      // 空行分隔段落
      if (!line.trim()) {
        if (currentParagraph.length) {
          this.flushParagraph(segments, currentParagraph, paragraphStart, lineNum - 1);
          currentParagraph = [];
        }
        continue;
      }

      // 标题行
      if (line.startsWith('#')) {
        if (currentParagraph.length) {
          this.flushParagraph(segments, currentParagraph, paragraphStart, lineNum - 1);
          currentParagraph = [];
        }
        const titleText = line.replace(/^#+\s*/, '').trim();
        if (containsChinese(titleText)) {
          const seg = this.makeSegment(lineNum, lineNum, 0, titleText, 'prose', line);
          if (seg) segments.push(seg);
        }
        continue;
      }

      // 正文段落
      if (!currentParagraph.length) {
        paragraphStart = lineNum;
      }
      currentParagraph.push(line);
    }

    // 处理最后一个段落
    if (currentParagraph.length) {
      this.flushParagraph(segments, currentParagraph, paragraphStart, lines.length);
    }

    return segments;
  }

  private flushParagraph(
    segments: Segment[],
    paragraphLines: string[],
    startLine: number,
    endLine: number
  ): void {
    const text = paragraphLines.join('\n').trim();
    if (containsChinese(text)) {
      const seg = this.makeSegment(
        startLine, endLine, 0, text, 'prose', paragraphLines[0] ?? ''
      );
      if (seg) segments.push(seg);
    }
  }

  // ── 纯文本提取 ──

  private extractPlainText(lines: string[]): Segment[] {
    const segments: Segment[] = [];
    let currentParagraph: string[] = [];
    let paragraphStart = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;

      if (!lines[i].trim()) {
        if (currentParagraph.length) {
          this.flushParagraph(segments, currentParagraph, paragraphStart, lineNum - 1);
          currentParagraph = [];
        }
        continue;
      }

      if (!currentParagraph.length) {
        paragraphStart = lineNum;
      }
      currentParagraph.push(lines[i]);
    }

    if (currentParagraph.length) {
      this.flushParagraph(segments, currentParagraph, paragraphStart, lines.length);
    }

    return segments;
  }

  // ── 代码提取 ──

  private extractCode(lines: string[]): Segment[] {
    const segments: Segment[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const lineNum = i + 1;

      // 多行注释
      const multiResult = this.tryMultiLineComment(lines, i);
      if (multiResult) {
        segments.push(multiResult.segment);
        i = multiResult.endLine + 1;
        continue;
      }

      // 单行注释
      const comment = extractSingleLineComment(line, this.language);
      if (comment) {
        const [offset, text] = comment;
        if (containsChinese(text)) {
          const seg = this.makeSegment(lineNum, lineNum, offset, text, 'comment', line);
          if (seg) segments.push(seg);
        }
      }

      // 字符串字面量
      const strings = extractStringsFromLine(line);
      for (const [offset, text] of strings) {
        const seg = this.makeSegment(lineNum, lineNum, offset, text, 'string', line);
        if (seg) segments.push(seg);
      }

      i++;
    }

    return segments;
  }

  private tryMultiLineComment(
    lines: string[], start: number
  ): { segment: Segment; endLine: number } | null {
    const line = lines[start];

    for (const [openMark, closeMark] of MULTI_LINE_MARKERS) {
      const openIdx = line.indexOf(openMark);
      if (openIdx < 0) continue;

      // 寻找闭合标记
      const closeIdx = line.indexOf(closeMark, openIdx + openMark.length);
      if (closeIdx >= 0) {
        // 单行内的多行注释
        const commentText = line.slice(openIdx + openMark.length, closeIdx);
        if (containsChinese(commentText)) {
          const seg = this.makeSegment(
            start + 1, start + 1,
            openIdx + openMark.length, commentText, 'comment', line
          );
          if (seg) return { segment: seg, endLine: start };
          return null;
        }
      } else {
        // 跨行的多行注释
        const commentLines = [line.slice(openIdx + openMark.length)];
        let endLine = start + 1;
        while (endLine < lines.length) {
          const ci = lines[endLine].indexOf(closeMark);
          if (ci >= 0) {
            commentLines.push(lines[endLine].slice(0, ci));
            break;
          }
          commentLines.push(lines[endLine]);
          endLine++;
        }

        const commentText = commentLines.join('\n').trim();
        if (containsChinese(commentText)) {
          const seg = this.makeSegment(
            start + 1, endLine + 1,
            openIdx + openMark.length, commentText, 'comment', lines[start]
          );
          if (seg) return { segment: seg, endLine };
          return null;
        }
      }
    }

    return null;
  }

  // ── 构造 segment ──

  private makeSegment(
    lineStart: number,
    lineEnd: number,
    charOffset: number,
    text: string,
    contextType: Segment['context_type'],
    surrounding: string
  ): Segment | null {
    const trimmed = text.trim();
    // 白名单过滤：完全匹配的段落跳过
    if (this.whitelistTerms.has(trimmed)) {
      return null;
    }
    const seg: Segment = {
      path: this.filepath,
      line_start: lineStart,
      line_end: lineEnd,
      char_offset: charOffset,
      text: trimmed,
      context_type: contextType,
      language: this.language,
      surrounding_code: surrounding.slice(0, 200),
    };
    if (this.sourceUrl) {
      seg.source_url = this.sourceUrl;
    }
    if (this.isTranslation) {
      seg.is_translation = true;
    }
    return seg;
  }
}

// ── 路径扫描 ──────────────────────────────────────────────

function loadConfig(): Config {
  const candidates = [
    path.join(process.cwd(), '.zh-lint.toml'),
    path.join(process.env.HOME ?? '~', '.zh-lint.toml'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        // 简单的 TOML 解析（只处理基本的 key = value 和数组）
        const content = fs.readFileSync(candidate, 'utf-8');
        return parseSimpleToml(content);
      } catch {
        // 忽略配置文件错误
      }
    }
  }
  return {};
}

function parseSimpleToml(content: string): Config {
  // 简化的 TOML 解析，只处理 exclude.paths 和 whitelist.terms
  const config: Config = {};
  let currentSection = '';
  let currentArray: string[] | null = null;
  let arrayKey = '';

  function saveArray(): void {
    if (currentArray && currentSection && arrayKey) {
      if (currentSection === 'exclude') {
        config.exclude = { ...config.exclude, paths: currentArray };
      } else if (currentSection === 'whitelist') {
        config.whitelist = { ...config.whitelist, terms: currentArray };
      }
    }
  }

  for (const rawLine of content.split('\n')) {
    // 去除行内注释（不在引号内的 #）
    let trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 去除行内注释：找到不在引号内的 #
    let inQuote: string | null = null;
    let commentIdx = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inQuote) {
        if (ch === inQuote && trimmed[i - 1] !== '\\') inQuote = null;
      } else {
        if (ch === '"' || ch === "'") inQuote = ch;
        else if (ch === '#') { commentIdx = i; break; }
      }
    }
    if (commentIdx >= 0) trimmed = trimmed.slice(0, commentIdx).trim();

    // 节标题 [section]
    const sectionMatch = /^\[([^\]]+)\]$/.exec(trimmed);
    if (sectionMatch) {
      saveArray();
      currentSection = sectionMatch[1];
      currentArray = null;
      arrayKey = '';
      continue;
    }

    // 数组项（双引号或单引号）
    if (currentArray !== null && (trimmed.startsWith('"') || trimmed.startsWith("'"))) {
      const quote = trimmed[0];
      const m = new RegExp(`^${quote}([^${quote}]+)${quote}`).exec(trimmed);
      if (m) currentArray.push(m[1]);
      continue;
    }

    // 数组开始 key = [
    const arrayMatch = /^(\w+)\s*=\s*\[/.exec(trimmed);
    if (arrayMatch) {
      saveArray();
      arrayKey = arrayMatch[1];
      currentArray = [];
      // 检查是否在同一行关闭
      if (trimmed.includes(']')) {
        const inline = trimmed.match(/"([^"]+)"|'([^']+)'/g);
        if (inline) {
          currentArray = inline.map(s => s.replace(/^["']|["']$/g, ''));
        }
        saveArray();
        currentArray = null;
      }
      continue;
    }

    // 简单 key = value（忽略）
    // const kvMatch = /^(\w+)\s*=\s*"([^"]*)"/.exec(trimmed);
  }

  // 保存最后一个数组
  saveArray();

  return config;
}

export function scanPaths(
  paths: string[],
  excludePatterns?: string[],
  config?: Config
): Segment[] {
  const allSegments: Segment[] = [];
  const exclude = new Set(excludePatterns ?? []);
  const whitelistTerms = config?.whitelist?.terms ?? [];

  if (config) {
    for (const p of config.exclude?.paths ?? []) {
      exclude.add(p);
    }
  }

  for (const pathStr of paths) {
    const stat = tryStat(pathStr);
    if (!stat) continue;

    if (stat.isFile()) {
      if (isTextFile(pathStr)) {
        const extractor = new SegmentExtractor(pathStr, whitelistTerms);
        allSegments.push(...extractor.extract());
      }
    } else if (stat.isDirectory()) {
      const files = walkDir(pathStr).sort();
      for (const filepath of files) {
        if (!isTextFile(filepath)) continue;
        if ([...exclude].some(excl => filepath.includes(excl))) continue;
        const extractor = new SegmentExtractor(filepath, whitelistTerms);
        allSegments.push(...extractor.extract());
      }
    }
  }

  return allSegments;
}

function tryStat(p: string): fs.Stats | null {
  try { return fs.statSync(p); } catch { return null; }
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── CLI ───────────────────────────────────────────────────

interface CliArgs {
  paths: string[];
  exclude: string[];
  output?: string;
  summary: boolean;
  batchSize: number;
  batchOffset: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    paths: [],
    exclude: [],
    summary: false,
    batchSize: 0,
    batchOffset: 0,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-o' || arg === '--output') {
      args.output = argv[++i];
    } else if (arg === '--summary') {
      args.summary = true;
    } else if (arg === '--batch-size') {
      args.batchSize = parseInt(argv[++i], 10);
    } else if (arg === '--batch-offset') {
      args.batchOffset = parseInt(argv[++i], 10);
    } else if (arg === '--exclude') {
      while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        args.exclude.push(argv[++i]);
      }
    } else if (!arg.startsWith('-')) {
      args.paths.push(arg);
    }
    i++;
  }

  if (!args.paths.length) {
    args.paths = ['.'];
  }

  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();

  const defaultExclude = [
    'node_modules', '__pycache__', '.git', '.venv', 'venv',
    'vendor', 'dist', 'build', '.tox', '.mypy_cache',
  ];
  const exclude = [...defaultExclude, ...args.exclude];

  const segments = scanPaths(args.paths, exclude, config);

  if (!segments.length) {
    console.error('✅ 未找到中文文本段。');
    process.exit(0);
  }

  // 统计
  const stats = {
    total: segments.length,
    byType: {} as Record<string, number>,
    byFile: {} as Record<string, number>,
  };
  for (const seg of segments) {
    stats.byType[seg.context_type] = (stats.byType[seg.context_type] ?? 0) + 1;
    stats.byFile[seg.path] = (stats.byFile[seg.path] ?? 0) + 1;
  }

  // 批量模式
  let batchSegments = segments;
  let batchInfo = '';
  if (args.batchSize > 0) {
    const start = args.batchOffset;
    const end = Math.min(start + args.batchSize, segments.length);
    batchSegments = segments.slice(start, end);
    batchInfo = ` (批量: ${start + 1}-${end} / ${segments.length})`;
  }

  // 输出摘要
  console.error(`📊 共提取 ${stats.total} 个中文文本段${batchInfo}`);
  console.error(`   按类型: ${JSON.stringify(stats.byType)}`);
  console.error(`   按文件: ${Object.keys(stats.byFile).length} 个文件`);
  if (args.batchSize > 0) {
    const remaining = Math.max(0, segments.length - args.batchOffset - args.batchSize);
    if (remaining > 0) {
      console.error(`   剩余: ${remaining} 个段落待处理`);
    }
    console.error(`   续传: --batch-offset ${args.batchOffset + args.batchSize}`);
  }
  console.error('');

  if (args.summary) return;

  // 输出 JSONL
  const output = args.output ? fs.createWriteStream(args.output, 'utf-8') : null;

  for (let idx = 0; idx < batchSegments.length; idx++) {
    const seg = { ...batchSegments[idx] };
    const line = JSON.stringify(seg);
    if (output) {
      output.write(line + '\n');
    } else {
      console.log(line);
    }
  }

  if (output) {
    output.end();
    console.error(`📝 已写入 ${args.output}`);
  }
}

// 直接运行时执行 main
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               process.argv[1]?.endsWith('extract-segments.ts') ||
               process.argv[1]?.endsWith('extract-segments.js');

if (isMain) {
  main();
}
