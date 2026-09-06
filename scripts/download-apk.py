#!/usr/bin/env python3
"""Download the researched release and verify its pinned hashes; never execute it."""
import hashlib
from html.parser import HTMLParser
from pathlib import Path
import urllib.request
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PAGE = "https://apkcombo.com/familysearch-tree/org.familysearch.mobile/download/phone-5.4.4-apk"
XAPK_HASH = "a9dbd75b31840cced9b1a1f67e63bbf8e9a945919c009b38e2a12cf7695deaf2"
APK_HASH = "a328744b0bc74653418554d01a9b33972a1ea974ba2b67d71044cfd6d48eb24b"

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and attrs.get("class") == "variant" and attrs.get("href", "").startswith("/r2?"):
            self.urls.append(attrs["href"])

def verify(path, expected):
    with path.open("rb") as file:
        actual = hashlib.file_digest(file, "sha256").hexdigest()
    if actual != expected:
        raise RuntimeError(f"Checksum mismatch for {path.name}; refusing to analyze a different artifact.")
    print(path.name, actual)

artifact = ROOT / "artifacts/familysearch-tree-5.4.4.xapk"
artifact.parent.mkdir(exist_ok=True)
if not artifact.exists():
    headers = {"User-Agent": "Mozilla/5.0", "Referer": PAGE}
    with urllib.request.urlopen(urllib.request.Request(PAGE, headers=headers), timeout=30) as response:
        parser = Links()
        parser.feed(response.read().decode())
    if not parser.urls:
        raise RuntimeError("The download mirror no longer exposes the expected release link.")
    url = urllib.parse.urljoin(PAGE, parser.urls[0])
    partial = artifact.with_suffix(".partial")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as response, partial.open("wb") as file:
            while chunk := response.read(1024 * 1024):
                file.write(chunk)
        verify(partial, XAPK_HASH)
        partial.rename(artifact)
    finally:
        partial.unlink(missing_ok=True)
verify(artifact, XAPK_HASH)
apk = ROOT / "artifacts/apks/org.familysearch.mobile.apk"
apk.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(artifact) as bundle:
    # Use one fixed member name, rather than extracting arbitrary archive paths.
    apk.write_bytes(bundle.read("org.familysearch.mobile.apk"))
verify(apk, APK_HASH)
