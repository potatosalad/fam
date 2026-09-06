#!/usr/bin/env python3
"""Extract Retrofit routes from apktool smali without relying on JADX reconstruction."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTTP = {"o66": "GET", "xla": "POST", "yla": "PUT", "te3": "DELETE"}
PARAM = {"pva": "path", "l2c": "query", "jp6": "header", "k61": "body"}
routes = []
for path in sorted((ROOT / "analysis/smali").rglob("*.smali")):
    text = path.read_text()
    if not any(prefix in text for prefix in ["service/mobile/api/", "cis-web/oauth2/", "service/cmn/user-preferences/"]):
        continue
    for match in re.finditer(r"^\.method[^\n]*\n[\s\S]*?^\.end method", text, re.M):
        block = match.group()
        for route in re.finditer(r'\.annotation runtime L([^;]+);\s+value = "([^"\n]*(?:service/mobile/api/|cis-web/oauth2/|service/cmn/user-preferences/)[^"\n]*)"\s+\.end annotation', block):
            annotation, url = route.groups()
            parameters = []
            for param in re.finditer(r"\.param[^\n]*\n[\s\S]*?\.end param", block):
                part = param.group()
                p = re.search(r'\.annotation runtime L([^;]+);([\s\S]*?)\.end annotation', part)
                if p:
                    value = re.search(r'value = "([^"\n]*)"', p[2])
                    parameters.append({"kind": PARAM.get(p[1], p[1]), "name": value[1] if value else None,
                                       "encoded": "encoded = true" in p[2], "signature": part.splitlines()[0].strip()})
            dto = sorted(set(re.findall(r"L(org/familysearch/mobile/tree/client/[^;]+);", block)))
            sig = re.search(r'\.annotation system Ldalvik/annotation/Signature;([\s\S]*?)\.end annotation', block)
            generic = ''.join(json.loads(s) for s in re.findall(r'"(?:[^"\\]|\\.)*"', sig[1])) if sig else None
            method_annotations = block[block.rfind('.end param') + len('.end param'):] if '.end param' in block else block
            static_headers = []
            for a in re.finditer(r'\.annotation runtime L([^;]+);([\s\S]*?)\.end annotation', method_annotations):
                if a[1] not in HTTP:
                    static_headers.extend(v for v in re.findall(r'"([^"\n]*)"', a[2]) if ': ' in v)
            routes.append({"method": HTTP.get(annotation, "UNKNOWN"), "annotation": annotation,
                           "path": "/" + url.lstrip("/"), "parameters": parameters,
                           "genericSignature": generic, "staticHeaders": static_headers,
                           "dtoReferences": dto, "source": str(path.relative_to(ROOT)),
                           "line": text[:match.start()].count("\n") + 1,
                           "member": block.splitlines()[0]})
routes.sort(key=lambda x: (x["path"], x["method"]))
out = ROOT / "docs/endpoints.json"
out.write_text(json.dumps({"package": "org.familysearch.mobile", "version": "5.4.4", "versionCode": 43530,
                           "source": "Retrofit annotations in APK smali; presence does not establish live availability",
                           "endpoints": routes}, indent=2) + "\n")
print(f"Extracted {len(routes)} endpoint declarations to {out.relative_to(ROOT)}")
unknown = sorted({x["annotation"] for x in routes if x["method"] == "UNKNOWN"})
if unknown:
    print("Unmapped HTTP annotations:", ", ".join(unknown))
