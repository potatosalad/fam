"""Use the image's verified binary and ordinary headed launch arguments."""
import json
import os
import subprocess
import sys
from cloakbrowser import ensure_binary
from cloakbrowser.browser import build_args, maybe_resolve_geoip

if "--geoip" in sys.argv:
    timezone, locale, _ = maybe_resolve_geoip(True, None, None, None)
    print(json.dumps({"timezone": timezone, "locale": locale}))
    sys.exit(0)

# Bound first-use database downloads and network failures. A failed lookup must
# not prevent access to existing sessions or the viewer.
geo = {}
if os.environ.get("FAM_CLOAKBROWSER_GEOIP", "true").lower() != "false":
    try:
        result = subprocess.run([sys.executable, __file__, "--geoip"],
                                capture_output=True, text=True, timeout=40, check=True)
        geo = json.loads(result.stdout.strip().splitlines()[-1])
    except (subprocess.SubprocessError, ValueError, IndexError):
        print("CloakBrowser GeoIP unavailable; using the default timezone and language.", file=sys.stderr)

print(json.dumps({
    "binary": ensure_binary(),
    "humanize": os.environ.get("FAM_CLOAKBROWSER_HUMANIZE", "true").lower() != "false",
    "args": ["--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage",
             "--disable-extensions", "--disable-popup-blocking", "--disable-background-networking",
             "--metrics-recording-only", "--start-maximized"] + build_args(
        stealth_args=True, extra_args=[], headless=False, **geo),
}))
