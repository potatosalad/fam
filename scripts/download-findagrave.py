#!/usr/bin/env python3
"""Fetch the researched XAPK without executing APK code. Refuse changed content."""
import hashlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
URL = 'https://d.apkpure.net/b/XAPK/com.ancestry.findagrave?versionCode=138&nc=arm64-v8a&sv=32'
SHA256 = '9cfdca06f7b3debcaf6c2cb40d366c5c80c6e0b8e83e49e2513392f7afa6a2b1'
target = ROOT / 'artifacts/findagrave/findagrave-4.0.2.xapk'
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
print('Find a Grave 4.0.2 XAPK SHA-256 verified.')
