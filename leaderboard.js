/* Leaderboard. Ranks are calculated by the database (Today = since midnight Pakistan time, 7 Days = last 7 days, Month = this month).
   How many top users are shown is set by the admin. Ranks run 1, 2, 3, 4 ... Names are shortened ("Ali K.") and nothing else about a user is shown. */
(function () {
  'use strict';
  var Z = window.Z;
  var L = Z.leaderboard = {};
  var cache = {};   // metric|period -> { at, data }

  L.enabled = function () { return !(Z.state.settings && Z.state.settings.leaderboard_enabled === false); };

  // Entry on Home
  L.homeCard = function () {
    if (!L.enabled()) return '';
    return '<div class="card"><button class="row row-btn" data-go="/leaderboard"><span class="row-ic warn">' + Z.icon('trophy') + '</span>' +
      '<span class="row-main"><span class="row-title">Leaderboard</span><span class="row-sub">See the top users and your rank</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>';
  };

  var METRICS = [['ads', 'Ads Watched'], ['referrals', 'Referrals'], ['earned', 'Earned']];
  var PERIODS = [['today', 'Today'], ['week', '7 Days'], ['month', 'This Month']];
  function label(list, key) { return list.filter(function (x) { return x[0] === key; })[0][1]; }

  function valueText(metric, r) {
    if (metric === 'earned') return Z.money(r.value);
    if (metric === 'referrals') return Number(r.value) + '<small>L1 ' + (r.l1 || 0) + ' \u00b7 L2 ' + (r.l2 || 0) + '</small>';
    return String(Number(r.value));
  }

  // 2nd on the left, 1st in the middle (raised, with a crown), 3rd on the right
  function podium(rows, metric) {
    function slot(i, cls, rank) {
      var r = rows[i];
      if (!r) return '<div class="pd ' + cls + ' empty"><div class="pd-av">?</div><div class="pd-name">\u2014</div><div class="pd-base"><b>' + rank + '</b></div></div>';
      return '<div class="pd ' + cls + (r.me ? ' me' : '') + '">' +
        (rank === 1 ? '<span class="pd-crown">' + Z.icon('crown') + '</span>' : '') +
        '<div class="pd-av">' + Z.esc((r.name || '?').charAt(0).toUpperCase()) + '</div>' +
        '<div class="pd-name">' + Z.esc(r.name) + '</div>' + (r.me ? '<span class="ptag use">YOU</span>' : '') +
        '<div class="pd-val">' + valueText(metric, r) + '</div>' +
        '<div class="pd-base"><b>' + rank + '</b></div></div>';
    }
    return '<div class="card podium">' + slot(1, 'p2', 2) + slot(0, 'p1', 1) + slot(2, 'p3', 3) + '</div>';
  }

  Z.views.leaderboard = async function (el, ctx) {
    await Z.refreshSettings();
    if (ctx.stale()) return;
    if (!L.enabled()) { el.innerHTML = '<section class="page">' + Z.empty({ icon: 'trophy', title: 'Leaderboard is not available', text: 'Check back soon.' }) + '</section>'; return; }

    var metric = 'ads', period = 'today';
    el.innerHTML = '<section class="page"><div class="lb-title" id="lbhead"><h2>Leaderboard</h2><p>Rank by ' + label(METRICS, metric) + '</p></div>' +
      Z.chips(PERIODS, period, 'data-lp') +
      '<div class="seg">' + METRICS.map(function (m) { return '<button class="seg-btn' + (m[0] === metric ? ' on' : '') + '" data-lm="' + m[0] + '">' + m[1] + '</button>'; }).join('') + '</div>' +
      '<div id="lbpod"></div><div id="lbme"></div><div class="card" id="lb" hidden></div></section>';
    var pod = Z.$('#lbpod', el), box = Z.$('#lb', el), meBox = Z.$('#lbme', el), head = Z.$('#lbhead', el);

    async function load() {
      var key = metric + '|' + period, hit = cache[key];
      pod.innerHTML = Z.skel(1, 230); box.hidden = true; meBox.innerHTML = '';
      head.innerHTML = '<h2>Leaderboard</h2><p>Rank by ' + label(METRICS, metric) + ' \u00b7 ' + label(PERIODS, period) + '</p>';
      var d;
      if (hit && Date.now() - hit.at < 30000) d = hit.data;
      else {
        var r = await sb.rpc('leaderboard', { p_metric: metric, p_period: period });
        if (ctx.stale()) return;
        if (r.error) { pod.innerHTML = Z.errorState(); Z.$('[data-retry]', pod).addEventListener('click', load); return; }
        d = r.data; cache[key] = { at: Date.now(), data: d };
      }
      if (ctx.stale() || key !== metric + '|' + period) return;
      if (!d.enabled) { pod.innerHTML = Z.empty({ icon: 'trophy', title: 'Leaderboard is not available' }); return; }

      var rows = d.rows || [];
      head.innerHTML = '<h2>Top ' + Math.min(d.size, Math.max(rows.length, 1)) + ' Users</h2><p>Rank by ' + label(METRICS, metric) + ' \u00b7 ' + label(PERIODS, period) + '</p>';

      pod.innerHTML = rows.length ? podium(rows, metric)
        : '<div class="card">' + Z.empty({ icon: 'trophy', title: 'No one here yet', text: 'Be the first on the board for this period.' }) + '</div>';

      meBox.innerHTML = d.me
        ? '<div class="card lb-me"><span class="lb-rank">' + d.me.rank + '</span><span class="row-main"><span class="row-title">Your rank</span><span class="row-sub">' + valueText(metric, d.me).replace(/<small>/, ' \u00b7 ').replace(/<[^>]+>/g, '') + '</span></span></div>'
        : '<div class="alert a-info">' + Z.icon('info') + '<div>You are not ranked yet for this period. ' + (metric === 'ads' ? 'Watch an ad to get on the board.' : metric === 'referrals' ? 'Invite friends to get on the board.' : 'Earn rewards to get on the board.') + '</div></div>';

      // everyone after the top 3, in full (never folded)
      var rest = rows.slice(3);
      box.hidden = !rest.length;
      box.innerHTML = rest.map(function (r) {
        return '<div class="row lb-row' + (r.me ? ' me' : '') + '"><span class="lb-rank">' + r.rank + '</span>' +
          '<span class="avatar sm">' + Z.esc((r.name || '?').charAt(0).toUpperCase()) + '</span>' +
          '<span class="row-main"><span class="row-title">' + Z.esc(r.name) + (r.me ? ' <span class="ptag use">YOU</span>' : '') + '</span></span>' +
          '<span class="lb-val">' + valueText(metric, r) + '</span></div>';
      }).join('');
    }

    Z.$('.chips', el).addEventListener('click', function (e) {
      var c = e.target.closest('[data-lp]'); if (!c || c.getAttribute('data-lp') === period) return;
      period = c.getAttribute('data-lp');
      Z.$$('[data-lp]', el).forEach(function (x) { x.classList.toggle('on', x === c); });
      load();
    });
    Z.$('.seg', el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-lm]'); if (!b || b.getAttribute('data-lm') === metric) return;
      metric = b.getAttribute('data-lm');
      Z.$$('[data-lm]', el).forEach(function (x) { x.classList.toggle('on', x === b); });
      load();
    });
    load();
  };
})();
