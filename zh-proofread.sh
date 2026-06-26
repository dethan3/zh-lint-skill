#!/bin/bash
# 中文校对 Skill — 主入口脚本
# 用法: zh-proofread.sh [options] [path...]

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SELF_CMD=$(printf '%q' "$SCRIPT_DIR/zh-proofread.sh")

usage() {
    cat <<'EOF'
用法: zh-proofread.sh [options] [path...]

选项:
  --export-review <file>  导出中文文本段到 JSONL 文件，供 LLM 审查
  --apply-review <file>   应用已批准的修改
  --diff <file>           预览待修改的差异（不实际修改文件）
  --summary               只显示摘要统计，不输出详细内容
  --batch-size <N>        批量模式：每批处理 N 个段落
  --batch-offset <I>      批量模式：跳过前 I 个段落（用于续传）
  -h, --help              显示帮助信息

说明:
  - 默认扫描当前目录
  - --export-review、--apply-review、--diff 互斥
  - 审查文件格式为 JSONL，每行一个 JSON 对象
  - 批量模式用于处理大型代码库，避免一次处理太多段落

示例:
  # 扫描当前目录并显示摘要
  zh-proofread.sh --summary

  # 导出中文文本段供审查
  zh-proofread.sh --export-review review.jsonl src/

  # 批量处理：每次处理 50 个段落
  zh-proofread.sh --export-review review.jsonl --batch-size 50 src/

  # 续传：跳过前 50 个段落
  zh-proofread.sh --export-review review.jsonl --batch-size 50 --batch-offset 50 src/

  # 预览修改差异
  zh-proofread.sh --diff review.jsonl

  # 应用已批准的修改
  zh-proofread.sh --apply-review review.jsonl
EOF
}

ACTION="scan"
EXPORT_REVIEW_FILE=""
REVIEW_FILE=""
PATHS=()
SUMMARY_ONLY=0
RUNNER=""

set_action() {
    local requested="$1"
    if [[ "$ACTION" != "scan" && "$ACTION" != "$requested" ]]; then
        echo "Error: --export-review 与 --apply-review 互斥。" >&2
        exit 2
    fi
    ACTION="$requested"
}

require_runner() {
    if [[ -n "$RUNNER" ]]; then
        return 0
    fi
    # 优先使用 tsx，其次 npx tsx
    if command -v tsx >/dev/null 2>&1; then
        RUNNER="tsx"
        return 0
    fi
    if command -v npx >/dev/null 2>&1; then
        RUNNER="npx tsx"
        return 0
    fi
    echo "Error: 需要 tsx 或 npx（npm install -g tsx 或 npm install tsx）。" >&2
    exit 127
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --export-review)
            if [[ $# -lt 2 ]]; then
                echo "缺少 --export-review 的参数" >&2
                usage >&2
                exit 2
            fi
            set_action "export"
            EXPORT_REVIEW_FILE="$2"
            shift 2
            ;;
        --apply-review)
            if [[ $# -lt 2 ]]; then
                echo "缺少 --apply-review 的参数" >&2
                usage >&2
                exit 2
            fi
            set_action "apply"
            REVIEW_FILE="$2"
            shift 2
            ;;
        --diff)
            if [[ $# -lt 2 ]]; then
                echo "缺少 --diff 的参数" >&2
                usage >&2
                exit 2
            fi
            set_action "diff"
            REVIEW_FILE="$2"
            shift 2
            ;;
        --summary)
            SUMMARY_ONLY=1
            shift
            ;;
        --batch-size)
            if [[ $# -lt 2 ]]; then
                echo "缺少 --batch-size 的参数" >&2
                usage >&2
                exit 2
            fi
            BATCH_SIZE="$2"
            shift 2
            ;;
        --batch-offset)
            if [[ $# -lt 2 ]]; then
                echo "缺少 --batch-offset 的参数" >&2
                usage >&2
                exit 2
            fi
            BATCH_OFFSET="$2"
            shift 2
            ;;
        --)
            shift
            break
            ;;
        -*)
            echo "未知选项: $1" >&2
            usage >&2
            exit 2
            ;;
        *)
            PATHS+=("$1")
            shift
            ;;
    esac
done

if [[ $# -gt 0 ]]; then
    PATHS+=("$@")
fi

if [[ ${#PATHS[@]} -eq 0 ]]; then
    PATHS=(.)
fi

require_runner

# 应用修改模式
if [[ "$ACTION" == "apply" ]]; then
    if [[ -z "$REVIEW_FILE" ]]; then
        echo "Error: --apply-review 需要审查文件路径" >&2
        exit 2
    fi
    if [[ ! -f "$REVIEW_FILE" ]]; then
        echo "Error: 审查文件不存在: $REVIEW_FILE" >&2
        exit 2
    fi
    $RUNNER "$SCRIPT_DIR/scripts/apply-review.ts" "$REVIEW_FILE"
    exit 0
fi

# 预览差异模式
if [[ "$ACTION" == "diff" ]]; then
    if [[ -z "$REVIEW_FILE" ]]; then
        echo "Error: --diff 需要审查文件路径" >&2
        exit 2
    fi
    if [[ ! -f "$REVIEW_FILE" ]]; then
        echo "Error: 审查文件不存在: $REVIEW_FILE" >&2
        exit 2
    fi
    $RUNNER "$SCRIPT_DIR/scripts/apply-review.ts" --dry-run "$REVIEW_FILE"
    exit 0
fi

# 扫描模式
echo "🔍 扫描中文文本: ${PATHS[*]}"
echo "======================================"

EXTRACT_ARGS=("${PATHS[@]}")
if [[ "$SUMMARY_ONLY" -eq 1 ]]; then
    EXTRACT_ARGS+=("--summary")
fi

if [[ "$ACTION" == "export" && -n "$EXPORT_REVIEW_FILE" ]]; then
    EXTRACT_ARGS+=("--output" "$EXPORT_REVIEW_FILE")
fi

if [[ "${BATCH_SIZE:-0}" -gt 0 ]]; then
    EXTRACT_ARGS+=("--batch-size" "$BATCH_SIZE" "--batch-offset" "${BATCH_OFFSET:-0}")
fi

$RUNNER "$SCRIPT_DIR/scripts/extract-segments.ts" "${EXTRACT_ARGS[@]}"

echo ""
echo "======================================"
echo ""

if [[ "$ACTION" == "export" && -n "$EXPORT_REVIEW_FILE" ]]; then
    echo "📋 下一步:"
    echo "  1. LLM 审查 $EXPORT_REVIEW_FILE 中的每条记录"
    echo "  2. 设置 status: ACCEPT / FALSE POSITIVE / CUSTOM"
    echo "  3. 应用修改: $SELF_CMD --apply-review $(printf '%q' "$EXPORT_REVIEW_FILE")"
else
    echo "📋 要导出审查文件，请运行:"
    echo "  $SELF_CMD --export-review review.jsonl ${PATHS[*]}"
fi
