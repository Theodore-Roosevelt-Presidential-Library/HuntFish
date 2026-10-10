#!/usr/bin/env python3
"""Build the data files for the HuntFish tools (standard library only).

Writes, into docs/data/:
  lands.json   public land and walk-in hunting land around Medora, one class per feature (GeoJSON)
  units.json   hunting unit outlines (deer, elk, pronghorn, bighorn sheep, turkey, mountain lion)
  waters.json  fishing waters: species, Game and Fish notes, depth, ramps and piers, recent stocking,
               aquatic nuisance species, contour map link (GeoJSON points)
  places.json  license vendors and Game and Fish offices (GeoJSON points)
  meta.json    when each source was read and how many features came back

Land that is in none of these layers is shown as "private or unknown".

Privacy. Two of the state services also carry personal details: the trust land layer has lessee
names, phone numbers and rents, and the electronically posted land layer has owner names, phones
and emails. Only the fields listed in this file are requested. The posted land layer is not read
here at all; the widget asks it one yes/no question (the POSTED flag) for a tapped point.

Usage:  python collector/build.py
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'data')

# Coverage: the Little Missouri badlands and the country around them, from the Montana line to
# Dickinson and Killdeer, and from the South Dakota line to the Missouri River.
BBOX = (-104.05, 46.0, -102.3, 48.1)  # west, south, east, north

UA = 'TRPL-HuntFish-Collector/1.0 (+https://huntfish.labs.trlibrary.com)'
USFS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW'
PADUS = 'https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0'
TRUST = 'https://ndgishub.nd.gov/arcgis/rest/services/Applications/SLD_TrustlandMinerals/MapServer/1'
GNF = 'https://ndgishub.nd.gov/arcgis/rest/services/Applications'
PLOTS_GUIDE = GNF + '/GNF_PLOTSGuide/MapServer'
FISH = GNF + '/GNF_FishingWaters/MapServer'
GENERAL = GNF + '/GNF_GeneralInformation/MapServer'

DIGITS = 5  # about one metre


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get_json(url, params, tries=4):
    full = url + '?' + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            req = urllib.request.Request(full, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                d = json.loads(r.read().decode('utf-8'))
            if isinstance(d, dict) and d.get('error'):
                raise RuntimeError(json.dumps(d['error'])[:300])
            return d
        except Exception as e:  # noqa: BLE001
            log('  retry', i + 1, 'after', type(e).__name__, str(e)[:200])
            time.sleep(5 * (i + 1))
    raise RuntimeError('failed: ' + full[:300])


def envelope():
    w, s, e, n = BBOX
    return json.dumps({'xmin': w, 'ymin': s, 'xmax': e, 'ymax': n, 'spatialReference': {'wkid': 4326}})


def query_all(layer, where, fields, offset_deg, page=1000, order='OBJECTID', bbox=True):
    """Every feature (intersecting BBOX unless bbox=False), as GeoJSON features."""
    feats, start = [], 0
    while True:
        params = {
            'where': where, 'outFields': fields, 'returnGeometry': 'true', 'outSR': 4326, 'f': 'geojson',
            'resultOffset': start, 'resultRecordCount': page, 'orderByFields': order,
        }
        if bbox:
            params.update({'geometry': envelope(), 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
                           'spatialRel': 'esriSpatialRelIntersects'})
        if offset_deg:
            params['maxAllowableOffset'] = offset_deg
        d = get_json(layer + '/query', params)
        got = d.get('features', [])
        feats.extend(got)
        log('  ', layer.split('/services/')[-1][:70], 'offset', start, '+', len(got))
        more = d.get('exceededTransferLimit') or (d.get('properties') or {}).get('exceededTransferLimit')
        if not got or (len(got) < page and not more):
            break
        start += len(got)
    return feats


# ---------- geometry helpers ----------

def clip_ring(ring):
    """Sutherland-Hodgman clip of one ring to BBOX. Returns [] if nothing is left."""
    w, s, e, n = BBOX

    def clip(points, inside, cross):
        out = []
        if not points:
            return out
        prev = points[-1]
        for cur in points:
            if inside(cur):
                if not inside(prev):
                    out.append(cross(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(cross(prev, cur))
            prev = cur
        return out

    def x_at(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return [x, a[1] + t * (b[1] - a[1])]

    def y_at(a, b, y):
        t = (y - a[1]) / (b[1] - a[1])
        return [a[0] + t * (b[0] - a[0]), y]

    pts = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring[:]
    pts = clip(pts, lambda p: p[0] >= w, lambda a, b: x_at(a, b, w))
    pts = clip(pts, lambda p: p[0] <= e, lambda a, b: x_at(a, b, e))
    pts = clip(pts, lambda p: p[1] >= s, lambda a, b: y_at(a, b, s))
    pts = clip(pts, lambda p: p[1] <= n, lambda a, b: y_at(a, b, n))
    if len(pts) < 3:
        return []
    return pts + [pts[0]]


def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2.0


def rnd(ring, digits=DIGITS):
    out = []
    for x, y in ring:
        p = [round(x, digits), round(y, digits)]
        if not out or p != out[-1]:
            out.append(p)
    return out


def polygons_of(geom):
    if not geom:
        return []
    if geom['type'] == 'Polygon':
        return [geom['coordinates']]
    if geom['type'] == 'MultiPolygon':
        return geom['coordinates']
    return []


def clean_polygons(geom, min_area=1e-8, digits=DIGITS):
    """Clip to BBOX, round, drop slivers. Returns a list of polygons (lists of rings)."""
    out = []
    for poly in polygons_of(geom):
        rings = []
        for k, ring in enumerate(poly):
            c = rnd(clip_ring([list(map(float, p[:2])) for p in ring]), digits)
            if len(c) < 4 or abs(ring_area(c)) < min_area:
                if k == 0:
                    rings = []
                    break
                continue
            rings.append(c)
        if rings:
            out.append(rings)
    return out


def feature(polys, props):
    geom = {'type': 'Polygon', 'coordinates': polys[0]} if len(polys) == 1 else {'type': 'MultiPolygon', 'coordinates': polys}
    return {'type': 'Feature', 'properties': props, 'geometry': geom}


def point(x, y, props):
    return {'type': 'Feature', 'properties': props, 'geometry': {'type': 'Point', 'coordinates': [round(x, DIGITS), round(y, DIGITS)]}}


def in_bbox(x, y, pad=0.0):
    w, s, e, n = BBOX
    return w - pad <= x <= e + pad and s - pad <= y <= n + pad


def epoch_or_text_date(v):
    """ArcGIS dates come back as epoch milliseconds or as 'YYYY-MM-DD hh:mm:ss' text."""
    if v is None or v == '':
        return ''
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v / 1000, timezone.utc).strftime('%Y-%m-%d')
    return str(v)[:10]


# ---------- land ----------

def forest_service_land():
    log('Forest Service land (surface ownership parcels)')
    feats = query_all(USFS + '/EDW_SurfaceOwnership_01/MapServer/0',
                      "ownerclassification='USDA FOREST SERVICE'", 'nfslandunitname', 0.00003)
    out = []
    for f in feats:
        polys = clean_polygons(f.get('geometry'))
        if polys:
            name = (f.get('properties') or {}).get('nfslandunitname') or 'Little Missouri National Grassland'
            out.append(feature(polys, {'c': 'usfs', 'n': name}))
    return out


def trust_land():
    log('State school trust land (ND Department of Trust Lands surface tracts)')
    # Only these fields. The layer also holds lessee names, phones and rents; they are never requested.
    feats = query_all(TRUST, '1=1', 'OBJECTID,TRACT_ID,COUNTY,TWP,RNG,SEC,SUBDIVISION,PUBLIC_ACCESS', 0.00003)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'))
        if not polys:
            continue
        legal = 'Sec. %s, T%sN, R%sW' % (p.get('SEC'), p.get('TWP'), p.get('RNG')) if p.get('SEC') else ''
        out.append(feature(polys, {
            'c': 'trust', 'n': 'State school trust land', 'a': (p.get('PUBLIC_ACCESS') or '').strip(),
            'l': legal, 'q': (p.get('SUBDIVISION') or '').strip(), 'k': (p.get('COUNTY') or '').strip().title(),
        }))
    return out


def plots_land():
    """Private Land Open To Sportsmen: walk-in hunting by agreement with Game and Fish."""
    log('PLOTS (ND Game and Fish, PLOTS Guide)')
    feats = query_all(PLOTS_GUIDE + '/18', "Status='Active'",
                      'ObjectID,agreement,Unit_Name,County_Name,Access_Acres,EndDate,signed', 0.00003, order='ObjectID')
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    out = []
    for f in feats:
        p = f.get('properties') or {}
        end = epoch_or_text_date(p.get('EndDate'))
        if end and end < today:
            continue
        polys = clean_polygons(f.get('geometry'))
        if not polys:
            continue
        props = {'c': 'plots', 'n': 'PLOTS walk-in hunting area', 'id': p.get('agreement') or '',
                 'ac': round(p.get('Access_Acres') or 0), 'k': (p.get('County_Name') or '').strip()}
        if 'Mule Deer' in (p.get('Unit_Name') or ''):
            props['md'] = 1
        if 'Unharvested' in (p.get('signed') or ''):
            props['uc'] = 1  # posted "No Hunting in Unharvested Crop"
        out.append(feature(polys, props))
    return out


def wma_land():
    log('Wildlife management areas (ND Game and Fish)')
    feats = query_all(PLOTS_GUIDE + '/19', '1=1', 'ObjectID,Unit_Name,COUNTY', 0.00003, order='ObjectID')
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'))
        if polys:
            out.append(feature(polys, {'c': 'wma', 'n': (p.get('Unit_Name') or '').strip(), 'k': (p.get('COUNTY') or '').strip()}))
    return out


def refuge_land():
    """Fee-title refuge land only. Easement refuges are private land with a conservation easement."""
    log('National wildlife refuges (fee title)')
    feats = query_all(PLOTS_GUIDE + '/28', "INTEREST_TYPE1='Owned'", 'OBJECTID,UNIT_NAME,UNIT_TYPE', 0.00003)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'))
        if polys:
            out.append(feature(polys, {'c': 'fws', 'n': (p.get('UNIT_NAME') or '').strip()}))
    return out


PADUS_CLASS = {'NPS': 'nps', 'SPR': 'park', 'USACE': 'usace', 'USBR': 'usbr'}
RENAMED = {'Sully Creek State Recreation Area': 'Rough Rider State Park'}


def other_public_land():
    log('Other public land (PAD-US 4.1 fee layer)')
    managers = ",".join("'%s'" % m for m in PADUS_CLASS)
    feats = query_all(PADUS, "State_Nm='ND' AND Mang_Name IN (%s)" % managers,
                      'OBJECTID,Mang_Name,Unit_Nm,Des_Tp', 0.0002, page=500)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'), min_area=1e-7)
        if not polys:
            continue
        cls = PADUS_CLASS.get(p.get('Mang_Name'))
        name = (p.get('Unit_Nm') or '').strip()
        name = RENAMED.get(name, name)
        out.append(feature(polys, {'c': cls, 'n': name}))
    return out


FEDERAL = 'https://ndgishub.nd.gov/arcgis/rest/services/All_GovtLands_Federal/MapServer'


def blm_land():
    """BLM surface land, parcel by parcel (ND GIS Hub, the layer the ND Hunting Atlas shows)."""
    log('Bureau of Land Management surface land (ND GIS Hub)')
    feats = query_all(FEDERAL + '/6', '1=1', 'OBJECTID,ACRES', 0.00003)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        polys = clean_polygons(f.get('geometry'))
        if polys:
            out.append(feature(polys, {'c': 'blm', 'n': 'Bureau of Land Management', 'ac': round(p.get('ACRES') or 0)}))
    return out


def grassland_boundary():
    log('Grassland administrative boundary')
    try:
        feats = query_all(USFS + '/EDW_ForestSystemBoundaries_01/MapServer/0', "forestname LIKE '%Dakota Prairie%'",
                          'forestname', 0.0005, page=50)
    except Exception as e:  # noqa: BLE001
        log('  skipped:', e)
        return []
    out = []
    for f in feats:
        polys = clean_polygons(f.get('geometry'), min_area=1e-6)
        if polys:
            out.append(feature(polys, {'c': 'boundary', 'n': 'Dakota Prairie Grasslands boundary'}))
    return out


SITE_TYPES = {'CAMPGROUND', 'TRAILHEAD', 'DAY USE AREA', 'PICNIC SITE', 'BOATING SITE', 'BOAT RAMP', 'FISHING SITE',
              'INTERPRETIVE SITE', 'OBSERVATION SITE', 'GROUP CAMPGROUND', 'HORSE CAMP',
              'OTHER RECREATION CONCENTRATION AREA'}
NAME_FIXES = {'Coc Campground': 'CCC Campground', 'Coal Creek Mdh Ii': 'Coal Creek Campground',
              'Bennet': 'Bennett Trailhead', 'Sather Lake Day Use': 'Sather Lake Day Use Area'}


def tidy_name(name, site_type):
    if name.isupper():
        name = ' '.join(w if w in ('CCC', 'MDH', 'II') else w.capitalize() for w in name.split())
    else:
        name = ' '.join(w.capitalize() if w.islower() and w not in ('of', 'in', 'the', 'and') else w for w in name.split())
    name = NAME_FIXES.get(name, name)
    if site_type == 'TRAILHEAD' and 'trailhead' not in name.lower():
        name += ' Trailhead'
    return name


def rec_sites():
    """Developed Forest Service sites. No shooting within 150 yards of a campground or developed recreation area."""
    log('Developed recreation sites (Forest Service)')
    feats = query_all(USFS + '/EDW_RecInfraRecreationSites_02/MapServer/0', '1=1',
                      'OBJECTID,site_name,public_site_name,site_type,development_scale', None)
    out = []
    for f in feats:
        p = f.get('properties') or {}
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        t = (p.get('site_type') or '').upper()
        try:
            scale = int(p.get('development_scale') or 0)
        except ValueError:
            scale = 0
        if t not in SITE_TYPES or not (scale >= 2 or t == 'DAY USE AREA'):
            continue
        x, y = g['coordinates'][:2]
        if in_bbox(x, y):
            out.append(point(x, y, {'n': tidy_name((p.get('public_site_name') or p.get('site_name') or '').strip(), t)}))
    return out


# ---------- hunting units ----------

UNIT_LAYERS = [  # (layer id, key, label)
    (33, 'deer', 'Deer unit'), (34, 'elk', 'Elk unit'), (43, 'pronghorn', 'Pronghorn unit'),
    (29, 'sheep', 'Bighorn sheep unit'), (49, 'fturkey', 'Fall turkey unit'), (50, 'sturkey', 'Spring turkey unit'),
    (39, 'lion', 'Mountain lion zone'), (5, 'county', 'County'),
]


def hunting_units():
    log('Hunting units (ND Game and Fish)')
    out = []
    for lyr, key, label in UNIT_LAYERS:
        field = 'NAME' if key == 'county' else 'UNIT_ID'
        feats = query_all(GENERAL + '/%d' % lyr, '1=1', 'OBJECTID,' + field, 0.0008, page=200)
        for f in feats:
            uid = str((f.get('properties') or {}).get(field) or '').strip()
            polys = clean_polygons(f.get('geometry'), min_area=1e-6, digits=4)
            if uid and polys:
                out.append(feature(polys, {'t': key, 'u': uid}))
    return out


# ---------- fishing ----------

FACILITY_KEEP = {
    'ramp': ('Boat Ramps',),
    'pier': ('Fishing Piers',),
    'shore': ('Shore Fishing Access', 'Fishing Access'),
    'dock': ('Crty. Dock',),
    'clean': ('Fish Cleaning',),
    'toilet': ('Vault Tiolet',),
}


def facility_kind(code_name, unit_type):
    s = (code_name or '') + ' ' + (unit_type or '')
    for k, keys in FACILITY_KEEP.items():
        if any(x in s for x in keys):
            return k
    if 'Ramp' in (code_name or ''):
        return 'ramp'
    return None


def fishing_waters():
    log('Fishing waters (ND Game and Fish)')
    fields = ('ObjectID,Lake_Code,Lake_Name,Status,SportfishLong,latitude,longitude,Directions,FishStatus,County,'
              'Ltype,Tier,Acres,MaxDepth,ShorelineMiles,Ramps,Piers,Contour,Management,Agency')
    feats = query_all(FISH + '/0', "Status='Active'", fields, None, page=500, order='ObjectID')
    extra = query_all(FISH + '/0', "Lake_Name LIKE 'Sakakawea%'", fields, None, page=50, order='ObjectID', bbox=False)
    seen, waters = set(), {}
    for f in feats + extra:
        p = f.get('properties') or {}
        code = p.get('Lake_Code')
        if not code or code in seen:
            continue
        seen.add(code)
        x, y = p.get('longitude'), p.get('latitude')
        if x is None or y is None:
            g = f.get('geometry') or {}
            if g.get('type') != 'Point':
                continue
            x, y = g['coordinates'][:2]
        name = (p.get('Lake_Name') or '').strip()
        if ', ' in name and name.split(', ')[1] in ('Lake',):
            name = 'Lake ' + name.split(', ')[0]   # "Ilo, Lake" -> "Lake Ilo"
        contour = (p.get('Contour') or '').strip()
        if 'info-not-avail' in contour:
            contour = ''
        waters[code] = point(x, y, {
            'code': code, 'n': name, 'k': (p.get('County') or '').replace('Not Specified', '').strip(),
            'sp': [s.strip() for s in (p.get('SportfishLong') or '').split(',') if s.strip()],
            'note': (p.get('FishStatus') or '').strip(), 'dir': (p.get('Directions') or '').strip(),
            'ac': round(p['Acres']) if p.get('Acres') else None,
            'depth': round(p['MaxDepth']) if p.get('MaxDepth') else None,
            'ramp': 1 if (p.get('Ramps') or '').strip() else 0,
            'contour': contour, 'mgr': (p.get('Management') or '').strip(),
            'river': 1 if 'River' in name else 0,
            'fac': {}, 'stock': [], 'ans': [],
        })

    log('Fishing facilities')
    for f in query_all(FISH + '/4', "Status='Active'",
                       'ObjectID,Lake_Code,Lake_Name,Location_Name,code_Name,UNIT_TYPE,Useable,RampStatus,Latitude,Longitude',
                       None, page=1000, order='ObjectID'):
        p = f.get('properties') or {}
        w = waters.get(p.get('Lake_Code'))
        kind = facility_kind(p.get('code_Name'), p.get('UNIT_TYPE'))
        if not w or not kind:
            continue
        w['properties']['fac'][kind] = w['properties']['fac'].get(kind, 0) + 1
        rs = (p.get('RampStatus') or '').strip().rstrip('. ')
        if kind == 'ramp' and rs and rs != 'Usable':
            w['properties'].setdefault('_bad', []).append(rs)

    for w in waters.values():
        pr = w['properties']
        bad, ramps = pr.pop('_bad', []), pr['fac'].get('ramp', 0)
        if not bad:
            continue
        if len(bad) >= ramps:
            text = bad[0] if bad[0] != 'Not Usable' else 'The boat ramp is not usable'
            text = text.replace('Ramp unusable', 'The boat ramp is unusable')
            pr['rampnote'] = text[:1].upper() + text[1:]
        else:
            pr['rampnote'] = '%d of %d boat ramps may not be usable. Check before you go' % (len(bad), ramps)

    # The river points sit wherever Game and Fish placed them; put the Little Missouri at Medora.
    if '410' in waters:
        lm = waters['410']
        lm['geometry']['coordinates'] = [-103.5305, 46.9165]
        lm['properties']['dir'] = 'Flows through Medora and Theodore Roosevelt National Park'

    log('Fish stocking, last three stocking years')
    this_year = datetime.now(timezone.utc).year
    stock = {}
    for f in query_all(FISH + '/3', 'StockYear>=%d' % (this_year - 3),
                       'ObjectID,Lake,Lake_Name,Species,StockYear,Total_Stocked,StockSizeDescription', None, page=2000, order='ObjectID'):
        p = f.get('properties') or {}
        code = str(p.get('Lake') or '').zfill(3)
        if code not in waters:
            continue
        key = (code, p.get('Species'), p.get('StockYear'))
        stock[key] = stock.get(key, 0) + int(p.get('Total_Stocked') or 0)
    for (code, sp, yr), n in stock.items():
        waters[code]['properties']['stock'].append({'sp': sp, 'yr': yr, 'n': n})
    for w in waters.values():
        w['properties']['stock'].sort(key=lambda s: (-s['yr'], s['sp']))

    log('Aquatic nuisance species (validated records)')
    for f in query_all(FISH + '/5', "Validated='Y'", 'ObjectID,Lake_Code,ANS', None, page=2000, order='ObjectID', bbox=False):
        p = f.get('properties') or {}
        w = waters.get(p.get('Lake_Code'))
        a = (p.get('ANS') or '').strip()
        if w and a and a not in w['properties']['ans']:
            w['properties']['ans'].append(a)
    return list(waters.values())


SMALL_WORDS = {'and', 'of', 'the', 'at'}
KEEP_UPPER = {'ND', 'NDGF', 'LLC', 'DL', 'II', 'US', 'BP', 'CHS', 'SW', 'NW', 'NE', 'SE'}


def smart_title(s):
    """'ROSIE'S FOOD & GAS' -> "Rosie's Food & Gas"; keeps short initialisms."""
    words = []
    for i, w in enumerate((s or '').split()):
        bare = w.strip('.,').upper()
        if bare in KEEP_UPPER:
            words.append(w.upper())
        elif i and w.lower() in SMALL_WORDS:
            words.append(w.lower())
        else:
            t = '-'.join(part[:1].upper() + part[1:].lower() for part in w.split('-'))
            if t.startswith('Mc') and len(t) > 2:
                t = 'Mc' + t[2].upper() + t[3:]
            words.append(t)
    return ' '.join(words).replace(' 1567', '')


def phone(s):
    d = ''.join(ch for ch in (s or '') if ch.isdigit())
    return '(%s) %s-%s' % (d[:3], d[3:6], d[6:10]) if len(d) == 10 else (s or '').strip()


def places():
    log('License vendors and Game and Fish offices')
    out = []
    for f in query_all(GENERAL + '/64', '1=1',
                       'ObjectID,Business_Name,Address1,City,Telephone,SRV_LICSALES,SRV_LIVEBAIT,SRV_FISHTACKLE,SRV_HUNTEQUIP,SRV_AMMUNITION',
                       None, page=500, order='ObjectID'):
        p = f.get('properties') or {}
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        x, y = g['coordinates'][:2]
        sells = ['licenses'] + [k for k, fld in ( ('bait', 'SRV_LIVEBAIT'), ('tackle', 'SRV_FISHTACKLE'),
                                  ('hunting gear', 'SRV_HUNTEQUIP'), ('ammunition', 'SRV_AMMUNITION')) if (p.get(fld) or '').upper().startswith('Y')]
        name = (p.get('Business_Name') or '').strip()
        if name.upper().startswith('NDGF'):
            continue   # the Department's own office is listed below
        out.append(point(x, y, {'t': 'vendor', 'n': smart_title(name), 'a': smart_title(p.get('Address1')),
                                'city': (p.get('City') or '').strip().title(), 'ph': phone(p.get('Telephone')), 's': sells}))
    for f in query_all(GENERAL + '/65', '1=1', 'ObjectID,Office,Address1,City,Telephone', None, page=100, order='ObjectID', bbox=False):
        p = f.get('properties') or {}
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        x, y = g['coordinates'][:2]
        if not in_bbox(x, y, pad=0.6):
            continue
        office = (p.get('Office') or '').strip().upper().replace('NDGF-', '').replace('NDGF ', '').title()
        out.append(point(x, y, {'t': 'office', 'n': 'ND Game and Fish, ' + office + ' office', 'a': smart_title(p.get('Address1')),
                                'city': (p.get('City') or '').strip().title(), 'ph': phone(p.get('Telephone'))}))
    return out


def write(name, obj):
    path = os.path.join(OUT, name)
    tmp = path + '.tmp'
    with open(tmp, 'w') as fh:
        json.dump(obj, fh, separators=(',', ':'))
    os.replace(tmp, path)
    log('wrote', name, round(os.path.getsize(path) / 1024), 'KB')


def fc(features):
    return {'type': 'FeatureCollection', 'features': features}


def main():
    os.makedirs(OUT, exist_ok=True)
    now = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    meta = {'built': now, 'bbox': BBOX, 'sources': {}}

    def note(key, label, n):
        meta['sources'][key] = {'label': label, 'features': n, 'read': now}

    layers = []
    for key, fn, label, required in (
        ('usfs', forest_service_land, 'USDA Forest Service, Surface Ownership (EDW)', True),
        ('trust', trust_land, 'ND Department of Trust Lands, Surface Tracts (ND GIS Hub)', True),
        ('plots', plots_land, 'ND Game and Fish, PLOTS Guide: PLOTS tracts', True),
        ('wma', wma_land, 'ND Game and Fish, PLOTS Guide: Wildlife Management Areas', True),
        ('fws', refuge_land, 'ND Game and Fish, PLOTS Guide: National Wildlife Refuges (fee title)', False),
        ('blm', blm_land, 'ND GIS Hub, Bureau of Land Management Surface Lands', True),
        ('padus', other_public_land, 'USGS Protected Areas Database of the U.S. (PAD-US) 4.1, Fee (national park, state parks, Corps, Reclamation)', True),
        ('boundary', grassland_boundary, 'USDA Forest Service, Administrative Forest Boundaries (EDW)', False),
    ):
        feats = fn()
        if required and not feats:
            raise SystemExit('No features from %s; keeping the previous files.' % label)
        layers.extend(feats)
        note(key, label, len(feats))
    write('lands.json', fc(layers))

    sites = rec_sites()
    note('sites', 'USDA Forest Service, Recreation Sites (EDW)', len(sites))
    write('sites.json', fc(sites))

    units = hunting_units()
    if not units:
        raise SystemExit('No hunting units; keeping the previous files.')
    note('units', 'ND Game and Fish, hunting units', len(units))
    write('units.json', fc(units))

    waters = fishing_waters()
    if not waters:
        raise SystemExit('No fishing waters; keeping the previous files.')
    note('waters', 'ND Game and Fish, Fishing Waters, Facilities, Stocking and ANS', len(waters))
    write('waters.json', fc(waters))

    pl = places()
    note('places', 'ND Game and Fish, License Vendors and Offices', len(pl))
    write('places.json', fc(pl))

    write('meta.json', meta)


if __name__ == '__main__':
    main()
