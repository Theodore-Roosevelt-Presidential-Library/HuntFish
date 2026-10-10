# Hunting and Fishing Guide

Tools from the Theodore Roosevelt Presidential Library that help people hunt and fish legally around Medora, North Dakota. Served from GitHub Pages at `huntfish.labs.trlibrary.com`. Land, unit and fishing records are rebuilt weekly by GitHub Actions, season dates are read from the Game and Fish proclamations every day, and the regulation pages behind the written land rules are watched twice a week.

The country around Medora is a patchwork. The Little Missouri National Grassland, Theodore Roosevelt National Park (closed to hunting), state school trust land, PLOTS walk-in tracts, wildlife management areas and private ranches sit side by side, often with no fence or sign between them, and each has its own rules.

## The tools

1. **Can I hunt here?** One button. With the person's permission it reads the phone's location (on the device) and says who manages that ground, whether it is open to hunting, the rules there, the hunting units (deer, elk, pronghorn, bighorn sheep, turkey, mountain lion zone), legal shooting hours for that spot that day, and the fishing rules. On private land it asks ND Game and Fish whether the parcel is electronically posted.
2. **Map.** Public land by manager, PLOTS tracts, wildlife management areas, the 150-yard no-shooting rings around developed Forest Service sites, electronically posted land (from Game and Fish's own tiles), fishing waters, and any set of hunting unit lines. Tap anywhere for the same answer as the button.
3. **What's open.** Every season near Medora with its status on any date, legal shooting hours in Medora that day (computed with the NOAA solar method, which matches the U.S. Naval Observatory tables to the minute), and the nonresident restrictions in force.
4. **Where to fish.** About 30 waters, closest first, filterable by fish: species, Game and Fish's own notes, acreage and depth, ramps and piers (with ramp problems flagged), what was stocked lately, aquatic nuisance species, depth maps and directions. Then the fishing rules in brief and the statewide limits.
5. **Licenses.** What to buy and where, hunter education, lottery species, waterfowl stamps, carcass rules, and the nearest license vendors.
6. **Rules by land type** and a short before-you-go list.
7. **Offline map** at `/map/`. Can be added to a phone's home screen. "Save this area for offline" stores about 5 miles of topo map and posted-land tiles around the map's center. The land records, units, shooting hours and GPS then work with no signal; the posted-land check needs a signal.

## Embed

```html
<div id="trpl-huntfish"></div>
<script src="https://huntfish.labs.trlibrary.com/huntfish.js" defer></script>
```

| Attribute | Effect |
|---|---|
| `data-view="check"` | Only the "Can I hunt here?" button and its answer (with a link to the map) |
| `data-view="map"` | The button and the map |
| `data-view="seasons"` | Only what's open and shooting hours |
| `data-view="fishing"` | Only where to fish and the fishing rules |
| `data-view="licenses"` | Licenses, vendors and the rules by land type |
| `data-view="compact"` | A short "open today" card for a sidebar or the homepage |
| `data-more="https://..."` | Where "See the full guide" and "Open the map" go |
| `data-heading="off"` | Hides the built-in heading and intro |
| `data-target="#id"` | Mounts in a different element |
| `data-fonts="off"` | Does not load the brand fonts |

The widget renders in a shadow root, so page styles do not leak in or out. It carries its own copy of Leaflet and gives a page's existing Leaflet back untouched.

## How a spot is classified

The spot is tested against every land polygon. When layers overlap, the first match in this order wins: national park, wildlife refuge, state park, state trust land, wildlife management area, PLOTS, Corps of Engineers, Bureau of Reclamation, BLM, national grassland. On the grassland, a spot within 150 yards of a developed recreation site becomes "No shooting here". A spot in no layer is private or unknown, and the electronic posting check decides between "Permission needed" and "Not posted: ask first".

| Land | Answer | Rule source |
|---|---|---|
| Little Missouri National Grassland | Open; no shooting within 150 yards of developed sites or residences or across roads and water; no off-road game retrieval; no bait | [Forest Service shooting rules](https://www.fs.usda.gov/r01/dpg/recreation/target-shooting), [ND general regulations](https://gf.nd.gov/regulations/hunting-general) |
| PLOTS | Walk-in hunting in season; everything else (camping, fishing, trapping, vehicles) needs written permission | [PLOTS public use rules](https://gf.nd.gov/help?term_node_tid_depth=900) |
| Wildlife management areas | Open unless posted; vehicles on roads only; no bait | [gf.nd.gov/wma](https://gf.nd.gov/wma) |
| State school trust land | Walk-in hunting and fishing; "Closed" tracts flagged; "Notify the Lessee" tracts flagged | [Trust Lands public access](https://www.land.nd.gov/node/154) |
| Theodore Roosevelt National Park | No hunting; fishing with a state license | [NPS firearms page](https://www.nps.gov/thro/learn/management/firearms-and-weapons.htm), [NPS fishing](https://www.nps.gov/thro/planyourvisit/fishing.htm) |
| Lake Ilo NWR | No hunting; fishing in designated areas | [Refuge visitor information](https://www.fws.gov/refuge/lake-ilo/visit-us) |
| BLM land | Open under state seasons; many parcels are landlocked, so legal access is flagged | [BLM North Dakota Field Office](https://www.blm.gov/office/north-dakota-field-office) |
| Private land | Open unless posted with signs or electronically; ask first | [Where to hunt](https://gf.nd.gov/hunting/where) |

## Data

| Source | Used for | Read by |
|---|---|---|
| ND Game and Fish, PLOTS Guide service (PLOTS, WMAs, refuges) | Walk-in and Game and Fish land | `collector/build.py` |
| USDA Forest Service EDW: Surface Ownership, Forest Boundaries, Recreation Sites | Grassland land, boundary, no-shooting rings | `collector/build.py` |
| ND Department of Trust Lands, Surface Tracts. **Only tract, legal description and access are requested; lessee names, phones and rents are never read.** | Trust land | `collector/build.py` |
| ND GIS Hub, Bureau of Land Management Surface Lands (`All_GovtLands_Federal/6`, the layer the ND Hunting Atlas shows) | BLM parcels, with acreage | `collector/build.py` |
| USGS PAD-US 4.1 Fee | National park, state parks, Corps, Reclamation | `collector/build.py` |
| ND Game and Fish, General Information service | Hunting units, counties, license vendors, offices | `collector/build.py` |
| ND Game and Fish, Fishing Waters service | Waters, facilities, stocking, aquatic nuisance species | `collector/build.py` |
| ND Game and Fish, Electronically Posted Lands (`GNF_EpostedLandsCached`). **Only the `POSTED` flag is requested, live, for the tapped point; owner names and contacts are never read.** | Posted check and map overlay | Browser |
| ND Game and Fish proclamations (deer, pronghorn, elk/moose/sheep, fall and spring turkey, small game and waterfowl, fishing) | Season dates, nonresident restriction dates, goose shooting-hour switch, bag notes, statewide fish limits (`docs/data/seasons.json`) | `collector/seasons.py`, daily |
| U.S. DOT National Transportation Atlas Database, Time Zones | Mountain or Central clock time for shooting hours at a spot | `collector/build.py` |
| USGS The National Map | Topo and imagery basemaps | Browser |

## Upkeep

- **Season dates are read automatically.** `collector/seasons.py` runs every day, reads the season tables and dated sentences in the current proclamations, and rewrites `docs/data/seasons.json`. When Game and Fish posts next year's proclamations, the new dates appear on their own. Dates without a year in a table take the proclamation's year for August to December and the next year for January to July (the spring turkey page uses its own year). When any date changes, or a season cannot be found on its page, the workflow opens a GitHub issue (or comments on the open one) listing it; a season it cannot find keeps its last good dates. If a page changes shape, adjust its rule in `build()` in `collector/seasons.py`. For a planning date well past a season's close, the page says the next dates are not out yet instead of guessing.
- **Time zones** come from the federal time zone boundaries, so a spot in the Central part of McKenzie or Dunn County gets Central clock times.
- **Regulation pages changed issue.** `collector/check_sources.py` fingerprints the pages behind the written land rules (PLOTS, wildlife areas, trust land, posting, grassland shooting rules, CWD, ANS, park firearms). When one changes, the workflow opens a GitHub issue. Update `CLASSES` in `docs/huntfish.js` if needed, and check the trlibrary.com page, which repeats some rules.
- Each new license year: new deer, small game, pronghorn, elk/moose/sheep, turkey and fishing proclamations. The nonresident restriction dates (`restrictions`) move with the pheasant and deer bow openers.
- If a source changes shape, the collector stops and keeps the last good files rather than writing empty ones. Run either workflow from the Actions tab by hand.

## Run locally

```bash
python collector/build.py
python collector/seasons.py
python collector/check_sources.py
cd docs && python -m http.server 8000      # preview at http://localhost:8000
```

## GitHub Pages setup

1. Settings → Pages → Deploy from a branch → `main`, folder `/docs`.
2. Custom domain `huntfish.labs.trlibrary.com` (already in `docs/CNAME`; the wildcard DNS record covers it). Tick "Enforce HTTPS" once the certificate is issued. Location only works over HTTPS.
3. Settings → Actions → General → Workflow permissions → Read and write.

## Not legal advice

The Library does not manage any of this land or set any of these rules. Land records are approximate and are not a survey. Posted signs, the land manager and the current ND Game and Fish proclamations always have the final word.
