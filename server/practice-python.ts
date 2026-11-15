/** Maintained synchronous Python adapter; no pytest, reference code or source interpolation. */
export const pythonHarness = `
import importlib, importlib.util, inspect, json, math, pathlib, sys, traceback
input = json.loads(pathlib.Path('__stupen_practice_input.json').read_text(encoding='utf-8'))
result = pathlib.Path('__stupen_practice_result.json')
def plain(v, depth=1):
    if depth > 8:
        raise ValueError('Output nesting exceeds 8')
    if type(v) in (bool, str):
        return v
    if type(v) in (int, float) and math.isfinite(v) and (not float(v).is_integer() or abs(v) <= 9007199254740991):
        return v
    if type(v) is list and len(v) <= 1000:
        return [plain(x, depth+1) for x in v]
    if type(v) is dict and len(v) <= 64 and all(type(k) is str for k in v):
        return {k: plain(x, depth+1) for k,x in v.items()}
    raise ValueError('Return a JSON-compatible value: booleans, strings, safe finite numbers, lists or string-keyed dicts')
try:
    path = pathlib.Path(input['entry']['file']).resolve()
    sys.path.insert(0, str(path.parent))
    name = '.'.join(pathlib.Path(input['entry']['file']).with_suffix('').parts)
    if '.' in name:
        importlib.import_module(name.rsplit('.', 1)[0])
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    fn = getattr(module, input['entry']['symbol'])
    if not inspect.isfunction(fn) or inspect.iscoroutinefunction(fn) or inspect.isgeneratorfunction(fn) or inspect.isasyncgenfunction(fn):
        raise TypeError('Entry must declare a synchronous function')
    actual = fn(*input['args'])
    try:
        text = json.dumps({'actual': plain(actual)}, ensure_ascii=False, allow_nan=False)
        data = text.encode('utf-8', errors='backslashreplace')
        if len(data) > 65536:
            raise ValueError('Output exceeds 64 KiB')
        result.write_bytes(data)
    except Exception as error:
        print(str(error), file=sys.stderr)
        result.write_text('{"invalid":true}', encoding='utf-8')
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;
