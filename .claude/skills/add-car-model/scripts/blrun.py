# Runs a build script under `blender --background` and writes its `result` next to it as JSON.
import bpy, json, sys, traceback

script = sys.argv[sys.argv.index('--') + 1]
scope = {'__name__': '__main__'}
try:
    exec(open(script, encoding='utf8').read(), scope)
    out = scope.get('result', {})
except Exception:
    out = {'error': traceback.format_exc()}
with open(script + '.json', 'w', encoding='utf8') as f:
    json.dump(out, f, ensure_ascii=False, default=str)
