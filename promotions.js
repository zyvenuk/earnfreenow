/* Promotions (user side). Browse approved promotions, manage your own, and promote your channel or account.
   The price is shown live here, but the database recomputes it and charges the Main Wallet exactly once. */
(function () {
  'use strict';
  var Z = window.Z;
  var PR = Z.promos = {};
  var reqId = null, reqKey = '';   // one request id per unfinished submission: a retry can never charge twice

  var STATUS = {
    pending: ['Pending Approval', 'b-pending'], active: ['Active', 'b-active'], rejected: ['Rejected', 'b-rejected'],
    expired: ['Expired', 'b-ended'], suspended: ['Suspended', 'b-rejected'], removed: ['Removed', 'b-ended']
  };
  function sbadge(s) { var m = STATUS[s] || [s, '']; return '<span class="badge ' + m[1] + '">' + Z.esc(m[0]) + '</span>'; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').replace(/(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'); }

  PR.enabled = function () { return !(Z.state.settings && Z.state.settings.promotions_enabled === false); };

  PR.homeCard = function (live) {
    if (!PR.enabled()) return '';
    var n = Number(live) || 0;   // promotions live right now (comes with the summary, no extra request)
    return '<div class="card"><button class="row row-btn" data-go="/promotions"><span class="row-ic acc">' + Z.icon('megaphone') + '</span>' +
      '<span class="row-main"><span class="row-title">Promotions' + (n > 0 ? ' <span class="badge b-valid">' + n + ' live</span>' : '') + '</span>' +
      '<span class="row-sub">' + (n > 0 ? 'Discover channels or promote your own' : 'Be the first to promote your channel or account') + '</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>';
  };

  /* ---------- Logos ----------
     The admin's service logo is always drawn first. The real logo of the promoted channel/account (looked up from the
     link the user attached, through unavatar.io) is layered on top and fades in only once it has loaded.
     While it loads, or if there is none, the service logo stays visible. */
  var SAFE = /^[A-Za-z0-9._\-]{1,100}$/;
  PR.realLogoUrl = function (link) {
    var u;
    try { u = new URL(link); } catch (e) { return ''; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    var host = u.hostname.toLowerCase().replace(/^(www|m|mobile|web)\./, '');
    var seg = u.pathname.split('/').filter(Boolean).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } });
    var key = '', base = 'https://unavatar.io/';
    function bad(a, list) { return list.indexOf((a || '').toLowerCase()) !== -1; }
    if (host === 'youtube.com') {
      if (seg[0] && seg[0].charAt(0) === '@') key = 'youtube/' + seg[0].slice(1);
      else if (seg[0] === 'channel' && seg[1]) key = 'youtube/' + seg[1];
      else if ((seg[0] === 'c' || seg[0] === 'user') && seg[1]) key = 'youtube/' + seg[1];
    } else if (host === 'instagram.com') {
      if (seg[0] && !bad(seg[0], ['p', 'reel', 'reels', 'stories', 'explore', 'tv', 'accounts', 'direct'])) key = 'instagram/' + seg[0];
    } else if (host === 'tiktok.com') {
      if (seg[0] && seg[0].charAt(0) === '@') key = 'tiktok/' + seg[0].slice(1);
    } else if (host === 'x.com' || host === 'twitter.com') {
      if (seg[0] && !bad(seg[0], ['i', 'home', 'intent', 'share', 'search', 'hashtag', 'explore', 'messages', 'settings'])) key = 'x/' + seg[0];
    } else if (host === 'facebook.com' || host === 'fb.com') {
      if (seg[0] === 'profile.php') key = 'facebook/' + (u.searchParams.get('id') || '');
      else if (seg[0] === 'pages' && seg.length >= 3) key = 'facebook/' + seg[seg.length - 1];
      else if (seg[0] && !bad(seg[0], ['groups', 'share', 'sharer', 'watch', 'events', 'story.php', 'photo', 'photos', 'reel', 'permalink.php', 'people', 'p'])) key = 'facebook/' + seg[0];
    } else if (host === 'chat.whatsapp.com') {
      if (seg[0]) key = 'whatsapp/chat:' + seg[0];
    } else if (host === 'whatsapp.com') {
      if (seg[0] === 'channel' && seg[1]) key = 'whatsapp/channel:' + seg[1];
    }
    var id = key.split('/')[1] || '';
    id = id.replace(/^(chat|channel):/, '');
    if (!key || !SAFE.test(id)) return '';
    return base + key.replace(/^([a-z]+)\/(.*)$/, function (m, a, b) { return a + '/' + b.split(':').map(encodeURIComponent).join(':'); }) + '?fallback=false';
  };

  PR.logo = function (p) {
    var real = PR.realLogoUrl(p.link);
    return '<span class="plan-logo promo-logo">' + Z.icon('layout') +
      (p.logo_path ? '<img src="' + Z.esc(Z.plans.url(p.logo_path)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
      (real ? '<img class="real" src="' + Z.esc(real) + '" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onload="this.classList.add(\'ok\')" onerror="this.remove()">' : '') +
      '</span>';
  };

  // same arithmetic as the database (display only)
  function calc(svc, days, pos, D) {
    var dur = r2(days * Number(svc.price_per_day)), pp = 0, steps = 0;
    for (var j = pos; j <= D - 1; j++) {
      var rule = (svc.rules || []).filter(function (r) { return j >= r.from && j <= r.to; })[0];
      pp += rule ? Number(rule.price) : Number(svc.step_price); steps++;
    }
    return { dur: dur, pp: r2(pp), steps: steps, total: r2(dur + pp) };
  }

  function card(p) {
    return '<div class="card promo-card" data-pid="' + Z.esc(p.id) + '"><div class="plan-top">' + PR.logo(p) +
      '<div class="plan-name"><b>' + Z.esc(p.title) + '</b><span><i class="pop">' + Z.esc(p.service_name) + '</i> \u00b7 ' + Z.esc(p.category) + '</span></div>' +
      '<span class="pos-badge">#' + p.position + '</span></div>' +
      '<p class="plan-desc">' + Z.esc(p.description) + '</p>' +
      '<a class="btn btn-primary btn-block" data-pclick="' + Z.esc(p.id) + '" href="' + Z.esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow">' + Z.esc(p.action_label) + '</a></div>';
  }

  function mine(p) {
    var live = p.status === 'active';
    return '<div class="card promo-card"><div class="plan-top">' + PR.logo(p) +
      '<div class="plan-name"><b>' + Z.esc(p.title) + '</b><span>' + Z.esc(p.service_name) + ' \u00b7 ' + Z.esc(p.category) + '</span></div>' + sbadge(p.status) + '</div>' +
      '<p class="plan-desc">' + Z.esc(p.description) + '</p>' +
      (p.status === 'rejected' && p.reject_reason ? '<div class="alert a-error">' + Z.icon('info') + '<div><b>Rejected:</b> ' + Z.esc(p.reject_reason) + '<br><small>Your payment was returned to your Main Wallet.</small></div></div>' : '') +
      (p.status === 'pending' ? '<div class="alert a-info">' + Z.icon('clock') + '<div>Waiting for approval. The promotion time starts when it is approved.</div></div>' : '') +
      '<div class="summary"><div class="kv"><span>Link</span><b><a class="link" href="' + Z.esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow">Open link</a></b></div>' +
      '<div class="kv"><span>Duration</span><b>' + p.days + ' day' + (p.days === 1 ? '' : 's') + '</b></div>' +
      '<div class="kv"><span>Position</span><b>' + (live && p.position ? '#' + p.position + ' (live)' : '#' + p.requested_pos + ' requested') + '</b></div>' +
      '<div class="kv"><span>Total paid</span><b>' + Z.money(p.total_price) + '</b></div>' +
      '<div class="kv"><span>Requested</span><b>' + Z.fmtDate(p.created_at) + '</b></div>' +
      '<div class="kv"><span>' + (p.status === 'expired' ? 'Expired' : 'Expires') + '</span><b>' + (p.expires_at ? Z.fmtDate(p.expires_at) : 'After approval') + '</b></div></div>' +
      (live || p.status === 'expired' ?
        '<div class="pa-mini"><div><b>' + Number(p.views || 0) + '</b><span>Views</span></div><div><b>' + Number(p.clicks || 0) + '</b><span>Clicks</span></div></div>' +
        '<button class="btn btn-tonal btn-block" data-pa="' + Z.esc(p.id) + '">' + Z.icon('layout') + (live ? 'Live analytics' : 'View results') + '</button>' : '') +
      '</div>';
  }


  /* ---------------- Tracking: what members really see and tap ----------------
     A view is counted when a card has been at least half on screen for under a second AND the tab is visible.
     A click is counted when the action button is tapped. The database decides what counts (once per member per day for
     views, 3 clicks per member per day, never the owner or the admin). Tracking can never break the page. */
  var queued = {}, sentViews = {}, flushTimer = null, dwell = {}, io = null;
  function flushViews() {
    var ids = Object.keys(queued).slice(0, 50); queued = {}; flushTimer = null;
    if (!ids.length) return;
    ids.forEach(function (id) { sentViews[id] = 1; });
    sb.rpc('promo_track_views', { p_ids: ids }).then(function (r) { if (r && r.error) ids.forEach(function (id) { delete sentViews[id]; }); }, function () { ids.forEach(function (id) { delete sentViews[id]; }); });
  }
  function enqueueView(id) {
    if (sentViews[id] || queued[id]) return;
    queued[id] = 1;
    if (!flushTimer) flushTimer = setTimeout(flushViews, 1500);
  }
  function trackClick(id) { try { sb.rpc('promo_track_click', { p_id: id }).then(function () {}, function () {}); } catch (e) { /* never block the link */ } }
  function observeCards(root) {
    Object.keys(dwell).forEach(function (k) { clearTimeout(dwell[k]); delete dwell[k]; });
    if (io) { io.disconnect(); io = null; }
    if (!('IntersectionObserver' in window)) return;      // no way to know what is on screen = no counting, never a guess
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var id = en.target.getAttribute('data-pid');
        if (en.isIntersecting && en.intersectionRatio >= 0.5) {
          if (!dwell[id]) dwell[id] = setTimeout(function () { delete dwell[id]; if (document.visibilityState === 'visible') enqueueView(id); }, 700);
        } else if (dwell[id]) { clearTimeout(dwell[id]); delete dwell[id]; }
      });
    }, { threshold: [0, 0.5] });
    Array.prototype.forEach.call(root.querySelectorAll('[data-pid]'), function (el) { io.observe(el); });
  }

  /* ---------------- Live analytics (owner) ---------------- */
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function plural(n, w) { return n + ' ' + w + (Number(n) === 1 ? '' : 's'); }
  function leftText(ms) {
    if (ms <= 0) return 'ended';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return (d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + (m % 60) + 'm' : Math.max(1, m) + 'm') + ' left';
  }
  function agoText(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago';
  }
  function series(d, tab) {
    if (tab === 'hours') {
      return d.hours.map(function (h, i) {
        var dt = new Date(h.t);
        var lab = i === d.hours.length - 1 ? 'Now' : (i % 4 === 0 ? dt.toLocaleTimeString([], { hour: 'numeric' }).replace(' ', '') : '');
        return { label: lab, tip: (i === d.hours.length - 1 ? 'This hour' : dt.toLocaleTimeString([], { hour: 'numeric' })), views: Number(h.views), clicks: Number(h.clicks) };
      });
    }
    return d.days.map(function (x, i) {
      var q = String(x.day).split('-').map(Number), w = new Date(Date.UTC(q[0], q[1] - 1, q[2])).getUTCDay();
      return { label: i === d.days.length - 1 ? 'Today' : DOW[w], tip: (i === d.days.length - 1 ? 'Today' : DOW[w] + ', ' + MON[q[1] - 1] + ' ' + q[2]), views: Number(x.views), clicks: Number(x.clicks) };
    });
  }
  function tipText(s) { return s.tip + ' \u00b7 ' + plural(s.views, 'view') + ' \u00b7 ' + plural(s.clicks, 'click'); }

  function openAnalytics(promo) {
    var data = null, tab = 'hours', sel = null, timer = null, skew = 0, drawn = false;
    var sheet = Z.sheet('<h2 class="sheet-title">Promotion analytics</h2><p class="muted small pa-sub">' + Z.esc(promo.title) + '</p><div id="pa-body">' + Z.skel(3, 70) + '</div>' +
      '<button class="btn btn-ghost btn-block" data-close>Close</button>', { onClose: function () { clearInterval(timer); } });
    var body = Z.$('#pa-body', sheet.el);

    function render() {
      var d = data, live = d.status === 'active', t = d.totals, td = d.today;
      var now = Date.now() + skew, last = Math.max(t.last_view_at ? Date.parse(t.last_view_at) : 0, t.last_click_at ? Date.parse(t.last_click_at) : 0);
      var uv = Number(t.unique_viewers), uc = Number(t.unique_clickers), rate = uv > 0 ? Math.min(100, Math.round(uc / uv * 100)) : null;
      var k = function (label, v, key) { return '<div class="pa-k"><b data-count="' + Number(v) + '" data-kind="int" data-ck="pa-' + promo.id + '-' + key + '">' + Number(v) + '</b><span>' + label + '</span></div>'; };
      var sr = series(d, tab); if (sel === null || sel >= sr.length) sel = sr.length - 1;
      var max = sr.reduce(function (a, s) { return Math.max(a, s.views, s.clicks); }, 0);
      var h = function (n) { return n > 0 ? Math.max(8, Math.round(n / max * 100)) : 0; };
      var chart = Number(t.views) === 0 ?
        Z.empty({ icon: 'megaphone', title: 'No views yet', text: live ? 'Your promotion is live. Views and clicks appear here the moment members see or tap it.' : 'This promotion did not get any views.' }) :
        Z.chips([['hours', 'Last 24 hours'], ['days', 'Last 7 days']], tab, 'data-pt') +
        '<div class="pa-chart' + (drawn ? ' still' : '') + '" data-pa-cols style="--n:' + sr.length + '">' + sr.map(function (s, i) {
          return '<button type="button" class="pa-col' + (i === sel ? ' on' : '') + '" data-i="' + i + '" aria-pressed="' + (i === sel) + '" aria-label="' + Z.esc(tipText(s)) + '">' +
            '<span class="pa-bars"><i class="v' + (s.views ? '' : ' zero') + '" style="--h:' + h(s.views) + '%"></i><i class="c' + (s.clicks ? '' : ' zero') + '" style="--h:' + h(s.clicks) + '%"></i></span><em>' + s.label + '</em></button>';
        }).join('') + '</div>' +
        '<div class="pa-tip" data-pa-tip aria-live="polite">' + Z.esc(tipText(sr[sel])) + '</div>' +
        '<div class="pa-leg"><span><i class="v"></i>Views</span><span><i class="c"></i>Clicks</span></div>';
      body.innerHTML =
        (live ? '<div class="pa-live"><span class="online-dot" data-s="live"></span><span>Live \u00b7 refreshes every 15 s</span><em>' + (last ? 'Last activity ' + agoText(now - last) : 'No activity yet') + '</em></div>'
              : '<div class="pa-live pa-done"><span>Final results</span><em>Ended ' + Z.esc(Z.fmtDate(d.expires_at)) + '</em></div>') +
        '<div class="pa-kpis">' + k('Views today', td.views, 'tv') + k('Clicks today', td.clicks, 'tc') + k('Members who saw it', uv, 'uv') +
          '<div class="pa-k"><b>' + (rate === null ? '\u2014' : rate + '%') + '</b><span>Click rate</span></div></div>' +
        (live && d.position ? '<div class="pa-pos">' + Z.icon('trophy') + '<span>Position <b>#' + d.position + '</b> of ' + d.live_total + ' live \u00b7 ' + leftText(Date.parse(d.expires_at) - now) + '</span></div>' : '') +
        '<div class="card pa-card">' + chart + '</div>' +
        '<div class="summary"><div class="kv"><span>Total views</span><b>' + Number(t.views) + '</b></div><div class="kv"><span>Total clicks</span><b>' + Number(t.clicks) + '</b></div>' +
          '<div class="kv"><span>Members who clicked</span><b>' + uc + '</b></div></div>' +
        '<p class="hint">A view counts once per member per day, when your promotion was on their screen. Up to 3 clicks per member per day count. Your own visits and the admin\u2019s are never counted. Only numbers are shown, never who.</p>';
      drawn = true;
      Z.countUp(body);
    }
    async function load() {
      var r = await sb.rpc('promo_analytics', { p_id: promo.id });
      if (!sheet.el.isConnected) return;
      if (r.error) {
        if (!data) { body.innerHTML = Z.errorState(); var rt = Z.$('[data-retry]', body); if (rt) rt.addEventListener('click', function () { body.innerHTML = Z.skel(3, 70); load(); }); }
        return;                                       // a failed refresh keeps showing the last real numbers
      }
      data = r.data; skew = Date.parse(data.now) - Date.now();
      render();
      if (data.status !== 'active') clearInterval(timer);
    }
    body.addEventListener('click', function (e) {
      var tb = e.target.closest('[data-pt]');
      if (tb) { tab = tb.getAttribute('data-pt'); sel = null; drawn = false; if (data) render(); return; }
      var c = e.target.closest('.pa-col');
      if (c && data) {
        sel = Number(c.getAttribute('data-i'));
        Array.prototype.forEach.call(body.querySelectorAll('.pa-col'), function (x) { var on = x === c; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        var tip = body.querySelector('[data-pa-tip]'); if (tip) tip.textContent = tipText(series(data, tab)[sel]);
      }
    });
    timer = setInterval(function () { if (!document.hidden && sheet.el.isConnected && data && data.status === 'active') load(); }, 15000);
    load();
  }

  /* Browse tab: approved promotions only, with a search bar and service / category filters. */
  Z.views.browse = async function (el, ctx) {
    await Z.refreshSettings();
    if (ctx.stale()) return;
    if (!PR.enabled()) { el.innerHTML = '<section class="page">' + Z.empty({ icon: 'search', title: 'Browse is not available', text: 'Check back soon.' }) + '</section>'; return; }
    var cr = await sb.rpc('promo_catalog');
    if (ctx.stale()) return;
    if (cr.error) throw cr.error;
    var cat = cr.data, q = '', svc = '', catg = '', items = [], done = false, loading = false, seq = 0;

    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>Browse</h2><p class="sub">Discover channels and accounts.</p></div></div>' +
      '<div class="search">' + Z.icon('search') + '<input class="input" id="psq" type="search" placeholder="Search channels and accounts" autocomplete="off"></div>' +
      '<div class="two">' + Z.field({ id: 'psv', label: 'Service', type: 'select', value: '', options: [['', 'All services']].concat(cat.services.map(function (s) { return [s.id, s.name]; })) }) +
      Z.field({ id: 'pct', label: 'Category', type: 'select', value: '', options: [['', 'All categories']].concat(cat.categories.map(function (c) { return [c, c]; })) }) + '</div>' +
      '<div id="plist"></div><div id="pmore"></div>' +
      '<p class="muted small center">Profile pictures by <a class="link" href="https://unavatar.io" target="_blank" rel="noopener noreferrer">unavatar.io</a></p></section>';
    var list = Z.$('#plist', el), more = Z.$('#pmore', el);

    async function load(reset) {
      if (loading && !reset) return;
      var my = ++seq; loading = true;   // a newer search/filter makes older responses obsolete
      if (reset) { items = []; done = false; list.innerHTML = Z.skel(3, 150); more.innerHTML = ''; }
      var r = await sb.rpc('list_promotions', { p_search: q || null, p_service: svc || null, p_category: catg || null, p_limit: 30, p_offset: items.length });
      if (my !== seq) return;
      loading = false;
      if (ctx.stale()) return;
      if (r.error) { list.innerHTML = Z.errorState(); Z.$('[data-retry]', list).addEventListener('click', function () { load(true); }); return; }
      items = items.concat(r.data || []); done = (r.data || []).length < 30;
      list.innerHTML = items.length ? items.map(card).join('') : '<div class="card">' + Z.empty({ icon: 'search', title: 'No promotions found', text: q || svc || catg ? 'Try a different search or filter.' : 'Nothing to browse yet. Check back soon.' }) + '</div>';
      more.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="pmb">Load more</button>';
      var b = Z.$('#pmb', more); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
      observeCards(list);
    }

    list.addEventListener('click', function (e) { var a = e.target.closest('[data-pclick]'); if (a) trackClick(a.getAttribute('data-pclick')); });
    Z.$('#psq', el).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim(); load(true); }, 300));
    Z.$('#psv', el).addEventListener('change', function (e) { svc = e.target.value; load(true); });
    Z.$('#pct', el).addEventListener('change', function (e) { catg = e.target.value; load(true); });
    load(true);
  };

  /* Promotions page (reached from Home): promote your own channel and see your requests. */
  Z.views.promotions = async function (el, ctx) {
    await Z.refreshSettings();
    if (ctx.stale()) return;
    if (!PR.enabled()) { el.innerHTML = '<section class="page">' + Z.empty({ icon: 'megaphone', title: 'Promotions are not available', text: 'Check back soon.' }) + '</section>'; return; }
    var cr = await sb.rpc('promo_catalog');
    if (ctx.stale()) return;
    if (cr.error) throw cr.error;
    var cat = cr.data;

    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>My Promotions</h2><p class="sub">Promote your channel or account and track your requests. To discover others, open Browse.</p></div></div>' +
      '<button class="btn btn-primary btn-block" id="promote">' + Z.icon('megaphone') + 'Promote my channel</button>' +
      '<div id="pbody"></div></section>';
    var body = Z.$('#pbody', el), mineList = [];
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pa]');
      if (!b) return;
      var id = b.getAttribute('data-pa'), pr = mineList.filter(function (x) { return x.id === id; })[0];
      if (pr) openAnalytics(pr);
    });

    async function showMine() {
      body.innerHTML = Z.skel(2, 220);
      var r = await sb.rpc('my_promotions');
      if (ctx.stale()) return;
      if (r.error) { body.innerHTML = Z.errorState(); Z.$('[data-retry]', body).addEventListener('click', showMine); return; }
      mineList = r.data || [];
      body.innerHTML = (r.data || []).length ? r.data.map(mine).join('') : '<div class="card">' + Z.empty({ icon: 'megaphone', title: 'No promotions yet', text: 'Promote your channel or account to reach more people.' }) + '</div>';
    }

    Z.$('#promote', el).addEventListener('click', function () { createSheet(cat, showMine); });
    showMine();
  };

  /* ---------------- Create a promotion ---------------- */
  async function createSheet(cat, onDone) {
    if (!cat.services.length) return Z.toast('No promotion services are available right now.');
    var sum = await Z.loadSummary().catch(function () { return null; });
    var balance = sum ? Number(sum.balance) : 0, D = cat.default_position;
    var sheet = Z.sheet('<h2 class="sheet-title">Promote my channel</h2><form id="cf" novalidate>' +
      Z.field({ id: 'sv', label: 'Service', type: 'select', value: cat.services[0].id, options: cat.services.map(function (s) { return [s.id, s.name + ' \u00b7 ' + Z.money(s.price_per_day) + '/day']; }) }) +
      Z.field({ id: 'lk', label: 'Channel / account link', type: 'url', placeholder: 'https://', attrs: 'inputmode="url" autocapitalize="off" maxlength="500"', hint: '<span id="lk-h"></span>' }) +
      Z.field({ id: 'ti', label: 'Channel / account name', attrs: 'maxlength="60"' }) +
      Z.field({ id: 'ct', label: 'Category', placeholder: 'Select or write, e.g. Education', attrs: 'maxlength="30" list="cat-list"' }) +
      '<datalist id="cat-list">' + ['Education', 'Entertainment', 'News', 'Gaming', 'Business', 'Tech', 'Lifestyle', 'Music', 'Religion', 'Sports'].concat(cat.categories).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (c) { return '<option value="' + Z.esc(c) + '">'; }).join('') + '</datalist>' +
      Z.field({ id: 'ds', label: 'Short description', type: 'textarea', rows: 3, attrs: 'maxlength="300"' }) +
      Z.field({ id: 'dy', label: 'Duration (days)', value: '', attrs: 'inputmode="numeric"', hint: '<span id="dy-h"></span>' }) +
      Z.field({ id: 'ps', label: 'Display position', type: 'select', value: D, options: [[D, '#' + D]] , hint: 'Position #' + D + ' is the normal price. A lower number shows higher and costs extra.' }) +
      '<div class="summary" id="pbox"></div><div id="cferr"></div>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Review and pay</button><button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sheet.el;

    function svcNow() { return cat.services.filter(function (s) { return s.id === Z.$('#sv', el).value; })[0]; }
    function rebuildPositions(keep) {
      var s = svcNow(), days = parseInt(Z.$('#dy', el).value, 10) || s.min_days, opts = [], lo = Math.max(1, D - 119);
      for (var k = D; k >= lo; k--) {
        var c = calc(s, days, k, D);
        opts.push('<option value="' + k + '"' + (String(keep) === String(k) ? ' selected' : '') + '>#' + k + (k === D ? ' (normal price)' : ' (+' + Z.money(c.pp) + ')') + '</option>');
      }
      Z.$('#ps', el).innerHTML = opts.join('');
    }
    function onService() {
      var s = svcNow();
      Z.$('#dy-h', el).textContent = 'Allowed: ' + s.min_days + ' to ' + s.max_days + ' days';
      Z.$('#lk-h', el).textContent = s.allowed_domains ? 'Must be a ' + s.allowed_domains.replace(/,\s*/g, ' / ') + ' link.' : 'Enter the public link of your channel or account.';
      var d = parseInt(Z.$('#dy', el).value, 10);
      if (!d) Z.$('#dy', el).value = s.min_days; else if (d < s.min_days) Z.$('#dy', el).value = s.min_days; else if (d > s.max_days) Z.$('#dy', el).value = s.max_days;
      rebuildPositions(Z.$('#ps', el).value || D);
      paint();
    }
    function state() {
      var s = svcNow(), days = parseInt(Z.$('#dy', el).value, 10), pos = parseInt(Z.$('#ps', el).value, 10) || D;
      var ok = isFinite(days) && days >= s.min_days && days <= s.max_days;
      return { s: s, days: days, pos: pos, ok: ok, c: ok ? calc(s, days, pos, D) : null };
    }
    function paint() {
      var x = state();
      Z.$('#pbox', el).innerHTML = x.ok
        ? '<div class="kv"><span>' + x.days + ' day' + (x.days === 1 ? '' : 's') + ' \u00d7 ' + Z.money(x.s.price_per_day) + '</span><b>' + Z.money(x.c.dur) + '</b></div>' +
          '<div class="kv"><span>Position #' + x.pos + (x.c.steps ? ' (' + x.c.steps + ' step' + (x.c.steps === 1 ? '' : 's') + ' up)' : ' (normal)') + '</span><b>' + Z.money(x.c.pp) + '</b></div>' +
          '<div class="kv total"><span>Total</span><b>' + Z.money(x.c.total) + '</b></div>' +
          '<div class="kv"><span>Main Wallet balance</span><b style="color:' + (balance >= x.c.total ? 'inherit' : 'var(--neg)') + '">' + Z.money(balance) + '</b></div>'
        : '<div class="kv"><span class="muted">Enter a duration between ' + x.s.min_days + ' and ' + x.s.max_days + ' days to see the price.</span></div>';
    }
    Z.$('#sv', el).addEventListener('change', onService);
    Z.$('#dy', el).addEventListener('input', function () { rebuildPositions(Z.$('#ps', el).value); paint(); });
    Z.$('#ps', el).addEventListener('change', paint);
    onService();

    Z.$('#cf', el).addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = Z.$('#cferr', el), x = state(), btn = Z.$('button[type=submit]', el);
      var v = { link: Z.$('#lk', el).value.trim(), title: Z.$('#ti', el).value.trim(), category: Z.$('#ct', el).value.trim(), description: Z.$('#ds', el).value.trim() };
      if (!/^https?:\/\/\S+$/i.test(v.link)) return Z.formError(err, 'Enter a valid link starting with https://');
      if (!v.title) return Z.formError(err, 'Enter the channel or account name.');
      if (!v.category) return Z.formError(err, 'Enter or choose a category.');
      if (!v.description) return Z.formError(err, 'Write a short description.');
      if (!x.ok) return Z.formError(err, 'Choose a duration from ' + x.s.min_days + ' to ' + x.s.max_days + ' days.');
      Z.formError(err, '');
      Z.run(btn, async function () {
        var qr = await sb.rpc('promo_quote', { p_service: x.s.id, p_days: x.days, p_position: x.pos });   // the server's price is the one that counts
        if (qr.error) throw qr.error;
        var total = Number(qr.data.total);
        if (Math.abs(total - x.c.total) > 0.005 || Number(qr.data.position) !== x.pos) {
          Z.toast('Prices or positions changed. Please review and try again.', 'error');
          var fresh = await sb.rpc('promo_catalog'); if (!fresh.error) { cat = fresh.data; D = cat.default_position; sheet.close(); return createSheet(cat, onDone); }
          return;
        }
        if (balance < total) throw { message: 'insufficient_balance' };
        var ok = await Z.confirm({
          title: 'Pay ' + Z.money(total) + ' for this promotion?',
          html: '<div class="summary"><div class="kv"><span>Service</span><b>' + Z.esc(x.s.name) + '</b></div><div class="kv"><span>Duration</span><b>' + x.days + ' days</b></div>' +
            '<div class="kv"><span>Position</span><b>#' + x.pos + '</b></div><div class="kv total"><span>Total</span><b>' + Z.money(total) + '</b></div></div>' +
            '<p class="muted small">The amount is taken from your Main Wallet now. The promotion goes live after approval, and your time starts then. If it is rejected, the full amount is returned.</p>',
          confirm: 'Pay ' + Z.money(total)
        });
        if (!ok) return;
        var key = [x.s.id, v.link, v.title, v.category, v.description, x.days, x.pos].join('|');
        if (!reqId || key !== reqKey) { reqId = uuid(); reqKey = key; }
        var r = await sb.rpc('submit_promotion', { p_request_id: reqId, p_service: x.s.id, p_title: v.title, p_link: v.link, p_category: v.category,
          p_description: v.description, p_days: x.days, p_position: x.pos, p_expected_total: total });
        if (r.error) throw r.error;
        reqId = null; reqKey = '';
        Z.invalidateSummary(); Z.refreshUnread && Z.refreshUnread(true);
        sheet.close();
        Z.toast('Promotion request submitted', 'ok');
        onDone();
      }, err);
    });
  }
})();
