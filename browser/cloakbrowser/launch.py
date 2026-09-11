"""Use the image's verified binary and ordinary headed launch arguments."""
import json
from cloakbrowser import ensure_binary
from cloakbrowser.browser import build_args

print(json.dumps({
    "binary": ensure_binary(),
    "args": ["--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage",
             "--disable-extensions", "--disable-popup-blocking", "--disable-background-networking",
             "--metrics-recording-only", "--start-maximized"] + build_args(
        stealth_args=True, extra_args=[], headless=False),
}))
