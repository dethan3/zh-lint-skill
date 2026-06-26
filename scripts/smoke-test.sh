#!/bin/bash
# 冒烟测试：验证中文校对 Skill 的基本功能

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SKILL_DIR=$(dirname "$SCRIPT_DIR")

echo "=== 中文校对 Skill 冒烟测试 ==="
echo ""

# 创建临时测试文件
TEST_DIR=$(mktemp -d)
trap "rm -rf $TEST_DIR" EXIT

cat > "$TEST_DIR/test.py" << 'EOF'
# 这是一个测试文件
def process_data(data):
    # 检查数据是否有效
    if not data:
        return "数据不正确，请从新输入"
    # 这个函授用来处理数据
    return "处理成功"
EOF

echo "1. 测试 --summary 模式..."
OUTPUT=$("$SKILL_DIR/zh-lint.sh" --summary "$TEST_DIR/test.py" 2>&1)
if echo "$OUTPUT" | grep -q "共提取"; then
    echo "   ✅ --summary 正常"
else
    echo "   ❌ --summary 失败"
    echo "$OUTPUT"
    exit 1
fi

echo ""
echo "2. 测试 --export-review 模式..."
REVIEW_FILE="$TEST_DIR/review.jsonl"
"$SKILL_DIR/zh-lint.sh" --export-review "$REVIEW_FILE" "$TEST_DIR/test.py" 2>&1

if [[ -f "$REVIEW_FILE" ]]; then
    LINE_COUNT=$(wc -l < "$REVIEW_FILE")
    echo "   ✅ 生成了审查文件，共 $LINE_COUNT 条记录"
else
    echo "   ❌ 审查文件未生成"
    exit 1
fi

echo ""
echo "3. 测试 --apply-review 模式..."
# 创建一个简单的审查文件
cat > "$TEST_DIR/apply_test.jsonl" << 'EOF'
{"path": "test.py", "line_start": 5, "line_end": 5, "char_offset": 22, "text": "数据不正确，请从新输入", "original": "从新输入", "suggestion": "重新输入", "issue_type": "typo", "confidence": "high", "reason": "'从新' 应为 '重新'", "status": "ACCEPT"}
EOF

# 复制测试文件
cp "$TEST_DIR/test.py" "$TEST_DIR/test_backup.py"

OUTPUT=$("$SKILL_DIR/zh-lint.sh" --apply-review "$TEST_DIR/apply_test.jsonl" 2>&1)
if echo "$OUTPUT" | grep -q "Applied"; then
    echo "   ✅ --apply-review 正常"
    # 验证修改是否生效
    if grep -q "重新输入" "$TEST_DIR/test.py"; then
        echo "   ✅ 修改内容正确"
    else
        echo "   ❌ 修改内容不正确"
        exit 1
    fi
else
    echo "   ❌ --apply-review 失败"
    echo "$OUTPUT"
    exit 1
fi

echo ""
echo "=== 所有测试通过 ==="
