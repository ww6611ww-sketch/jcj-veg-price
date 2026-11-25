#!/usr/bin/env bash
# 在 Android 模擬器上安裝 APK，分別在連線與斷網狀態開啟 App 驗證行情來源
set -euo pipefail
APK="$1"; GEN="$2"; LATEST="$3"; PKG=tw.jcj.todaysvegprice
adb wait-for-device; adb shell getprop ro.build.version.release
adb install -r "$APK" | tee install.log
adb shell pm list packages | grep -q "$PKG" && echo "INSTALL_OK" | tee -a install.log
forward() {
  sleep 3
  SOCK=$(adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | head -1)
  echo "devtools socket: $SOCK"; adb forward --remove-all || true; adb forward tcp:9222 "localabstract:$SOCK"
}
launch() { adb shell am force-stop "$PKG"; adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null; sleep 12; forward; }
# 1) 連線
adb shell cmd connectivity airplane-mode disable || true; adb shell svc wifi enable || true; adb shell svc data enable || true; sleep 5
launch
node scripts/cdp-check.mjs online "$GEN" "$LATEST"
adb exec-out screencap -p > e2e-online.png
# 2) 斷網：飛航模式＋關 Wi-Fi／行動數據，重新開啟 App
adb shell cmd connectivity airplane-mode enable || true; adb shell svc wifi disable || true; adb shell svc data disable || true; sleep 5
adb shell ping -c 1 -W 2 8.8.8.8 && echo "警告：模擬器仍可連線" || echo "已斷網"
launch
node scripts/cdp-check.mjs offline "$GEN" "$LATEST"
adb exec-out screencap -p > e2e-offline.png
adb shell cmd connectivity airplane-mode disable || true; adb shell svc wifi enable || true; adb shell svc data enable || true
