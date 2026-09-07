#!/usr/bin/env python3
"""Recover literal GraphQL documents, serializer fields, and HTTP call sites.

Smali is authoritative. No vendor code is executed. REST URL fragments are an
inventory, not invented Retrofit declarations or complete request contracts.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SMALI = ROOT / 'analysis/findagrave/smali'
STR = re.compile(r'const-string(?:/jumbo)? (\w+), "((?:\\.|[^"\\])*)"')


def strings(text):
    return [(m[1], json.loads('"' + m[2].replace("\\'", "'") + '"')) for m in STR.finditer(text)]


def extract():
    graphql, models, rest = [], [], []
    for path in sorted(SMALI.glob('smali*/**/*.smali')):
        text = path.read_text()
        source = str(path.relative_to(ROOT))
        owner = path.stem
        for method in re.finditer(r'^\.method (.*?)\n(.*?)^\.end method', text, re.M | re.S):
            signature, body = method.groups()
            literals = [s for _, s in strings(body)]
            method_name = signature.split('(')[0].split()[-1]
            if owner == 'qe' and method_name == '<clinit>':
                # OAuth document is constructed from three literal StringBuilder pieces.
                if len(literals) != 3 or body.count('->append(Ljava/lang/String;)') != 2:
                    raise ValueError('OAuth document assembly changed; inspect the smali.')
                literals = [''.join(literals)]
            for literal in literals:
                match = re.match(r'\s*(query|mutation) (\w+)\s*(?:\((.*?)\))?\s*\{', literal, re.S)
                if not match:
                    continue
                kind, name, variables = match.groups()
                document = literal.strip() + '\n'
                digest = hashlib.sha256(document.encode()).hexdigest()
                parsed = [{'name': v[1], 'type': v[2], 'required': v[2].endswith('!') and v[3] is None,
                           **({'default': v[3].strip()} if v[3] is not None else {})}
                          for v in re.finditer(r'\$(\w+)\s*:\s*([\w\[\]!]+)(?:\s*=\s*([^,$]+))?', variables or '')]
                emb = next((s for s in literals if s.startswith(('/orc/graphql/', '/org/graphql/'))), None)
                graphql.append({'id': f'graphql.{name}.{digest[:8]}', 'name': name, 'kind': kind,
                                'variables': parsed, 'document': document, 'sha256': digest,
                                'headers': {'x-emb-path': emb} if emb else {}, 'source': source,
                                'sourceMethod': method_name})
            urls = [s for s in literals if s.startswith(('https://www.findagrave.com/', 'https://images.findagrave.com/'))]
            # Ktor call sites only; omit UI links and the GraphQL transport.
            if 'Lt99;->b(' in body and not any('/orc/graphql' in u for u in urls):
                verbs = re.findall(r'sget-object \w+, Lpo3;->([b-j]):Lpo3;', body)
                for url in urls:
                    rest.append({'id': f'http.{owner}.{method_name}', 'urlPrefix': url,
                                 'method': dict(zip('bcdefghij', ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','TRACE','QUERY'])).get(verbs[-1], 'GET') if verbs else 'GET',
                                 'source': source, 'sourceMethod': method_name,
                                 'note': 'Call-site URL literal; dynamic path suffixes and body bindings require call-site inspection.'})
            if method_name != '<clinit>':
                continue
            model_name = next((s for s in literals if s.startswith('com.ancestry.findagrave.') and 'Lqn6;-><init>' in body), None)
            if not model_name:
                continue
            registers, fields = {}, []
            for line in body.splitlines():
                sm = STR.search(line)
                if sm:
                    registers[sm[1]] = json.loads('"' + sm[2].replace("\\'", "'") + '"')
                cm = re.search(r'const(?:/4|/16)? (\w+), (0x[0-9a-f]+|\d+)', line)
                if cm:
                    registers[cm[1]] = int(cm[2], 0)
                fm = re.search(r'invoke-virtual \{\w+, (\w+), (\w+)\}, Lqn6;->j\(Ljava/lang/String;Z\)V', line)
                if fm:
                    fields.append({'name': registers[fm[1]], 'optionalInApp': bool(registers[fm[2]])})
            if fields:
                models.append({'name': model_name.split('.')[-1], 'qualifiedName': model_name, 'fields': fields, 'source': source})
    if len(graphql) < 25 or not models:
        raise SystemExit('Incomplete disassembly: expected GraphQL documents and serializers.')
    if len({op['id'] for op in graphql}) != len(graphql):
        raise SystemExit('Duplicate document IDs; inspect before regenerating.')
    enums = []
    for path in sorted((ROOT / 'analysis/findagrave/java/sources/defpackage').glob('*.java')):
        for m in re.finditer(r'aw1\.v\("(com\.ancestry\.findagrave\.[^"]+)", \w+\.values\(\), new String\[\]\{([^}]+)\}', path.read_text()):
            values = re.findall(r'"([^"]+)"', m[2])
            smali_paths = list(SMALI.glob(f'smali*/{path.stem}.smali'))
            if len(smali_paths) != 1 or not all('"' + value + '"' in smali_paths[0].read_text() for value in values):
                raise ValueError('Enum values must be corroborated by smali.')
            enums.append({'name': m[1].split('.')[-1], 'values': values, 'source': str(smali_paths[0].relative_to(ROOT))})
    return {'apkVersion': '4.0.2', 'graphql': sorted(graphql, key=lambda x: x['id']),
            'models': sorted(models, key=lambda x: x['qualifiedName']), 'enums': sorted(enums, key=lambda x: x['name']),
            'httpCallSites': sorted(rest, key=lambda x: x['id'])}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = extract()
    payload = json.dumps(data, indent=2) + '\n'
    outputs = {ROOT / 'docs/findagrave/contracts.json': payload,
               ROOT / 'src/findagrave/generated/contracts.ts': '// Generated by scripts/extract-findagrave.py. Do not edit.\nexport const contracts = ' + payload.rstrip() + ' as const;\n'}
    for path, content in outputs.items():
        if args.check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f'Stale generated file: {path.relative_to(ROOT)}')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    print(f"Find a Grave: {len(data['graphql'])} GraphQL documents, {len(data['models'])} model inventories, {len(data['httpCallSites'])} HTTP call sites")


if __name__ == '__main__':
    main()
