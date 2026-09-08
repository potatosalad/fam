#!/usr/bin/env python3
"""Enable opt-in private Firefox contexts, including cookie persistence.

Run before starting Camofox. Unmarked contexts retain upstream behavior.
The internal opt-in header is consumed by Juggler and never sent to websites.
"""
import os
from pathlib import Path
import shutil
import tempfile
import zipfile

MARKER = '// fam-private-context-v2'
root = Path(os.environ.get('FAM_CAMOUFOX_DIR', str(Path.home() / '.cache/camoufox')))
archive = root / 'omni.ja'
registry_path = 'chrome/juggler/content/TargetRegistry.js'
handler_path = 'chrome/juggler/content/protocol/BrowserHandler.js'


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Unsupported Camoufox engine layout; no files changed.')
    return text.replace(old, new, 1)


source_archive = archive
with zipfile.ZipFile(archive) as installed:
    if '// fam-private-context-v1' in installed.read(registry_path).decode():
        source_archive = root / 'omni.ja.before-fam-private-contexts'
        if not source_archive.exists():
            raise RuntimeError('The original archive is required to upgrade the fam engine bridge.')

with zipfile.ZipFile(source_archive) as source:
    registry = source.read(registry_path).decode()
    handler = source.read(handler_path).decode()
    if MARKER in registry and MARKER in handler:
        print('fam private contexts: engine already prepared')
        raise SystemExit(0)
    if MARKER in registry or MARKER in handler:
        raise RuntimeError('Incomplete fam engine patch; restore the original archive.')
    registry = replace_once(registry, 'const features = "chrome,dialog=no,all";',
        'const features = "chrome,dialog=no,all" + (browserContext.famPrivateBrowsing ? ",private" : "");')
    registry = replace_once(registry,
        "const window = Services.ww.openWindow(null, AppConstants.BROWSER_CHROME_URL, '_blank', features, args);",
        'if (browserContext.famPrivateBrowsing && (!this._famPrivateGuardian || this._famPrivateGuardian.closed)) {\n'
        '      // Firefox can exit when its last private window closes. Keep an\n'
        '      // empty hidden regular window alive until the browser is stopped.\n'
        '      const guardianArgs = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);\n'
        '      guardianArgs.appendElement(urlSupports);\n'
        '      const guardian = Services.ww.openWindow(null, AppConstants.BROWSER_CHROME_URL, "_blank", "chrome,dialog=no,all", guardianArgs);\n'
        '      this._famPrivateGuardian = guardian;\n'
        '      await waitForWindowReady(guardian);\n'
        '      guardian.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIBaseWindow).visibility = false;\n'
        '    }\n'
        "    const window = Services.ww.openWindow(null, AppConstants.BROWSER_CHROME_URL, '_blank', features, args);")
    registry = replace_once(registry,
        '{ userContextId: this.userContextId || undefined } /* originAttributes */',
        '{ userContextId: this.userContextId || undefined, privateBrowsingId: this.famPrivateBrowsing ? 1 : 0 } /* originAttributes */')
    registry = replace_once(registry, 'for (let cookie of Services.cookies.cookies) {',
        'for (let cookie of (this.famPrivateBrowsing ? Services.cookies.getCookiesWithOriginAttributes(JSON.stringify({userContextId: this.userContextId, privateBrowsingId: 1})) : Services.cookies.cookies)) {')
    registry = replace_once(registry, 'async destroy() {\n    if (this.userContextId !== 0) {',
        'async destroy() {\n    if (this.famPrivateBrowsing && this.userContextId !== 0) {\n'
        '      await new Promise((resolve, reject) => Services.clearData.deleteDataFromOriginAttributesPattern(\n'
        '        {userContextId: this.userContextId}, {onDataDeleted: flags => flags ? reject(new Error("Private context storage cleanup failed")) : resolve()}));\n'
        '    }\n    if (this.userContextId !== 0) {')
    handler = replace_once(handler,
        'this._targetRegistry.browserContextForId(browserContextId).extraHTTPHeaders = headers;',
        'const context = this._targetRegistry.browserContextForId(browserContextId);\n'
        '    if (headers.some(header => header.name.toLowerCase() === "x-fam-private-context" && header.value === "1")) context.famPrivateBrowsing = true;\n'
        '    context.extraHTTPHeaders = headers.filter(header => header.name.toLowerCase() !== "x-fam-private-context");')
    changes = {registry_path: (MARKER + '\n' + registry).encode(), handler_path: (MARKER + '\n' + handler).encode()}
    fd, temporary = tempfile.mkstemp(prefix='fam-omni-', dir=root)
    os.close(fd)
    try:
        with zipfile.ZipFile(temporary, 'w') as target:
            for entry in source.infolist():
                target.writestr(entry, changes.get(entry.filename, source.read(entry.filename)))
        backup = root / 'omni.ja.before-fam-private-contexts'
        if not backup.exists():
            shutil.copy2(archive, backup)
        shutil.copymode(archive, temporary)
        os.replace(temporary, archive)
    finally:
        Path(temporary).unlink(missing_ok=True)
print('fam private contexts: engine prepared; original archive preserved')
