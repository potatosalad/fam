#!/usr/bin/env bash
# Full smali plus Java for call-site routing, without installing or running the APK.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v apktool >/dev/null || { echo 'Install apktool before analysis.' >&2; exit 1; }
command -v jadx >/dev/null || { echo 'Install JADX before analysis.' >&2; exit 1; }
python3 scripts/download-findmypast.py
python3 - <<'PY'
import hashlib, zipfile
from pathlib import Path
with zipfile.ZipFile('artifacts/findmypast/findmypast-2.59.0.xapk') as bundle:
    base = bundle.read('com.findmypast.prod.apk')
if hashlib.sha256(base).hexdigest() != '871582437e67cf243a73d50abc861fbb172fd0bd7b048f04444be8852b7a1d07':
    raise SystemExit('Unexpected base APK SHA-256')
Path('artifacts/findmypast/base.apk').write_bytes(base)

PY
if [[ ! -d analysis/findmypast/smali ]]; then
  mkdir -p analysis/findmypast
  apktool d --no-res -o analysis/findmypast/smali artifacts/findmypast/base.apk >artifacts/findmypast/apktool.log 2>&1
fi
if [[ ! -d analysis/findmypast/java/sources ]]; then
  if ! jadx --no-res --decompilation-mode simple -j 4 -d analysis/findmypast/java artifacts/findmypast/base.apk >artifacts/findmypast/jadx.log 2>&1; then
    echo 'JADX reported incomplete methods; smali is authoritative. See artifacts/findmypast/jadx.log.' >&2
  fi
fi
if [[ ! -f analysis/findmypast/resources/res/values/strings.xml ]]; then
  apktool d --no-src -o analysis/findmypast/resources artifacts/findmypast/base.apk >artifacts/findmypast/resources.log 2>&1
fi
python3 scripts/extract-findmypast.py
