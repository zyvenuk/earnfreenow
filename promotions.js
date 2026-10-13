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

  PR.homeCard = function () {
    if (!PR.enabled()) return '';
    return '<div class="card"><button class="row row-btn" data-go="/promotions"><span class="row-ic acc">' + Z.icon('megaphone') + '</span>' +
      '<span class="row-main"><span class="row-title">Promotions</span><span class="row-sub">Discover channels or promote your own</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>';
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
    return '<div class="card promo-card"><div class="plan-top">' + Z.plans.logo(p.logo_path) +
      '<div class="plan-name"><b>' + Z.esc(p.title) + '</b><span><i class="pop">' + Z.esc(p.service_name) + '</i> \u00b7 ' + Z.esc(p.category) + '</span></div>' +
      '<span class="pos-badge">#' + p.position + '</span></div>' +
      '<p class="plan-desc">' + Z.esc(p.description) + '</p>' +
      '<a class="btn btn-primary btn-block" href="' + Z.esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow">' + Z.esc(p.action_label) + '</a></div>';
  }

  function mine(p) {
    var live = p.status === 'active';
    return '<div class="card promo-card"><div class="plan-top">' + Z.plans.logo(p.logo_path) +
      '<div class="plan-name"><b>' + Z.esc(p.title) + '</b><span>' + Z.esc(p.service_name) + ' \u00b7 ' + Z.esc(p.category) + '</span></div>' + sbadge(p.status) + '</div>' +
      '<p class="plan-desc">' + Z.esc(p.description) + '</p>' +
      (p.status === 'rejected' && p.reject_reason ? '<div class="alert a-error">' + Z.icon('info') + '<div><b>Rejected:</b> ' + Z.esc(p.reject_reason) + '<br><small>Your payment was returned to your Main Wallet.</small></div></div>' : '') +
      (p.status === 'pending' ? '<div class="alert a-info">' + Z.icon('clock') + '<div>Waiting for approval. The promotion time starts when it is approved.</div></div>' : '') +
      '<div class="summary"><div class="kv"><span>Link</span><b><a class="link" href="' + Z.esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow">Open link</a></b></div>' +
      '<div class="kv"><span>Duration</span><b>' + p.days + ' day' + (p.days === 1 ? '' : 's') + '</b></div>' +
      '<div class="kv"><span>Position</span><b>' + (live && p.position ? '#' + p.position + ' (live)' : '#' + p.requested_pos + ' requested') + '</b></div>' +
      '<div class="kv"><span>Total paid</span><b>' + Z.money(p.total_price) + '</b></div>' +
      '<div class="kv"><span>Requested</span><b>' + Z.fmtDate(p.created_at) + '</b></div>' +
      '<div class="kv"><span>' + (p.status === 'expired' ? 'Expired' : 'Expires') + '</span><b>' + (p.expires_at ? Z.fmtDate(p.expires_at) : 'After approval') + '</b></div></div></div>';
  }

  Z.views.promotions = async function (el, ctx) {
    await Z.refreshSettings();
    if (ctx.stale()) return;
    if (!PR.enabled()) { el.innerHTML = '<section class="page">' + Z.empty({ icon: 'megaphone', title: 'Promotions are not available', text: 'Check back soon.' }) + '</section>'; return; }
    var cr = await sb.rpc('promo_catalog');
    if (ctx.stale()) return;
    if (cr.error) throw cr.error;
    var cat = cr.data, tab = 'browse', q = '', svc = '', catg = '', items = [], done = false, loading = false;

    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>Promotions</h2><p class="sub">Discover channels and accounts, or promote your own.</p></div></div>' +
      '<button class="btn btn-primary btn-block" id="promote">' + Z.icon('megaphone') + 'Promote my channel</button>' +
      '<div class="seg"><button class="seg-btn on" data-t="browse">Browse</button><button class="seg-btn" data-t="mine">My Promotions</button></div>' +
      '<div id="pbody"></div></section>';
    var body = Z.$('#pbody', el);

    function filters() {
      return '<div class="search">' + Z.icon('search') + '<input class="input" id="psq" type="search" placeholder="Search channels and accounts" value="' + Z.esc(q) + '" autocomplete="off"></div>' +
        '<div class="two">' + Z.field({ id: 'psv', label: 'Service', type: 'select', value: svc, options: [['', 'All services']].concat(cat.services.map(function (s) { return [s.id, s.name]; })) }) +
        Z.field({ id: 'pct', label: 'Category', type: 'select', value: catg, options: [['', 'All categories']].concat(cat.categories.map(function (c) { return [c, c]; })) }) + '</div>' +
        '<div id="plist"></div><div id="pmore"></div>';
    }

    async function load(reset) {
      var list = Z.$('#plist', body), more = Z.$('#pmore', body);
      if (!list || loading) return; loading = true;
      if (reset) { items = []; done = false; list.innerHTML = Z.skel(3, 150); more.innerHTML = ''; }
      var r = await sb.rpc('list_promotions', { p_search: q || null, p_service: svc || null, p_category: catg || null, p_limit: 30, p_offset: items.length });
      loading = false;
      if (ctx.stale() || tab !== 'browse') return;
      if (r.error) { list.innerHTML = Z.errorState(); Z.$('[data-retry]', list).addEventListener('click', function () { load(true); }); return; }
      items = items.concat(r.data || []); done = (r.data || []).length < 30;
      list.innerHTML = items.length ? items.map(card).join('') : '<div class="card">' + Z.empty({ icon: 'megaphone', title: 'No promotions found', text: q || svc || catg ? 'Try a different search or filter.' : 'Be the first to promote your channel.' }) + '</div>';
      more.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="pmb">Load more</button>';
      var b = Z.$('#pmb', more); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }

    async function showMine() {
      body.innerHTML = Z.skel(2, 220);
      var r = await sb.rpc('my_promotions');
      if (ctx.stale() || tab !== 'mine') return;
      if (r.error) { body.innerHTML = Z.errorState(); Z.$('[data-retry]', body).addEventListener('click', showMine); return; }
      body.innerHTML = (r.data || []).length ? r.data.map(mine).join('') : '<div class="card">' + Z.empty({ icon: 'megaphone', title: 'No promotions yet', text: 'Promote your channel or account to reach more people.' }) + '</div>';
    }

    function showBrowse() {
      body.innerHTML = filters();
      Z.$('#psq', body).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim(); load(true); }, 300));
      Z.$('#psv', body).addEventListener('change', function (e) { svc = e.target.value; load(true); });
      Z.$('#pct', body).addEventListener('change', function (e) { catg = e.target.value; load(true); });
      load(true);
    }

    Z.$('.seg', el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-t]'); if (!b || b.getAttribute('data-t') === tab) return;
      tab = b.getAttribute('data-t');
      Z.$$('.seg-btn', el).forEach(function (x) { x.classList.toggle('on', x === b); });
      if (tab === 'mine') showMine(); else showBrowse();
    });
    Z.$('#promote', el).addEventListener('click', function () {
      createSheet(cat, function () {   // after a successful request: show it under My Promotions
        tab = 'mine';
        Z.$$('.seg-btn', el).forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-t') === 'mine'); });
        showMine();
      });
    });
    showBrowse();
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
