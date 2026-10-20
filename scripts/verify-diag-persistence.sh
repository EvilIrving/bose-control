#!/bin/sh
# 第一单元验证：持久日志 writer + 页面桥 + 历史导出（macOS，真实 WebController）
#   1) 正常启动写日志 → kill -9 → 重启 → 导出里应有两次 runId
#   2) 容量：把单文件/总量压到很小，造大量事件，检查滚动与淘汰
#   3) 坏末行：手工破坏最后一行，导出应跳过并报 corruptLines
#   4) 写失败：日志目录只读，导出仍能产出并标 write-failed
# 只在 Debug 构建里生效（BOSE_DIAG_* 环境变量）。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/bose-persist-selftest"
DERIVED="${TMPDIR:-/tmp}/bose-persist-build"
rm -rf "$OUT"
mkdir -p "$OUT/logs"

xcodebuild -project "$ROOT/macos/BoseControl.xcodeproj" -scheme BoseControl \
  -configuration Debug -destination 'platform=macOS' -derivedDataPath "$DERIVED" >/dev/null
APP="$DERIVED/Build/Products/Debug/BoseControl.app/Contents/MacOS/BoseControl"

export BOSE_DIAG_DIR="$OUT/logs"
fail=0
note() { printf '%s\n' "$*"; }
bad() { note "FAIL $*"; fail=1; }

# 1) 第一次运行：写日志后强杀
("$APP" >/dev/null 2>&1 & echo $! > "$OUT/pid1"); sleep 4
kill -9 "$(cat "$OUT/pid1")" 2>/dev/null || true
sleep 1
[ -n "$(ls -A "$OUT/logs" 2>/dev/null)" ] || bad "第一次运行没有落盘"

# 2) 第二次运行：进程内自检导出（走页面 → 原生 exportDiagnostics）
line=$(BOSE_DIAG_SELFTEST=1 "$APP" 2>/dev/null | grep -E 'SELFTEST note=' | tail -1)
file=$(printf '%s' "$line" | grep -oE '/[^ ()]*bose-diag-[^ ()]*\.txt' | tail -1)
[ -n "$file" ] && [ -s "$file" ] || bad "第二次运行没有导出文件（$line）"

runs=$(grep -oE '"runId":"[^"]+"' "$file" | sort -u | wc -l | awk '{print $1}')
[ "$runs" -ge 2 ] || bad "导出里只有 $runs 个 runId，重启前的历史丢了"
grep -q '"event":"run-start"' "$file" || bad "导出里没有 run-start"
dup=$(grep -oE '\{"timestamp".*\}' "$file" | sort | uniq -d | wc -l | awk '{print $1}')
[ "$dup" -eq 0 ] || bad "同一事件重复落盘 $dup 行"
note "PASS 重启可追溯：runIds=$runs 文件=$file"

# 3) 容量：压到 4KB/8KB，造 400 条事件
rm -rf "$OUT/cap"; mkdir -p "$OUT/cap"
cap_line=$(BOSE_DIAG_DIR="$OUT/cap" BOSE_DIAG_MAX_FILE=4096 BOSE_DIAG_MAX_TOTAL=8192 \
  BOSE_DIAG_SPAM=400 BOSE_DIAG_SELFTEST=1 "$APP" 2>/dev/null | grep -E 'SELFTEST note=' | tail -1)
cap_file=$(printf '%s' "$cap_line" | grep -oE '/[^ ()]*bose-diag-[^ ()]*\.txt' | tail -1)
[ -n "$cap_file" ] || bad "容量用例没有导出文件"
total=$(cat "$OUT"/cap/*.jsonl 2>/dev/null | wc -c | awk '{print $1}')
[ "$total" -le 8192 ] || bad "总量 ${total}B 超过上限 8KB"
files=$(ls "$OUT"/cap/*.jsonl 2>/dev/null | wc -l | awk '{print $1}')
[ "$files" -ge 2 ] || bad "没有滚动（只有 $files 个文件）"
grep -q 'retention=' "$cap_file" || bad "导出缺保留策略说明"
note "PASS 容量与滚动：files=$files total=${total}B"

# 4) 坏末行：破坏最新文件尾行
printf 'not-json-tail\n' >> "$(ls -t "$OUT"/logs/*.jsonl | head -1)"
corrupt_line=$(BOSE_DIAG_SELFTEST=1 "$APP" 2>/dev/null | grep -E 'SELFTEST note=' | tail -1)
corrupt_file=$(printf '%s' "$corrupt_line" | grep -oE '/[^ ()]*bose-diag-[^ ()]*\.txt' | tail -1)
grep -qE 'corruptLines=[1-9]' "$corrupt_file" || bad "坏末行没有被统计"
grep -q '"event":"run-start"' "$corrupt_file" || bad "坏末行导致整份历史丢失"
note "PASS 坏末行：$(grep -oE 'corruptLines=[0-9]+' "$corrupt_file" | head -1)"

# 5) 写失败：目录只读
rm -rf "$OUT/ro"; mkdir -p "$OUT/ro"; chmod 500 "$OUT/ro"
ro_line=$(BOSE_DIAG_DIR="$OUT/ro/logs" BOSE_DIAG_SELFTEST=1 "$APP" 2>/dev/null | grep -E 'SELFTEST note=' | tail -1)
ro_file=$(printf '%s' "$ro_line" | grep -oE '/[^ ()]*bose-diag-[^ ()]*\.txt' | tail -1)
chmod 700 "$OUT/ro"
[ -n "$ro_file" ] || bad "写失败时没有导出（用户没法反馈）"
grep -q 'write-failed' "$ro_file" || bad "写失败没有在导出里标明"
grep -q 'memoryFallback=' "$ro_file" || bad "缺内存兜底说明"
note "PASS 写失败可诊断：$(grep -oE 'health=[^ ]*' "$ro_file" | head -1)"

if [ "$fail" -ne 0 ]; then
  note "第一单元自检失败"
  exit 1
fi
note "第一单元自检通过：证据在 $OUT"
