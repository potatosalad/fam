#!/usr/bin/env python3
"""Extract API contracts from apktool smali; no APK code is executed.

Run after scripts/analyze-findmypast.sh. Generated JSON is also the SDK input.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SMALI = ROOT / 'analysis/findmypast/smali'


def string(value):
    return json.loads('"' + value.replace("\\'", "'") + '"')


def extract():
    rest, graphql = [], {}
    for path in sorted(SMALI.glob('smali*/**/*.smali')):
        text = path.read_text()
        declaration = re.search(r'^\.class[^\n]*?\bL([^;]+);', text, re.M)
        if not declaration:
            raise ValueError(f'Cannot parse class: {path}')
        owner = declaration.group(1)
        source = str(path.relative_to(ROOT))
        for method in re.finditer(r'^\.method (.*?)\n(.*?)^\.end method', text, re.M | re.S):
            signature, body = method.groups()
            http = re.search(r'\.annotation runtime Lretrofit2/http/(GET|POST|PUT|PATCH|DELETE|HEAD);\s*value = "((?:\\.|[^"\\])*)"', body)
            if http and owner in {'w40', 'eh7', 'cj', 'hl0'}:
                params = []
                for param in re.finditer(r'\.param (p\d+)([^\n]*)\n(.*?)\.end param', body, re.S):
                    for annotation in re.finditer(r'\.annotation runtime Lretrofit2/http/(\w+);(.*?)\.end annotation', param[3], re.S):
                        value = re.search(r'value = "((?:\\.|[^"\\])*)"', annotation[2])
                        params.append({'kind': annotation[1], 'name': string(value[1]) if value else None,
                                       'type': param[2].strip().removeprefix('# ').strip(),
                                       'encoded': 'encoded = true' in annotation[2]})
                header_block = re.search(r'\.annotation runtime Lretrofit2/http/Headers;(.*?)\.end annotation', body, re.S)
                headers = {}
                if header_block:
                    for value in re.findall(r'"((?:\\.|[^"\\])*)"', header_block[1]):
                        name, sep, value = string(value).partition(':')
                        if sep: headers[name] = value.strip()
                operation = signature.split('(')[0].split()[-1]
                rest.append({'id': 'rest.' + owner.replace('/', '.') + '.' + operation,
                             'owner': owner, 'method': http[1], 'path': string(http[2]),
                             'parameters': params, 'headers': headers,
                             'encoding': 'form' if 'Lretrofit2/http/FormUrlEncoded;' in body else 'multipart' if 'Lretrofit2/http/Multipart;' in body else 'json',
                             'signature': signature, 'source': source})
        for literal in re.finditer(r'const-string(?:/jumbo)? \w+, "((?:query|mutation) (?:\\.|[^"\\])*)"', text):
            query = string(literal[1])
            match = re.match(r'(query|mutation) (\w+)\s*(?:\((.*?)\))?\s*\{', query, re.S)
            if not match:
                continue  # Error messages containing "query ..." are not documents.
            kind, name, variables = match.groups()
            parsed = []
            for v in re.finditer(r'\$(\w+)\s*:\s*([\w\[\]!]+)(?:\s*=\s*([^,$]+))?', variables or ''):
                parsed.append({'name': v[1], 'type': v[2], 'required': v[2].endswith('!') and v[3] is None,
                               **({'default': v[3].strip()} if v[3] is not None else {})})
            entry = {'id': f'graphql.{name}', 'name': name, 'kind': kind, 'variables': parsed, 'document': query,
                     'sha256': hashlib.sha256(query.encode()).hexdigest(), 'source': source}
            if name in graphql and graphql[name]['document'] != query:
                raise ValueError(f'Different documents share GraphQL name {name}')
            graphql[name] = entry
    if not rest or not graphql:
        raise ValueError('No contracts found; disassemble the APK first')
    input_types = {re.sub(r'[\[\]!]', '', v['type']) for op in graphql.values() for v in op['variables']}
    models = []
    for path in sorted(SMALI.glob('smali*/**/*.smali')):
        text = path.read_text()
        method = re.search(r'^\.method[^\n]* toString\(\)Ljava/lang/String;\n(.*?)^\.end method', text, re.M | re.S)
        if not method: continue
        literals = re.findall(r'const-string(?:/jumbo)? \w+, "((?:\\.|[^"\\])*)"', method[1])
        joined = ''.join(string(s) for s in literals)
        name = re.match(r'(\w+)\(', joined)
        if name and name[1] in input_types:
            models.append({'name': name[1], 'fields': re.findall(r'(\w+)=', joined), 'source': str(path.relative_to(ROOT)),
                           'note': 'Input field inventory from toString; not a complete server SDL or required-field schema.'})
    return {'apkVersion': '2.59.0', 'models': sorted(models, key=lambda m: m['name']), 'rest': sorted(rest, key=lambda op: op['id']), 'graphql': sorted(graphql.values(), key=lambda op: op['name'])}


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--check', action='store_true')
    check = args.parse_args().check
    contracts = extract()
    outputs = {ROOT / 'docs/findmypast/contracts.json': json.dumps(contracts, indent=2) + '\n',
               ROOT / 'src/findmypast/generated/contracts.ts': '// Generated by scripts/extract-findmypast.py. Do not edit.\nexport const contracts = ' + json.dumps(contracts, indent=2) + ' as const;\n'}
    for path, content in outputs.items():
        if check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f'Generated file is stale: {path.relative_to(ROOT)}')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    print(f"Findmypast contracts: {len(contracts['rest'])} REST declarations, {len(contracts['graphql'])} GraphQL operations")


if __name__ == '__main__':
    main()
