#!/usr/bin/env python3
"""Watch the regulation pages the guide's hand-entered rules come from (standard library only).

docs/data/seasons.json and the land rules in docs/huntfish.js are typed in by hand from the pages
listed below. This script fetches each page, reduces it to its visible text, and compares a hash
with collector/source_hashes.json. When a page changes, or the season dates are about to run out,
it writes sources-changed.md so the workflow can open a GitHub issue for staff to review.

Usage:  python collector/check_sources.py
"""
import hashlib
import html
import json
import os
import re
import sys
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HASHES = os.path.join(ROOT, 'collector', 'source_hashes.json')
SEASONS = os.path.join(ROOT, 'docs', 'data', 'seasons.json')
REPORT = os.path.join(ROOT, 'sources-changed.md')
UA = 'TRPL-HuntFish-SourceCheck/1.0 (+https://huntfish.labs.trlibrary.com)'

PAGES = {
    'Deer proclamation': 'https://gf.nd.gov/regulations/deer',
    'Small game, waterfowl and furbearer proclamation': 'https://gf.nd.gov/hunting/proclamations/current/small-game',
    'Pronghorn proclamation': 'https://gf.nd.gov/hunting/proclamations/current/pronghorn',
    'Elk, moose and bighorn sheep proclamation': 'https://gf.nd.gov/regulations/moose-elk-sheep',
    'Fall turkey proclamation': 'https://gf.nd.gov/regulations/fall-turkey',
    'Spring turkey proclamation': 'https://gf.nd.gov/regulations/spring-turkey',
    'Fishing proclamation': 'https://gf.nd.gov/regulations/fishing',
    'General hunting regulations (posting, stands, bait)': 'https://gf.nd.gov/regulations/hunting-general',
    'Where to hunt (private land rules)': 'https://gf.nd.gov/hunting/where',
    'PLOTS public use rules': 'https://gf.nd.gov/help?term_node_tid_depth=900',
    'Wildlife management area rules': 'https://gf.nd.gov/wma',
    'Aquatic nuisance species rules': 'https://gf.nd.gov/ans/regulations',
    'CWD carcass rules': 'https://gf.nd.gov/cwd',
    'Trust land public access': 'https://www.land.nd.gov/node/154',
    'Forest Service target shooting rules': 'https://www.fs.usda.gov/r01/dpg/recreation/target-shooting',
    'National park firearms and hunting': 'https://www.nps.gov/thro/learn/management/firearms-and-weapons.htm',
}


def visible_text(raw):
    m = re.search(r'<main\b.*?</main>', raw, re.S | re.I)
    body = m.group(0) if m else raw
    body = re.sub(r'<(script|style|noscript|svg)\b.*?</\1>', ' ', body, flags=re.S | re.I)
    body = re.sub(r'<[^>]+>', ' ', body)
    body = html.unescape(body)
    # drop things that change on every load: tokens, counters, "last updated" stamps
    body = re.sub(r'(?i)last (updated|modified)[^.\n]{0,40}', ' ', body)
    return re.sub(r'\s+', ' ', body).strip()


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8', 'replace')


def main():
    old = json.load(open(HASHES)) if os.path.exists(HASHES) else {}
    new, changed, failed = {}, [], []
    for name, url in PAGES.items():
        try:
            h = hashlib.sha256(visible_text(fetch(url)).encode('utf-8')).hexdigest()
        except Exception as e:  # noqa: BLE001
            failed.append((name, url, str(e)[:120]))
            if url in old:
                new[url] = old[url]
            continue
        new[url] = h
        if url in old and old[url] != h:
            changed.append((name, url))
    with open(HASHES, 'w') as fh:
        json.dump(new, fh, indent=1, sort_keys=True)

    notes = []
    seasons = json.load(open(SEASONS))
    left = (date.fromisoformat(seasons['valid_through']) - date.today()).days
    if left <= 45:
        notes.append('Season dates in docs/data/seasons.json run out in %d days (%s). Enter the new proclamation dates.' % (left, seasons['valid_through']))

    if changed or notes:
        lines = ['A source the hunting and fishing guide relies on has changed. Review it and update '
                 '`docs/data/seasons.json` or the rules in `docs/huntfish.js` (CLASSES) if needed, then bump `checked` in seasons.json.', '']
        for name, url in changed:
            lines.append('- [%s](%s) changed' % (name, url))
        for n in notes:
            lines.append('- ' + n)
        if failed:
            lines += ['', 'Could not read: ' + ', '.join(n for n, _, _ in failed)]
        lines += ['', 'The trlibrary.com hunting and fishing page repeats some of these rules in plain text; check it too.']
        open(REPORT, 'w').write('\n'.join(lines) + '\n')
        print('\n'.join(lines))
    else:
        print('No changes.', ('Could not read: ' + ', '.join(n for n, _, _ in failed)) if failed else '')
    return 0


if __name__ == '__main__':
    sys.exit(main())
