#!/usr/bin/env python3
"""Fetch the researched XAPK without executing APK code. Refuse changed content."""
import hashlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://d.apkpure.net/b/XAPK/com.findmypast.prod?versionCode=259000&nc=arm64-v8a&sv=32'
SHA256 = '17362c07c7753c0f6c6f820550b96faa859c57a1dab25274441aaf6024e05f6a'
target = ROOT / 'artifacts/findmypast/findmypast-2.59.0.xapk'
target.parent.mkdir(parents=True, exist_ok=True)
if not target.exists():
    temporary = target.with_suffix('.download')
    try:
        subprocess.run(['curl', '--location', '--fail', '--max-time', '180', '--silent', '--show-error', URL, '-o', str(temporary)], check=True)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != SHA256:
            raise SystemExit('Download differs from the researched XAPK; inspect version/provenance before proceeding.')
        temporary.rename(target)
    finally:
        temporary.unlink(missing_ok=True)
if hashlib.sha256(target.read_bytes()).hexdigest() != SHA256:
    raise SystemExit('Existing XAPK hash mismatch; file was left unchanged.')
print('Findmypast 2.59.0 XAPK SHA-256 verified.')
