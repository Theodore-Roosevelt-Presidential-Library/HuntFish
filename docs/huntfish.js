/*! TRPL Hunting and Fishing Guide | Theodore Roosevelt Presidential Library | huntfish.labs.trlibrary.com
 *
 * Helps people hunt and fish legally around Medora, North Dakota:
 *   - "Can I hunt here?"  one tap, uses the phone's location, says who manages the ground, whether
 *     hunting is allowed there, the hunting units, and today's legal shooting hours
 *   - a map of public land, PLOTS walk-in areas, wildlife management areas, posted private land,
 *     hunting units and fishing waters
 *   - what is open on any date, with shooting hours for that day
 *   - where to fish: species, Game and Fish notes, ramps and piers, recent stocking
 *   - licenses, nearby license vendors, and the rules for each kind of land
 *
 * Embed:
 *   <div id="trpl-huntfish"></div>
 *   <script src="https://huntfish.labs.trlibrary.com/huntfish.js" defer></script>
 *
 * Optional attributes on the script tag:
 *   data-view="check"      only the "Can I hunt here?" button and its answer
 *   data-view="map"        the button and the map
 *   data-view="seasons"    only what is open, with shooting hours
 *   data-view="fishing"    only where to fish and the fishing rules
 *   data-view="licenses"   only licenses, vendors and rules by land type
 *   data-view="compact"    a short "open today" summary for a sidebar, linking to data-more
 *   data-view="app"        full-screen layout used by the offline map at /map/
 *   data-heading="off"     hide the built-in heading and intro
 *   data-more="https://..." where "See the full guide" and "Open the map" go
 *   data-target="#some-id" mount somewhere other than #trpl-huntfish
 *   data-fonts="off"       do not load the brand fonts
 *
 * Location is read on the device and never sent anywhere. The one live lookup, whether a private
 * parcel is electronically posted, sends ND Game and Fish the tapped point and asks only for the
 * POSTED flag. Land, unit and water data come from docs/data/ in this repository (rebuilt weekly).
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var BASE = script && script.src ? new URL('.', script.src).href : './';
  var opts = (script && script.dataset) || {};
  var host = (opts.target && document.querySelector(opts.target)) || document.getElementById('trpl-huntfish');
  if (!host) {
    host = document.createElement('div');
    host.id = 'trpl-huntfish';
    if (script && script.parentNode) script.parentNode.insertBefore(host, script);
    else document.body.appendChild(host);
  }
  if (host.shadowRoot) return;
  var root = host.attachShadow({ mode: 'open' });

  var VIEW = opts.view || 'full';
  var APP = VIEW === 'app';
  var SHOW = {
    heading: opts.heading !== 'off' && VIEW !== 'compact' && !APP,
    check: VIEW === 'full' || VIEW === 'check' || VIEW === 'map' || APP,
    map: VIEW === 'full' || VIEW === 'map' || APP,
    seasons: VIEW === 'full' || VIEW === 'seasons' || APP,
    fishing: VIEW === 'full' || VIEW === 'fishing',
    licenses: VIEW === 'full' || VIEW === 'licenses',
    rules: VIEW === 'full' || VIEW === 'licenses',
    compact: VIEW === 'compact',
    offline: APP && 'caches' in window
  };
  var MORE = opts.more || 'https://huntfish.labs.trlibrary.com/';
  var APP_URL = 'https://huntfish.labs.trlibrary.com/map/';
  var MEDORA = [46.9139, -103.5244];
  var CENTER = [47.0, -103.3];
  var NO_SHOOT = 137.2;   // 150 yards, in metres

  var URLS = {
    lands: BASE + 'data/lands.json',
    sites: BASE + 'data/sites.json',
    units: BASE + 'data/units.json',
    waters: BASE + 'data/waters.json',
    places: BASE + 'data/places.json',
    seasons: BASE + 'data/seasons.json',
    meta: BASE + 'data/meta.json',
    leafletJs: BASE + 'vendor/leaflet/leaflet.js',
    leafletCss: BASE + 'vendor/leaflet/leaflet.css'
  };
  var TILES = {
    topo: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}',
    imagery: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}'
  };
  var TILE_CACHE = 'trpl-huntfish-tiles-v1';
  // Private land the owner has posted electronically with ND Game and Fish. Only the POSTED flag is
  // requested; the service also holds owner names and contact details, which this tool never reads.
  var EPOST = 'https://ndgishub.nd.gov/arcgis/rest/services/Applications/GNF_EpostedLandsCached/MapServer';

  var LINKS = {
    buy: 'https://gf.nd.gov/buy-apply',
    app: 'https://gf.nd.gov/mobile-app',
    huntLicense: 'https://gf.nd.gov/hunting/licensing',
    fishLicense: 'https://gf.nd.gov/fishing/licensing',
    hunterEd: 'https://gf.nd.gov/education/hunter',
    regs: 'https://gf.nd.gov/regulations',
    general: 'https://gf.nd.gov/regulations/hunting-general',
    where: 'https://gf.nd.gov/hunting/where',
    atlas: 'https://geocortex.gf.nd.gov/Html5Viewer/?viewer=Hunt',
    plots: 'https://gf.nd.gov/help?term_node_tid_depth=900',
    plotsGuide: 'https://gf.nd.gov/plots/guide/maps',
    wma: 'https://gf.nd.gov/wma',
    fishRegs: 'https://gf.nd.gov/regulations/fishing',
    whereFish: 'https://gfappspublic.nd.gov/wheretofish/Search.aspx',
    ans: 'https://gf.nd.gov/ans/regulations',
    cwd: 'https://gf.nd.gov/cwd',
    trust: 'https://www.land.nd.gov/node/154',
    dpgShooting: 'https://www.fs.usda.gov/r01/dpg/recreation/target-shooting',
    dpgFishing: 'https://www.fs.usda.gov/r01/dpg/safety-ethics/fishing',
    dpgMaps: 'https://www.fs.usda.gov/r01/dpg/maps-guides',
    npsFishing: 'https://www.nps.gov/thro/planyourvisit/fishing.htm',
    npsFirearms: 'https://www.nps.gov/thro/learn/management/firearms-and-weapons.htm',
    blm: 'https://www.blm.gov/office/north-dakota-field-office',
    ilo: 'https://www.fws.gov/refuge/lake-ilo/visit-us',
    usace: 'https://www.nwo.usace.army.mil/Missions/Civil-Works/Garrison-Dam-Lake-Sakakawea/',
    parks: 'https://www.parkrec.nd.gov/',
    camping: 'https://www.trlibrary.com/visit/camping'
  };

  // ---------- what each kind of land means for a hunter ----------
  var STATUS = {
    open: { word: 'Open to hunting', bg: '#1B4532', ink: '#fff' },
    walkin: { word: 'Walk-in hunting', bg: '#1B4532', ink: '#fff' },
    ask: { word: 'Not posted: ask first', bg: '#F9D635', ink: '#25282A' },
    permission: { word: 'Permission needed', bg: '#E7805D', ink: '#25282A' },
    pending: { word: 'Private land', bg: '#D1CCBD', ink: '#25282A' },
    check: { word: 'Check the rules', bg: '#F9D635', ink: '#25282A' },
    noshoot: { word: 'No shooting here', bg: '#E7805D', ink: '#25282A' },
    no: { word: 'No hunting', bg: '#C2405C', ink: '#fff' }
  };

  var STANDS = 'Portable stands, blinds and trail cameras only, from Aug. 20 to Jan. 31, marked with your name, address and phone or a Game and Fish equipment number.';
  var GRASSLAND_CONTACT = 'Medora Ranger District, Dickinson: (701) 227‑7800. McKenzie Ranger District, Watford City: (701) 842‑8500.';
  var GF_CONTACT = 'North Dakota Game and Fish: (701) 328‑6300.';

  var CLASSES = {
    usfs: {
      label: 'Little Missouri National Grassland', who: 'U.S. Forest Service, Dakota Prairie Grasslands', status: 'open',
      fill: '#8FC895', legend: 'National grassland',
      rules: function () {
        return [
          'Open to hunting under North Dakota seasons and licenses.',
          'Never shoot within 150 yards of a campground, developed recreation area, residence or building, or across a road or a body of water.',
          'Drive only on roads open to vehicles. Driving off the road to retrieve game is not allowed.',
          'No baiting. ' + STANDS,
          'The grassland is a patchwork. State and private land sit inside it, often with no fence. Check before you follow game across a line.',
          'Expect cattle and oil and gas sites. Stay well away from wells, upwind if you can, and never shoot toward one.'
        ];
      },
      fish: 'Fishing follows North Dakota rules. Sather Lake and the Little Missouri River are the grassland’s best-known spots.',
      links: [['Forest Service shooting rules', LINKS.dpgShooting], ['Grassland maps and travel rules', LINKS.dpgMaps]],
      contact: GRASSLAND_CONTACT
    },
    plots: {
      label: 'PLOTS walk-in hunting area', who: 'Private land open to walk-in hunting through ND Game and Fish', status: 'walkin',
      fill: '#F9D635', legend: 'PLOTS walk-in area',
      rules: function (p) {
        var r = ['Open to walk-in hunting during legal hunting seasons. No permission needed.'];
        if (p && p.uc) r.push('This tract is signed “No Hunting in Unharvested Crop.” Stay out of standing crops until they are harvested.');
        r.push('No vehicles, horses or ATVs on the tract. Park on the road or section line, never on an oil pad or oil field road.');
        r.push('Camping, target shooting, dog training, shed hunting, trapping and fishing all need the owner’s written permission.');
        r.push('Take stands, blinds, decoys and bait with you when you leave.');
        r.push('Orange “No Shooting Toward Building” signs mark tracts with a building nearby.');
        return r;
      },
      fish: 'PLOTS is for hunting only. Fishing here needs the owner’s written permission.',
      links: [['PLOTS rules', LINKS.plots], ['PLOTS maps', LINKS.plotsGuide]],
      contact: GF_CONTACT
    },
    wma: {
      label: 'Wildlife management area', who: 'North Dakota Game and Fish Department', status: 'open',
      fill: '#99ADC5', legend: 'Wildlife management area',
      rules: function () {
        return [
          'Open to hunting, fishing and trapping unless posted otherwise at the entrance.',
          'Vehicles stay on constructed roads, established trails and parking areas, including when retrieving game.',
          'No baiting, tracer rounds or exploding targets. ' + STANDS,
          'Decoys may not be left unattended. Dogs may not be trained here from April 1 to Aug. 15.'
        ];
      },
      fish: 'Fishing is allowed unless posted otherwise.',
      links: [['Wildlife management area rules', LINKS.wma]],
      contact: GF_CONTACT
    },
    trust: {
      label: 'State school trust land', who: 'North Dakota Department of Trust Lands', status: 'open',
      fill: '#E7805D', legend: 'State trust land (walk-in)',
      rules: function (p) {
        var r = [];
        if (p && /notify/i.test(p.a || '')) r.push('This tract is posted “Notify the Lessee Before Entering.” Call the leaseholder before you go in. The Department of Trust Lands can tell you who to call.');
        r.push('Open to walk-in hunting and fishing. No vehicles at all, even on two-track trails: leave yours on the road or section line.');
        r.push('No baiting, target shooting, trapping, dog training, guiding or fee hunting. No camping or fires.');
        r.push('Blinds and stands are for the day only. Take them down when you leave.');
        r.push('This land is leased, usually for grazing. Respect livestock, fences and gates.');
        return r;
      },
      fish: 'Fishing is allowed on foot.',
      links: [['Trust land public access rules', LINKS.trust]],
      contact: ''
    },
    blm: {
      label: 'Bureau of Land Management land', who: 'Bureau of Land Management', status: 'open',
      fill: '#FC924E', legend: 'BLM land',
      rules: function () {
        return [
          'Open to hunting under North Dakota seasons and licenses.',
          'Much of the BLM land here is in small, scattered parcels, many surrounded by private land. Make sure you can reach it by public road or section line; crossing private land takes the owner’s permission.',
          'Stay on existing roads and trails.'
        ];
      },
      fish: 'Fishing follows North Dakota rules.',
      links: [['BLM North Dakota Field Office', LINKS.blm]],
      contact: ''
    },
    nps: {
      label: 'National park land', who: 'National Park Service', status: 'no',
      fill: '#092A4D', legend: 'National park (no hunting)',
      rules: function (p) {
        var r = ['Hunting is not allowed anywhere in the park.'];
        if (p && /Theodore Roosevelt/.test(p.n || '')) {
          r.push('You may carry a firearm where North Dakota law allows, but not into park buildings, and not to hunt.');
          r.push('Much of the park boundary has no fence. Know where it is before you hunt next to it, and never shoot across it.');
        }
        return r;
      },
      fish: 'Fishing in the Little Missouri River is allowed with a North Dakota license. Channel catfish, sauger and goldeye are the sport fish; the catch is unpredictable.',
      links: [['Park fishing', LINKS.npsFishing], ['Park firearms rules', LINKS.npsFirearms]],
      contact: 'Theodore Roosevelt National Park: (701) 623‑4466.'
    },
    fws: {
      label: 'National wildlife refuge', who: 'U.S. Fish and Wildlife Service', status: 'check',
      fill: '#F36079', legend: 'Wildlife refuge',
      rules: function (p) {
        if (p && /Ilo/.test(p.n || '')) return ['Hunting is not allowed on Lake Ilo National Wildlife Refuge.', 'The dam and the water 100 feet in front of it are closed to all public use.'];
        return ['Hunting rules differ from refuge to refuge. Ask the refuge office before you hunt.'];
      },
      fish: 'Refuges are closed to fishing except areas the refuge opens. At Lake Ilo, shore and ice fishing are open all year in designated areas, and boat fishing May 1 to Sept. 30.',
      links: [['Lake Ilo refuge visitor information', LINKS.ilo]],
      contact: ''
    },
    park: {
      label: 'State park', who: 'North Dakota Parks and Recreation', status: 'check',
      fill: '#1B4532', legend: 'State park',
      rules: function () { return ['State park rules apply. Ask the park office before you hunt here.']; },
      fish: 'Fishing follows North Dakota rules.',
      links: [['North Dakota Parks and Recreation', LINKS.parks]],
      contact: ''
    },
    usace: {
      label: 'U.S. Army Corps of Engineers land', who: 'U.S. Army Corps of Engineers', status: 'check',
      fill: '#D1CCBD', legend: 'Corps of Engineers or Reclamation',
      rules: function () { return ['Rules differ by area. Follow posted signs, and check with the Corps before you hunt.', 'No baiting on Corps-managed land. ' + STANDS]; },
      fish: 'Fishing follows North Dakota rules, except where posted.',
      links: [['Garrison Dam and Lake Sakakawea', LINKS.usace]],
      contact: ''
    },
    usbr: {
      label: 'Bureau of Reclamation land', who: 'Bureau of Reclamation', status: 'check',
      fill: '#D1CCBD', legend: 'Corps of Engineers or Reclamation',
      rules: function () { return ['Rules differ by area. Follow posted signs, or ask the managing office before you hunt.']; },
      fish: 'Fishing follows North Dakota rules, except where posted.',
      links: [], contact: ''
    },
    noshoot: {
      label: 'Within 150 yards of a developed site', who: 'U.S. Forest Service, Dakota Prairie Grasslands', status: 'noshoot',
      fill: '#F36079', legend: '150 yards around developed sites',
      rules: function (p) {
        return [
          'This spot is within 150 yards of ' + (p && p.n ? p.n : 'a developed recreation site') + '. Shooting is not allowed this close.',
          'Move farther away before you shoot. The rest of the grassland’s rules apply beyond 150 yards.'
        ];
      },
      fish: 'Fishing follows North Dakota rules.',
      links: [['Forest Service shooting rules', LINKS.dpgShooting]],
      contact: GRASSLAND_CONTACT
    },
    private: {
      label: 'Private land or unknown', who: 'Not in any public land record this guide uses', status: 'pending',
      fill: null, legend: 'No color: private or unknown',
      rules: function (p) {
        var r = [];
        if (p && p.inside) r.push('This spot is inside the national grassland boundary, but this parcel is not Forest Service land.');
        r.push('In North Dakota, private land is open to hunting unless it is posted, with signs or electronically. Ask the owner first anyway; Game and Fish calls it best practice.');
        r.push('Land posted with signs but not electronically does not show on any map. Look for signs; they can be up to a half mile apart.');
        r.push('No hunting within 440 yards of an occupied building, or in unharvested cereal or oilseed crops, without consent.');
        r.push('Road rights-of-way are usually closed to hunting when the land beside them is posted.');
        return r;
      },
      fish: 'Ask before crossing private land to reach water.',
      links: [['Where to hunt and posting rules', LINKS.where], ['ND Hunting Atlas (owner contacts for posted land)', LINKS.atlas]],
      contact: ''
    }
  };

  // When layers overlap, the more restrictive or more specific one wins.
  var PRECEDENCE = ['nps', 'fws', 'park', 'trust', 'wma', 'plots', 'usace', 'usbr', 'blm', 'usfs'];
  var UNIT_LABELS = { deer: 'Deer', elk: 'Elk', pronghorn: 'Pronghorn', sheep: 'Bighorn sheep', fturkey: 'Fall turkey', sturkey: 'Spring turkey', lion: 'Mountain lion zone' };
  var UNIT_ORDER = ['deer', 'elk', 'pronghorn', 'sheep', 'fturkey', 'sturkey', 'lion'];

  // ---------- brand fonts (same files trlibrary.com uses) ----------
  var FONT_BASE = 'https://www.trlibrary.com/themes/custom/trpl/css/';
  var FONTS = [
    ['Dharma Gothic E', 700, 'dharma_type-dharmagothice-bold.woff2'],
    ['Clearface', 400, 'clearfacestd-regular.woff2'],
    ['Clearface', 700, 'clearfacestd-heavy.woff2'],
    ['Frutiger', 400, 'frutigerltstd-regular.woff2'],
    ['Frutiger', 700, 'frutigerltstd-bold.woff2']
  ];
  (function loadFonts() {
    var onMainSite = /^(www\.)?trlibrary\.com$/.test(location.hostname);
    if (opts.fonts === 'off' || onMainSite || document.getElementById('trpl-brand-fonts')) return;
    var style = document.createElement('style');
    style.id = 'trpl-brand-fonts';
    style.textContent = FONTS.map(function (f) {
      return '@font-face{font-family:"' + f[0] + '";font-weight:' + f[1] + ';font-style:normal;font-display:swap;src:url("' + FONT_BASE + f[2] + '") format("woff2")}';
    }).join('');
    document.head.appendChild(style);
  })();
  var SANS = 'Frutiger,"Frutiger Next","Helvetica Neue",Arial,sans-serif';
  var SERIF = 'Clearface,Georgia,"Times New Roman",serif';
  var DISPLAY = '"Dharma Gothic E","Oswald","Arial Narrow",sans-serif';

  var CSS = [
    ':host{display:block;container-type:inline-size;font-family:' + SERIF + ';color:#25282A;line-height:1.45;' +
      '--forest:#1B4532;--night:#092A4D;--ink:#25282A;--sand:#D1CCBD;--orange:#E7805D;--bright:#8FC895;--sky:#99ADC5;--yellow:#F9D635;--pink:#F36079;' +
      '--line:#D1CCBD;--muted:#5A5F61;--wash:#F4F2EC;--water:#2B6CB0}',
    '*{box-sizing:border-box}',
    'a{color:var(--forest)}',
    'h2{font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;letter-spacing:.02em;font-size:clamp(2.2rem,6vw,3.4rem);line-height:.95;margin:0 0 .3em;color:var(--forest)}',
    'h3{font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:clamp(1.7rem,4vw,2.2rem);line-height:1;margin:1.6em 0 .5em;color:var(--forest)}',
    'h4{font-family:' + SANS + ';font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 6px}',
    '.intro{font-size:1.12rem;margin:0 0 1.1em;max-width:46em}',
    '.lede{margin:0 0 12px;max-width:46em}',
    '.eyebrow{font-family:' + SANS + ';font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 6px}',
    '.check{background:var(--forest);color:#fff;border-radius:2px;padding:22px 22px 20px}',
    '.check .eyebrow{color:var(--bright)}',
    '.check>p{margin:0 0 14px;max-width:40em}',
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:52px;padding:8px 24px 6px;border-radius:2px;font-family:' + DISPLAY + ';font-weight:700;font-size:1.6rem;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;border:1px solid var(--orange);background:var(--orange);color:var(--ink);cursor:pointer}',
    '.btn:hover{background:#D07556;border-color:#D07556}',
    '.btn:disabled{opacity:.7;cursor:progress}',
    '.btn.small{font-size:1.2rem;min-height:40px;padding:6px 16px 4px}',
    '.btn.line{background:#fff;color:var(--ink);border-color:#9A9C9A}',
    '.btn:focus-visible,.chip:focus-visible,summary:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--yellow);outline-offset:2px}',
    '.privacy{font-family:' + SANS + ';font-size:.8rem;color:#D6E4D9;margin:12px 0 0}',
    '.answer{margin-top:16px;background:#fff;color:var(--ink);border-radius:2px;padding:18px 18px 16px;border-left:10px solid var(--sand)}',
    '.answer[hidden]{display:none}',
    '.verdict{display:inline-block;font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;letter-spacing:.03em;font-size:clamp(2rem,7vw,2.8rem);line-height:1;padding:8px 12px 4px;border-radius:2px;margin:0 0 10px}',
    '.answer .place{font-size:1.25rem;font-weight:700;margin:0}',
    '.answer .who{font-family:' + SANS + ';font-size:.86rem;color:var(--muted);margin:2px 0 10px}',
    '.answer ul{margin:0 0 10px;padding-left:1.2em}',
    '.answer li{margin:0 0 6px}',
    '.box{margin:10px 0;padding:10px 12px;background:var(--wash);border-radius:2px}',
    '.box b.k{font-family:' + SANS + ';font-size:.76rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:block;margin-bottom:2px}',
    '.answer ul.units,.answer ul.hours{padding-left:0}',
    '.units{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 0;padding:0;list-style:none;font-family:' + SANS + ';font-size:.86rem}',
    '.units li{background:#fff;border:1px solid var(--line);border-radius:2px;padding:3px 8px}',
    '.units b{font-weight:700}',
    '.warn{margin:10px 0;padding:10px 12px;border:1px solid var(--yellow);background:#FFF9DA;border-radius:2px;font-size:.98rem}',
    '.warn.alert{border-color:#C2405C;background:#FDE8EC}',
    '.answer .meta{font-family:' + SANS + ';font-size:.8rem;color:var(--muted);margin:10px 0 0}',
    '.answer .links{font-family:' + SANS + ';font-size:.9rem;margin:8px 0 0;display:flex;flex-wrap:wrap;gap:6px 16px}',
    '.answer .actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}',
    '.posted.on{border-color:#C2405C;background:#FDE8EC}',
    '.posted.off{border-color:var(--sand);background:var(--wash)}',
    '.err{margin-top:14px;background:#FFF9DA;color:var(--ink);padding:12px 14px;border-radius:2px}',
    '.err[hidden]{display:none}',
    // map
    '.mapwrap{position:relative;margin-top:14px}',
    '.map{height:clamp(420px,68vh,720px);border:1px solid var(--line);border-radius:2px;background:#E9E6DD}',
    '.app .map{height:calc(100vh - 200px);min-height:360px}',
    '.mapbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 8px}',
    '.chip{font-family:' + SANS + ';font-size:.86rem;font-weight:700;min-height:38px;padding:0 12px;border-radius:2px;border:1px solid #9A9C9A;background:#fff;color:var(--ink);cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}',
    '.chip[aria-pressed="true"]{background:var(--ink);color:#fff;border-color:var(--ink)}',
    'select.chip{appearance:auto;padding-right:6px}',
    '.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-family:' + SANS + ';font-size:.84rem;margin:10px 0 0;padding:0;list-style:none}',
    '.legend li{display:flex;align-items:center;gap:6px}',
    '.sw{width:16px;height:16px;border-radius:2px;border:1px solid rgba(0,0,0,.25);flex:0 0 auto;display:inline-block}',
    '.sw.ring{border:2px dashed #C2405C;background:rgba(243,96,121,.18);border-radius:50%}',
    '.sw.none{background:#fff}',
    '.sw.bnd{background:transparent;border:2px dashed #1B4532}',
    '.sw.unit{background:transparent;border:2px solid #5A2D82}',
    '.sw.fish{border-radius:50%;background:var(--water);border:2px solid #fff;box-shadow:0 0 0 1px var(--water)}',
    '.sw.posted{background:repeating-linear-gradient(45deg,#E7805D 0 2px,transparent 2px 5px);border-color:#E7805D}',
    '.loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:' + SANS + ';color:var(--muted);pointer-events:none}',
    '.leaflet-container{font-family:' + SANS + '}',
    '.pin{width:22px;height:22px;border-radius:50%;background:var(--orange);border:3px solid #fff;box-shadow:0 0 0 2px var(--ink)}',
    '.me{width:18px;height:18px;border-radius:50%;background:#2A7BE4;border:3px solid #fff;box-shadow:0 0 0 2px rgba(42,123,228,.4)}',
    '.ulabel{font-family:' + SANS + ';font-weight:700;font-size:13px;color:#5A2D82;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;white-space:nowrap;transform:translate(-50%,-50%);pointer-events:none}',
    '.mapnote{font-family:' + SANS + ';font-size:.8rem;color:var(--muted);margin:6px 0 0}',
    '.leaflet-popup-content{font-family:' + SANS + ';font-size:.9rem;margin:10px 12px}',
    '.leaflet-popup-content b{font-size:1rem}',
    // seasons
    '.datebar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 14px;font-family:' + SANS + '}',
    '.datebar label{font-weight:700;font-size:.9rem}',
    '.datebar input{font-family:' + SANS + ';font-size:1rem;min-height:40px;padding:4px 8px;border:1px solid #9A9C9A;border-radius:2px}',
    '.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}',
    '.card{border:1px solid var(--line);border-radius:2px;padding:14px 14px 12px;background:#fff}',
    '.card .big{font-family:' + DISPLAY + ';font-weight:700;text-transform:uppercase;font-size:2.1rem;line-height:1;margin:2px 0 6px;color:var(--forest)}',
    '.card p{margin:0 0 6px;font-size:1rem}',
    '.card small{display:block;font-family:' + SANS + ';font-size:.8rem;color:var(--muted)}',
    '.hours{list-style:none;margin:6px 0 0;padding:0;font-family:' + SANS + ';font-size:.92rem}',
    '.hours li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid #EEECE5}',
    '.hours li b{white-space:nowrap}',
    '.sgroup{margin:18px 0 0}',
    '.srow{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;padding:10px 0;border-bottom:1px solid var(--line)}',
    '.srow .nm{font-weight:700;font-size:1.06rem}',
    '.srow .dt{font-family:' + SANS + ';font-size:.88rem;color:var(--muted)}',
    '.srow .nt{grid-column:1/-1;font-size:.96rem}',
    '.srow .nt a{font-family:' + SANS + ';font-size:.84rem}',
    '.badge{font-family:' + SANS + ';font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:4px 8px;border-radius:2px;white-space:nowrap;align-self:start}',
    '.b-open{background:var(--forest);color:#fff}',
    '.b-soon{background:var(--yellow);color:var(--ink)}',
    '.b-later{background:var(--wash);color:var(--ink);border:1px solid var(--line)}',
    '.b-closed{background:#EEECE5;color:var(--muted)}',
    '.stamp{font-family:' + SANS + ';font-size:.78rem;color:var(--muted);margin:10px 0 0}',
    // fishing
    '.filters{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}',
    '.water h4{margin-bottom:2px}',
    '.water .nm{font-size:1.15rem;font-weight:700;margin:0 0 2px}',
    '.water .sp{font-family:' + SANS + ';font-size:.88rem;margin:6px 0}',
    '.water .facts{font-family:' + SANS + ';font-size:.82rem;color:var(--muted);margin:4px 0}',
    '.water .ans{font-family:' + SANS + ';font-size:.82rem;color:#8A2A3D;margin:4px 0}',
    '.water .acts{display:flex;flex-wrap:wrap;gap:6px 14px;font-family:' + SANS + ';font-size:.86rem;margin-top:8px}',
    '.water .clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}',
    '.water .more,.water .acts button{font:inherit;color:var(--forest);background:none;border:0;padding:0;text-decoration:underline;cursor:pointer}',
    'table.limits{border-collapse:collapse;width:100%;max-width:560px;font-family:' + SANS + ';font-size:.9rem;margin:6px 0 4px}',
    'table.limits th,table.limits td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}',
    'table.limits td.n,table.limits th.n{text-align:right;white-space:nowrap}',
    // rules
    'details.rule{border-top:1px solid var(--line);padding:10px 0}',
    'details.rule:last-of-type{border-bottom:1px solid var(--line)}',
    'details.rule summary{cursor:pointer;display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.12rem;list-style:none}',
    'details.rule summary::-webkit-details-marker{display:none}',
    'details.rule summary .badge{margin-left:auto}',
    'details.rule ul{margin:8px 0 6px;padding-left:1.2em}',
    'details.rule li{margin:0 0 5px}',
    'details.rule .small{font-family:' + SANS + ';font-size:.86rem}',
    '.tips{margin:0;padding-left:1.2em;font-size:1.05rem;max-width:46em}',
    '.tips li{margin:0 0 6px}',
    '.vendors{list-style:none;margin:8px 0 0;padding:0;font-family:' + SANS + ';font-size:.9rem}',
    '.vendors li{padding:8px 0;border-bottom:1px solid var(--line)}',
    '.vendors b{font-size:.98rem}',
    '.vendors small{display:block;color:var(--muted)}',
    '.plinks{margin:6px 0 0;padding-left:1.1em;font-family:' + SANS + ';font-size:.9rem}',
    '.plinks li{margin:0 0 4px}',
    '.note{font-family:' + SANS + ';font-size:.78rem;color:var(--muted);margin:2em 0 0;max-width:62em}',
    '.compact .card{margin-bottom:10px}',
    '.compact ul{margin:4px 0 10px;padding-left:1.1em}',
    '@container (max-width:560px){.check{padding:18px 16px}.btn{width:100%}.answer .actions .btn{width:auto;flex:1}.legend{font-size:.8rem}.srow{grid-template-columns:1fr}.srow .badge{justify-self:start}}'
  ].join('\n');

  // ---------- small helpers ----------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function link(text, href) { return el('a', { href: href, target: '_blank', rel: 'noopener', text: text }); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function getJSON(url, ms) {
    var ctl = 'AbortController' in window ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, ms || 15000) : null;
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      if (t) clearTimeout(t);
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }
  function metres(a, b) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(s));
  }
  function miles(m) { return Math.round(m / 1609.34); }
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPolygons(x, y, polys) {
    for (var p = 0; p < polys.length; p++) {
      if (!inRing(x, y, polys[p][0])) continue;
      var hole = false;
      for (var h = 1; h < polys[p].length; h++) if (inRing(x, y, polys[p][h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  function index(fc) {
    (fc.features || []).forEach(function (f) {
      var g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
      var b = [180, 90, -180, -90];
      polys.forEach(function (p) { p[0].forEach(function (c) {
        if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1];
        if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1];
      }); });
      f._b = b; f._p = polys;
    });
    return fc;
  }
  function hits(fc, lat, lng) {
    var out = [];
    if (!fc) return out;
    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i], b = f._b;
      if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
      if (inPolygons(lng, lat, f._p)) out.push(f);
    }
    return out;
  }

  // ---------- dates and the sun ----------
  var MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function md(s) { var d = parseYmd(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); }
  function daysBetween(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 864e5); }
  function todayInMedora() {
    try { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' }); } catch (e) { return ymd(new Date()); }
  }
  // Sunrise and sunset by the NOAA Solar Calculator method; agrees with the U.S. Naval Observatory
  // tables (which ND Game and Fish points hunters to) to within a minute.
  function sunTimes(dateStr, lat, lng) {
    var p = dateStr.split('-'), rad = Math.PI / 180, base = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    function at(minutesUtc) {
      var jd = base / 864e5 + 2440587.5 + minutesUtc / 1440;
      var T = (jd - 2451545) / 36525;
      var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
      var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
      var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
      var C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
      var lam = L0 + C - 0.00569 - 0.00478 * Math.sin((125.04 - 1934.136 * T) * rad);
      var eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos((125.04 - 1934.136 * T) * rad);
      var dec = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
      var y = Math.tan(eps * rad / 2) * Math.tan(eps * rad / 2);
      var eqt = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
      var ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(dec)) - Math.tan(lat * rad) * Math.tan(dec)) / rad;
      var noon = 720 - 4 * lng - eqt;
      return { rise: noon - 4 * ha, set: noon + 4 * ha };
    }
    var first = at(720);
    var minute = 60000;
    function round(m) { return new Date(Math.round((base + m * minute) / minute) * minute); }
    return { sunrise: round(at(first.rise).rise), sunset: round(at(first.set).set) };
  }
  function clock(d, tz) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).replace('AM', 'a.m.').replace('PM', 'p.m.');
  }
  function shootingHours(dateStr, lat, lng) {
    var s = sunTimes(dateStr, lat, lng), half = 30 * 60000;
    return { start: new Date(s.sunrise - half), sunset: s.sunset, bigEnd: new Date(+s.sunset + half), sunrise: s.sunrise };
  }
  // The time zone comes from the U.S. DOT time zone boundaries in units.json (t: 'tz').
  function tzFor(zone) {
    return zone === 'Central' ? { tz: 'America/Chicago', label: 'Central Time' } : { tz: 'America/Denver', label: 'Mountain Time' };
  }
  // Geese and cranes: 2 p.m. most days, sunset on Wednesdays and Saturdays, and every day late in the season.
  function gooseEnd(dateStr) {
    var g = (state.seasons && state.seasons.goose_hours) || {};
    var d = parseYmd(dateStr), dow = d.getDay();
    if (g.sunset_daily_from && dateStr >= g.sunset_daily_from) return 'sunset';
    return (dow === 3 || dow === 6) ? 'sunset' : '2pm';
  }

  // ---------- state ----------
  var state = { lands: null, sites: null, units: null, waters: null, places: null, seasons: null, meta: null, map: null, L: null, pin: null, me: null, layers: {}, date: todayInMedora() };
  var dataReady = null, sideReady = null;
  function loadLandData() {
    if (dataReady) return dataReady;
    dataReady = Promise.all([
      getJSON(URLS.lands, 30000), getJSON(URLS.sites), getJSON(URLS.units, 30000), loadSide(),
      getJSON(URLS.meta).catch(function () { return null; })
    ]).then(function (r) {
      state.lands = index(r[0]);
      state.sites = r[1];
      state.units = index(r[2]);
      state.meta = r[4];
    });
    return dataReady;
  }
  function loadSide() {
    if (sideReady) return sideReady;
    sideReady = Promise.all([
      getJSON(URLS.seasons).catch(function () { return null; }),
      getJSON(URLS.waters).catch(function () { return null; }),
      getJSON(URLS.places).catch(function () { return null; })
    ]).then(function (r) { state.seasons = r[0]; state.waters = r[1]; state.places = r[2]; });
    return sideReady;
  }

  // ---------- what is at a point ----------
  function classify(lat, lng) {
    var b = (state.meta && state.meta.bbox) || [-104.05, 46.0, -102.3, 48.1];
    var res = { lat: lat, lng: lng, outside: lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3] };
    var found = hits(state.lands, lat, lng);
    var inside = found.some(function (f) { return f.properties.c === 'boundary'; });
    found = found.filter(function (f) { return f.properties.c !== 'boundary'; });
    found.sort(function (a, c) { return PRECEDENCE.indexOf(a.properties.c) - PRECEDENCE.indexOf(c.properties.c); });
    var top = found[0];
    res.cls = top ? top.properties.c : 'private';
    res.props = top ? top.properties : { inside: inside };
    res.inside = inside;
    res.county = null;
    if (res.cls === 'trust' && res.props.a === 'Closed') res.closedTrust = true;
    if (res.cls === 'usfs' && state.sites) {
      var near = null, best = Infinity;
      state.sites.features.forEach(function (s) {
        var dd = metres([lat, lng], [s.geometry.coordinates[1], s.geometry.coordinates[0]]);
        if (dd < best) { best = dd; near = s; }
      });
      if (near && best <= NO_SHOOT) { res.cls = 'noshoot'; res.props = near.properties; res.distance = best; }
    }
    res.units = {};
    hits(state.units, lat, lng).forEach(function (f) { res.units[f.properties.t] = f.properties.u; });
    if (res.units.county) res.county = res.units.county;
    return res;
  }
  function nearBoundary(lat, lng, r, cls) {
    var dLat = r / 111320, dLng = r / (111320 * Math.cos(lat * Math.PI / 180));
    for (var a = 0; a < 360; a += 45) {
      var t = a * Math.PI / 180;
      var c = classify(lat + dLat * Math.sin(t), lng + dLng * Math.cos(t));
      if (c.cls !== cls) return c;
    }
    return null;
  }
  function statusOf(res) {
    if (res.closedTrust) return STATUS.no;
    return STATUS[CLASSES[res.cls].status];
  }
  function activeRestrictions(dateStr, cls) {
    var s = state.seasons;
    if (!s || !s.restrictions) return [];
    return s.restrictions.filter(function (r) { return dateStr >= r.from && dateStr <= r.to && (!cls || r.lands.indexOf(cls) >= 0); });
  }

  // ---------- rendering ----------
  var style = el('style', { text: CSS });
  root.appendChild(style);
  var wrap = el('div', { class: APP ? 'app' : '' });
  root.appendChild(wrap);

  if (SHOW.heading) {
    wrap.appendChild(el('p', { class: 'eyebrow', text: 'Hunting and fishing around Medora' }));
    wrap.appendChild(el('h2', { text: 'Know the ground' }));
    wrap.appendChild(el('p', { class: 'intro', text: 'T.R. first came to the Badlands in 1883 to hunt bison. Today the country around Medora is a patchwork: national grassland, a national park closed to hunting, state trust land, walk-in areas and private ranches, often with no fence or sign between them. Check where you stand, what is open, and where the fish are.' }));
  }

  // --- the check ---
  var answer, checkBtn, errBox;
  if (SHOW.check) {
    var check = el('section', { class: 'check', 'aria-label': 'Can I hunt here?' });
    check.appendChild(el('p', { class: 'eyebrow', text: 'One tap' }));
    checkBtn = el('button', { class: 'btn', type: 'button', onclick: locate }, ['Can I hunt here?']);
    check.appendChild(el('p', { text: 'Your phone’s location tells you who manages the ground you are standing on, whether you can hunt it, your hunting units, and today’s legal shooting hours.' }));
    check.appendChild(checkBtn);
    check.appendChild(el('p', { class: 'privacy', text: 'Your browser will ask to share your location. It stays on your device and is never sent to the Library or anyone else.' }));
    errBox = el('div', { class: 'err', role: 'alert', hidden: true });
    answer = el('div', { class: 'answer', hidden: true, 'aria-live': 'polite', tabindex: '-1' });
    check.appendChild(errBox);
    check.appendChild(answer);
    wrap.appendChild(check);
  }
  function showError(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.hidden = !msg;
  }
  function locate() {
    showError('');
    if (!('geolocation' in navigator)) { showError('This browser cannot share a location. Tap the map instead to check any spot.'); return; }
    checkBtn.disabled = true;
    checkBtn.textContent = 'Finding you…';
    loadLandData().then(function () {
      navigator.geolocation.getCurrentPosition(function (pos) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Check again';
        explain(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, true);
      }, function (e) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Can I hunt here?';
        if (e.code === 1) showError('Location sharing is turned off for this page. Allow location in your browser or phone settings and try again, or tap the map to check any spot.');
        else if (e.code === 3) showError('Your phone could not get a location fix in time. Step into the open, wait a moment and try again.');
        else showError('Your location is not available right now. Tap the map to check any spot.');
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    }).catch(function () {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Can I hunt here?';
      showError('The land records could not load. Check your connection and try again.');
    });
  }

  function explain(lat, lng, accuracy, fromGps) {
    var res = classify(lat, lng);
    var cls = CLASSES[res.cls];
    var st = statusOf(res);
    if (!answer) answer = el('div', { class: 'answer' });
    answer.innerHTML = '';
    answer.hidden = false;
    answer.style.borderLeftColor = st.bg;
    answer.appendChild(el('p', { class: 'eyebrow', text: fromGps ? 'Where you are' : 'The spot you picked' }));
    if (res.outside) {
      answer.appendChild(el('p', { class: 'place', text: 'Outside this guide’s area' }));
      answer.appendChild(el('p', { text: 'This guide covers southwestern North Dakota from the Montana line to Dickinson and Killdeer. Use the ND Game and Fish Hunting Atlas for this spot.' }));
      answer.appendChild(el('p', { class: 'links' }, [link('ND Hunting Atlas', LINKS.atlas)]));
    } else {
      var verdict = el('span', { class: 'verdict', text: st.word, style: 'background:' + st.bg + ';color:' + st.ink });
      answer.appendChild(verdict);
      var place = cls.label;
      if (res.cls === 'wma') place = (res.props.n || 'Wildlife') + ' Wildlife Management Area';
      else if (['park', 'usace', 'usbr', 'fws', 'nps'].indexOf(res.cls) >= 0 && res.props.n && res.props.n !== 'BOR Lands') place = res.props.n;
      answer.appendChild(el('p', { class: 'place', text: place }));
      var who = cls.who;
      if (res.cls === 'trust' && res.props.l) who += ' · ' + [res.props.q, res.props.l].filter(Boolean).join(' ');
      if (res.cls === 'plots' && res.props.ac) who += ' · ' + res.props.ac + ' walk-in acres';
      if (res.cls === 'blm' && res.props.ac) who += ' · ' + res.props.ac.toLocaleString() + '-acre parcel';
      if (res.county) who += ' · ' + res.county + ' County';
      answer.appendChild(el('p', { class: 'who', text: who }));
      var ul = el('ul');
      var rules = res.closedTrust ? ['This tract is posted closed to all public access. No one may hunt it, the leaseholder included.', 'Use the map to find open trust land or other public land nearby.'] : cls.rules(res.props);
      rules.forEach(function (t) { ul.appendChild(el('li', { text: t })); });
      answer.appendChild(ul);
      activeRestrictions(state.date, res.cls).forEach(function (r) { answer.appendChild(el('div', { class: 'warn', text: r.text })); });
      var postedBox = null;
      if (res.cls === 'private') {
        postedBox = el('div', { class: 'warn posted', text: 'Checking whether the owner has posted this land electronically…' });
        answer.insertBefore(postedBox, ul);
        checkPosted(lat, lng, postedBox, verdict);
      }
      answer.appendChild(unitsBox(res));
      answer.appendChild(hoursBox(lat, lng, res.units.tz, state.date));
      if (cls.fish) answer.appendChild(el('div', { class: 'box' }, [el('b', { class: 'k', text: 'Fishing' }), el('span', { text: res.closedTrust ? 'Closed to all public access.' : cls.fish })]));
      var radius = Math.max(30, Math.min(accuracy || 30, 150));
      var other = nearBoundary(lat, lng, radius, res.cls);
      if (other || (accuracy && accuracy > 100)) {
        var msg = other ? 'You are within about ' + Math.round(radius * 3.281) + ' feet of ' + (other.cls === 'private' ? 'land that may be private' : CLASSES[other.cls].label.toLowerCase()) + '. ' : '';
        if (accuracy && accuracy > 100) msg += 'Your phone’s location is only accurate to about ' + Math.round(accuracy * 3.281) + ' feet right now. ';
        msg += 'Know where the line is before you shoot, and trust fences and posted signs over this map.';
        answer.appendChild(el('div', { class: 'warn', text: msg }));
      }
      var links = el('p', { class: 'links' });
      cls.links.forEach(function (l) { links.appendChild(link(l[0], l[1])); });
      if (links.childNodes.length) answer.appendChild(links);
      if (cls.contact) answer.appendChild(el('p', { class: 'meta', text: cls.contact }));
    }
    var coords = lat.toFixed(5) + ', ' + lng.toFixed(5);
    answer.appendChild(el('p', { class: 'meta', text: (fromGps && accuracy ? 'Location ' + coords + ' (within ' + Math.round(accuracy * 3.281) + ' ft). ' : 'Location ' + coords + '. ') +
      'Land records are a guide, not a survey. Boundaries can be off by 100 feet or more.' }));
    var actions = el('div', { class: 'actions' });
    if (SHOW.map && state.map) actions.appendChild(el('button', { class: 'btn small line', type: 'button', onclick: function () { focusMap(lat, lng, fromGps, accuracy); } }, ['Show on map']));
    if (!SHOW.map) actions.appendChild(el('a', { class: 'btn small line', href: MORE + (MORE.indexOf('?') < 0 ? '?' : '&') + 'at=' + lat.toFixed(5) + ',' + lng.toFixed(5), target: '_blank', rel: 'noopener' }, ['Open the map']));
    if (actions.childNodes.length) answer.appendChild(actions);
    if (SHOW.map) ensureMap().then(function () { focusMap(lat, lng, fromGps, accuracy, true); });
    try { answer.focus({ preventScroll: !fromGps }); } catch (e) { /* older browsers */ }
  }

  function unitsBox(res) {
    var box = el('div', { class: 'box' }, [el('b', { class: 'k', text: 'Hunting units here' })]);
    var ul = el('ul', { class: 'units' });
    UNIT_ORDER.forEach(function (k) {
      if (res.units[k]) ul.appendChild(el('li', {}, [UNIT_LABELS[k] + ' ', el('b', { text: res.units[k] })]));
    });
    if (!ul.childNodes.length) ul.appendChild(el('li', { text: 'No unit found for this spot' }));
    box.appendChild(ul);
    return box;
  }

  function hoursBox(lat, lng, zone, dateStr) {
    var h = shootingHours(dateStr, lat, lng), z = tzFor(zone);
    var box = el('div', { class: 'box' }, [el('b', { class: 'k', text: 'Legal shooting hours ' + (dateStr === todayInMedora() ? 'today' : 'on ' + md(dateStr)) })]);
    var ul = el('ul', { class: 'hours' });
    ul.appendChild(el('li', {}, [el('span', { text: 'Shooting starts' }), el('b', { text: clock(h.start, z.tz) })]));
    ul.appendChild(el('li', {}, [el('span', { text: 'Upland birds, turkeys, ducks end (sunset)' }), el('b', { text: clock(h.sunset, z.tz) })]));
    ul.appendChild(el('li', {}, [el('span', { text: 'Big game and predators end' }), el('b', { text: clock(h.bigEnd, z.tz) })]));
    ul.appendChild(el('li', {}, [el('span', { text: 'Geese and cranes end' }), el('b', { text: gooseEnd(dateStr) === 'sunset' ? clock(h.sunset, z.tz) : '2 p.m.' })]));
    box.appendChild(ul);
    box.appendChild(el('small', { style: 'display:block;margin-top:6px;font-family:inherit', text: z.label + ' here.' }));
    return box;
  }

  // Is this private spot electronically posted? Asked live, because postings change often.
  var postedSeq = 0;
  function checkPosted(lat, lng, box, verdict) {
    var seq = ++postedSeq;
    var url = EPOST + '/0/query?geometry=' + lng.toFixed(6) + ',' + lat.toFixed(6) + '&geometryType=esriGeometryPoint&inSR=4326' +
      '&spatialRel=esriSpatialRelIntersects&outFields=POSTED&returnGeometry=false&f=json';
    function setVerdict(st) {
      verdict.textContent = st.word; verdict.style.background = st.bg; verdict.style.color = st.ink;
      answer.style.borderLeftColor = st.bg;
    }
    getJSON(url, 12000).then(function (j) {
      if (seq !== postedSeq) return;
      var posted = (j.features || []).some(function (f) { return f.attributes && f.attributes.POSTED === 'Y'; });
      if (posted) {
        setVerdict(STATUS.permission);
        box.className = 'warn posted on';
        box.innerHTML = '<b>Posted land.</b> The owner has posted this parcel electronically with North Dakota Game and Fish. Hunting it without permission is a misdemeanor that costs at least a year of hunting privileges. Many owners list a contact in the <a href="' + LINKS.atlas + '" target="_blank" rel="noopener">ND Hunting Atlas</a>.';
      } else {
        setVerdict(STATUS.ask);
        box.className = 'warn posted off';
        box.textContent = 'Not posted electronically. Look for posting signs on the ground. If there are none, state law lets you hunt here, but ask the owner first.';
      }
    }).catch(function () {
      if (seq !== postedSeq) return;
      box.className = 'warn posted';
      box.innerHTML = 'Could not check electronic posting right now (no signal?). Treat this land as posted, or check the <a href="' + LINKS.atlas + '" target="_blank" rel="noopener">ND Hunting Atlas</a>.';
    });
  }

  // --- the map ---
  var mapEl, mapReady = null, loadingNote, unitSel, bFish, bPosted, bTopo, bImg;
  if (SHOW.map) {
    var msec = el('section', { 'aria-label': 'Hunting and fishing map' });
    if (!APP) msec.appendChild(el('h3', { text: 'Where can I hunt?' }));
    if (!APP) msec.appendChild(el('p', { class: 'lede', text: 'Tap anywhere to see who manages it and what the rules are. Uncolored land is private or unknown. Zoom in to see land posted electronically.' }));
    var bar = el('div', { class: 'mapbar' });
    bTopo = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: function () { setBase('topo'); } }, ['Topo']);
    bImg = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false', onclick: function () { setBase('imagery'); } }, ['Satellite']);
    bPosted = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: function () { postedOn = !postedOn; bPosted.setAttribute('aria-pressed', String(postedOn)); syncLayers(); } }, ['Posted land']);
    bFish = el('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: function () { fishOn = !fishOn; bFish.setAttribute('aria-pressed', String(fishOn)); syncLayers(); } }, ['Fishing spots']);
    unitSel = el('select', { class: 'chip', 'aria-label': 'Show hunting units', onchange: function () { showUnits(unitSel.value); } });
    [['', 'Hunting units: off'], ['deer', 'Deer units'], ['elk', 'Elk units'], ['pronghorn', 'Pronghorn units'], ['sheep', 'Bighorn sheep units'], ['fturkey', 'Fall turkey units'], ['sturkey', 'Spring turkey units'], ['lion', 'Mountain lion zones']].forEach(function (o) {
      unitSel.appendChild(el('option', { value: o[0], text: o[1] }));
    });
    [bTopo, bImg, bPosted, bFish, unitSel].forEach(function (b) { bar.appendChild(b); });
    if (SHOW.offline) bar.appendChild(el('button', { class: 'chip', type: 'button', onclick: saveArea }, ['Save this area for offline']));
    if (!APP) bar.appendChild(el('a', { class: 'chip', href: APP_URL, target: '_blank', rel: 'noopener' }, ['Full-screen map (works offline)']));
    msec.appendChild(bar);
    var mw = el('div', { class: 'mapwrap' });
    mapEl = el('div', { class: 'map', role: 'application', 'aria-label': 'Map of hunting land and fishing waters around Medora. Tap a spot to check it.' });
    loadingNote = el('div', { class: 'loading', text: 'Loading the map…' });
    mw.appendChild(mapEl); mw.appendChild(loadingNote);
    msec.appendChild(mw);
    var lg = el('ul', { class: 'legend' });
    ['usfs', 'plots', 'wma', 'trust', 'blm', 'nps', 'fws', 'park', 'usace'].forEach(function (k) {
      lg.appendChild(el('li', {}, [el('span', { class: 'sw', style: 'background:' + CLASSES[k].fill + ';opacity:.8' }), CLASSES[k].legend]));
    });
    lg.appendChild(el('li', {}, [el('span', { class: 'sw ring' }), 'No shooting: 150 yards around developed sites']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw posted' }), 'Posted private land (zoom in)']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw fish' }), 'Fishing water']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw unit' }), 'Hunting unit line']));
    lg.appendChild(el('li', {}, [el('span', { class: 'sw none' }), 'No color: private or unknown']));
    msec.appendChild(lg);
    msec.appendChild(el('p', { class: 'mapnote', html: 'Land posted with signs but not electronically does not appear on any map. Trust signs on the ground over this map. PLOTS tracts change every year; this map is rebuilt weekly from the <a href="' + LINKS.atlas + '" target="_blank" rel="noopener">ND Game and Fish</a> records.' }));
    var savedNote = el('p', { class: 'mapnote', 'aria-live': 'polite' });
    msec.appendChild(savedNote);
    wrap.appendChild(msec);
  }

  function loadLeaflet() {
    if (state.L) return Promise.resolve(state.L);
    var prev = window.L;
    var css = fetch(URLS.leafletCss).then(function (r) { return r.text(); }).then(function (t) { root.insertBefore(el('style', { text: t }), style); });
    var js = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = URLS.leafletJs;
      s.onload = function () {
        var mine = window.L;
        if (prev && mine !== prev && mine.noConflict) mine = mine.noConflict();
        resolve(mine);
      };
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return Promise.all([css, js]).then(function (r) { state.L = r[1]; return state.L; });
  }

  var postedOn = true, fishOn = true;
  function ensureMap() {
    if (mapReady) return mapReady;
    mapReady = Promise.all([loadLeaflet(), loadLandData()]).then(function (r) {
      var L = r[0];
      var renderer = L.canvas({ padding: 0.5, tolerance: 4 });
      var map = L.map(mapEl, { center: CENTER, zoom: 8, minZoom: 7, maxZoom: 17, renderer: renderer, preferCanvas: true, tap: false });
      state.map = map;
      var attr = 'Basemap: <a href="https://www.usgs.gov/the-national-map" target="_blank" rel="noopener">USGS The National Map</a>';
      state.layers.base = {
        topo: L.tileLayer(TILES.topo, { maxNativeZoom: 16, maxZoom: 17, attribution: attr }),
        imagery: L.tileLayer(TILES.imagery, { maxNativeZoom: 16, maxZoom: 17, attribution: attr })
      };
      state.layers.base.topo.addTo(map);
      map.attributionControl.setPrefix(false);
      map.attributionControl.addAttribution('Land: ND Game and Fish, USDA Forest Service, ND Trust Lands, BLM via ND GIS Hub, USGS PAD-US');
      state.layers.lands = L.geoJSON(state.lands, {
        renderer: renderer, interactive: false,
        filter: function (f) { return f.properties.c !== 'boundary'; },
        style: function (f) {
          var c = CLASSES[f.properties.c] || CLASSES.usbr;
          var closed = f.properties.c === 'trust' && f.properties.a === 'Closed';
          return { stroke: true, weight: 0.6, color: c.fill, opacity: 0.9, fillColor: closed ? '#C2405C' : c.fill, fillOpacity: f.properties.c === 'nps' ? 0.3 : 0.45 };
        }
      }).addTo(map);
      state.layers.boundary = L.geoJSON(state.lands, {
        renderer: renderer, interactive: false,
        filter: function (f) { return f.properties.c === 'boundary'; },
        style: function () { return { weight: 1.6, color: '#1B4532', dashArray: '6 6', fill: false }; }
      });
      var rings = L.layerGroup();
      (state.sites.features || []).forEach(function (s) {
        var ll = [s.geometry.coordinates[1], s.geometry.coordinates[0]];
        rings.addLayer(L.circle(ll, { radius: NO_SHOOT, renderer: renderer, interactive: false, color: '#C2405C', weight: 1.2, dashArray: '3 3', fillColor: '#F36079', fillOpacity: 0.2 }));
      });
      state.layers.rings = rings;
      state.layers.posted = L.tileLayer(EPOST + '/tile/{z}/{y}/{x}', { minZoom: 11, maxNativeZoom: 16, maxZoom: 17, opacity: 0.75,
        attribution: 'Posted land: <a href="' + LINKS.where + '" target="_blank" rel="noopener">ND Game and Fish</a>' });
      state.layers.fish = L.layerGroup();
      ((state.waters && state.waters.features) || []).forEach(function (w) {
        var p = w.properties, ll = [w.geometry.coordinates[1], w.geometry.coordinates[0]];
        var m = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 2, fillColor: '#2B6CB0', fillOpacity: 1, bubblingMouseEvents: false });
        m.bindPopup('<b>' + esc(p.n) + '</b><br>' + esc((p.sp || []).slice(0, 6).join(', ')) + (p.note ? '<br><span style="color:#5A5F61">' + esc(p.note) + '</span>' : '') +
          '<br><a href="https://www.google.com/maps/dir/?api=1&destination=' + ll[0] + ',' + ll[1] + '" target="_blank" rel="noopener">Directions</a>');
        state.layers.fish.addLayer(m);
      });
      map.on('zoomend', syncLayers);
      syncLayers();
      map.on('click', function (e) { explain(e.latlng.lat, e.latlng.lng, null, false); });
      loadingNote.remove();
      var at = /[?&]at=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(location.search);
      if (at) explain(+at[1], +at[2], null, false);
      return map;
    }).catch(function (e) {
      loadingNote.textContent = 'The map could not load. Check your connection and reload the page.';
      throw e;
    });
    return mapReady;
  }
  function toggle(layer, want) {
    var m = state.map;
    if (!m || !layer) return;
    if (want && !m.hasLayer(layer)) layer.addTo(m);
    if (!want && m.hasLayer(layer)) m.removeLayer(layer);
  }
  function syncLayers() {
    var m = state.map;
    if (!m) return;
    var z = m.getZoom();
    toggle(state.layers.boundary, z >= 11);
    toggle(state.layers.rings, z >= 12);
    toggle(state.layers.posted, postedOn && z >= 11);
    toggle(state.layers.fish, fishOn);
  }
  function showUnits(kind) {
    var L = state.L, m = state.map;
    if (!m) { ensureMap().then(function () { showUnits(kind); }); return; }
    if (state.layers.units) { m.removeLayer(state.layers.units); state.layers.units = null; }
    if (!kind) return;
    var g = L.layerGroup();
    state.units.features.filter(function (f) { return f.properties.t === kind; }).forEach(function (f) {
      g.addLayer(L.geoJSON(f, { interactive: false, style: function () { return { color: '#5A2D82', weight: 2.2, opacity: 0.85, fill: false }; } }));
      var b = f._b, c = [(b[1] + b[3]) / 2, (b[0] + b[2]) / 2];
      // keep the label inside the unit: walk toward its first ring vertex until inside
      if (!inPolygons(c[1], c[0], f._p)) {
        var v = f._p[0][0][Math.floor(f._p[0][0].length / 2)];
        for (var t = 0.1; t < 1; t += 0.1) { var q = [c[0] + (v[1] - c[0]) * t, c[1] + (v[0] - c[1]) * t]; if (inPolygons(q[1], q[0], f._p)) { c = q; break; } }
      }
      g.addLayer(L.marker(c, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', html: '<div class="ulabel">' + esc((kind === 'lion' ? 'Zone ' : '') + f.properties.u) + '</div>', iconSize: [0, 0] }) }));
    });
    g.addTo(m);
    state.layers.units = g;
  }
  function setBase(k) {
    if (!state.map) return;
    var b = state.layers.base;
    Object.keys(b).forEach(function (n) { if (state.map.hasLayer(b[n])) state.map.removeLayer(b[n]); });
    b[k].addTo(state.map); b[k].bringToBack();
    bTopo.setAttribute('aria-pressed', String(k === 'topo'));
    bImg.setAttribute('aria-pressed', String(k === 'imagery'));
  }
  function focusMap(lat, lng, isMe, accuracy, quiet) {
    var L = state.L, map = state.map;
    if (!L || !map) return;
    var icon = L.divIcon({ className: '', html: '<div class="' + (isMe ? 'me' : 'pin') + '"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    if (state.pin) map.removeLayer(state.pin);
    state.pin = L.marker([lat, lng], { icon: icon, keyboard: false, interactive: false }).addTo(map);
    if (state.me) { map.removeLayer(state.me); state.me = null; }
    if (isMe && accuracy) state.me = L.circle([lat, lng], { radius: accuracy, color: '#2A7BE4', weight: 1, fillOpacity: 0.08, interactive: false }).addTo(map);
    if (isMe) map.setView([lat, lng], Math.max(map.getZoom(), 14));
    if (!quiet) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function saveArea() {
    if (!state.map) return;
    var c = state.map.getCenter(), km = 8, urls = [];
    function ty(lat, n) { var r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); }
    for (var z = 10; z <= 15; z++) {
      var n = Math.pow(2, z);
      var dLat = km / 111.32, dLng = km / (111.32 * Math.cos(c.lat * Math.PI / 180));
      var x0 = Math.floor((c.lng - dLng + 180) / 360 * n), x1 = Math.floor((c.lng + dLng + 180) / 360 * n);
      var y0 = ty(c.lat + dLat, n), y1 = ty(c.lat - dLat, n);
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) {
        urls.push(TILES.topo.replace('{z}', z).replace('{y}', y).replace('{x}', x));
        if (z >= 11) urls.push(EPOST + '/tile/' + z + '/' + y + '/' + x);
      }
    }
    savedNote.textContent = 'Saving ' + urls.length + ' map tiles around the center of the map…';
    caches.open(TILE_CACHE).then(function (cache) {
      var done = 0, i = 0;
      function next() {
        if (i >= urls.length) return Promise.resolve();
        var u = urls[i++];
        return cache.match(u).then(function (hit) { return hit || cache.add(u); }).catch(function () {}).then(function () {
          done++;
          if (done % 20 === 0) savedNote.textContent = 'Saved ' + done + ' of ' + urls.length + ' tiles…';
          return next();
        });
      }
      return Promise.all([next(), next(), next(), next()]);
    }).then(function () {
      savedNote.textContent = 'Saved. The land records, posted land and about 5 miles of topo map around this spot will work with no signal. Location still works offline. The posted-land check needs a signal.';
    }).catch(function () { savedNote.textContent = 'Could not save tiles on this device.'; });
  }

  // --- seasons ---
  var seasonSec, seasonBody, dateInput;
  if (SHOW.seasons || SHOW.compact) {
    seasonSec = el('section', { class: SHOW.compact ? 'compact' : '', 'aria-label': 'What is open' });
    if (!SHOW.compact) {
      seasonSec.appendChild(el('h3', { text: 'What’s open' }));
      var db = el('div', { class: 'datebar' });
      dateInput = el('input', { type: 'date', id: 'hf-date', value: state.date, onchange: function () { if (dateInput.value) { state.date = dateInput.value; renderSeasons(); } } });
      db.appendChild(el('label', { for: 'hf-date', text: 'Plan for a date' }));
      db.appendChild(dateInput);
      db.appendChild(el('button', { class: 'chip', type: 'button', onclick: function () { state.date = todayInMedora(); dateInput.value = state.date; renderSeasons(); } }, ['Today']));
      seasonSec.appendChild(db);
    }
    seasonBody = el('div', {}, [el('p', { class: 'stamp', text: 'Loading seasons…' })]);
    seasonSec.appendChild(seasonBody);
    wrap.appendChild(seasonSec);
  }
  function seasonStatus(s, d) {
    if (s.closed) return state.seasons && d > state.seasons.valid_through ? { cls: 'b-later', word: 'Next dates not out', rank: 2 } : { cls: 'b-closed', word: 'No season', rank: 4 };
    if (s.missing) return { cls: 'b-later', word: 'Check Game and Fish', rank: 2 };
    if (s.allyear) return { cls: 'b-open', word: 'Open', rank: 0 };
    if (d >= s.open && d <= s.close) {
      if (s.gap && d >= s.gap[0] && d <= s.gap[1]) return { cls: 'b-soon', word: 'Reopens ' + md(addDays(s.gap[1], 1)), rank: 1 };
      return { cls: 'b-open', word: d === s.open && s.noon ? 'Opens at noon' : 'Open', rank: 0 };
    }
    if (d < s.open) {
      var n = daysBetween(d, s.open);
      return n <= 14 ? { cls: 'b-soon', word: n === 1 ? 'Opens tomorrow' : 'Opens in ' + n + ' days', rank: 1 } : { cls: 'b-later', word: 'Opens ' + md(s.open), rank: 2 };
    }
    // Well past the close, the next season's dates are not out yet.
    if (daysBetween(s.close, d) > 120) return { cls: 'b-later', word: 'Next dates not out', rank: 2 };
    return { cls: 'b-closed', word: 'Closed', rank: 3 };
  }
  function addDays(s, n) { var d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function renderSeasons() {
    if (!seasonBody) return;
    seasonBody.innerHTML = '';
    var S = state.seasons;
    if (!S) { seasonBody.appendChild(el('p', { text: 'Season dates could not load. See the North Dakota Game and Fish regulations.' })); return; }
    var d = state.date;
    var stale = d > S.valid_through;
    var h = shootingHours(d, MEDORA[0], MEDORA[1]);
    var openNow = S.seasons.filter(function (s) { return seasonStatus(s, d).rank === 0; });

    if (SHOW.compact) {
      var c = el('div', { class: 'card' }, [el('h4', { text: 'Open today around Medora' })]);
      if (stale) c.appendChild(el('p', { text: 'Game and Fish has not posted the seasons for this date yet.' }));
      else {
        var ul = el('ul');
        openNow.filter(function (s) { return s.group !== 'Fishing'; }).forEach(function (s) { ul.appendChild(el('li', { text: s.name })); });
        if (!ul.childNodes.length) ul.appendChild(el('li', { text: 'No hunting seasons open today' }));
        ul.appendChild(el('li', { text: 'Fishing: open all year on most waters' }));
        c.appendChild(ul);
      }
      c.appendChild(el('p', { html: '<b>Shooting hours in Medora:</b> ' + clock(h.start, 'America/Denver') + ' to ' + clock(h.sunset, 'America/Denver') + ' (big game to ' + clock(h.bigEnd, 'America/Denver') + ') Mountain Time' }));
      c.appendChild(el('a', { class: 'btn small', href: MORE, text: 'See the full guide' }));
      seasonBody.appendChild(c);
      return;
    }

    if (stale) seasonBody.appendChild(el('div', { class: 'warn alert', html: 'Game and Fish has not posted the seasons for this date yet. They appear here on their own once the new <a href="' + LINKS.regs + '" target="_blank" rel="noopener">proclamations</a> are out.' }));

    var cards = el('div', { class: 'cards' });
    var hc = el('div', { class: 'card' }, [el('h4', { text: 'Shooting hours in Medora' })]);
    hc.appendChild(el('p', { class: 'big', text: clock(h.start, 'America/Denver') }));
    hc.appendChild(el('p', { text: (d === todayInMedora() ? 'Legal start today' : 'Legal start on ' + md(d)) + ', half an hour before sunrise. Mountain Time.' }));
    var hl = el('ul', { class: 'hours' });
    hl.appendChild(el('li', {}, [el('span', { text: 'Upland birds, turkeys, ducks' }), el('b', { text: 'until ' + clock(h.sunset, 'America/Denver') })]));
    hl.appendChild(el('li', {}, [el('span', { text: 'Deer, pronghorn, elk, predators' }), el('b', { text: 'until ' + clock(h.bigEnd, 'America/Denver') })]));
    hl.appendChild(el('li', {}, [el('span', { text: 'Geese and sandhill cranes' }), el('b', { text: gooseEnd(d) === 'sunset' ? 'until ' + clock(h.sunset, 'America/Denver') : 'until 2 p.m.' })]));
    hc.appendChild(hl);
    hc.appendChild(el('small', { text: 'Deer and pronghorn seasons open at noon Central Time, which is 11 a.m. in Medora.' }));
    cards.appendChild(hc);

    var oc = el('div', { class: 'card' }, [el('h4', { text: d === todayInMedora() ? 'Open today' : 'Open on ' + md(d) })]);
    var hunts = openNow.filter(function (s) { return s.group !== 'Fishing'; });
    oc.appendChild(el('p', { class: 'big', text: stale ? 'Check dates' : hunts.length + ' hunting season' + (hunts.length === 1 ? '' : 's') }));
    if (hunts.length && !stale) oc.appendChild(el('p', { text: hunts.map(function (s) { return s.name; }).join(' \u00b7 ') }));
    oc.appendChild(el('p', { text: 'Plus fishing, which is open all year on most waters.' }));
    var rs = activeRestrictions(d);
    rs.forEach(function (r) { oc.appendChild(el('div', { class: 'warn', text: r.text })); });
    cards.appendChild(oc);
    seasonBody.appendChild(cards);

    var groups = [];
    S.seasons.forEach(function (s) { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    groups.forEach(function (g) {
      var sec = el('div', { class: 'sgroup' }, [el('h4', { text: g })]);
      S.seasons.filter(function (s) { return s.group === g; })
        .map(function (s) { return { s: s, st: seasonStatus(s, d) }; })
        .sort(function (a, b) { return a.st.rank - b.st.rank || (a.s.open || '').localeCompare(b.s.open || ''); })
        .forEach(function (x) {
          var s = x.s, st = x.st;
          var dates = (s.closed || s.missing) ? '' : (s.allyear ? 'All year' : md(s.open) + (s.noon ? ' (noon CT)' : '') + ' to ' + md(s.close));
          var row = el('div', { class: 'srow' }, [
            el('div', {}, [el('div', { class: 'nm', text: s.name }), el('div', { class: 'dt', text: [dates, s.license].filter(Boolean).join(' · ') })]),
            el('span', { class: 'badge ' + st.cls, text: st.word })
          ]);
          var nt = el('div', { class: 'nt' });
          if (s.note) nt.appendChild(document.createTextNode(s.note + ' '));
          nt.appendChild(link('Regulations', s.src));
          row.appendChild(nt);
          sec.appendChild(row);
        });
      seasonBody.appendChild(sec);
    });
    seasonBody.appendChild(el('p', { class: 'stamp', html: 'Dates are read from the current North Dakota Game and Fish proclamations every day; last checked ' + md(S.checked) + '. Bag limits, units and license rules are in each <a href="' + LINKS.regs + '" target="_blank" rel="noopener">proclamation</a>; it is the final word.' }));
  }

  // --- fishing ---
  var fishSec, fishList, speciesFilter = '', fishRulesNode = null;
  var SPECIES = [['', 'All'], ['Walleye', 'Walleye'], ['Northern Pike', 'Pike'], ['Bass', 'Bass'], ['Trout', 'Trout'], ['Channel Catfish', 'Catfish'], ['Yellow Perch', 'Perch'], ['Bluegill', 'Bluegill'], ['Crappie', 'Crappie']];
  if (SHOW.fishing) {
    fishSec = el('section', { 'aria-label': 'Where to fish' });
    fishSec.appendChild(el('h3', { text: 'Where to fish' }));
    fishSec.appendChild(el('p', { class: 'lede', text: 'Lakes, dams and rivers within reach of Medora that North Dakota Game and Fish manages for fishing, closest first. Notes are the Department’s own.' }));
    var fl = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter by fish' });
    SPECIES.forEach(function (s) {
      fl.appendChild(el('button', { class: 'chip', type: 'button', 'aria-pressed': String(s[0] === ''), 'data-sp': s[0], onclick: function (e) {
        speciesFilter = s[0];
        Array.prototype.forEach.call(fl.children, function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-sp') === speciesFilter)); });
        renderWaters();
      } }, [s[1]]));
    });
    fishSec.appendChild(fl);
    fishList = el('div', { class: 'cards' }, [el('p', { class: 'stamp', text: 'Loading fishing waters…' })]);
    fishSec.appendChild(fishList);
    fishSec.appendChild(fishingRules());
    wrap.appendChild(fishSec);
  }
  var FAC_WORDS = { ramp: 'boat ramp', pier: 'fishing pier', dock: 'courtesy dock', clean: 'fish cleaning station', shore: 'shore access', toilet: 'toilet' };
  function renderWaters() {
    if (!fishList) return;
    fishList.innerHTML = '';
    var W = state.waters;
    if (!W) { fishList.appendChild(el('p', { text: 'Fishing waters could not load. Try the Game and Fish Where to Fish tool.' })); return; }
    W.features.map(function (w) { return { w: w, d: metres(MEDORA, [w.geometry.coordinates[1], w.geometry.coordinates[0]]) }; })
      .filter(function (x) { return !speciesFilter || (x.w.properties.sp || []).some(function (s) { return s.indexOf(speciesFilter) >= 0; }); })
      .sort(function (a, b) { return a.d - b.d; })
      .forEach(function (x) {
        var p = x.w.properties, ll = [x.w.geometry.coordinates[1], x.w.geometry.coordinates[0]];
        var c = el('div', { class: 'card water' });
        c.appendChild(el('h4', { text: (p.k ? p.k + ' County · ' : '') + 'about ' + miles(x.d) + ' mi from Medora' }));
        c.appendChild(el('p', { class: 'nm', text: p.n }));
        if (p.sp && p.sp.length) c.appendChild(el('p', { class: 'sp', text: p.sp.slice(0, 8).join(', ') }));
        if (p.note) {
          var np = el('p', { class: p.note.length > 260 ? 'clamp' : '', text: p.note });
          c.appendChild(np);
          if (p.note.length > 260) c.appendChild(el('button', { class: 'more', type: 'button', onclick: function (e) { np.classList.toggle('clamp'); e.target.textContent = np.classList.contains('clamp') ? 'Read more' : 'Show less'; } }, ['Read more']));
        }
        var facts = [];
        if (p.ac) facts.push(p.ac.toLocaleString() + ' acres');
        if (p.depth) facts.push(p.depth + ' ft deep');
        var fac = Object.keys(p.fac || {}).filter(function (k) { return k !== 'toilet' || Object.keys(p.fac).length > 1; }).map(function (k) { return FAC_WORDS[k]; });
        if (fac.length) facts.push(fac.join(', '));
        if (facts.length) c.appendChild(el('p', { class: 'facts', text: facts.join(' · ') }));
        if (p.rampnote) c.appendChild(el('p', { class: 'ans', text: p.rampnote + '.' }));
        if (p.stock && p.stock.length) {
          var sp = [];
          p.stock.forEach(function (s) { if (sp.indexOf(s.sp) < 0) sp.push(s.sp); });
          c.appendChild(el('p', { class: 'facts', text: 'Stocked lately: ' + sp.join(', ') + '.' }));
        }
        if (p.ans && p.ans.length) c.appendChild(el('p', { class: 'ans', text: 'Aquatic nuisance species found here: ' + p.ans.join(', ') + '. Clean, drain and dry before you leave.' }));
        if (p.dir) c.appendChild(el('p', { class: 'facts', text: p.dir }));
        var acts = el('div', { class: 'acts' });
        acts.appendChild(link('Directions', 'https://www.google.com/maps/dir/?api=1&destination=' + ll[0] + ',' + ll[1]));
        if (p.contour) acts.appendChild(link('Depth map', p.contour));
        if (SHOW.map) acts.appendChild(el('button', { type: 'button', onclick: function () { ensureMap().then(function () { state.map.setView(ll, 13); mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); } }, ['Show on map']));
        c.appendChild(acts);
        fishList.appendChild(c);
      });
    if (!fishList.childNodes.length) fishList.appendChild(el('p', { text: 'No water nearby lists that fish. Try another.' }));
  }
  function fishingRules() {
    var s = el('div');
    s.appendChild(el('h3', { text: 'Fishing rules in brief' }));
    var ul = el('ul', { class: 'tips' });
    [
      'Anyone 16 or older needs a North Dakota fishing license. Residents under 16 do not; nonresidents under 16 may fish with a licensed adult.',
      'Two poles in open water, four on the ice.',
      'Leave no plants, water or mud on your boat or gear. Pull drain plugs and drain livewells, bait wells and motors before you leave the water, and keep plugs out on the road.',
      'Live aquatic bait may not be brought into North Dakota. Dump unused bait away from the water.',
      'In Theodore Roosevelt National Park, the Little Missouri River is open to fishing with a state license.'
    ].forEach(function (t) { ul.appendChild(el('li', { text: t })); });
    s.appendChild(ul);
    var lim = (state.seasons && state.seasons.fish_limits) || null;
    var tableSlot = el('div');
    s.appendChild(tableSlot);
    s._fill = function () {
      var L = (state.seasons && state.seasons.fish_limits) || [];
      if (!L.length) return;
      tableSlot.innerHTML = '';
      tableSlot.appendChild(el('h4', { text: 'Daily and possession limits (statewide)', style: 'margin-top:14px' }));
      var t = el('table', { class: 'limits' });
      t.appendChild(el('tr', {}, [el('th', { text: 'Fish' }), el('th', { class: 'n', text: 'Daily' }), el('th', { class: 'n', text: 'Possession' })]));
      L.forEach(function (r) { t.appendChild(el('tr', {}, [el('td', { text: r[0] }), el('td', { class: 'n', text: r[1] }), el('td', { class: 'n', text: r[2] })])); });
      tableSlot.appendChild(t);
      tableSlot.appendChild(el('p', { class: 'stamp', html: 'Some waters have their own limits or size rules. See the <a href="' + LINKS.fishRegs + '" target="_blank" rel="noopener">fishing proclamation</a> and the <a href="' + LINKS.ans + '" target="_blank" rel="noopener">aquatic nuisance species rules</a>.' }));
    };
    if (lim) s._fill();
    fishRulesNode = s;
    return s;
  }

  // --- licenses ---
  var licSlot = SHOW.licenses ? el('div') : null;
  if (licSlot) wrap.appendChild(licSlot);
  function renderLicenses() {
    if (!licSlot) return;
    licSlot.innerHTML = '';
    licSlot.appendChild(el('h3', { text: 'Licenses' }));
    var cards = el('div', { class: 'cards' });
    [
      { h: 'Buy a license', need: 'Online, in the app or at a vendor', text: 'Buy online or in the free ND Game and Fish app, which also keeps your licenses and the regulations on your phone with no signal.', links: [['Buy and apply', LINKS.buy], ['ND Game and Fish app', LINKS.app]] },
      { h: 'Hunter education', need: 'Born after Dec. 31, 1961', text: 'You need a hunter education number to buy a hunting license. Hunters 12 and older without one can get an apprentice validation for small game and deer for one license year.', links: [['Hunter education', LINKS.hunterEd], ['Hunting license rules', LINKS.huntLicense]] },
      { h: 'Deer, pronghorn, elk, turkey', need: 'Mostly by lottery', text: 'Licenses for deer gun, muzzleloader, pronghorn, elk, moose, bighorn sheep and turkey are issued by lottery. Deer archery licenses are sold over the counter.', links: [['Lotteries and availability', 'https://gf.nd.gov/hunting/lotteries']] },
      { h: 'Ducks, geese, cranes, doves', need: 'Extra stamps', text: 'Register with the Harvest Information Program every year. Waterfowl hunters 16 and older also need a federal duck stamp. Nonresident waterfowl licenses cover two 7-day periods in chosen zones.', links: [['Small game and waterfowl proclamation', 'https://gf.nd.gov/hunting/proclamations/current/small-game']] },
      { h: 'Fishing', need: 'Age 16 and older', text: 'Residents and nonresidents 16 and older need a fishing license.', links: [['Fishing licenses', LINKS.fishLicense]] },
      { h: 'After the hunt', need: 'Carcass and bird rules', text: 'Deer, elk or moose carcass waste taken out of its unit must go to a landfill or waste hauler. Keep a wing or head on waterfowl and a leg, head or wing on upland birds until you get home.', links: [['Chronic wasting disease rules', LINKS.cwd]] }
    ].forEach(function (p) {
      var c = el('div', { class: 'card' }, [el('h4', { text: p.h }), el('p', { style: 'font-weight:700;color:#1B4532', text: p.need }), el('p', { text: p.text })]);
      var ul = el('ul', { class: 'plinks' });
      p.links.forEach(function (l) { ul.appendChild(el('li', {}, [link(l[0], l[1])])); });
      c.appendChild(ul);
      cards.appendChild(c);
    });
    licSlot.appendChild(cards);
    var P = state.places;
    if (P && P.features.length) {
      licSlot.appendChild(el('h4', { text: 'Where to buy a license nearby', style: 'margin-top:18px' }));
      var vl = el('ul', { class: 'vendors' });
      P.features.map(function (f) { return { p: f.properties, d: metres(MEDORA, [f.geometry.coordinates[1], f.geometry.coordinates[0]]) }; })
        .sort(function (a, b) { return a.d - b.d; })
        .slice(0, 10)
        .forEach(function (x) {
          var p = x.p;
          var li = el('li', {}, [el('b', { text: p.n })]);
          var tel = (p.ph || '').replace(/[^0-9]/g, '');
          li.appendChild(el('small', { html: esc([p.a, p.city].filter(Boolean).join(', ')) + ' · about ' + miles(x.d) + ' mi from Medora' + (tel ? ' · <a href="tel:+1' + tel + '">' + esc(p.ph) + '</a>' : '') }));
          if (p.s && p.s.length > 1) li.appendChild(el('small', { text: 'Sells ' + p.s.join(', ') + '.' }));
          vl.appendChild(li);
        });
      licSlot.appendChild(vl);
      licSlot.appendChild(el('p', { class: 'stamp', text: 'From the ND Game and Fish license vendor list. Call ahead; hours vary.' }));
    }
    licSlot.appendChild(el('div', { class: 'warn', html: '<b>Report poaching:</b> Report All Poachers, <a href="tel:+17013289921">(701) 328‑9921</a>.' }));
  }

  // --- rules by land type ---
  var rulesSlot = SHOW.rules ? el('div') : null;
  if (rulesSlot) wrap.appendChild(rulesSlot);
  function buildRules() {
    if (!rulesSlot) return;
    rulesSlot.innerHTML = '';
    var rs = el('section', { 'aria-label': 'Rules by land type' });
    rs.appendChild(el('h3', { text: 'The rules, by land type' }));
    ['usfs', 'plots', 'wma', 'trust', 'blm', 'nps', 'private'].forEach(function (k) {
      var c = CLASSES[k], st = STATUS[k === 'private' ? 'ask' : c.status];
      var d = el('details', { class: 'rule' });
      var word = k === 'private' ? 'Unless posted' : st.word;
      d.appendChild(el('summary', {}, [el('span', { class: 'sw' + (c.fill ? '' : ' none'), style: c.fill ? 'background:' + c.fill : '' }), k === 'private' ? 'Private land' : c.label.replace('Little Missouri ', '').replace(' walk-in hunting area', ' walk-in areas').replace('National park land', 'Theodore Roosevelt National Park'), el('span', { class: 'badge', style: 'background:' + st.bg + ';color:' + st.ink, text: word })]));
      var ul = el('ul');
      c.rules(k === 'nps' ? { n: 'Theodore Roosevelt National Park' } : {}).forEach(function (t) { ul.appendChild(el('li', { text: t })); });
      if (c.fish) ul.appendChild(el('li', { text: 'Fishing: ' + c.fish }));
      d.appendChild(ul);
      var links = el('p', { class: 'small' });
      c.links.forEach(function (l, i) { if (i) links.appendChild(document.createTextNode(' · ')); links.appendChild(link(l[0], l[1])); });
      if (c.contact) links.appendChild(el('span', { text: (c.links.length ? ' · ' : '') + c.contact }));
      if (links.childNodes.length) d.appendChild(links);
      rs.appendChild(d);
    });
    rs.appendChild(el('h3', { text: 'Before you go' }));
    var tips = el('ul', { class: 'tips' });
    [
      'Wear blaze orange during the deer gun season, bowhunters included. It is also required in the muzzleloader, pronghorn gun and most elk seasons.',
      'Cell service is patchy in the Badlands. Open the full-screen map and save your area for offline use while you still have a signal.',
      'Badlands clay turns slick and impassable after rain, even with four-wheel drive. Park where you can drive out on gravel.',
      'Close every gate you open. Leaving a gate open can cost you your hunting license.',
      'Know where the national park boundary is. Bison, elk and wild horses wander right up to it.',
      'Hunt upwind of oil and gas wells and never shoot toward one or any other equipment.'
    ].forEach(function (t) { tips.appendChild(el('li', { text: t })); });
    rs.appendChild(tips);
    rs.appendChild(el('p', { style: 'margin-top:16px' }, [el('a', { class: 'btn', href: LINKS.camping, target: '_blank', rel: 'noopener' }, ['Camping on public land'])]));
    rulesSlot.appendChild(rs);
  }

  if (!SHOW.compact) {
    var note = el('p', { class: 'note' });
    note.innerHTML = 'This guide is offered as a help, not a legal determination. The Theodore Roosevelt Presidential Library does not manage any of this land or set any of these rules. Land and fishing records come from North Dakota Game and Fish, the U.S. Forest Service, the North Dakota Department of Trust Lands and the USGS Protected Areas Database, and boundaries are approximate. Posted signs, the land manager and the current <a href="' + LINKS.regs + '" target="_blank" rel="noopener">North Dakota Game and Fish proclamations</a> always have the final word.';
    wrap.appendChild(note);
    var stampEl = el('p', { class: 'note', style: 'margin-top:6px' });
    wrap.appendChild(stampEl);
  }

  // ---------- start ----------
  buildRules();
  loadSide().then(function () {
    renderSeasons();
    renderWaters();
    if (fishRulesNode && fishRulesNode._fill) fishRulesNode._fill();
    renderLicenses();
  });
  if (stampEl) getJSON(URLS.meta).then(function (m) {
    if (m && m.built) stampEl.textContent = 'Land, unit and fishing records last refreshed ' + new Date(m.built).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Denver' }) + '.';
  }).catch(function () {});
  if (SHOW.check && !SHOW.map) loadLandData().catch(function () {});
  if (SHOW.map) {
    if ('IntersectionObserver' in window && !APP) {
      var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); ensureMap(); } }, { rootMargin: '400px' });
      io.observe(mapEl);
    } else ensureMap();
  }
})();
