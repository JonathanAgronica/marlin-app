#!/usr/bin/env python3
"""Single-file build for Mac's Marlin: inlines src/app.css, src/astro.js, src/app.js and data/fads.json into index.html,
and writes sw.js with a fresh build id (bumped every build) so phones pick up the new version."""
import json, os, time
R = os.path.dirname(os.path.abspath(__file__)); S = lambda p: open(os.path.join(R, p), encoding='utf8').read()
BUILD = time.strftime('%Y%m%d%H%M')
html = S('src/app.html')
for k, v in {'/*CSS*/': S('src/app.css'), '/*ASTRO*/': S('src/astro.js'), '/*APP*/': S('src/app.js'),
             '/*FADS*/': json.dumps(json.load(open(os.path.join(R, 'data/fads.json'))), ensure_ascii=False, separators=(',', ':')), '/*BUILD*/': BUILD}.items():
    assert html.count(k) == 1, k; html = html.replace(k, v)
open(os.path.join(R, 'index.html'), 'w', encoding='utf8').write(html)
open(os.path.join(R, 'sw.js'), 'w').write(S('src/sw.js').replace('__BUILD__', BUILD))
print('built', BUILD, len(html) // 1024, 'KB')
