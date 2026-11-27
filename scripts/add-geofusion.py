"""Add USRG_GeoFusion (and Himawari-9 IR Enhanced) handlers to a goesproc config.
Usage: add_geofusion.py IN.conf OUT.conf   (safe to run twice: skips if already there)"""
import re, sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, newline='').read(); nl = '\r\n' if '\r\n' in s else '\n'; s = s.replace('\r\n', '\n')
if 'USRG_GeoFusion' in s:
    open(dst, 'w', newline='').write(s.replace('\n', nl)); print('already has GeoFusion'); sys.exit()
lines = s.split('\n')

def block_at(i):
    """[start, end) of the [[handler]] holding line i, without the next block's header comments."""
    a = max(j for j in range(i + 1) if lines[j].startswith('[[handler]]'))
    b = next((j for j in range(i + 1, len(lines)) if lines[j].startswith('[[handler]]')), len(lines))
    while b > a and (lines[b - 1].strip() == '' or lines[b - 1].startswith('#')):
        b -= 1
    return a, b

m = re.search(r'\[handler\.gradient\.ch13\]\n(\s*points = \[.*?\n\s*\])', s, re.S)
ch13 = m.group(1) if m else None

inserts = []
for i, l in enumerate(lines):
    if not re.match(r'\s*directory\s*=.*/USRG_GeoColor/', l):
        continue
    a, b = block_at(i)
    blk = lines[a:b]
    origin = next((x for x in blk if x.strip().startswith('origin')), '')
    him = 'himawari' in origin
    gpath = next((x.split('=', 1)[1].strip().strip('"') for x in blk if re.match(r'\s*path\s*=.*/geocolor"', x)), '/usr/share/goestools/usradioguy/geocolor')
    share = gpath.rsplit('/', 1)[0]
    new = [x.replace('USRG_GeoColor', 'USRG_GeoFusion') if re.match(r'\s*(directory|filename)\s*=', x) else x for x in blk]
    head = ['', '# USRG_GeoFusion (Nov 2026): GeoColor with the enhanced Channel 13 cold cloud-top',
            '# colors on top at 75%. Grey parts of the enhancement (warmer cloud, map lines) are clear.']
    fus = ['', '  [handler.geofusion]', '  strength = 0.75']
    if him:
        fus += ['  # Himawari relay files carry no calibration: colors per (remapped) IR level',
                f'  table = "{share}/himawari9_geofusion_table.png"']
    else:
        if not ch13:
            sys.exit('no [handler.gradient.ch13] in this config to copy')
        fus += ['', '  # Same Channel 13 colors as this config\'s ch13_enhanced images',
                '  [handler.gradient.ch13]', ch13]
    out = head + new + fus
    if him:
        out += ['', '# Himawari-9 IR Enhanced (Nov 2026): Channel 13 style colors for the relayed IR',
                '[[handler]]', 'type = "image"', 'origin = "himawari8"', 'channels = [ "ir" ]',
                'directory = "./himawari9/{region:short|lower}/ir_enhanced/{time:%Y-%m-%d}"',
                'filename = "Himawari9_{region:short}_IRENH_{time:%Y%m%dT%H%M%SZ}"',
                'format = "jpg"', 'json = false', '',
                '  [handler.remap.ir]', f'  path = "{share}/himawari9_ir_enhanced.png"', '',
                '  [[handler.map]]', '  path = "/usr/share/goestools/ne/ne_50m_admin_0_countries_lakes.json"'.replace('/usr/share/goestools', share.rsplit('/', 1)[0]), '',
                '  [[handler.map]]', '  path = "/usr/share/goestools/ne/ne_50m_admin_1_states_provinces_lakes.json"'.replace('/usr/share/goestools', share.rsplit('/', 1)[0])]
    inserts.append((b, out))

for b, out in sorted(inserts, reverse=True):
    lines[b:b] = out
open(dst, 'w', newline='').write('\n'.join(lines).replace('\n', nl))
print(dst, 'added', len(inserts), 'GeoFusion handler(s)')
