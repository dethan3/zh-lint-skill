---
name: zh-proofread
description: 检查中文文本中的错别字和语病，支持代码注释、文档、纯文本。
---

# 中文校对 Skill

当用户想要检查代码注释、文档或纯文本中的中文错别字和语病时，使用此 Skill。

## 工作流程

1. 运行 `<skill-dir>/zh-proofread.sh --export-review review.jsonl [path...]`
   提取中文文本段并生成审查文件。
2. 读取 `review.jsonl` 中的每条记录，对 `text` 字段进行审查。
3. 对每条记录判断是否存在以下问题：
   - **错别字**（typo）：字形或读音相似导致的用字错误，如"以经"→"已经"
   - **语法错误**（grammar）：成分残缺、搭配不当、语序不当
   - **语句不通顺**（awkward）：读起来别扭，需要调整语序或改写
   - **重复累赘**（redundancy）：如"涉及到"→"涉及"
   - **用词不当**（wrong_word）：如"观点很宏大"→"观点很深刻"
4. 更新每条记录：
   - `status`：`ACCEPT`（有问题）、`FALSE POSITIVE`（无问题）、`CUSTOM`（自定义修改）
   - `suggestion`：建议的修改内容（ACCEPT 时必须有）
   - `correction`：自定义修改内容（CUSTOM 时必须有）
   - `reason`：判断理由
   - `issue_type`：问题类型（typo / grammar / awkward / redundancy / wrong_word）
   - `confidence`：置信度（high / medium / low）
5. 运行 `<skill-dir>/zh-proofread.sh --apply-review review.jsonl` 应用已批准的修改。

## 审查原则

- **保守判断**：不确定的标记为 `FALSE POSITIVE`
- **技术术语跳过**：编程术语、API 名称、库名等自动跳过
- **专有名词跳过**：人名、地名、品牌名等不修改
- **网络用语跳过**：如"yyds"、"绝绝子"等不修改
- **优先给出建议**：对每个问题给出具体的修改建议，而非只指出问题
- **保留原意**：修改时保持原文的意思不变，只修正错误或改善表达

## 翻译文章检测与审查

如果记录中包含 `source_url` 字段，说明文件可能包含外文原文。按以下流程处理：

### 检测源语言

使用 `WebFetch` 访问 `source_url`，判断原文语言：
- 源语言 **非中文** → 本段为翻译文章，启用翻译专用审查规则
- 源语言 **是中文** → 本段为转载/引用，按普通中文校对处理
- **无法访问** → 按普通中文校对处理（保守策略）

### 翻译文章专用审查规则

对照原文审查译文，而非仅凭中文语感判断：

- **只改错字，不换整个术语**：如"冒名顶替综合症"只有"症→征"需要改，不要把整个术语换成"冒充者综合征"
- **术语首次出现附英文原文**：如 `冒名顶替综合征（Impostor Syndrome）`
- **忠实于原文语义**：如果译文用词与原文语义一致，即使中文读起来略显生硬，也应标记为 `FALSE POSITIVE`
- **"wrong_word" 类型需谨慎**：必须确认译文用词确实偏离原文含义，而非仅仅是中文表达风格偏好
- **翻译腔不是错误**：被动句偏多、长定语前置等翻译特征不应标记为语法错误

## 审查文件格式

每行一个 JSON 对象，字段如下：

| 字段 | 类型 | 说明 |
|------|------|------|
| `path` | string | 文件路径 |
| `line_start` | int | 起始行号 |
| `line_end` | int | 结束行号 |
| `char_offset` | int | 行内字符偏移 |
| `text` | string | 提取的中文文本（原文） |
| `context_type` | string | 上下文类型：comment / string / doc / prose |
| `language` | string | 编程语言 |
| `surrounding_code` | string | 周围代码上下文 |
| `source_url` | string | 原文链接（可选，翻译文章时出现） |
| `is_translation` | bool | 是否为翻译文章（可选，翻译文章时为 true） |

审查后需要添加的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | ACCEPT / FALSE POSITIVE / CUSTOM |
| `suggestion` | string | 建议修改（ACCEPT 时必填） |
| `correction` | string | 自定义修改（CUSTOM 时必填） |
| `issue_type` | string | 问题类型 |
| `confidence` | string | 置信度：high / medium / low |
| `reason` | string | 判断理由 |

## 常见误报场景

以下情况应标记为 `FALSE POSITIVE`：
- 代码变量名中的拼音（如 `zhangsan`、`lisi`）
- 专有名词（如"图灵"、"冯·诺依曼"）
- 技术术语（如"正则表达式"、"哈希表"）
- 网络用语和缩写
- 古诗词或引用的原文
- 人名、地名、品牌名
- 翻译文章中与原文语义一致的用词（即使中文读起来略显生硬）
- 已被社区广泛接受的术语译法（如"冒名顶替综合征"、"教程地狱"）

## 执行上下文

- 不要假设当前工作目录是 Skill 目录
- 通过绝对路径调用 `zh-proofread.sh`
- 审查文件中的相对路径相对于审查文件所在目录解析
- 如果源文件在导出后被修改，需要重新导出

## 配置文件

支持 `.zh-proofread.toml` 配置文件，用于排除路径和设置白名单：

```toml
# 排除的路径模式
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

## 文件说明

- `zh-proofread.sh`：**唯一入口脚本**（Agent 应始终通过此脚本调用，不要直接调用 scripts/ 下的文件）
- `scripts/extract-segments.ts`：中文文本提取（由 zh-proofread.sh 调用）
- `scripts/apply-review.ts`：应用已批准的修改（由 zh-proofread.sh 调用）

> **注意**：`_legacy/` 目录包含旧的 Python 实现，仅供历史参考，不应使用。
