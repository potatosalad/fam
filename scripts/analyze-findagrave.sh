#!/usr/bin/env bash
# Full smali plus Java for call-site routing, without installing or running the APK.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v apktool >/dev/null || { echo 'Install apktool before analysis.' >&2; exit 1; }
command -v jadx >/dev/null || { echo 'Install JADX before analysis.' >&2; exit 1; }
python3 scripts/download-findagrave.py
python3 - <<'PY'
import hashlib, zipfile
from pathlib import Path
with zipfile.ZipFile('artifacts/findagrave/findagrave-4.0.2.xapk') as bundle:
    base = bundle.read('com.ancestry.findagrave.apk')
if hashlib.sha256(base).hexdigest() != '90eff28f5a2f88a55491afcf727d3acbb8f53774fd236ba399592c18adc8462b':
    raise SystemExit('Unexpected base APK SHA-256')
Path('artifacts/findagrave/base.apk').write_bytes(base)

PY
if [[ ! -d analysis/findagrave/smali ]]; then
  mkdir -p analysis/findagrave
  apktool d --no-res -o analysis/findagrave/smali artifacts/findagrave/base.apk >artifacts/findagrave/apktool.log 2>&1
fi
if [[ ! -d analysis/findagrave/java/sources ]]; then
  if ! jadx --no-res --decompilation-mode simple -j 4 -d analysis/findagrave/java artifacts/findagrave/base.apk >artifacts/findagrave/jadx.log 2>&1; then
    echo 'JADX reported incomplete methods; smali is authoritative. See artifacts/findagrave/jadx.log.' >&2
  fi
fi
if [[ ! -f analysis/findagrave/resources/res/values/strings.xml ]]; then
  apktool d --no-src -o analysis/findagrave/resources artifacts/findagrave/base.apk >artifacts/findagrave/resources.log 2>&1
fi
python3 scripts/extract-findagrave.py
