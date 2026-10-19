#!/bin/sh
# 诊断导出自检：用真实的 macOS WebController + Diag 跑两条路径，检查导出的 txt 内容。
#   - 正常加载：页面就绪，文件里有系统信息与原生日志
#   - 模块 404：原生收到 bootError，appReady 报未就绪，原生出口仍能生成文件
# 只在 Debug 构建里生效（BOSE_DIAG_SELFTEST）。
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
  file="$OUT/$name.txt"
  rm -f "$file"
  env "$@" BOSE_DIAG_SELFTEST=1 BOSE_DIAG_OUT="$file" "$APP" >/dev/null 2>&1 || true
  if [ ! -s "$file" ]; then
    echo "FAIL $name：没有生成 $file"
    fail=1
    return
  fi
  size=$(wc -c <"$file" | awk '{print $1}')
  echo "PASS ${name}：${size}B → $file"
}

run normal
grep -q "==== 原生 ====" "$OUT/normal.txt" || { echo "FAIL normal：缺原生日志段"; fail=1; }
grep -q "页面已就绪" "$OUT/normal.txt" || { echo "FAIL normal：没有就绪日志"; fail=1; }

run missing BOSE_DIAG_MISSING=1
grep -q 'bose://app/app.js' "$OUT/missing.txt" || { echo "FAIL missing：没有记录模块 URL"; fail=1; }
grep -q "触发=load-check" "$OUT/missing.txt" || { echo "FAIL missing：没有记录就绪失败原因与耗时"; fail=1; }
grep -q "页面未启动" "$OUT/missing.txt" || { echo "FAIL missing：没有标明页面日志不可用"; fail=1; }

if [ "$fail" -ne 0 ]; then
  echo "自检失败"
  exit 1
fi
echo "自检通过：两份文件都在 $OUT"
