/* Zyven UI kit: the shared look and feel.
   Everything here only DRAWS what the app already knows. It never changes data, money or rules. */
(function () {
  'use strict';
  var Z = window.Z;
  var MQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  Z.reducedMotion = function () { return !!(MQ && MQ.matches); };

  /* ---------------- Empty states: one illustrated look everywhere ---------------- */
  Z.empty = function (o) {
    return '<div class="empty">' +
      '<div class="empty-art" aria-hidden="true"><span class="empty-ring r1"></span><span class="empty-ring r2"></span>' +
      '<div class="empty-ic">' + Z.icon(o.icon || 'inbox') + '</div></div>' +
      '<h3>' + Z.esc(o.title) + '</h3>' +
      (o.text ? '<p>' + Z.esc(o.text) + '</p>' : '') +
      (o.action || '') + '</div>';
  };

  /* ---------------- Skeletons: the same shapes as the real page, shown only while it loads ---------------- */
  function bone(cls, style) { return '<div class="skel ' + cls + '"' + (style ? ' style="' + style + '"' : '') + '></div>'; }
  Z.skelRows = function (n) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<div class="skel-row">' + bone('skel-av') + '<div class="skel-lines">' + bone('skel-l1') + bone('skel-l2') + '</div></div>';
    return '<div class="card skel-card">' + out + '</div>';
  };
  Z.skelFor = function (name) {
    switch (name) {
      case 'home':
        return bone('skel-hero') + '<div class="skel-tiles">' + bone('skel-tile') + bone('skel-tile') + bone('skel-tile') + bone('skel-tile') + '</div>' +
          bone('', 'height:84px;border-radius:18px') + bone('', 'height:218px;border-radius:18px') + Z.skelRows(2);
      case 'profile':
        return bone('skel-hero', 'height:150px') + Z.skelRows(4);
      case 'referral': case 'milestones': case 'checkin': case 'payout':
        return bone('skel-hero', 'height:210px') + Z.skelRows(3);
      case 'watch': case 'browse': case 'plans': case 'myplans': case 'apps': case 'myapps': case 'promotions':
      case 'leaderboard': case 'activity': case 'notifications': case 'support':
        return Z.skelRows(5);
      default:
        return Z.skel(3, 90);
    }
  };

  /* ---------------- Progress bar with a real current/target label ---------------- */
  Z.progress = function (o) {
    var max = Number(o.max) || 0, val = Math.max(0, Number(o.value) || 0);
    var pct = max > 0 ? (val >= max ? 100 : Math.floor(val / max * 100)) : 0;   // 100% only when the target is really reached
    return '<div class="zprog">' +
      '<div class="zprog-top"><span>' + Z.esc(o.label || '') + '</span><b>' + Z.esc(o.right != null ? o.right : val + ' / ' + max) + '</b></div>' +
      '<div class="zbar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i></div></div>';
  };

  /* ---------------- Number counting ----------------
     Counts from the value the person last saw (or from 0 the first time) to the real value. The final text is always
     exactly the real value, and nothing animates when the value did not change. */
  var memo = {};
  var NF = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  Z.countUp = function (root) {
    var nodes = (root || document).querySelectorAll('[data-count]');
    Array.prototype.forEach.call(nodes, function (el) {
      var to = Number(el.getAttribute('data-count'));
      if (!isFinite(to)) return;
      var kind = el.getAttribute('data-kind') || 'int', key = el.getAttribute('data-ck') || '';
      var from = key && memo[key] != null ? memo[key] : 0;
      if (key) memo[key] = to;
      if (from === to || to < 0 || from < 0 || Z.reducedMotion()) return;
      var write, finish, finalText;
      if (kind === 'money') {
        var span = el.querySelector('.mny'), last = span && span.lastChild;
        if (!last || last.nodeType !== 3) return;
        finalText = last.nodeValue;
        var numStr = NF.format(Math.abs(to));
        if (finalText.slice(-numStr.length) !== numStr) return;
        var prefix = finalText.slice(0, finalText.length - numStr.length);
        write = function (v) { last.nodeValue = prefix + NF.format(Math.abs(v)); };
        finish = function () { last.nodeValue = finalText; };
      } else {
        finalText = el.textContent;
        write = function (v) { el.textContent = Math.round(v).toLocaleString('en-US'); };
        finish = function () { el.textContent = finalText; };
      }
      var dur = Math.min(900, 450 + Math.abs(to - from) * 2), t0 = null;
      write(from);   // first paint already shows the starting value, so the final number never flashes first
      function step(ts) {
        if (!el.isConnected) return;
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / dur);
        if (p >= 1) { finish(); return; }   // always ends on the exact real value
        write(from + (to - from) * easeOut(p));
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  };

  /* ---------------- Last 7 days chart (tap a bar to read it) ---------------- */
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parts(iso) { var p = String(iso).split('-').map(Number); return { y: p[0], m: p[1], d: p[2], w: new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() }; }
  function tipText(e, isToday) { var p = parts(e.day); return (isToday ? 'Today' : DOW[p.w] + ', ' + MON[p.m - 1] + ' ' + p.d) + ' \u00b7 ' + Z.money(e.earned); }
  function cleanWeek(week) { return (week || []).map(function (e) { return { day: String(e.day), earned: Number(e.earned) || 0 }; }); }

  Z.weekChart = function (week, foot) {
    week = cleanWeek(week);
    var total = week.reduce(function (a, e) { return a + e.earned; }, 0), max = week.reduce(function (a, e) { return Math.max(a, e.earned); }, 0);
    var head = '<div class="wk-head"><div><span class="wk-title">Last 7 days</span><b class="wk-total" data-count="' + total + '" data-kind="money" data-ck="wk-total">' + Z.moneyHtml(total) + '</b></div>' +
      '<span class="wk-note">Earned from ads, referrals and rewards</span></div>';
    var footer = foot ? '<div class="wk-foot">' + foot + '</div>' : '';
    if (!week.length || max <= 0) {
      return '<div class="card wk-card">' + head +
        Z.empty({ icon: 'coin', title: 'No earnings this week', text: 'Watch an ad and your weekly chart will start to fill up.', action: '<button class="btn btn-tonal" data-go="/watch">Watch ads</button>' }) + footer + '</div>';
    }
    var last = week.length - 1;
    var cols = week.map(function (e, i) {
      var h = e.earned > 0 ? Math.max(8, Math.round(e.earned / max * 100)) : 0, p = parts(e.day);
      return '<button type="button" class="wk-col' + (i === last ? ' on' : '') + (e.earned > 0 ? '' : ' zero') + '" data-i="' + i + '" aria-pressed="' + (i === last) + '" aria-label="' + Z.esc(tipText(e, i === last)) + '">' +
        '<span class="wk-track"><i style="--h:' + h + '%"></i></span><em>' + (i === last ? 'Today' : DOW[p.w]) + '</em></button>';
    }).join('');
    return '<div class="card wk-card">' + head + '<div class="wk-cols" data-wk>' + cols + '</div>' +
      '<div class="wk-tip" data-wk-tip aria-live="polite">' + Z.esc(tipText(week[last], true)) + '</div>' + footer + '</div>';
  };
  Z.weekBind = function (root, week) {
    week = cleanWeek(week);
    var cols = root.querySelector('[data-wk]'), tip = root.querySelector('[data-wk-tip]');
    if (!cols || !tip) return;
    cols.addEventListener('click', function (e) {
      var b = e.target.closest('.wk-col');
      if (!b) return;
      var i = Number(b.getAttribute('data-i'));
      Array.prototype.forEach.call(cols.children, function (c) { var on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
      tip.textContent = tipText(week[i], i === week.length - 1);
    });
  };

  /* ---------------- Achievements ----------------
     Z.unseen remembers what the person has already been shown. The first visit only records what is already there,
     so old unlocks never replay; later calls return only genuinely new ids. */
  Z.unseen = function (key, ids) {
    try {
      var k = 'zyven:seen:' + key, raw = localStorage.getItem(k), set = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(set)) { localStorage.setItem(k, JSON.stringify(ids)); return []; }
      var fresh = ids.filter(function (x) { return set.indexOf(x) === -1; });
      if (fresh.length) localStorage.setItem(k, JSON.stringify(set.concat(fresh)));
      return fresh;
    } catch (e) { return []; }   // storage blocked: never celebrate by guesswork
  };
  Z.celebrate = function (o) {
    var dots = '';
    for (var i = 0; i < 12; i++) dots += '<i style="--a:' + (i * 30) + 'deg;--d:' + (i % 2 ? 62 : 84) + 'px"></i>';
    return Z.sheet('<div class="cel"><div class="cel-burst" aria-hidden="true">' + dots + '</div>' +
      '<span class="cel-ic">' + Z.icon(o.icon || 'trophy') + '</span>' +
      '<h2 class="sheet-title">' + Z.esc(o.title) + '</h2>' +
      (o.text ? '<p class="muted">' + Z.esc(o.text) + '</p>' : '') +
      (Number(o.amount) > 0 ? '<div class="cel-amt">+' + Z.money(o.amount) + '</div>' : '') +
      '<button class="btn btn-primary btn-block" data-close>' + Z.esc(o.button || 'Great') + '</button></div>', { center: true });
  };

  /* ---------------- Navigation dot: a check-in is waiting ---------------- */
  Z.updateNavDots = function () {
    var s = Z.state && Z.state.summary, d = Z.$('.nav-item[data-tab="home"] .nav-dot');
    if (d) d.hidden = !(s && s.checkin_enabled && s.checkin_done === false);
  };
})();
