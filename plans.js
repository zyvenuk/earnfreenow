/* Plans (user side). Every number shown here comes from the database; the browser never decides a price,
   a limit or a reward. Countdowns use the server clock (offset) instead of the phone's clock. */
(function () {
  'use strict';
  var Z = window.Z;
  var P = Z.plans = { offset: 0, cache: null, at: 0 };
  var reqIds = {};   // one request id per plan while a purchase is unfinished: a retry can never charge twice

  P.enabled = function () { return !!(Z.state.settings && Z.state.settings.plans_enabled); };
  P.now = function () { return Date.now() + P.offset; };
  P.invalidate = function () { P.at = 0; };

  P.status = async function (force) {
    if (!force && P.cache && Date.now() - P.at < 15000) return P.cache;
    var r = await sb.rpc('my_plan_status');
    if (r.error) throw r.error;
    P.cache = r.data; P.at = Date.now();
    P.offset = new Date(r.data.server_now).getTime() - Date.now();
    return r.data;
  };

  /* ---------- helpers ---------- */
  P.url = function (path) { return path ? sb.storage.from('plan-assets').getPublicUrl(path).data.publicUrl : ''; };
  P.logo = function (path, cls) {
    return '<span class="plan-logo ' + (cls || '') + '">' + Z.icon('layout') +
      (path ? '<img src="' + Z.esc(P.url(path)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
  };
  P.badge = function (b) {
    if (!b) return '';
    return '<span class="plan-badge">' + (b.image_path ? '<img src="' + Z.esc(P.url(b.image_path)) + '" alt="" onerror="this.remove()">' : '') + Z.esc(b.name) + '</span>';
  };
  P.tag = function (type) { return '<span class="ptag ' + (type === 'free' ? 'free' : 'paid') + '">' + (type === 'free' ? 'FREE' : 'PAID') + '</span>'; };
  P.price = function (p) { return p.plan_type === 'free' ? 'FREE' : Z.money(p.price); };

  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  P.left = function (expIso) {
    var ms = new Date(expIso).getTime() - P.now();
    if (ms <= 0) return 'Expired';
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mi = m % 60;
    if (d > 0) return plural(d, 'day') + ' ' + plural(h, 'hour') + ' remaining';
    if (h > 0) return plural(h, 'hour') + ' ' + plural(mi, 'minute') + ' remaining';
    return plural(mi, 'minute') + ' ' + plural(Math.floor(ms / 1000) % 60, 'second') + ' remaining';
  };
  P.until = function (iso) {   // "7h 12m"
    var m = Math.max(0, Math.floor((new Date(iso).getTime() - P.now()) / 60000));
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  };
  P.potential = function (p) {
    var total = Number(p.daily_ad_limit) * Number(p.reward_per_ad) * Number(p.duration_days);
    return { total: total, line: p.daily_ad_limit + ' ads \u00d7 ' + Z.money(p.reward_per_ad) + ' \u00d7 ' + p.duration_days + ' days = ' };
  };

  // Keeps every [data-left] countdown on screen ticking; stops itself when the screen changes
  function tickLeft(root) {
    function paint() { Z.$$('[data-left]', root).forEach(function (n) { n.textContent = P.left(n.getAttribute('data-left')); }); }
    paint();
    var t = setInterval(paint, 1000);
    (Z.leaveHooks = Z.leaveHooks || []).push(function () { clearInterval(t); });
  }
  P.tickLeft = tickLeft;

  /* ---------- Home: current plan card ---------- */
  P.homeCard = function (st) {
    if (!st || !st.enabled) return '';
    var c = st.current;
    if (!c) {
      return '<div class="card plan-now"><div class="pn-head"><span class="row-ic warn">' + Z.icon('layout') + '</span>' +
        '<div class="row-main"><span class="row-title">No active plan</span><span class="row-sub wrap">' +
        (st.last_expired ? Z.esc(st.last_expired.name) + ' ended on ' + Z.fmtDay(st.last_expired.expired_at) + '. ' : '') +
        'Activate a plan to start watching ads and earning rewards.</span></div></div>' +
        '<button class="btn btn-primary btn-block" data-go="/plans">Browse plans</button></div>';
    }
    var lim = c.daily_ad_limit, done = Math.min(st.done_today, lim), pct = Math.round(done / lim * 100);
    return '<div class="card plan-now"><div class="pn-head">' + P.logo(c.logo_path) +
      '<div class="row-main"><span class="row-title">' + Z.esc(c.name) + ' ' + P.tag(c.plan_type) + '</span>' +
      '<span class="row-sub">Expires ' + Z.fmtDate(c.expires_at) + '</span></div></div>' +
      '<div class="pn-stats"><div><b>' + done + '/' + lim + '</b><span>Ads today</span></div><div><b>' + st.remaining + '</b><span>Remaining</span></div>' +
      '<div><b>' + Z.money(c.reward_per_ad) + '</b><span>Per ad</span></div></div>' +
      '<div class="pn-bar"><i style="width:' + pct + '%"></i></div>' +
      '<div class="pn-foot"><span data-left="' + c.expires_at + '"></span>' +
      (st.remaining < 1 ? '<span class="pn-wait">Daily limit reached. New ads in ' + P.until(st.reset_at) + '.</span>' : '') + '</div>' +
      '<button class="btn btn-tonal btn-block" data-go="/plans">View plans</button></div>';
  };

  /* ---------- Watch: allowance bar ---------- */
  P.watchHeader = function (st) {
    var c = st && st.current;
    if (!c) return '';
    return '<div class="card plan-strip"><div class="ps-main">' + P.logo(c.logo_path, 'sm') +
      '<div><b>' + Z.esc(c.name) + '</b><span>' + st.remaining + ' of ' + c.daily_ad_limit + ' ads left today \u00b7 ' + Z.money(c.reward_per_ad) + ' per ad</span></div></div>' +
      (st.remaining < 1 ? '<div class="ps-wait">Daily limit reached. New ads are available at ' + Z.fmtDate(st.reset_at) + ' (in ' + P.until(st.reset_at) + ').</div>' : '') + '</div>';
  };
  P.noPlan = function () {
    return Z.empty({ icon: 'layout', title: 'No active plan', text: 'Activate a free plan or buy a paid plan to start watching ads.',
      action: '<button class="btn btn-primary" data-go="/plans">Browse plans</button>' });
  };

  /* ---------- Profile row ---------- */
  P.profileRow = function (st) {
    if (!st || !st.enabled) return '';
    var c = st.current;
    return '<button class="row row-btn" data-go="/plans"><span class="row-ic acc">' + Z.icon('layout') + '</span>' +
      '<span class="row-main"><span class="row-title">' + (c ? Z.esc(c.name) + ' \u00b7 ' + (c.plan_type === 'free' ? 'Free' : 'Paid') : 'No active plan') + '</span>' +
      '<span class="row-sub wrap">' + (c ? 'Activated ' + Z.fmtDay(c.activated_at) + ' \u00b7 Expires ' + Z.fmtDay(c.expires_at) + '<br><span data-left="' + c.expires_at + '"></span>' : 'Browse plans to start earning') + '</span></span>' +
      Z.icon('chevron', 'row-chev') + '</button>';
  };

  /* ---------- Plans page ---------- */
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2)).padEnd(32, '0').replace(/(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'); }

  Z.views.plans = async function (el, ctx) {
    await Z.refreshSettings();
    if (ctx.stale()) return;
    if (!P.enabled()) { el.innerHTML = '<section class="page">' + Z.empty({ icon: 'layout', title: 'Plans are not available yet', text: 'Check back soon.' }) + '</section>'; return; }

    var res = await Promise.all([sb.rpc('list_plans'), P.status(true), Z.loadSummary()]);
    if (ctx.stale()) return;
    if (res[0].error) throw res[0].error;
    P.offset = new Date(res[0].data.server_now).getTime() - Date.now();
    var plans = res[0].data.plans, st = res[1], sum = res[2], balance = Number(sum.balance);

    function mine(a) {
      return '<div class="card plan-mine"><div class="pn-head">' + P.logo(a.logo_path) +
        '<div class="row-main"><span class="row-title">' + Z.esc(a.name) + ' ' + P.tag(a.plan_type) +
        (st.current && st.current.user_plan_id === a.user_plan_id ? ' <span class="ptag use">IN USE</span>' : '') +
        (a.status === 'paused' ? ' <span class="ptag paused">PAUSED</span>' : '') + '</span>' +
        '<span class="row-sub">' + a.daily_ad_limit + ' ads/day \u00b7 ' + Z.money(a.reward_per_ad) + ' per ad</span></div></div>' +
        '<div class="summary"><div class="kv"><span>Activated</span><b>' + Z.fmtDate(a.activated_at) + '</b></div>' +
        '<div class="kv"><span>Expires</span><b>' + Z.fmtDate(a.expires_at) + '</b></div>' +
        '<div class="kv total"><span>Time left</span><b data-left="' + a.expires_at + '"></b></div></div></div>';
    }

    function card(p) {
      var pot = P.potential(p), mineInfo = p.mine, blocked = p.blocked, canBuy = !blocked, paid = p.plan_type === 'paid';
      var reason = blocked && blocked !== 'plan_already_active'
        ? (blocked === 'insufficient_balance' ? 'Not enough Main Wallet balance. You have ' + Z.money(balance) + '. Earn more by watching ads.' : Z.errText(blocked)) : '';
      var btn = canBuy
        ? '<button class="btn btn-primary btn-block" data-buy="' + p.id + '">' + (paid ? 'Buy for ' + Z.money(p.price) : 'Activate free plan') + '</button>'
        : '<button class="btn btn-tonal btn-block" disabled>' + (blocked === 'plan_already_active' ? 'Active' : (blocked === 'insufficient_balance' ? 'Buy for ' + Z.money(p.price) : 'Unavailable')) + '</button>';
      return '<div class="card plan-card" data-plan="' + p.id + '">' +
        '<div class="plan-top">' + P.logo(p.logo_path) +
        '<div class="plan-name"><b>Plan ' + p.plan_no + ' \u00b7 ' + Z.esc(p.name) + '</b><span>' + P.tag(p.plan_type) + ' <i class="pop">' + plural(p.popularity, 'user') + '</i></span></div>' + P.badge(p.badge) + '</div>' +
        '<div class="plan-price ' + (paid ? '' : 'free') + '">' + P.price(p) + '</div>' +
        '<div class="plan-stats"><div><b>' + p.daily_ad_limit + '</b><span>Ads per day</span></div><div><b>' + Z.money(p.reward_per_ad) + '</b><span>Reward per ad</span></div><div><b>' + p.duration_days + '</b><span>Days</span></div></div>' +
        '<div class="plan-calc"><span>' + pot.line + '</span><b>' + Z.money(pot.total) + '</b><em>potential rewards</em></div>' +
        '<p class="plan-note">Potential, not guaranteed. You earn only for ads you complete and that are verified.</p>' +
        (p.description ? '<p class="plan-desc">' + Z.esc(p.description) + '</p>' : '') +
        (p.benefits ? '<ul class="plan-benefits">' + p.benefits.split('\n').filter(Boolean).map(function (b) { return '<li>' + Z.icon('check') + Z.esc(b) + '</li>'; }).join('') + '</ul>' : '') +
        (mineInfo ? '<div class="plan-active-info">' + Z.icon('clock') + 'Active until ' + Z.fmtDate(mineInfo.expires_at) + ' \u00b7 <b data-left="' + mineInfo.expires_at + '"></b></div>' : '') +
        btn + (reason ? '<p class="plan-reason">' + Z.esc(reason) + '</p>' : '') + '</div>';
    }

    el.innerHTML = '<section class="page">' +
      '<div class="card info-card"><div class="ic-line"><span>Main Wallet balance</span><b>' + Z.money(balance) + '</b></div>' +
      '<div class="ic-line small"><span>Paid plans are bought from this balance only</span></div></div>' +
      '<div class="section-head"><h3>Your plan</h3></div>' +
      (st.active_plans.length ? st.active_plans.map(mine).join('') :
        '<div class="alert a-warn">' + Z.icon('alert') + '<div>You have no active plan. Activate one below to start watching ads.' +
        (st.last_expired ? ' Your last plan, ' + Z.esc(st.last_expired.name) + ', ended on ' + Z.fmtDay(st.last_expired.expired_at) + '.' : '') + '</div></div>') +
      '<div class="section-head"><h3>Available plans</h3></div>' +
      (plans.length ? plans.map(card).join('') : '<div class="card">' + Z.empty({ icon: 'layout', title: 'No plans yet', text: 'New plans will appear here.' }) + '</div>') +
      '</section>';
    tickLeft(el);

    Z.$('.page', el).addEventListener('click', async function (e) {   // on the page itself: it is rebuilt on every visit
      var b = e.target.closest('[data-buy]'); if (!b) return;
      var p = plans.filter(function (x) { return x.id === b.getAttribute('data-buy'); })[0]; if (!p) return;
      var paid = p.plan_type === 'paid', pot = P.potential(p);
      var ok = await Z.confirm({
        title: paid ? 'Buy ' + p.name + '?' : 'Activate ' + p.name + '?',
        html: '<div class="summary"><div class="kv"><span>Price</span><b>' + P.price(p) + '</b></div>' +
          (paid ? '<div class="kv"><span>Balance after</span><b>' + Z.money(balance - Number(p.price)) + '</b></div>' : '') +
          '<div class="kv"><span>Ads per day</span><b>' + p.daily_ad_limit + '</b></div><div class="kv"><span>Reward per ad</span><b>' + Z.money(p.reward_per_ad) + '</b></div>' +
          '<div class="kv"><span>Duration</span><b>' + p.duration_days + ' days</b></div>' +
          '<div class="kv total"><span>Potential rewards</span><b>' + Z.money(pot.total) + '</b></div></div>' +
          '<p class="muted small">Potential rewards are not guaranteed. ' + (paid ? 'The price is taken from your Main Wallet now and is not refunded when the plan ends.' : 'Free plans cost nothing.') + '</p>',
        confirm: paid ? 'Buy for ' + Z.money(p.price) : 'Activate'
      });
      if (!ok) return;
      if (!reqIds[p.id]) reqIds[p.id] = uuid();   // kept until success, so a retry after a bad connection is recognised
      Z.run(b, async function () {
        var r = await sb.rpc('activate_plan', { p_plan_id: p.id, p_request_id: reqIds[p.id] });
        if (r.error) throw r.error;
        delete reqIds[p.id];
        Z.invalidateSummary();
        var sh = Z.sheet('<div class="follow"><div class="sup-ic big" style="background:var(--pos-soft);color:var(--pos)">' + Z.icon('check') + '</div>' +
          '<h2>' + (r.data.duplicate ? 'Already active' : 'Plan activated') + '</h2><p>' + Z.esc(p.name) + ' is active until ' + Z.fmtDate(r.data.expires_at) + '.</p>' +
          '<button class="btn btn-primary btn-block" data-go="/watch" data-close>Watch ads</button>' +
          '<button class="btn btn-ghost btn-block" data-close>Close</button></div>', { center: true });
        Z.$$('[data-go]', sh.el).forEach(function (n) { n.addEventListener('click', function () { sh.close(); }); });
        Z.route();
      });
    });
  };
})();
