#!/usr/bin/env python3
"""Fetch the researched XAPK without executing APK code. Refuse changed content."""
import hashlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://d.apkpure.net/b/XAPK/air.com.myheritage.mobile?versionCode=70050044&nc=arm64-v8a&sv=32'
SHA256 = '5ef7fd03df12d0b1f43eb56074818e4c707badabbf137c1a91267cfc0c3e9a2f'
target = ROOT / 'artifacts/myheritage/myheritage-7.5.44.xapk'
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
print('MyHeritage 7.5.44 XAPK SHA-256 verified.')
