#!/usr/bin/env python3
"""Read season dates straight from the ND Game and Fish proclamation pages (standard library only).

Writes docs/data/seasons.json. Every date the widget shows comes from the current proclamation
pages: the season tables (deer, pronghorn, elk and sheep, turkey, geese) and the dated sentences in
the small game proclamation (pheasant, grouse, doves, ducks, cranes, mountain lion, bobcat, the
nonresident week on PLOTS and wildlife areas, goose shooting hours). The statewide fish limits come
from the fishing proclamation's limits table.

When Game and Fish posts a new proclamation, the next run picks up the new dates on its own. If a
season cannot be found on its page, its last good dates are kept and the run says so in
seasons-report.md, which the workflow turns into a GitHub issue for a person to look at. Every
change of dates is also written to seasons-report.md so staff can see what moved.

Usage:  python collector/seasons.py
"""
import json
import os
import re
import sys
import urllib.request
from datetime import date, timedelta
from html import unescape
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'data', 'seasons.json')
REPORT = os.path.join(ROOT, 'seasons-report.md')
UA = 'TRPL-HuntFish-Seasons/1.0 (+https://huntfish.labs.trlibrary.com)'

GF = 'https://gf.nd.gov'
PAGES = {
    'deer': GF + '/regulations/deer',
    'pronghorn': GF + '/hunting/proclamations/current/pronghorn',
    'elk': GF + '/regulations/moose-elk-sheep',
    'fturkey': GF + '/regulations/fall-turkey',
    'sturkey': GF + '/regulations/spring-turkey',
    'small': GF + '/hunting/proclamations/current/small-game',
    'fishing': GF + '/regulations/fishing',
}

MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6, 'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
MON_RE = r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?'
DATE_RE = MON_RE + r'\s+\d{1,2}(?:,\s*\d{4})?'
SHORT = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------- fetching and reading ----------

class Tables(HTMLParser):
    """Every <table> as a grid of cell texts, with rowspans filled in."""

    def __init__(self):
        super().__init__()
        self.tables, self.stack, self.cell, self.span = [], [], None, 1

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.stack.append([])
        elif tag == 'tr' and self.stack:
            self.stack[-1].append([])
        elif tag in ('td', 'th') and self.stack and self.stack[-1]:
            self.cell = []
            try:
                self.span = int(dict(attrs).get('rowspan') or 1)
            except ValueError:
                self.span = 1

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None and self.stack and self.stack[-1]:
            self.stack[-1][-1].append((re.sub(r'\s+', ' ', ''.join(self.cell)).strip(), self.span))
            self.cell = None
        elif tag == 'table' and self.stack:
            self.tables.append(fill_rowspans(self.stack.pop()))

    def handle_data(self, d):
        if self.cell is not None:
            self.cell.append(d)


def fill_rowspans(rows):
    grid, carry = [], {}   # carry: column -> (text, rows left)
    for row in rows:
        out, col, cells = [], 0, list(row)
        while cells or any(c >= col for c in carry):
            if col in carry:
                text, left = carry[col]
                out.append(text)
                if left > 1:
                    carry[col] = (text, left - 1)
                else:
                    del carry[col]
            elif cells:
                text, span = cells.pop(0)
                out.append(text)
                if span > 1:
                    carry[col] = (text, span - 1)
            else:
                break
            col += 1
        grid.append(out)
    return grid


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript'):
            self.skip += 1
        elif tag in ('p', 'div', 'li', 'tr', 'br', 'h1', 'h2', 'h3', 'h4', 'td', 'th'):
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript') and self.skip:
            self.skip -= 1

    def handle_data(self, d):
        if not self.skip:
            self.parts.append(d)


class Page:
    def __init__(self, url):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read().decode('utf-8', 'replace')
        self.url = url
        t = re.search(r'<title>([^<]*)', raw)
        self.title = unescape(t.group(1)) if t else ''
        tp = Tables()
        tp.feed(raw)
        self.tables = tp.tables
        xp = Text()
        xp.feed(raw)
        self.text = re.sub(r'[ \t ]+', ' ', unescape(''.join(xp.parts)))
        self.flat = re.sub(r'\s+', ' ', self.text)
        y = re.search(r'\b(20\d\d)\b', self.title)
        self.year = int(y.group(1)) if y else date.today().year


def parse_date(s, year_hint, spring=False):
    """'Sept. 4 (12 noon)' / 'Sep. 26, 2026' / 'October 10, 2026' -> date. Dates without a year
    take the proclamation's year for August to December and the next year for January to July
    (fall seasons run past New Year), or the proclamation's year on spring pages."""
    m = re.search(r'(' + MON_RE + r')\s+(\d{1,2})(?:,\s*(\d{4}))?', s)
    if not m:
        return None
    mon = MONTHS[m.group(1)[:3].lower()]
    day = int(m.group(2))
    if m.group(3):
        yr = int(m.group(3))
    elif spring:
        yr = year_hint
    else:
        yr = year_hint if mon >= 8 else year_hint + 1
    return date(yr, mon, day)


def table_row(page, first, second=None, spring=False):
    """Find a season table row: first cell starts with `first`, second cell contains `second`.
    Returns (open, close, noon)."""
    for t in page.tables:
        if not t or not any('Opens' in c for c in t[0]):
            continue
        head = t[0]
        io, ic = head.index('Opens'), head.index('Closes')
        for row in t[1:]:
            if len(row) <= max(io, ic) or not row[0].lower().startswith(first.lower()):
                continue
            if second and second.lower() not in ' '.join(row[1:io]).lower():
                continue
            o = parse_date(row[io], page.year, spring)
            c = parse_date(row[ic], page.year, spring)
            if o and c:
                return o, c, '12 noon' in row[io]
    return None


def sentence(page, pattern, n=2):
    """Find dates in a sentence of the proclamation. `pattern` has n (DATE) groups."""
    rx = pattern.replace('(DATE)', '(' + DATE_RE + ')')
    m = re.search(rx, page.flat, re.I)
    if not m:
        return None
    return [parse_date(m.group(i + 1), page.year) for i in range(n)]


# ---------- what the widget shows ----------

BIG, SMALL, GOOSE = 'big', 'small', 'goose'
WATERFOWL_LIC = 'Waterfowl licenses, federal duck stamp (16 and older), HIP'


def md(d):
    return '%s %d' % (SHORT[d.month - 1], d.day)


def rng(a, b):
    """'Oct. 10 to 16', or 'Nov. 28 to Dec. 4' across months."""
    return '%s to %s' % (md(a), b.day if a.month == b.month else md(b))


def bag(page, lead):
    """'3 a day, 12 in possession.' from the sentence that follows `lead` in the proclamation."""
    if not page:
        return ''
    m = re.search(lead + r'[^.]*\.[^.]*?daily (?:bag )?limit shall be (\d+)(?: [a-z ]+?)? and the possession limit(?: shall be)? (\d+)', page.flat, re.I)
    return '%s a day, %s in possession.' % (m.group(1), m.group(2)) if m else ''


def build(pages):
    """Returns (seasons, restrictions, extras, problems)."""
    P = pages
    problems, out = [], []
    small = P.get('small')

    def add(sid, group, name, got, hours, license_, note, src, **kw):
        if got is None:
            problems.append(sid)
            out.append({'id': sid, 'group': group, 'name': name, 'missing': True, 'hours': hours, 'license': license_, 'note': note, 'src': src})
            return
        o, c = got[0], got[1]
        e = {'id': sid, 'group': group, 'name': name, 'open': o.isoformat(), 'close': c.isoformat(), 'hours': hours,
             'license': license_, 'note': note, 'src': src}
        if len(got) > 2 and got[2]:
            e['noon'] = True
        e.update(kw)
        out.append(e)

    def tr(key, *a, **k):
        return table_row(P[key], *a, **k) if P.get(key) else None

    def sn(pattern, n=2):
        return sentence(small, pattern, n) if small else None

    # Big game, from the season tables
    bow = tr('deer', 'Deer Bow')
    nr_bow = None
    if P.get('deer'):
        m = re.search(r'Starting (' + DATE_RE + r'), nonresidents can hunt both', P['deer'].flat)
        if m and bow:
            nr_bow = parse_date(m.group(1), P['deer'].year) - timedelta(days=1)
    add('deer-bow', 'Big game', 'Deer, archery', bow, BIG, 'Over the counter',
        ('Nonresidents may hunt only private land, not PLOTS, through %s.' % md(nr_bow)) if nr_bow else '', PAGES['deer'])
    add('deer-youth', 'Big game', 'Deer, youth season', tr('deer', 'Youth Deer'), BIG, 'Youth license (residents ages 11 to 15)', '', PAGES['deer'])
    add('deer-gun', 'Big game', 'Deer, gun', tr('deer', 'Deer Gun'), BIG, 'Lottery', 'Hunt the unit and type of deer on your license. Blaze orange required.', PAGES['deer'])
    add('deer-muzzleloader', 'Big game', 'Deer, muzzleloader', tr('deer', 'Muzz'), BIG, 'Lottery', 'White-tailed deer only. Blaze orange required.', PAGES['deer'])
    add('pronghorn-bow', 'Big game', 'Pronghorn, archery', tr('pronghorn', 'Bow'), BIG, 'Lottery', 'Hunt the unit on your license.', PAGES['pronghorn'])
    add('pronghorn-gun', 'Big game', 'Pronghorn, gun', tr('pronghorn', 'Gun'), BIG, 'Lottery', 'Blaze orange required, bowhunters included.', PAGES['pronghorn'])
    add('elk-badlands', 'Big game', 'Elk, units E3 and E4 (Badlands)', tr('elk', 'Elk Regular Season', 'E3, E4'), BIG, 'Lottery, residents only',
        'Other elk units nearby have different dates.', PAGES['elk'])
    early, late = tr('elk', 'Bighorn Sheep Regular Season - Early'), tr('elk', 'Bighorn Sheep Regular Late Season') or tr('elk', 'Bighorn Sheep Regular Season - Late')
    sheep = (early[0], late[1]) if early and late else (early or late)
    add('sheep', 'Big game', 'Bighorn sheep', sheep, BIG, 'Lottery, once in a lifetime',
        ('Early season %s to %s, late season %s to %s.' % (md(early[0]), md(early[1]), md(late[0]), md(late[1]))) if early and late else '', PAGES['elk'])
    add('turkey-fall', 'Big game', 'Turkey, fall', tr('fturkey', 'Fall'), SMALL, 'Lottery', 'Hunt the unit on your license.', PAGES['fturkey'])
    spring = tr('sturkey', 'Spring', spring=True)
    add('turkey-spring', 'Big game', 'Turkey, spring', spring, SMALL, 'Lottery, residents only',
        'Next spring\'s dates come with the new spring proclamation.' if spring and spring[1] < date.today() else '', PAGES['sturkey'])
    lion_e = sn(r'Zone 1 Early Season\.\s*Legal firearms and archery equipment may be used from (DATE) through (DATE)')
    lion_l = sn(r'Zone 1 Late Season\.\s*Legal firearms and archery equipment and pursuing with dogs may be used from (DATE) through (DATE)')
    add('lion-early', 'Big game', 'Mountain lion, Zone 1 early season', lion_e, BIG, 'Residents only', 'Closes early once its harvest limit is reached. Report a harvest within 12 hours.', PAGES['small'])
    add('lion-late', 'Big game', 'Mountain lion, Zone 1 late season', lion_l, BIG, 'Residents only', 'Dogs allowed. Closes early once its harvest limit is reached.', PAGES['small'])

    # Upland birds
    youth = sn(r'may hunt pheasants statewide on (DATE) and (DATE)')
    nr_week = sn(r'nonresidents shall be prohibited from hunting from (DATE) through (DATE) on Game and Fish Department wildlife management areas')
    note = []
    if youth:
        note.append('Youth weekend %s and %d.' % (md(youth[0]), youth[1].day) if youth[0].month == youth[1].month else 'Youth weekend %s and %s.' % (md(youth[0]), md(youth[1])))
    if nr_week:
        note.append('Nonresidents may not hunt wildlife management areas or PLOTS %s.' % rng(nr_week[0], nr_week[1]))
    add('pheasant', 'Upland birds', 'Pheasant (roosters)', sn(r'Male pheasants may be taken statewide from (DATE) through (DATE)'), SMALL, 'Small game', ' '.join(n for n in note if n), PAGES['small'])
    add('sharptail', 'Upland birds', 'Sharp-tailed grouse', sn(r'Sharp-tailed grouse may be taken statewide from (DATE) through (DATE)'), SMALL, 'Small game', bag(small, r'Sharp-tailed grouse may be taken statewide'), PAGES['small'])
    add('hun', 'Upland birds', 'Hungarian partridge', sn(r'Hungarian partridge may be taken statewide from (DATE) through (DATE)'), SMALL, 'Small game', bag(small, r'Hungarian partridge may be taken statewide'), PAGES['small'])
    if small and re.search(r'Sage grouse season will be closed', small.flat, re.I):
        out.append({'id': 'sage-grouse', 'group': 'Upland birds', 'name': 'Sage grouse', 'closed': True, 'hours': SMALL, 'license': '', 'note': 'No season this year.', 'src': PAGES['small']})
    else:
        add('sage-grouse', 'Upland birds', 'Sage grouse', sn(r'Sage grouse may be taken [^.]*?from (DATE) through (DATE)'), SMALL, 'Small game', '', PAGES['small'])
    dv = re.search(r'Doves may be taken statewide [^.]*\. The daily limit shall be (\d+) and the possession limit (\d+)', small.flat) if small else None
    add('dove', 'Upland birds', 'Mourning dove', sn(r'Doves may be taken statewide from (DATE) through (DATE)'), SMALL, 'Small game plus HIP registration',
        ('%s a day, %s in possession.' % dv.groups()) if dv else '', PAGES['small'])

    # Waterfowl
    ducks = sn(r'High Plains Unit:\s*Season Dates - (DATE) through (DATE) and (DATE) through (DATE)', 4)
    if ducks:
        gap = [(ducks[1] + timedelta(days=1)).isoformat(), (ducks[2] - timedelta(days=1)).isoformat()]
        add('ducks', 'Waterfowl', 'Ducks, High Plains unit', (ducks[0], ducks[3]), SMALL, WATERFOWL_LIC,
            'Split season: closed %s. Medora is in the High Plains unit.' % rng(ducks[1] + timedelta(days=1), ducks[2] - timedelta(days=1)), PAGES['small'], gap=gap)
    else:
        add('ducks', 'Waterfowl', 'Ducks, High Plains unit', sn(r'High Plains Unit:\s*Season Dates - (DATE) through (DATE)'), SMALL, WATERFOWL_LIC, 'Medora is in the High Plains unit.', PAGES['small'])
    geese, light, gbag, lbag = None, None, '', ''
    if small:
        for t in small.tables:
            if t and 'Opens' in t[0] and any('Canada Geese' in r[0] for r in t):
                ib = t[0].index('Bag Limit') if 'Bag Limit' in t[0] else None
                for r in t:
                    if r[0].startswith('Canada Geese') and len(r) > 3 and r[1] == 'Western':
                        geese = (parse_date(r[2], small.year), parse_date(r[3], small.year))
                        gbag = r[ib] if ib is not None and len(r) > ib else ''
                    if r[0].startswith('Light Geese') and len(r) > 3:
                        light = (parse_date(r[2], small.year), parse_date(r[3], small.year))
                        lbag = r[ib] if ib is not None and len(r) > ib else ''
    add('geese-canada', 'Waterfowl', 'Canada geese, Western zone', geese, GOOSE, WATERFOWL_LIC, ('%s a day.' % gbag) if gbag.isdigit() else '', PAGES['small'])
    add('geese-light', 'Waterfowl', "Snow and Ross's geese", light, GOOSE, WATERFOWL_LIC, ('%s a day.' % lbag) if lbag.isdigit() else '', PAGES['small'])
    cr = re.search(r'Unit 1\. That portion of North Dakota lying west of U\.S\. Highway 281\. The daily bag limit shall be (\d+)', small.flat) if small else None
    add('crane', 'Waterfowl', 'Sandhill crane', sn(r'Sandhill cranes may be taken from (DATE) through (DATE)'), GOOSE,
        'Sandhill crane permit plus small game or waterfowl license, HIP', ('%s a day west of U.S. Highway 281.' % cr.group(1)) if cr else '', PAGES['small'])

    # Predators and furbearers
    night = sn(r'at any hour during the night hunting season from (DATE),? through (DATE)')
    ly = small.year if small else date.today().year
    add('coyote', 'Predators and furbearers', 'Coyote and fox', (date(ly, 4, 1), date(ly + 1, 3, 31)), BIG, 'Furbearer',
        ('Open all year. Night hunting on foot %s to %s.' % (md(night[0]), md(night[1]))) if night else 'Open all year.', PAGES['small'], allyear=True)
    bob = sn(r'Zone 1\.\s*Bobcats may be harvested [^.]*? from (DATE) through (DATE)')
    dm = re.search(r'Zone 1\.\s*Bobcats may be harvested [^.]*? through ' + DATE_RE + r'\. They can also be harvested with the use of a cable device \(snares\) or dogs from (' + DATE_RE + ')', small.flat) if small else None
    dogs = [parse_date(dm.group(1), small.year)] if dm else None
    add('bobcat', 'Predators and furbearers', 'Bobcat, Zone 1', bob, BIG, 'Residents only', ('Dogs and cable devices from %s.' % md(dogs[0])) if dogs else '', PAGES['small'])

    # Fishing: the license year runs April 1 to March 31.
    fy = date.today().year if date.today().month >= 4 else date.today().year - 1
    add('fishing', 'Fishing', 'Hook and line fishing', (date(fy, 4, 1), date(fy + 1, 3, 31)), None, 'Fishing license, age 16 and older',
        'Open all year on most waters. National wildlife refuges are closed except areas the refuge opens.', PAGES['fishing'], allyear=True)

    restrictions = []
    if nr_week:
        restrictions.append({'from': nr_week[0].isoformat(), 'to': nr_week[1].isoformat(), 'who': 'nonresident', 'lands': ['wma', 'plots'],
                             'text': 'Nonresidents may not hunt anything on wildlife management areas or PLOTS from %s (the first week of pheasant season), unless hunting PLOTS land they own.' % rng(nr_week[0], nr_week[1])})
    else:
        problems.append('nonresident-week')
    if bow and nr_bow:
        restrictions.append({'from': bow[0].isoformat(), 'to': nr_bow.isoformat(), 'who': 'nonresident', 'lands': ['usfs', 'trust', 'plots', 'wma', 'blm', 'usace', 'usbr'],
                             'text': 'Nonresident deer bowhunters may hunt only private land, not PLOTS, through %s.' % md(nr_bow)})
    else:
        problems.append('nonresident-bow')

    extras = {}
    gh = sn(r'Beginning (DATE), and continuing through the close of each goose season, shooting hours shall be from one-half hour before sunrise to sunset each day', 1)
    if gh:
        extras['goose_hours'] = {'sunset_daily_from': gh[0].isoformat(), 'note': 'Before that date, sunset on Wednesdays and Saturdays, 2 p.m. other days.'}
    else:
        problems.append('goose-hours')

    if P.get('fishing'):
        extras['fish_limits'] = fish_limits(P['fishing'])
        if not extras['fish_limits']:
            problems.append('fish-limits')
            del extras['fish_limits']
    return out, restrictions, extras, problems


FISH_ROWS = [
    ('Walleye, sauger, saugeye (combined)', r'^Walleye, sauger'),
    ('Northern pike', r'^Northern Pike'),
    ('Largemouth and smallmouth bass (combined)', r'^Largemouth bass'),
    ('Trout (combined)', r'^Brown trout'),
    ('Channel catfish, west of N.D. Highway 1', r'\(West of ND Highway 1\)'),
    ('Crappie', r'^Crappie'),
    ('Bluegill', r'^Bluegill'),
    ('Yellow perch', r'^Yellow Perch'),
]


def fish_limits(page):
    for t in page.tables:
        if not t or not any('Daily Creel' in c for c in t[0]):
            continue
        rows = []
        for label, rx in FISH_ROWS:
            for r in t[1:]:
                if re.search(rx, r[0], re.I):
                    nums = [c for c in r[1:] if re.fullmatch(r'\d+', c)]
                    if len(nums) >= 2:
                        rows.append([label, nums[-2], nums[-1]])
                    break
        return rows if len(rows) == len(FISH_ROWS) else []
    return []


def main():
    prev = json.load(open(OUT)) if os.path.exists(OUT) else {'seasons': []}
    pages, unread = {}, []
    for k, u in PAGES.items():
        try:
            pages[k] = Page(u)
        except Exception as e:  # noqa: BLE001
            unread.append(k)
            log('could not read', u, e)
    seasons, restrictions, extras, problems = build(pages)

    # A season that could not be read keeps its last good dates.
    old = {s['id']: s for s in prev.get('seasons', [])}
    for i, s in enumerate(seasons):
        if s.get('missing') and s['id'] in old and not old[s['id']].get('missing'):
            seasons[i] = old[s['id']]
    if not restrictions:
        restrictions = prev.get('restrictions', [])

    today = date.today().isoformat()
    closes = [s['close'] for s in seasons if s.get('close') and not s.get('allyear')]
    new = {
        'label': 'Season dates',
        'checked': today,
        'valid_through': max(closes) if closes else prev.get('valid_through'),
        'note': 'Read automatically from the North Dakota Game and Fish proclamation pages by collector/seasons.py. '
                'A season that cannot be found keeps its last good dates and is reported in a GitHub issue.',
        'goose_hours': extras.get('goose_hours') or prev.get('goose_hours'),
        'hours': {
            'big': 'Half an hour before sunrise to half an hour after sunset',
            'small': 'Half an hour before sunrise to sunset',
            'goose': 'Half an hour before sunrise to 2 p.m., or to sunset on Wednesdays and Saturdays; every day to sunset late in the season.'
        },
        'proclamations': dict(prev.get('proclamations', {}), **{k: p.title.replace(' | North Dakota Game and Fish', '') for k, p in pages.items()}),
        'seasons': seasons,
        'restrictions': restrictions,
        'fish_limits': extras.get('fish_limits') or prev.get('fish_limits', []),
        'unread': sorted(problems + ['page:' + u for u in unread]),
    }

    # What changed, for people.
    changes = []
    for s in seasons:
        o = old.get(s['id'])
        if o and (o.get('open'), o.get('close'), o.get('closed')) != (s.get('open'), s.get('close'), s.get('closed')):
            changes.append('- %s: %s to %s → %s to %s' % (s['name'], o.get('open'), o.get('close'), s.get('open'), s.get('close')))
        elif not o:
            changes.append('- %s: new, %s to %s' % (s['name'], s.get('open'), s.get('close')))
    if prev.get('fish_limits') and new['fish_limits'] != prev.get('fish_limits'):
        changes.append('- Statewide fish limits changed: ' + '; '.join('%s %s/%s' % tuple(r) for r in new['fish_limits']))

    lines = []
    if changes:
        lines += ['Season dates on the hunting and fishing guide were updated automatically from the ND Game and Fish proclamations. '
                  'Check them against the source pages, and check the trlibrary.com page, which repeats a few dates in plain text.', ''] + changes
    if new['unread'] and new['unread'] != prev.get('unread'):   # only when the list of problems changes
        lines += ['', 'Could not find these on their proclamation pages, so their last good values were kept. '
                      'A page may have changed shape; update the matching rule in collector/seasons.py.', '']
        lines += ['- ' + p for p in problems]
        if unread:
            lines.append('- Pages not reachable: ' + ', '.join(unread))
    if lines:
        open(REPORT, 'w').write('\n'.join(lines) + '\n')
        print('\n'.join(lines))
    else:
        print('No changes.')

    # Always written, so the page's "last checked" date stays true.
    if True:
        with open(OUT, 'w') as fh:
            json.dump(new, fh, indent=1, ensure_ascii=False)
            fh.write('\n')
        log('wrote seasons.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
