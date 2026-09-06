#!/usr/bin/env python3
"""Extract API contracts from apktool smali; no APK code is executed.

Run after scripts/analyze-myheritage.sh. Generated JSON is also the SDK input.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SMALI = ROOT / 'analysis/myheritage/smali'


def string(value):
    return json.loads('"' + value + '"')


def extract():
    rest, graphql, models = [], {}, []
    for path in sorted(SMALI.glob('smali*/**/*.smali')):
        text = path.read_text()
        declaration = re.search(r'^\.class[^\n]*?\bL([^;]+);', text, re.M)
        if not declaration:
            raise ValueError(f'Cannot parse class: {path}')
        owner = declaration.group(1)
        source = str(path.relative_to(ROOT))
        for method in re.finditer(r'^\.method (.*?)\n(.*?)^\.end method', text, re.M | re.S):
            signature, body = method.groups()
            http = re.search(r'\.annotation runtime Lretrofit2/http/(GET|POST|PUT|PATCH|DELETE|HEAD);(.*?)\.end annotation', body, re.S)
            if http:
                route = re.search(r'value = "((?:\\.|[^"\\])*)"', http[2])
                route = string(route[1]) if route else ''
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
                generic = re.search(r'\.annotation system Ldalvik/annotation/Signature;(.*?)\.end annotation', body, re.S)
                generic = ''.join(string(s) for s in re.findall(r'"((?:\\.|[^"\\])*)"', generic[1])) if generic else None
                rest.append({'id': 'rest.' + owner.replace('/', '.') + '.' + operation,
                             'owner': owner, 'method': http[1], 'path': route,
                             'parameters': params, 'headers': headers,
                             'encoding': 'form' if 'Lretrofit2/http/FormUrlEncoded;' in body else 'multipart' if 'Lretrofit2/http/Multipart;' in body else 'json',
                             'signature': signature, 'genericSignature': generic, 'source': source})
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
            entry = {'id': f'graphql.embedded.{name}', 'name': name, 'kind': kind, 'variables': parsed, 'document': query,
                     'sha256': hashlib.sha256(query.encode()).hexdigest(), 'source': source}
            key = hashlib.sha256(query.encode()).hexdigest()
            graphql.setdefault(key, entry)
        if owner.startswith(('com/myheritage/libs/fgobjects/', 'com/myheritage/libs/authentication/models/')):
            fields = []
            for field in re.finditer(r'^\.field (.*?)\n(.*?)(?=^\.field |^#|^\.method |\Z)', text, re.M | re.S):
                if re.search(r'\b(static|synthetic|transient)\b', field[1]): continue
                decl = re.search(r'(\w+):([^ =]+)', field[1])
                if not decl: continue
                serial = re.search(r'L(?:com/google/gson/annotations/SerializedName|kwb);\s*value = "([^"\n]+)"', field[2])
                fields.append({'name': serial[1] if serial else decl[1], 'field': decl[1], 'type': decl[2]})
            if fields: models.append({'name': owner.replace('/', '.'), 'fields': fields, 'source': source})
    for path in sorted((ROOT / 'analysis/myheritage/assets/graphql').rglob('*.gql')):
        query = path.read_text()
        match = re.search(r'\b(query|mutation)\s+(\w+)\s*(?:\((.*?)\))?\s*\{', query, re.S)
        if not match: raise ValueError(f'Cannot parse {path}')
        kind, name, variables = match.groups()
        parsed = []
        for v in re.finditer(r'\$(\w+)\s*:\s*([\w\[\]!]+)(?:\s*=\s*([^,$]+))?', variables or ''):
            parsed.append({'name': v[1], 'type': v[2], 'required': v[2].endswith('!') and v[3] is None,
                           **({'default': v[3].strip()} if v[3] is not None else {})})
        rel = str(path.relative_to(ROOT / 'analysis/myheritage/assets/graphql')).removesuffix('.gql')
        graphql['asset:' + rel] = {'id': 'graphql.' + rel.replace('/', '.'), 'name': name, 'kind': kind,
            'variables': parsed, 'document': query, 'sha256': hashlib.sha256(query.encode()).hexdigest(), 'source': str(path.relative_to(ROOT))}
    # Overloaded methods and operation names must remain addressable independently.
    for op in rest:
        if sum(x['id'] == op['id'] for x in rest) > 1:
            original = op['id']
            for other in rest:
                if other['id'] == original: other['id'] += '.' + hashlib.sha256(other['signature'].encode()).hexdigest()[:8]
    for op in graphql.values():
        duplicates = [x for x in graphql.values() if x['id'] == op['id']]
        if len(duplicates) > 1:
            for other in duplicates: other['id'] += '.' + other['sha256'][:8]
    # Confirmed Retrofit roots: a74 (FamilyGraph), tk5 (GraphQL), iq7 (web), j85 (one-time token).
    for op in rest:
        op['base'] = ('https://familygraphql.myheritage.com/' if op['path'].startswith('mobile_') else
                      'https://origin-www.myheritage.com/' if op['owner'].endswith('/ReportEventApiInterface') and op['path'] == 'FP/API/reportEvent.php' else
                      'https://www.myheritage.com/' if op['path'].startswith('FP/') else
                      'https://www.myheritage.com/FP/API/FamilyGraph/' if op['path'] == 'get-familygraph-token.php' else
                      'https://www.myheritage.com/FP/API/DnaEthnicityIntroduction/' if 'DnaEthnicity' in op['owner'] else 'https://familygraph.myheritage.com/')
    # Preserve asset/embedded variants. Derive routing from the request class which loads each asset,
    # not from the GraphQL operation name (several APK documents have misleading duplicate names).
    java = ROOT / 'analysis/myheritage/java/sources'
    callers = {}
    for p in sorted(java.rglob('*.java')):
        t = p.read_text()
        for asset in re.findall(r'"([a-z0-9_/]+\.gql)"', t):
            for iface, method in re.findall(r'\(\((\w+)\) .*?\.create\(\1\.class\)\)\.(\w+)\(', t):
                matches = [o for o in rest if o['owner'].endswith('/'+iface) and o['signature'].split('(')[0].split()[-1] == method and o['base'] == 'https://familygraphql.myheritage.com/']
                for o in matches: callers.setdefault(asset, set()).add(o['path'])
    for op in graphql.values():
        asset = op['source'].split('assets/graphql/')[-1]
        routes = sorted(callers.get(asset, set()))
        overrides = {
            'change_estimated_date_status.gql': 'mobile_changeEstimatedDateStatus/',
            'get_estimation_data.gql': 'mobile_getEstimationData/',
            'start_date_estimation.gql': 'mobile_startDateEstimation/',
            'inbox/get_mailbox_counters.gql': 'mobile_getMailBox/',
            'individual/get_individuals_indexes_for_tree.gql': 'mobile_getFamilyListIndividuals/',
            'photos/time_machine/get_time_machine_completed_models.gql': 'mobile_getTimeMachineResults/',
            'site/get_animation_drivers.gql': 'mobile_getSiteAnimationDrivers/',
            'site/get_site_available_quota.gql': 'mobile_getSiteAvailableQuota/',
            'super_search/get_research_catalog_record_count.gql': 'mobile_getResearchCatalogRecordCount/',
            'tree/update_suggested_relative_to_add.gql': 'mobile_updateSuggestedRelativeToAdd/'
        }
        if asset in overrides: routes = [overrides[asset]]
        op['routes'] = routes
        op['route'] = routes[0] if len(routes) == 1 else '/' if '.embedded.' in op['id'] else None
    if not rest or not graphql: raise ValueError('No contracts found; disassemble the APK first')
    return {'apkVersion': '7.5.44', 'rest': sorted(rest, key=lambda op: op['id']),
            'graphql': sorted(graphql.values(), key=lambda op: op['id']), 'models': models}


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--check', action='store_true')
    check = args.parse_args().check
    contracts = extract()
    outputs = {ROOT / 'docs/myheritage/contracts.json': json.dumps(contracts, indent=2) + '\n',
               ROOT / 'src/myheritage/generated/contracts.ts': '// Generated by scripts/extract-myheritage.py. Do not edit.\nexport const contracts = ' + json.dumps(contracts, indent=2) + ' as const;\n'}
    for path, content in outputs.items():
        if check:
            if not path.exists() or path.read_text() != content:
                raise SystemExit(f'Generated file is stale: {path.relative_to(ROOT)}')
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
    print(f"MyHeritage contracts: {len(contracts['rest'])} REST declarations, {len(contracts['graphql'])} GraphQL operations")


if __name__ == '__main__':
    main()
