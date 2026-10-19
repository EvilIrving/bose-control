#!/bin/sh
# 诊断导出自检：用真实的 macOS WebController + Diag + 生产导出链路跑两条路径。
#   normal  —— 从页面调 window.NativeBLE.exportDiag（设置页按钮同一条路），
#              原生 exportDiagnostics 写文件，结果经 onDiagExported 回到页面
#   missing —— 让 app.js 404，页面起不来，走原生故障入口 exportDiagnostics(pageText: nil)
# 只在 Debug 构建里生效（BOSE_DIAG_SELFTEST），Release 不含这些钩子。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/bose-diag-selftest"
DERIVED="${TMPDIR:-/tmp}/bose-diag-selftest-build"
mkdir -p "$OUT"

xcodebuild -project "$ROOT/macos/BoseControl.xcodeproj" -scheme BoseControl \
  -configuration Debug -destination 'platform=macOS' -derivedDataPath "$DERIVED" >/dev/null

APP="$DERIVED/Build/Products/Debug/BoseControl.app/Contents/MacOS/BoseControl"
fail=0

run() {
  name="$1"; shift
  line=$(env "$@" BOSE_DIAG_SELFTEST=1 "$APP" 2>/dev/null | grep -E 'SELFTEST (note|ok)=' | tail -1)
  echo "$line" > "$OUT/$name.out"
  file=$(printf '%s' "$line" | grep -oE '/[^ ()]*bose-diag-[^ ()]*\.txt' | tail -1)
  if [ -z "$file" ] || [ ! -s "$file" ]; then
    printf 'FAIL %s: no file (%s)\n' "$name" "$line"
    fail=1
    return
  fi
  cp "$file" "$OUT/$name.txt"
  size=$(wc -c <"$OUT/$name.txt" | awk '{print $1}')
  printf 'PASS %s: %sB <- %s\n' "$name" "$size" "$file"
}

run normal
grep -q "ready=true" "$OUT/normal.txt" || { echo "FAIL normal: page section missing"; fail=1; }
grep -q "==== 原生 ====" "$OUT/normal.txt" || { echo "FAIL normal: native section missing"; fail=1; }
grep -q "页面已就绪" "$OUT/normal.txt" || { echo "FAIL normal: no ready log"; fail=1; }

run missing BOSE_DIAG_MISSING=1
grep -q 'bose://app/app.js' "$OUT/missing.txt" || { echo "FAIL missing: no module URL"; fail=1; }
grep -q "触发=load-check" "$OUT/missing.txt" || { echo "FAIL missing: no ready-failure reason"; fail=1; }
grep -q "页面未启动" "$OUT/missing.txt" || { echo "FAIL missing: page-unavailable note missing"; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "自检失败"
  exit 1
fi
echo "自检通过：两份文件在 $OUT"
