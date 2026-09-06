#!/usr/bin/env bash
# Analyze a locally downloaded, pinned APKMirror bundle without running Android code.
set -euo pipefail
cd "$(dirname "$0")/.."
bundle="${1:-artifacts/ancestry/ancestry-18.16.3.apkm}"
command -v apktool >/dev/null || { echo 'Install apktool before running this script.' >&2; exit 1; }
python3 - "$bundle" <<'PY'
import hashlib, sys, zipfile
from pathlib import Path
bundle = Path(sys.argv[1])
expected = '697ea2df0d21e04486356fa78d026682af40b7e0ada9076db71d2eda2576dc1c'
if hashlib.sha256(bundle.read_bytes()).hexdigest() != expected:
    raise SystemExit('Bundle SHA-256 differs from the researched build. Update provenance deliberately before analyzing a different version.')
with zipfile.ZipFile(bundle) as archive:
    base = archive.read('base.apk')
if hashlib.sha256(base).hexdigest() != 'd37b4e31ad8b34225bb4608981002bf6c1666c4be59877b989b99b38c1ce689a':
    raise SystemExit('Unexpected base APK SHA-256')
target = Path('artifacts/ancestry/base.apk')
target.parent.mkdir(parents=True, exist_ok=True)
target.write_bytes(base)
print('Pinned bundle and base APK hashes verified.')
PY
if [[ ! -d analysis/ancestry/smali ]]; then
  mkdir -p analysis/ancestry
  apktool d --no-res -o analysis/ancestry/smali artifacts/ancestry/base.apk >artifacts/ancestry/apktool.log 2>&1
fi
if [[ "${ANALYZE_JAVA:-0}" == 1 ]]; then
  command -v jadx >/dev/null || { echo 'Install JADX for optional Java decompilation.' >&2; exit 1; }
  if ! jadx --no-res --decompilation-mode simple -j 4 -d analysis/ancestry/java artifacts/ancestry/base.apk >artifacts/ancestry/jadx.log 2>&1; then
    echo 'JADX reported incomplete methods; inspect artifacts/ancestry/jadx.log. Smali remains authoritative.' >&2
  fi
fi
python3 scripts/extract-ancestry.py
