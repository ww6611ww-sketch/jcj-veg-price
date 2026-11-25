#!/usr/bin/env bash
# 產生「測試資料」並輸出 app/www/data/test.json（只在建置 App／預覽時執行，不提交到 repo）
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/gen-test-data.js
rm -rf data/test
for s in taichung_retail:csv moa_veg:json moa_fish:json moa_hog:json moa_poultry:json; do
  node cli.js import --source "${s%%:*}" --file "fixtures/test-data/TEST_${s%%:*}.${s##*:}" --dataset test > /dev/null
done
node cli.js export --datasets test --testToday "${1:-2026-11-25}"
