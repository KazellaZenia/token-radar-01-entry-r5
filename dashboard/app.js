// Beacon Radar v3 dashboard: renders the board from window.BEACON_DATA.
// Views by hash: #/board (default), #/detail/<slug>, #/filter/<category>.
// No network: every byte the page shows comes from data.js beside it.
(function () {
  // Screenshot mode: ?shot=detail hides the hero and controls so the detail
  // panel is the first thing on the page (no scrolling needed for a clean shot).
  var shot = new URLSearchParams(location.search).get('shot');
  if (shot === 'detail') {
    document.querySelector('header.hero').style.display = 'none';
    document.querySelector('section.controls').style.display = 'none';
  }
  var D = window.BEACON_DATA;
  var rows = D.rows;
  var stats = D.stats;
  var maxImplied = rows[0].implied;

  function usd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(n);
  }
  function pct(x) { return (x * 100).toFixed(1) + '%'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- model strip: the whole value model, in the open, with its tests ----
  var strip = document.getElementById('model-strip');
  strip.innerHTML =
    '<span class="lbl">How the value is built — every number fitted from the snapshot</span><br>' +
    '<b>Value if token:</b> log(mcap) = ' + stats.powerA.toFixed(2) + ' + ' + stats.powerB.toFixed(2) +
    ' · log(TVL), fit on ' + stats.nLive + ' live-token protocols. ' +
    'Leave-one-out error ' + stats.looFitMean.toFixed(2) + ' vs ' + stats.looFlatMean.toFixed(2) +
    ' for a flat 0.30×TVL; walk-forward ' + stats.wfFitMean.toFixed(2) + ' vs ' + stats.wfFlatMean.toFixed(2) +
    '; Spearman ' + stats.spearman.toFixed(2) + '; median fitted/actual ' + stats.medianFitRatio.toFixed(2) +
    ' vs flat ' + stats.medianFlatRatio.toFixed(2) + '.<br>' +
    '<b>Token odds:</b> age-driven only — category rates are an age artifact (no Risk Curator older ' +
    'than 2y exists, so its 0/22 rate punishes the board’s top protocols). Brier ' +
    stats.brierRaw.toFixed(3) + ' raw, ' + stats.brierCompressed.toFixed(3) + ' compressed vs ' +
    stats.brierFlat.toFixed(3) + ' flat; odds compressed ×0.3 toward the ' + pct(stats.globalRate) +
    ' global rate, so TVL decides the ranking. The odds give the expected value (implied × odds), not the implied value.<br>' +
    '<b>7d growth:</b> tested, no weight — it correlates ' + stats.growthCorr.toFixed(2) +
    ' with the value ratio and does not predict issuance, so it is shown, not used.<br>' +
    '<b>$/hour:</b> pool = 10% of the expected value (implied × odds, a stated assumption) ÷ farmers (TVL ÷ $5,000 median ' +
    'deposit, stated assumption) ÷ plan hours. Small protocols pay more per hour; giants pay less.';

  // ---- stat tiles ----
  var tiles = document.getElementById('tiles');
  tiles.innerHTML =
    tile(rows.length, 'protocols ranked') +
    tile(D.watchlist_covered + '/' + D.watchlist_total, 'watchlist covered') +
    tile(stats.medianFitRatio.toFixed(2) + '×', 'median fitted / actual mcap') +
    tile(stats.brierCompressed.toFixed(3), 'Brier, token odds') +
    tile(stats.looFitMean.toFixed(2), 'LOO error, power law');
  function tile(v, k) { return '<div class="tile"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>'; }

  // ---- category filter options ----
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var sel = document.getElementById('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; sel.appendChild(o);
  });

  var qEl = document.getElementById('q');
  var sortEl = document.getElementById('sort');
  var tbody = document.getElementById('rows');
  var countEl = document.getElementById('count');

  function current() {
    var list = rows.slice();
    var q = qEl.value.trim().toLowerCase();
    var cat = sel.value;
    if (q) list = list.filter(function (r) { return (r.name + ' ' + r.slug).toLowerCase().indexOf(q) >= 0; });
    if (cat) list = list.filter(function (r) { return r.category === cat; });
    var key = sortEl.value;
    if (key === 'tvl') list.sort(function (a, b) { return b.tvl - a.tvl; });
    else if (key === 'odds') list.sort(function (a, b) { return b.odds - a.odds; });
    else if (key === 'hourly') list.sort(function (a, b) { return b.hourly - a.hourly; });
    else list.sort(function (a, b) { return b.implied - a.implied; });
    return list;
  }

  function renderBoard() {
    var list = current();
    countEl.textContent = list.length + ' of ' + rows.length + ' shown';
    var html = '';
    list.forEach(function (r) {
      var chg = r.change7d === null ? '—' :
        '<span class="' + (r.change7d >= 0 ? 'up' : 'down') + '">' + (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '%</span>';
      html += '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
        '<td><div class="name">' + esc(r.name) + '</div><div class="sub">' + esc(r.category || '') + ' · ' + esc(r.slug) + '</div></td>' +
        '<td class="num">' + usd(r.tvl) + '</td><td class="num">' + chg + '</td>' +
        '<td><div class="val">' + usd(r.implied) + '</div><div class="bar"><i style="width:' +
        Math.max(2, Math.round((r.implied / maxImplied) * 100)) + '%"></i></div></td>' +
        '<td class="num odds">' + pct(r.odds) + '</td>' +
        '<td class="num">$' + r.hourly.toFixed(2) + '/h</td></tr>';
    });
    tbody.innerHTML = html;
  }

  function renderDetail(slug) {
    var box = document.getElementById('detail');
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var steps = r.steps.map(function (s) {
      var when = s.minutes >= 60 ? (s.minutes / 60).toFixed(1) + ' hours' : s.minutes + ' minutes';
      return '<li>' + esc(s.text) + ' <span class="cost">— about $' + s.costUsd + ' fees, ' + when + '</span></li>';
    }).join('');
    var callout = '';
    if (r.slug === 'usdd') {
      callout = '<div class="callout"><b>Honest note — read this before farming USDD.</b> USDD is a ' +
        'stablecoin whose token already trades: the USDD in circulation <i>is</i> the token. The value ' +
        'above is a hypothetical governance token for the USDD system, not the stablecoin, and it is ' +
        'ranked here only because the snapshot records no market cap for it. Farm it only if you ' +
        'understand that distinction.</div>';
    }
    box.innerHTML =
      '<h2>' + esc(r.name) + ' <span class="sub">#' + r.rank + ' · ' + esc(r.category || '') + ' · TVL ' + usd(r.tvl) + '</span></h2>' +
      '<div class="meta">Age bucket ' + esc(r.ageBucket) + (r.ageDays === null ? ' (listing date unrecorded)' : ' (' + r.ageDays + ' days listed)') +
      ' · 7d ' + (r.change7d === null ? '—' : (r.change7d >= 0 ? '+' : '') + r.change7d.toFixed(1) + '%') + '</div>' +
      '<div class="math">' +
      '<div class="cell"><div class="v">' + usd(r.valueIfToken) + '</div><div class="k">value if it had a token</div></div>' +
      '<div class="cell"><div class="v">' + pct(r.odds) + '</div><div class="k">token odds (' + esc(r.ageBucket) + ' bucket)</div></div>' +
      '<div class="cell"><div class="v">' + usd(r.expected) + '</div><div class="k">expected value = value × odds</div></div>' +
      '<div class="cell"><div class="v">$' + r.hourly.toFixed(2) + '/h</div><div class="k">farm $/hour</div></div>' +
      '</div>' +
      '<p style="margin:0 0 4px">Farm economics: airdrop pool ' + usd(r.pool) + ' (10% of the expected value, ' +
      usd(r.implied) + ' × ' + pct(r.odds) + ') ÷ ' +
      r.farmers.toLocaleString('en-US') + ' farmers (TVL ÷ $5,000 median deposit) ÷ ' + r.hours +
      (r.hours === 1 ? ' hour' : ' hours') + ' of plan = $' + r.hourly.toFixed(2) + '/h. The pool and the farmer count are stated assumptions, shown so you can check them.</p>' +
      callout +
      '<ol class="steps">' + steps + '</ol>' +
      '<p><a href="#/board">← back to the board</a></p>';
    box.hidden = false;
    box.scrollIntoView();
  }

  function route() {
    var h = location.hash || '#/board';
    var m = h.match(/^#\/detail\/(.+)$/);
    if (m) { renderDetail(decodeURIComponent(m[1])); renderBoard(); return; }
    var f = h.match(/^#\/filter\/(.+)$/);
    if (f) { sel.value = decodeURIComponent(f[1]); }
    document.getElementById('detail').hidden = true;
    renderBoard();
  }

  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  qEl.addEventListener('input', renderBoard);
  sel.addEventListener('change', renderBoard);
  sortEl.addEventListener('change', renderBoard);
  window.addEventListener('hashchange', route);
  document.getElementById('foot').textContent =
    'Beacon Radar v3. Snapshot ' + D.generated_from + ', ' + rows.length + ' rows. The value model, the odds and the ' +
    'farm economics are fitted from the snapshot and shown in full above; 7d growth is displayed but carries no weight, ' +
    'because it does not predict value or issuance in the data. A protocol records no token — it is never claimed to have none.';
  route();
})();
