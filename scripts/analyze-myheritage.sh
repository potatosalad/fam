#!/usr/bin/env bash
# Full smali plus Java for call-site routing, without installing or running the APK.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v apktool >/dev/null || { echo 'Install apktool before analysis.' >&2; exit 1; }
command -v jadx >/dev/null || { echo 'Install JADX before analysis.' >&2; exit 1; }
python3 scripts/download-myheritage.py
python3 - <<'PY'
import hashlib, zipfile
from pathlib import Path
with zipfile.ZipFile('artifacts/myheritage/myheritage-7.5.44.xapk') as bundle:
    base = bundle.read('air.com.myheritage.mobile.apk')
if hashlib.sha256(base).hexdigest() != 'a6dd5ecfc886aa0160a4012aeb795b3818b3d756183e149f715b8459ed3f11e9':
    raise SystemExit('Unexpected base APK SHA-256')
Path('artifacts/myheritage/base.apk').write_bytes(base)
with zipfile.ZipFile('artifacts/myheritage/base.apk') as apk:
    for name in apk.namelist():
        if name.startswith('assets/graphql/') and name.endswith('.gql'):
            relative = Path(name)
            if '..' in relative.parts or relative.is_absolute(): raise SystemExit('Unsafe asset path')
            destination = Path('analysis/myheritage') / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(apk.read(name))
PY
if [[ ! -d analysis/myheritage/smali ]]; then
  mkdir -p analysis/myheritage
  apktool d --no-res -o analysis/myheritage/smali artifacts/myheritage/base.apk >artifacts/myheritage/apktool.log 2>&1
fi
if [[ ! -d analysis/myheritage/java/sources ]]; then
  if ! jadx --no-res --decompilation-mode simple -j 4 -d analysis/myheritage/java artifacts/myheritage/base.apk >artifacts/myheritage/jadx.log 2>&1; then
    echo 'JADX reported incomplete methods; smali is authoritative. See artifacts/myheritage/jadx.log.' >&2
  fi
fi
python3 scripts/extract-myheritage.py
