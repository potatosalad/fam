#!/usr/bin/env python3
"""Recover wire contracts from Retrofit signatures and Moshi JSON serializers.

Reads disassembly as text, never executes APK code. Fails on unsupported patterns.
The smaller contracts.json output is sufficient to regenerate the TypeScript SDK.
"""
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / 'analysis/decompiled/sources'
PREFIX = 'org/familysearch/mobile/tree/client/'


def split_args(s):
    parts, start, depth, quoted, escaped = [], 0, 0, False, False
    for i, c in enumerate(s):
        if quoted:
            if c == '"' and not escaped:
                quoted = False
            escaped = c == '\\' and not escaped
        elif c == '"':
            quoted = True
        elif c in '({[<':
            depth += 1
        elif c in ')}]>':
            depth -= 1
        elif c == ',' and depth == 0:
            parts.append(s[start:i].strip())
            start = i + 1
    return parts + [s[start:].strip()]


def simple(kind):
    return {'kind': kind}


def class_type(name, args=None):
    name = name.replace('.', '$')
    args = args or []
    if name in ['java/lang/String', 'java/lang/CharSequence', 'java/lang/Character']:
        return simple('string')
    if name in ['java/lang/Integer', 'java/lang/Double', 'java/lang/Float', 'java/lang/Short', 'java/lang/Byte', 'java/lang/Number']:
        return simple('number')
    if name == 'java/lang/Long':
        return simple('integer')
    if name == 'java/lang/Boolean':
        return simple('boolean')
    if name in ['p6g', 'kotlin/Unit', 'java/lang/Void']:
        return simple('void')
    if name in ['java/lang/Object']:
        return simple('json')
    if name in ['java/util/List', 'java/util/Set', 'java/util/Collection', 'java/util/ArrayList']:
        assert len(args) == 1, (name, args)
        return {'kind': 'array', 'items': args[0]}
    if name in ['java/util/Map', 'java/util/HashMap']:
        assert len(args) == 2, (name, args)
        assert args[0]['kind'] in ['string', 'integer', 'number']
        return {'kind': 'record', 'values': args[1]}
    if name in ['g33', 'wyc']:
        assert len(args) == 1
        return args[0]
    if name == 'cvc':
        return simple('upload')
    if name in ['azc', 'zyc']:
        return simple('binary')
    return {'kind': 'ref', 'name': name}


def descriptor(s, i=0):
    c = s[i]
    if c in '+-':
        return descriptor(s, i + 1)
    primitives = {'Z': 'boolean', 'J': 'integer', 'I': 'number', 'D': 'number', 'F': 'number', 'S': 'number', 'B': 'number', 'C': 'string', 'V': 'void'}
    if c in primitives:
        return simple(primitives[c]), i + 1
    if c == '[':
        item, end = descriptor(s, i + 1)
        return {'kind': 'array', 'items': item}, end
    assert c == 'L', s[i:]
    m = re.match(r'L([^;<]+)', s[i:])
    name = m[1]
    j, args = i + len(m[0]), []
    if s[j] == '<':
        j += 1
        while s[j] != '>':
            item, j = descriptor(s, j)
            args.append(item)
        j += 1
    assert s[j] == ';', s[j:]
    return class_type(name, args), j + 1


models = {}
pending = set()


def references(t):
    if t['kind'] == 'ref':
        pending.add(t['name'])
    if t['kind'] == 'array':
        references(t['items'])
    if t['kind'] == 'record':
        references(t['values'])


def recover_model(name):
    path = JAVA / (name.replace('$', '_') + 'JsonAdapter.java')
    assert path.exists(), 'Missing serializer: ' + name
    text = path.read_text()
    package = re.search(r'package ([\w.]+);', text)[1]
    imports = {s.split('.')[-1]: s.replace('.', '/') for s in re.findall(r'import ([\w.]+);', text)}
    # JADX sometimes replaces string literals with references to unrelated public constants.
    for symbol in set(re.findall(r'\b[A-Z]\w*\.[A-Z][A-Z_0-9]+\b', text)):
        cls, field = symbol.split('.')
        constant_file = JAVA / (imports.get(cls, '') + '.java')
        if constant_file.is_file():
            constant = re.search(r'\b' + re.escape(field) + r' = ("(?:[^"\\]|\\.)*");', constant_file.read_text())
            if constant:
                text = text.replace(symbol, constant[1])
    # Wrapper classes are implicitly imported by Java.
    for cls in ['String', 'Integer', 'Boolean', 'Long', 'Double', 'Float', 'Short', 'Byte', 'Object', 'Number']:
        imports[cls] = 'java/lang/' + cls
    variables = {}

    def java_type(expr):
        expr = expr.strip()
        if expr in variables:
            return variables[expr]
        if expr.endswith('.class') or expr.endswith('.TYPE'):
            cls = expr.rsplit('.', 1)[0]
            return class_type(imports.get(cls, package.replace('.', '/') + '/' + cls))
        if expr.startswith('oqi.g('):
            args = split_args(expr[6:-1])
            base = args[0].removesuffix('.class')
            if len(args) == 2 and args[1].startswith('new Type[]{'):
                args = [args[0]] + split_args(args[1][11:-1])
            return class_type(imports.get(base, base), [java_type(a) for a in args[1:]])
        raise AssertionError((name, 'Unsupported type expression', expr))

    start = text.index('public ' + path.stem + '(')
    constructor = text[start:text.index('\n    @Override', start)]
    adapter_types = {}
    for line in constructor.splitlines():
        cls_assign = re.search(r'\b(\w+) = (\w+\.(?:class|TYPE));', line)
        if cls_assign:
            variables[cls_assign[1]] = java_type(cls_assign[2])
        assign = re.search(r'\b(\w+) = (oqi\.g\(.*\));', line)
        if assign:
            variables[assign[1]] = java_type(assign[2])
        adapter = re.search(r'this\.(\w+) = \w+\.b\((.*)\);', line)
        if adapter:
            args = split_args(adapter[2])
            assert len(args) == 3, (name, args)
            adapter_types[adapter[1]] = java_type(args[0])

    required = set(re.findall(r'ocg\.g\("[^"\n]*",\s*"([^"\n]+)"', text))
    nonnull = set(re.findall(r'ocg\.m\("[^"\n]*",\s*"([^"\n]+)"', text)) | required
    fields, aliases, current = {}, {}, None
    to_json = text[text.index('public final void toJson'):]
    for line in to_json.splitlines():
        prop = re.search(r'\w+\.r\("([^"\n]+)"\);', line)
        if prop:
            assert current is None, (name, 'Unmapped field', current)
            current = prop[1]
        alias = re.search(r'JsonAdapter (\w+) = this\.(\w+);', line)
        if alias:
            aliases[alias[1]] = alias[2]
        # R8 outlines primitive serialization followed by the next JSON field name.
        # Each helper below calls adapter.toJson(writer, boxedValue), then writer.r(name).
        outlined = re.search(r'(?:ab0\.s|g09\.[st]|pu1\.o|f16\.v)\((.*)\);', line)
        if outlined:
            args = split_args(outlined[1])
            assert len(args) in [3, 4] and current is not None, (name, line)
            key = args[1].removeprefix('this.') if args[1].startswith('this.') else aliases[args[1]]
            field_type = adapter_types[key]
            fields[current] = {'type': field_type, 'required': current in required, 'nullable': current not in nonnull}
            references(field_type)
            assert len(args) == 3 or args[3].startswith('"'), (name, line)
            current = json.loads(args[3]) if len(args) == 4 else None
        use = re.search(r'(this\.\w+|\w+)\.toJson\(', line)
        if use and current is not None:
            key = use[1].removeprefix('this.') if use[1].startswith('this.') else aliases[use[1]]
            field_type = adapter_types[key]
            fields[current] = {'type': field_type, 'required': current in required, 'nullable': current not in nonnull}
            references(field_type)
            current = None
    assert current is None and fields, (name, 'No fully decoded serializer')
    # Ensure every field in the serializer's options is represented, including reused adapters.
    option = re.search(r'this\.\w+ = xj7\.a\((.*?)\);', constructor, re.S)
    assert option
    expected = re.findall(r'"([^"\n]+)"', option[1])
    assert list(fields) == expected, (name, expected, list(fields))
    assert required <= fields.keys() and nonnull <= fields.keys(), (name, required, nonnull)
    return {'source': str(path.relative_to(ROOT)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'fields': fields}


inventory = json.loads((ROOT / 'docs/endpoints.json').read_text())['endpoints']
selection = json.loads((ROOT / 'docs/operation-selection.json').read_text())
operations = []
for chosen in selection['operations']:
    if chosen.get('unsupported'):
        continue
    matches = [e for e in inventory if (e['method'], e['path']) == (chosen['method'], chosen['path'])]
    assert len(matches) == 1, chosen
    e = matches[0]
    sig = e['genericSignature']
    assert sig and sig.startswith('('), e
    i, slot, parameter_types, response = 1, 1, {}, None
    while sig[i] != ')':
        start = i
        t, i = descriptor(sig, i)
        if sig[start:].startswith('Lg33<'):
            response = t
        else:
            parameter_types['p' + str(slot)] = t
        slot += 2 if sig[start] in 'JD' else 1
    assert response is not None, e
    parameters = []
    for p in e['parameters']:
        register = re.search(r'\.param (p\d+)', p['signature'])[1]
        t = parameter_types[register]
        parameters.append({'kind': p['kind'], 'name': p['name'] or 'body', 'type': t,
                           # Retrofit omits null query/header values; path/body are required.
                           'required': p['kind'] in ['path', 'body'], 'encodedInApk': p['encoded']})
        references(t)
    references(response)
    operations.append({**chosen, 'parameters': parameters, 'response': response, 'staticHeaders': e['staticHeaders'],
                       'evidence': {'source': e['source'], 'line': e['line'], 'member': e['member']}})

while pending:
    name = sorted(pending)[0]
    pending.remove(name)
    if name not in models:
        models[name] = recover_model(name)

out = {'version': 1, 'apkVersion': '5.4.4 (43530)', 'scope': selection['scope'], 'operations': operations, 'models': dict(sorted(models.items()))}
(ROOT / 'docs/contracts.json').write_text(json.dumps(out, indent=2) + '\n')
print(f'Recovered {len(operations)} operations and {len(models)} models.')
