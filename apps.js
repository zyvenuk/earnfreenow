/* Premium Apps (user side): Store and My Apps.
   Everything that matters is decided by the database: the price, the wallet deduction, the access time and the download link.
   The browser only shows it. The link never reaches the page until get_app_download confirms that access is running. */
(function () {
  'use strict';
  var Z = window.Z;
  var AP = Z.apps = { offset: 0 };
  var reqIds = {};   // one request id per app while a purchase is unfinished: a retry can never charge twice
  var PKT = 'Asia/Karachi';

  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').replace(/(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'); }
  function now() { return Date.now() + AP.offset; }
  function syncClock(data) { if (data && data.server_now) AP.offset = new Date(data.server_now).getTime() - Date.now(); }

  /* Dates are stored as exact moments and always shown in Pakistan time. */
  AP.fmt = function (iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { timeZone: PKT, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' PKT';
  };
  AP.duration = function (v, unit) {
    var one = { hours: 'hour', days: 'day', months: 'month' }[unit] || unit;
    return v + ' ' + one + (v === 1 ? '' : 's');
  };
  function left(iso) {
    var ms = new Date(iso).getTime() - now();
    if (ms <= 0) return '';
    var s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d >= 1) return d + (d === 1 ? ' day ' : ' days ') + h + (h === 1 ? ' hour' : ' hours') + ' left';
    if (h >= 1) return h + (h === 1 ? ' hour ' : ' hours ') + m + ' min left';
    return m + ' min ' + (s % 60) + ' sec left';
  }
  function icon(path, name) {
    return '<span class="app-ic"><b>' + Z.esc(String(name || '?').trim().charAt(0).toUpperCase()) + '</b>' +
      (path ? '<img src="' + Z.esc(Z.plans.url(path)) + '" alt="" loading="lazy" decoding="async" onerror="this.remove()">' : '') + '</span>';
  }

  AP.homeCard = function () {
    if (!Z.appsVisible()) return '';
    return '<div class="card"><button class="row row-btn" data-go="/apps"><span class="row-ic acc">' + Z.icon('download') + '</span>' +
      '<span class="row-main"><span class="row-title">Premium Apps</span><span class="row-sub">Buy apps with your Main Wallet</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>';
  };

  function tabs(active, count) {
    return '<div class="seg"><button class="seg-btn' + (active === 'store' ? ' on' : '') + '" data-go="/apps">Store</button>' +
      '<button class="seg-btn' + (active === 'mine' ? ' on' : '') + '" data-go="/myapps">My Apps' + (count ? ' (' + count + ')' : '') + '</button></div>';
  }

  /* A countdown that keeps itself honest: ticks every second near the end, every 20 s otherwise, and stops when the screen is left. */
  function keepTime(fn, soonest) {
    var t = null, dead = false;
    function loop() {
      if (dead) return;
      var next = soonest();
      t = setTimeout(function () { fn(); loop(); }, next !== null && next < 3600000 ? 1000 : 20000);
    }
    loop();
    (Z.leaveHooks = Z.leaveHooks || []).push(function () { dead = true; clearTimeout(t); });
  }

  /* ---------------- Download (checked by the database on every tap) ---------------- */
  async function download(appId, btn, afterDenied) {
    var win = null;
    try { win = window.open('', '_blank'); } catch (e) { win = null; }   // opened now, on the tap, so the phone does not block it
    Z.busy(btn, true);
    try {
      var r = await sb.rpc('get_app_download', { p_app_id: appId });
      if (r.error) throw r.error;
      var url = r.data && r.data.url;
      if (!/^https:\/\//i.test(url || '')) throw { message: 'no_access' };
      if (win) { try { win.opener = null; } catch (e) { /* ignore */ } win.location.href = url; }
      else window.open(url, '_blank', 'noopener,noreferrer') || Z.sheet('<h2 class="sheet-title">Your download is ready</h2><p class="sheet-text">Your browser blocked the new tab. Open the link yourself:</p><div class="sheet-actions"><a class="btn btn-primary btn-block" href="' + Z.esc(url) + '" target="_blank" rel="noopener noreferrer">Open download</a><button class="btn btn-ghost btn-block" data-close>Close</button></div>');
    } catch (e) {
      if (win) { try { win.close(); } catch (x) { /* ignore */ } }
      Z.toast(Z.errMsg(e), 'error');
      if (e && e.message === 'no_access' && afterDenied) afterDenied();   // access ended: refresh so the button disappears
    } finally { Z.busy(btn, false); }
  }

  /* ---------------- Store ---------------- */
  Z.views.apps = async function (el, ctx) {
    var res = await Promise.all([sb.rpc('list_store_apps'), sb.rpc('my_apps'), Z.loadSummary(true).catch(function () { return null; })]);
    if (ctx.stale()) return;
    if (res[0].error) throw res[0].error;
    syncClock(res[0].data);
    var items = res[0].data.items || [], sum = res[2];
    var activeMine = res[1].error ? 0 : (res[1].data.items || []).filter(function (p) { return p.status === 'active'; }).length;

    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>Premium Apps</h2><p class="sub">Pay from your Main Wallet and download right away.</p></div></div>' +
      tabs('store', activeMine) +
      (sum ? '<div class="card app-wallet"><span>Main Wallet</span><b id="aw">' + Z.moneyHtml(sum.balance) + '</b></div>' : '') +
      '<div id="alist"></div></section>';
    var list = Z.$('#alist', el);

    function card(a) {
      var owned = a.owned_until && new Date(a.owned_until).getTime() > now();
      return '<div class="card app-card" data-id="' + a.id + '"><div class="app-top">' + icon(a.icon_path, a.name) +
        '<div class="app-name"><b>' + Z.esc(a.name) + '</b><span class="app-sub">' + Z.esc(AP.duration(a.duration_value, a.duration_unit)) + ' access</span></div>' +
        (owned ? '<span class="badge b-active">Owned</span>' : '') + '</div>' +
        (a.description ? '<p class="app-desc">' + Z.esc(a.description) + '</p>' : '') +
        '<div class="app-foot"><div class="app-price"><b>' + Z.moneyHtml(a.price) + '</b><span>for ' + Z.esc(AP.duration(a.duration_value, a.duration_unit)) + '</span></div>' +
        (owned
          ? '<button class="btn btn-primary" data-dl="' + a.id + '">' + Z.icon('download') + 'Download</button>'
          : '<button class="btn btn-primary" data-buy="' + a.id + '">Buy now</button>') + '</div>' +
        (owned ? '<div class="app-note" data-exp="' + Z.esc(a.owned_until) + '"></div>' : '') + '</div>';
    }
    function paint() {
      list.innerHTML = items.length ? items.map(card).join('') :
        '<div class="card">' + Z.empty({ icon: 'download', title: 'No apps yet', text: 'Premium apps will appear here as soon as they are added.' }) + '</div>';
      stamp();
    }
    function stamp() {
      Z.$$('[data-exp]', list).forEach(function (n) { var l = left(n.getAttribute('data-exp')); n.textContent = l ? 'Access ' + l + ' · until ' + AP.fmt(n.getAttribute('data-exp')) : ''; });
    }
    paint();
    keepTime(function () {
      var changed = items.some(function (a) { return a.owned_until && new Date(a.owned_until).getTime() <= now(); });
      if (changed) { items.forEach(function (a) { if (a.owned_until && new Date(a.owned_until).getTime() <= now()) a.owned_until = null; }); paint(); } else stamp();
    }, function () {
      var m = null; items.forEach(function (a) { if (a.owned_until) { var d = new Date(a.owned_until).getTime() - now(); if (m === null || d < m) m = d; } }); return m;
    });

    async function reload() {
      var r = await sb.rpc('list_store_apps');
      if (ctx.stale() || r.error) return;
      syncClock(r.data); items = r.data.items || []; paint();
      var s = await Z.loadSummary(true).catch(function () { return null; }), w = Z.$('#aw', el);
      if (s && w) w.innerHTML = Z.moneyHtml(s.balance);
    }

    list.addEventListener('click', function (e) {
      var b = e.target.closest('[data-buy]'), d = e.target.closest('[data-dl]');
      if (b) buy(items.filter(function (a) { return a.id === b.getAttribute('data-buy'); })[0], reload);
      if (d) download(d.getAttribute('data-dl'), d, reload);
    });
  };

  /* ---------------- Buy ---------------- */
  async function buy(a, reload) {
    if (!a) return;
    var sum;
    try { sum = await Z.loadSummary(true); } catch (e) { return Z.toast(Z.errMsg(e), 'error'); }   // fresh balance for the message; the database still decides
    var price = Number(a.price), balance = Number(sum.balance);
    var dur = AP.duration(a.duration_value, a.duration_unit);

    if (balance < price) {
      var low = Z.sheet('<div class="follow"><div class="sup-ic big" style="background:var(--warn-soft);color:var(--warn)">' + Z.icon('wallet') + '</div>' +
        '<h2>Not enough balance</h2><p>' + Z.esc(a.name) + ' costs <b>' + Z.money(price) + '</b>. Your Main Wallet has <b>' + Z.money(balance) + '</b>, so you need <b>' + Z.money(price - balance) + '</b> more.</p>' +
        '<button class="btn btn-primary btn-block" data-go="/watch" data-close>Watch ads to earn</button><button class="btn btn-ghost btn-block" data-close>Close</button></div>', { center: true });
      return low;
    }

    var sh = Z.sheet('<h2 class="sheet-title">Confirm purchase</h2>' +
      '<div class="app-top" style="margin-bottom:12px">' + icon(a.icon_path, a.name) + '<div class="app-name"><b>' + Z.esc(a.name) + '</b><span class="app-sub">' + Z.esc(dur) + ' access</span></div></div>' +
      '<div class="summary"><div class="kv"><span>App</span><b>' + Z.esc(a.name) + '</b></div><div class="kv"><span>Access</span><b>' + Z.esc(dur) + '</b></div>' +
      '<div class="kv"><span>Price</span><b>' + Z.moneyHtml(price) + '</b></div>' +
      '<div class="kv"><span>Main Wallet now</span><b>' + Z.moneyHtml(balance) + '</b></div>' +
      '<div class="kv total"><span>Balance after</span><b>' + Z.moneyHtml(balance - price) + '</b></div></div>' +
      '<p class="muted small">The price is taken from your Main Wallet now. Access starts at the moment of purchase and ends after ' + Z.esc(dur) + '.</p>' +
      '<div id="buyerr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" id="buyok">Pay ' + Z.moneyHtml(price) + '</button><button class="btn btn-ghost btn-block" data-close>Cancel</button></div>');
    var ok = Z.$('#buyok', sh.el), err = Z.$('#buyerr', sh.el);
    ok.addEventListener('click', function () {
      if (!reqIds[a.id]) reqIds[a.id] = uuid();           // kept until the purchase succeeds, so a retry is recognised by the database
      Z.run(ok, async function () {
        var r = await sb.rpc('buy_store_app', { p_request_id: reqIds[a.id], p_app_id: a.id, p_expected_price: price });
        if (r.error) {
          var m = r.error.message || '';
          if (m === 'price_changed' || m === 'app_unavailable' || m === 'already_owned' || m === 'insufficient_balance') delete reqIds[a.id];   // nothing was charged: a fresh attempt gets a fresh id
          if (m === 'price_changed' || m === 'app_unavailable' || m === 'already_owned') { sh.close(); reload(); }
          throw r.error;
        }
        delete reqIds[a.id];
        Z.invalidateSummary(); Z.refreshUnread && Z.refreshUnread(true);
        sh.close(); reload();
        Z.toast(a.name + ' purchased', 'ok');
        var done = Z.sheet('<div class="follow"><div class="sup-ic big" style="background:var(--pos-soft);color:var(--pos)">' + Z.icon('check') + '</div>' +
          '<h2>Purchase complete</h2><p><b>' + Z.esc(a.name) + '</b> is yours until<br><b>' + Z.esc(AP.fmt(r.data.expires_at)) + '</b></p>' +
          '<button class="btn btn-primary btn-block" id="dlnow">' + Z.icon('download') + 'Download now</button><button class="btn btn-ghost btn-block" data-close>Done</button></div>', { center: true });
        var dn = Z.$('#dlnow', done.el); dn.addEventListener('click', function () { download(a.id, dn, null); });
      }, err);
    });
  }

  /* ---------------- My Apps ---------------- */
  Z.views.myapps = async function (el, ctx) {
    var r = await sb.rpc('my_apps');
    if (ctx.stale()) return;
    if (r.error) throw r.error;
    syncClock(r.data);
    var items = r.data.items || [];

    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>My Apps</h2><p class="sub">Your purchases and how long each one stays open.</p></div></div>' +
      tabs('mine', items.filter(function (p) { return p.status === 'active'; }).length) + '<div id="mlist"></div></section>';
    var list = Z.$('#mlist', el);

    function live(p) { return new Date(p.expires_at).getTime() > now(); }
    function card(p) {
      var on = live(p);
      return '<div class="card app-card' + (on ? '' : ' ended') + '" data-id="' + p.id + '"><div class="app-top">' + icon(p.icon_path, p.name) +
        '<div class="app-name"><b>' + Z.esc(p.name) + '</b><span class="app-sub">' + Z.esc(AP.duration(p.duration_value, p.duration_unit)) + ' access</span></div>' +
        '<span class="badge ' + (on ? 'b-active' : 'b-ended') + '">' + (on ? 'Active' : 'Expired') + '</span></div>' +
        '<div class="summary"><div class="kv"><span>Purchased</span><b>' + Z.esc(AP.fmt(p.purchased_at)) + '</b></div>' +
        '<div class="kv"><span>Paid</span><b>' + Z.moneyHtml(p.price_paid) + '</b></div>' +
        '<div class="kv"><span>' + (on ? 'Access ends' : 'Access ended') + '</span><b>' + Z.esc(AP.fmt(p.expires_at)) + '</b></div>' +
        '<div class="kv"><span>Remaining</span><b class="' + (on ? 'pos' : 'muted') + '" data-left="' + Z.esc(p.expires_at) + '">' + (on ? Z.esc(left(p.expires_at)) : 'Expired') + '</b></div></div>' +
        (on && p.can_download ? '<button class="btn btn-primary btn-block" data-dl="' + p.app_id + '">' + Z.icon('download') + 'Download</button>'
          : on ? '<div class="alert a-info">' + Z.icon('info') + '<div>This app was removed from the store, so it can no longer be downloaded.</div></div>'
          : '<div class="alert a-warn">' + Z.icon('clock') + '<div>Access has ended. Buy the app again from the store to download it.</div></div><button class="btn btn-tonal btn-block" data-go="/apps">Open the store</button>') + '</div>';
    }
    function paint() {
      list.innerHTML = items.length ? items.map(card).join('') :
        '<div class="card">' + Z.empty({ icon: 'download', title: 'No purchased apps yet', text: 'Apps you buy will show up here with their remaining time.',
          action: '<button class="btn btn-primary" data-go="/apps">Browse Premium Apps</button>' }) + '</div>';
    }
    function stamp() { Z.$$('[data-left]', list).forEach(function (n) { var l = left(n.getAttribute('data-left')); if (l) n.textContent = l; }); }
    paint();
    keepTime(function () {
      // the moment an access ends, its card flips to "Expired" and the Download button disappears
      var flipped = items.some(function (p) { return p.status === 'active' && !live(p); });
      if (flipped) { items.forEach(function (p) { if (p.status === 'active' && !live(p)) { p.status = 'expired'; p.can_download = false; } }); paint(); } else stamp();
    }, function () {
      var m = null; items.forEach(function (p) { if (live(p)) { var d = new Date(p.expires_at).getTime() - now(); if (m === null || d < m) m = d; } }); return m;
    });

    async function reload() {
      var x = await sb.rpc('my_apps');
      if (ctx.stale() || x.error) return;
      syncClock(x.data); items = x.data.items || []; paint();
    }
    list.addEventListener('click', function (e) {
      var d = e.target.closest('[data-dl]');
      if (d) download(d.getAttribute('data-dl'), d, reload);   // the database re-checks ownership and expiry on every tap
    });
  };
})();
