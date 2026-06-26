# 中文校对 Skill (zh-proofread)

检查代码注释、文档和纯文本中的中文错别字和语病。

## 与 typos-skill 的区别

| | typos-skill | zh-proofread |
|---|---|---|
| 检查对象 | 英文拼写 | 中文错别字和语病 |
| 检查引擎 | `typos-cli` 规则引擎 | LLM 语义理解 |
| 误报处理 | 规则分类 | LLM 判断 + 保守策略 |
| 应用方式 | 相同（先审查再修改） | 相同（先审查再修改） |

## 安装

### Claude Code

```bash
cp -r zh-proofread-skill ~/.claude/skills/zh-proofread
```

### Codex

```bash
cp -r zh-proofread-skill ${CODEX_HOME:-$HOME/.codex}/skills/zh-proofread
```

## 使用方法

### 扫描当前目录

```bash
./zh-proofread.sh
./zh-proofread.sh --summary  # 只显示统计
```

### 扫描指定路径

```bash
./zh-proofread.sh src/ docs/
```

### 导出审查文件

```bash
./zh-proofread.sh --export-review review.jsonl src/
```

### 批量处理

对于大型代码库，可以使用批量模式分批处理：

```bash
# 每批处理 50 个段落
./zh-proofread.sh --export-review review.jsonl --batch-size 50 src/

# 续传：跳过前 50 个段落
./zh-proofread.sh --export-review review.jsonl --batch-size 50 --batch-offset 50 src/
```

### 预览修改差异

```bash
./zh-proofread.sh --diff review.jsonl
```

### 应用已批准的修改

```bash
./zh-proofread.sh --apply-review review.jsonl
```

## 工作流程

1. **提取**：扫描源文件，提取包含中文的文本段
2. **审查**：LLM 逐段检查错别字和语病
3. **确认**：人工或 LLM 审批每条修改建议
4. **应用**：只修改已批准的内容

## 审查文件格式

导出的 `review.jsonl` 每行一个 JSON 对象：

```json
{
  "path": "src/main.py",
  "line_start": 42,
  "line_end": 42,
  "char_offset": 4,
  "text": "这个函授用来处理请求",
  "original": "这个函授用来处理请求",
  "suggestion": "这个函数用来处理请求",
  "issue_type": "typo",
  "confidence": "high",
  "reason": "'授' 应为 '数'，字形相似导致的错别字",
  "status": "PENDING",
  "context_type": "comment",
  "language": "python"
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `path` | 文件路径 |
| `line_start` / `line_end` | 起止行号 |
| `char_offset` | 行内字符偏移 |
| `text` | 提取的中文文本 |
| `original` | 原文（用于替换） |
| `suggestion` | 建议修改 |
| `issue_type` | 问题类型 |
| `confidence` | 置信度：high / medium / low |
| `reason` | 判断理由 |
| `status` | 审查状态 |

### 审查状态

| 状态 | 说明 |
|------|------|
| `PENDING` | 待审查 |
| `ACCEPT` | 接受建议修改 |
| `FALSE POSITIVE` | 误报，跳过 |
| `CUSTOM` | 使用自定义修改（需填 `correction` 字段） |

## 支持的文件类型

- **源代码**：Python, JavaScript, TypeScript, Go, Rust, C/C++, Java, Ruby, PHP, Shell 等
- **文档**：Markdown, RST, 纯文本
- **配置**：YAML, TOML, JSON

## 检查的问题类型

| 类型 | 说明 | 示例 |
|------|------|------|
| typo | 错别字 | "以经" → "已经" |
| grammar | 语法错误 | "通过...使..." 主语残缺 |
| awkward | 不通顺 | 语序不当、表达别扭 |
| redundancy | 重复累赘 | "涉及到" → "涉及" |
| wrong_word | 用词不当 | "观点很宏大" → "观点很深刻" |

## 配置文件

支持 `.zh-proofread.toml` 配置文件：

```toml
# 排除的路径
[exclude]
paths = ["vendor", "node_modules", "*.min.js"]

# 白名单术语（不会被标记为错误）
[whitelist]
terms = ["正则表达式", "哈希表", "yyds"]
```

配置文件查找顺序：
1. 当前目录 `.zh-proofread.toml`
2. 用户主目录 `~/.zh-proofread.toml`

## 依赖

- Node.js 18+
- tsx（`npm install -g tsx` 或项目内 `npm install`）

## 文件结构

```
zh-proofread-skill/
├── SKILL.md                      # Agent 指令
├── skill.json                    # 元数据
├── zh-proofread.sh               # 主入口脚本（唯一入口）
├── scripts/
│   ├── extract-segments.ts       # 中文文本提取
│   ├── apply-review.ts           # 应用已批准的修改
│   └── smoke-test.sh             # 端到端冒烟测试
├── tests/                        # 单元测试（Vitest）
├── examples/                     # 示例文件
├── agents/
│   └── openai.yaml               # Agent 平台元数据
├── .zh-proofread.toml            # 配置文件示例
├── README.md                     # 本文件
└── LICENSE
```

## 运行测试

```bash
npm test
```

## 许可证

MIT
