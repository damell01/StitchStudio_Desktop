"""Round path coordinates to 0.01 and drop repeated points in SVG files (in place)."""
import re, sys
def fmt(v):
    s = f"{float(v):.2f}".rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s
def compact(d):
    out, last = [], None
    for cmd, nums in re.findall(r'([MLZmlz])([^MLZmlz]*)', d):
        vals = re.findall(r'-?\d*\.?\d+(?:e-?\d+)?', nums)
        if cmd in 'Zz':
            out.append('Z'); last = None; continue
        pts = [(fmt(vals[i]), fmt(vals[i+1])) for i in range(0, len(vals) - 1, 2)]
        for k, p in enumerate(pts):
            c = cmd if k == 0 else 'L'
            if c == 'L' and p == last: continue
            out.append(f"{c}{p[0]} {p[1]}"); last = p
    return ' '.join(out).replace(' Z', 'Z')
for path in sys.argv[1:]:
    src = open(path).read()
    new = re.sub(r'( d=")([^"]*)(")', lambda m: m.group(1) + compact(m.group(2)) + m.group(3), src)
    open(path, 'w').write(new)
    print(len(src), '->', len(new), path.rsplit('/', 1)[-1])
