/* Admin panel. UI gating here is cosmetic: every query/function is enforced by RLS + is_admin() in the database. */
(function () {
  'use strict';
  var Z = window.Z;

  var TABS = [
    ['dashboard', 'Dashboard', 'grid'], ['payouts', 'Payouts', 'payout'], ['users', 'Users', 'users'],
    ['ads', 'Ads', 'play'], ['adsterra', 'Adsterra', 'layout'], ['transactions', 'Transactions', 'receipt'], ['settings', 'Settings', 'sliders']
  ];
  var PAGE = 20;

  Z.views.admin = async function (el, ctx) {
    var sub = ctx.sub || 'dashboard';
    if (!TABS.some(function (t) { return t[0] === sub; })) sub = 'dashboard';
    el.innerHTML = '<div class="admin-tabs" role="tablist">' + TABS.map(function (t) {
      return '<button class="atab' + (t[0] === sub ? ' on' : '') + '" data-go="/admin/' + (t[0] === 'dashboard' ? '' : t[0]) + '">' + Z.icon(t[2]) + t[1] + '</button>';
    }).join('') + '</div><section class="page" id="abody">' + Z.skel(3, 80) + '</section>';
    var on = Z.$('.atab.on', el); if (on && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' });
    var body = Z.$('#abody', el);
    await SECTIONS[sub](body, ctx);
  };

  function retry(box, fn) {
    box.innerHTML = Z.errorState();
    Z.$('[data-retry]', box).addEventListener('click', fn);
  }
  function lineKV(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; }
  function relation(x) { return Array.isArray(x) ? x[0] : x; }

  var SECTIONS = {};

  /* ---------------- Dashboard ---------------- */
  SECTIONS.dashboard = async function (body, ctx) {
    var r = await sb.rpc('admin_stats');
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var d = r.data;
    function stat(label, value, sub, go) {
      return '<div class="stat"' + (go ? ' data-go="' + go + '" role="link"' : '') + '><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
    }
    body.innerHTML = '<div class="stat-grid">' +
      stat('Users', d.users, d.new_users_today + ' new today', '/admin/users') +
      stat('Active ads', d.active_ads, '', '/admin/ads') +
      stat('Pending payouts', d.pending_payouts, d.processing_payouts + ' processing', '/admin/payouts') +
      stat('Payouts to send', Z.money(d.open_payout_amount), 'Pending + processing', '/admin/payouts') +
      stat('Ads watched today', d.today_views, '') +
      stat('Rewards today', Z.money(d.today_rewards), '') +
      stat('Total rewards', Z.money(d.total_rewards), '') +
      stat('Total paid out', Z.money(d.total_paid), '') + '</div>';
  };

  /* ---------------- Users ---------------- */
  SECTIONS.users = async function (body, ctx) {
    var q = '', items = [], done = false, loading = false;
    body.innerHTML = '<div class="search">' + Z.icon('search') + '<input class="input" id="q" type="search" placeholder="Search name or email" autocomplete="off"></div>' +
      '<div class="card" id="ul"></div><div id="um"></div>';
    var ul = Z.$('#ul', body), um = Z.$('#um', body);

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; ul.innerHTML = Z.skel(4, 60); um.innerHTML = ''; }
      var qq = sb.from('profiles').select('id,email,full_name,status,created_at,wallets(balance,total_earned,total_paid_out)')
        .order('created_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
      if (q) { var c = q.replace(/[,()%*\\]/g, ' ').trim(); if (c) qq = qq.or('email.ilike.%' + c + '%,full_name.ilike.%' + c + '%'); }
      var r = await qq; loading = false;
      if (ctx.stale()) return;
      if (r.error) return retry(ul, function () { load(true); });
      items = items.concat(r.data || []); done = (r.data || []).length < PAGE;
      ul.innerHTML = items.length ? items.map(function (u) {
        var w = relation(u.wallets) || {};
        return '<button class="row row-btn" data-u="' + u.id + '"><span class="avatar sm">' + Z.esc((u.full_name || '?').charAt(0).toUpperCase()) + '</span>' +
          '<span class="row-main"><span class="row-title">' + Z.esc(u.full_name) + '</span><span class="row-sub">' + Z.esc(u.email) + '</span></span>' +
          '<span class="col-end"><span class="amt">' + Z.money(w.balance) + '</span>' + (u.status !== 'active' ? Z.badge(u.status) : '') + '</span></button>';
      }).join('') : Z.empty({ icon: 'users', title: 'No users found' });
      um.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="umb">Load more</button>';
      var b = Z.$('#umb', um); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }
    Z.$('#q', body).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim(); load(true); }, 350));
    ul.addEventListener('click', function (e) {
      var b = e.target.closest('[data-u]'); if (!b) return;
      var u = items.filter(function (x) { return x.id === b.getAttribute('data-u'); })[0];
      if (u) userSheet(u, function () { load(true); });
    });
    load(true);
  };

  async function userSheet(u, onChange) {
    var w = relation(u.wallets) || {};
    var sh = Z.sheet('<h2 class="sheet-title">' + Z.esc(u.full_name) + '</h2>' +
      '<p class="muted small">' + Z.esc(u.email) + '</p>' +
      '<div class="summary">' + lineKV('Status', Z.badge(u.status)) + lineKV('Balance', Z.money(w.balance)) +
      lineKV('Total earned', Z.money(w.total_earned)) + lineKV('Paid out', Z.money(w.total_paid_out)) + lineKV('Joined', Z.fmtDay(u.created_at)) + '</div>' +
      '<div class="sheet-actions row-actions">' +
      '<button class="btn btn-tonal" id="adj">Adjust balance</button>' +
      '<button class="btn ' + (u.status === 'active' ? 'btn-danger-ghost' : 'btn-primary') + '" id="tg">' + (u.status === 'active' ? 'Suspend' : 'Reactivate') + '</button></div>' +
      '<h3 class="mini-title">Recent activity</h3><div id="ua">' + Z.skel(2, 50) + '</div>');

    Promise.all([
      sb.from('transactions').select('id,type,amount,note,created_at').eq('user_id', u.id).order('created_at', { ascending: false }).limit(8),
      sb.from('payout_requests').select('id,method,amount,status,created_at').eq('user_id', u.id).order('created_at', { ascending: false }).limit(5)
    ]).then(function (res) {
      var box = Z.$('#ua', sh.el); if (!box) return;
      if (res[0].error) { box.innerHTML = '<p class="muted small">Could not load activity.</p>'; return; }
      var txs = res[0].data || [], pays = (res[1].data || []);
      box.innerHTML = (txs.length ? '<div class="card flat">' + txs.map(Z.txRow).join('') + '</div>' : '<p class="muted small">No transactions yet.</p>') +
        (pays.length ? '<h3 class="mini-title">Payout requests</h3><div class="card flat">' + pays.map(function (p) {
          return '<div class="row"><span class="row-main"><span class="row-title">' + (Z.methods[p.method] || {}).name + ' \u00b7 ' + Z.money(p.amount) + '</span><span class="row-sub">' + Z.fmtDate(p.created_at) + '</span></span>' + Z.badge(p.status) + '</div>';
        }).join('') + '</div>' : '');
    });

    Z.$('#tg', sh.el).addEventListener('click', async function () {
      var next = u.status === 'active' ? 'suspended' : 'active';
      if (!await Z.confirm({ title: (next === 'suspended' ? 'Suspend ' : 'Reactivate ') + u.full_name + '?', text: next === 'suspended' ? 'They will not be able to watch ads or request payouts.' : 'They will be able to earn and request payouts again.', confirm: next === 'suspended' ? 'Suspend' : 'Reactivate', danger: next === 'suspended' })) return;
      Z.run(Z.$('#tg', sh.el), async function () {
        var r = await sb.rpc('admin_set_user_status', { p_user_id: u.id, p_status: next });
        if (r.error) throw r.error;
        Z.toast('User ' + (next === 'suspended' ? 'suspended' : 'reactivated'), 'ok'); sh.close(); onChange();
      });
    });

    Z.$('#adj', sh.el).addEventListener('click', function () {
      var s2 = Z.sheet('<h2 class="sheet-title">Adjust balance</h2><form id="af" novalidate>' +
        Z.field({ id: 'dir', label: 'Type', type: 'select', value: 'add', options: [['add', 'Add to balance'], ['sub', 'Deduct from balance']] }) +
        Z.field({ id: 'am', label: 'Amount', placeholder: '0.00', attrs: 'inputmode="decimal"' }) +
        Z.field({ id: 'nt', label: 'Reason (shown to the user)', placeholder: 'e.g. Correction for ad credit', attrs: 'maxlength="120"' }) +
        '<div id="aerr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Apply adjustment</button>' +
        '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
      Z.$('#af', s2.el).addEventListener('submit', function (e) {
        e.preventDefault();
        var amt = parseFloat(Z.$('#am', s2.el).value), note = Z.$('#nt', s2.el).value.trim(), err = Z.$('#aerr', s2.el);
        if (!isFinite(amt) || amt <= 0) return Z.formError(err, 'Enter an amount greater than zero.');
        if (note.length < 3) return Z.formError(err, 'Enter a reason of at least 3 characters.');
        var signed = Z.$('#dir', s2.el).value === 'sub' ? -amt : amt;
        Z.run(Z.$('button[type=submit]', s2.el), async function () {
          var r = await sb.rpc('admin_adjust_balance', { p_user_id: u.id, p_amount: signed, p_note: note });
          if (r.error) throw r.error;
          Z.toast('Balance updated', 'ok'); s2.close(); sh.close(); onChange();
        }, err);
      });
    });
  }

  /* ---------------- Ads ---------------- */
  var AD_TYPES = [['banner', 'Banner'], ['native', 'Native'], ['video', 'Video'], ['direct_link', 'Direct link / offer']];

  function adStatus(a) {
    var now = Date.now();
    if (!a.is_active) return 'inactive';
    if (a.starts_at && new Date(a.starts_at) > now) return 'scheduled';
    if (a.ends_at && new Date(a.ends_at) <= now) return 'expired';
    return 'active';
  }

  SECTIONS.ads = async function (body, ctx) {
    var r = await sb.from('ads').select('*').order('sort_order').order('created_at', { ascending: false });
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var ads = r.data || [];
    body.innerHTML = '<div class="page-head"><div><h2>Ads &amp; tasks</h2><p class="sub">What users can watch to earn.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="new">' + Z.icon('plus') + 'New ad</button></div>' +
      '<div class="card" id="al">' + (ads.length ? ads.map(function (a) {
        var st = adStatus(a);
        return '<div class="row" data-a="' + a.id + '"><button class="row-btn row-main-btn" data-edit="' + a.id + '">' +
          '<span class="row-main"><span class="row-title">' + Z.esc(a.title) + '</span>' +
          '<span class="row-sub">' + (AD_TYPES.filter(function (t) { return t[0] === a.ad_type; })[0] || [0, a.ad_type])[1] + ' \u00b7 ' + Z.money(a.reward) + ' \u00b7 ' + a.duration_seconds + 's' +
          (a.daily_limit ? ' \u00b7 ' + a.daily_limit + '/day' : '') + '</span></span></button>' +
          Z.badge(st) +
          '<label class="switch"><input type="checkbox" data-toggle="' + a.id + '"' + (a.is_active ? ' checked' : '') + ' aria-label="Active"><i></i></label></div>';
      }).join('') : Z.empty({ icon: 'play', title: 'No ads yet', text: 'Create your first ad or task so users can start earning.' })) + '</div>';

    Z.$('#new', body).addEventListener('click', function () { adForm(null); });
    Z.$('#al', body).addEventListener('click', function (e) {
      var ed = e.target.closest('[data-edit]');
      if (ed) adForm(ads.filter(function (a) { return a.id === ed.getAttribute('data-edit'); })[0]);
    });
    Z.$('#al', body).addEventListener('change', async function (e) {
      var t = e.target.closest('[data-toggle]'); if (!t) return;
      var res = await sb.from('ads').update({ is_active: t.checked }).eq('id', t.getAttribute('data-toggle'));
      if (res.error) { t.checked = !t.checked; Z.toast(Z.errMsg(res.error), 'error'); }
      else { Z.toast(t.checked ? 'Ad enabled' : 'Ad disabled', 'ok'); Z.route(); }
    });
  };

  function adForm(a) {
    var isNew = !a; a = a || { ad_type: 'banner', duration_seconds: 15, is_active: true, sort_order: 0 };
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New ad' : 'Edit ad') + '</h2><form id="adf" novalidate>' +
      Z.field({ id: 't', label: 'Title', value: a.title, attrs: 'maxlength="80"' }) +
      Z.field({ id: 'd', label: 'Description (optional)', value: a.description, attrs: 'maxlength="200"' }) +
      Z.field({ id: 'ty', label: 'Ad type', type: 'select', value: a.ad_type, options: AD_TYPES }) +
      '<div class="two">' + Z.field({ id: 'rw', label: 'Reward', value: a.reward, attrs: 'inputmode="decimal"' }) +
      Z.field({ id: 'du', label: 'Seconds to watch', value: a.duration_seconds, attrs: 'inputmode="numeric"', hint: '5 to 300' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'dl', label: 'Daily limit per user', value: a.daily_limit, attrs: 'inputmode="numeric"', placeholder: 'No limit' }) +
      Z.field({ id: 'tl', label: 'Total limit per user', value: a.total_limit, attrs: 'inputmode="numeric"', placeholder: 'No limit' }) + '</div>' +
      '<div id="code-box">' + Z.field({ id: 'cd', label: 'Ad code', type: 'textarea', mono: true, value: a.ad_code, rows: 5, placeholder: 'Paste the code from your Adsterra dashboard', hint: 'Shown to users inside an isolated frame.' }) + '</div>' +
      '<div id="url-box">' + Z.field({ id: 'ur', label: 'Offer URL', type: 'url', value: a.target_url, placeholder: 'https://', attrs: 'inputmode="url" autocapitalize="off"', hint: 'Adsterra Direct Link / Smartlink.' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'sa', label: 'Starts (optional)', type: 'datetime-local', value: Z.toLocalInput(a.starts_at) }) +
      Z.field({ id: 'ea', label: 'Ends (optional)', type: 'datetime-local', value: Z.toLocalInput(a.ends_at) }) + '</div>' +
      Z.field({ id: 'so', label: 'Sort order', value: a.sort_order, attrs: 'inputmode="numeric"', hint: 'Lower numbers show first.' }) +
      Z.switchEl('ac', a.is_active, 'Active') +
      '<div id="adferr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Create ad' : 'Save changes') + '</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el;
    function sync() {
      var direct = Z.$('#ty', el).value === 'direct_link';
      Z.$('#code-box', el).hidden = direct; Z.$('#url-box', el).hidden = !direct;
    }
    Z.$('#ty', el).addEventListener('change', sync); sync();

    function intOrNull(v) { v = String(v).trim(); if (!v) return null; var n = parseInt(v, 10); return isFinite(n) ? n : NaN; }
    Z.$('#adf', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#adferr', el), ty = Z.$('#ty', el).value;
      var p = {
        title: Z.$('#t', el).value.trim(), description: Z.$('#d', el).value.trim() || null, ad_type: ty,
        reward: parseFloat(Z.$('#rw', el).value), duration_seconds: parseInt(Z.$('#du', el).value, 10),
        daily_limit: intOrNull(Z.$('#dl', el).value), total_limit: intOrNull(Z.$('#tl', el).value),
        ad_code: ty === 'direct_link' ? null : (Z.$('#cd', el).value.trim() || null),
        target_url: ty === 'direct_link' ? (Z.$('#ur', el).value.trim() || null) : null,
        starts_at: Z.$('#sa', el).value ? new Date(Z.$('#sa', el).value).toISOString() : null,
        ends_at: Z.$('#ea', el).value ? new Date(Z.$('#ea', el).value).toISOString() : null,
        sort_order: parseInt(Z.$('#so', el).value, 10) || 0,
        is_active: Z.$('#ac', el).checked
      };
      if (!p.title) return Z.formError(err, 'Enter a title.');
      if (!isFinite(p.reward) || p.reward <= 0) return Z.formError(err, 'Enter a reward greater than zero.');
      if (!isFinite(p.duration_seconds) || p.duration_seconds < 5 || p.duration_seconds > 300) return Z.formError(err, 'Watch time must be between 5 and 300 seconds.');
      if (Number.isNaN(p.daily_limit) || Number.isNaN(p.total_limit) || (p.daily_limit !== null && p.daily_limit < 1) || (p.total_limit !== null && p.total_limit < 1)) return Z.formError(err, 'Limits must be whole numbers above zero, or empty.');
      if (ty === 'direct_link' && !/^https?:\/\//i.test(p.target_url || '')) return Z.formError(err, 'Enter a valid offer URL starting with https://');
      if (ty !== 'direct_link' && !p.ad_code) return Z.formError(err, 'Paste the ad code for this ad.');
      if (p.starts_at && p.ends_at && p.ends_at <= p.starts_at) return Z.formError(err, 'The end time must be after the start time.');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var r = isNew ? await sb.from('ads').insert(p) : await sb.from('ads').update(p).eq('id', a.id);
        if (r.error) throw r.error;
        Z.toast(isNew ? 'Ad created' : 'Ad saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
  }

  /* ---------------- Adsterra placements ---------------- */
  SECTIONS.adsterra = async function (body, ctx) {
    var r = await sb.from('ad_placements').select('*').order('sort_order');
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var list = r.data || [];
    body.innerHTML = '<div class="page-head"><div><h2>Adsterra placements</h2><p class="sub">Paste ad code once. It appears everywhere that placement is used.</p></div></div>' +
      '<div class="card">' + list.map(function (p) {
        var has = p.code && p.code.trim();
        var st = !has ? 'nocode' : (p.is_enabled ? 'live' : 'off');
        return '<button class="row row-btn" data-k="' + p.key + '"><span class="row-main"><span class="row-title">' + Z.esc(p.label) + '</span>' +
          '<span class="row-sub">' + Z.esc(p.description || '') + '</span></span>' + Z.badge(st) + Z.icon('chevron', 'row-chev') + '</button>';
      }).join('') + '</div>' +
      '<div class="alert a-info">' + Z.icon('info') + '<div>Banner placements run inside an isolated frame. Payout screens never show ads. Ad slots with no code stay hidden.</div></div>';
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-k]'); if (!b) return;
      placementForm(list.filter(function (p) { return p.key === b.getAttribute('data-k'); })[0]);
    });
  };

  function placementForm(p) {
    var sh = Z.sheet('<h2 class="sheet-title">' + Z.esc(p.label) + '</h2><p class="muted small">' + Z.esc(p.description || '') + '</p><form id="pf" novalidate>' +
      Z.field({ id: 'code', label: 'Ad code', type: 'textarea', mono: true, rows: 7, value: p.code, placeholder: 'Paste the code from your Adsterra dashboard' }) +
      (p.kind === 'frame' ? Z.field({ id: 'fh', label: 'Frame height in px (optional)', value: p.frame_height, attrs: 'inputmode="numeric"', hint: 'Only needed if the code does not define its own height.' }) : '') +
      Z.switchEl('en', p.is_enabled, 'Enabled') +
      '<div id="perr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Save placement</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el;
    Z.$('#pf', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var code = Z.$('#code', el).value.trim(), enabled = Z.$('#en', el).checked, err = Z.$('#perr', el);
      var fhEl = Z.$('#fh', el), fh = fhEl && fhEl.value.trim() ? parseInt(fhEl.value, 10) : null;
      if (enabled && !code) return Z.formError(err, 'Paste ad code before enabling this placement.');
      if (fh !== null && (!isFinite(fh) || fh < 20 || fh > 1200)) return Z.formError(err, 'Frame height must be between 20 and 1200.');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var r = await sb.from('ad_placements').update({ code: code || null, is_enabled: enabled, frame_height: fh }).eq('key', p.key);
        if (r.error) throw r.error;
        Z.slots.loadedAt = 0; // refresh cached placements
        Z.toast('Placement saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
  }

  /* ---------------- Payouts ---------------- */
  SECTIONS.payouts = async function (body, ctx) {
    var filter = 'open', items = [], done = false, loading = false;
    body.innerHTML = Z.chips([['open', 'To do'], ['paid', 'Paid'], ['rejected', 'Rejected'], ['cancelled', 'Cancelled'], ['all', 'All']], 'open', 'data-pf') +
      '<div id="pl"></div><div id="pm"></div>';
    var pl = Z.$('#pl', body), pm = Z.$('#pm', body);

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; pl.innerHTML = Z.skel(3, 120); pm.innerHTML = ''; }
      var q = sb.from('payout_requests').select('*,profiles(full_name,email)').range(items.length, items.length + PAGE - 1);
      if (filter === 'open') q = q.in('status', ['pending', 'processing']).order('created_at', { ascending: true });
      else { if (filter !== 'all') q = q.eq('status', filter); q = q.order('created_at', { ascending: false }); }
      var r = await q; loading = false;
      if (ctx.stale()) return;
      if (r.error) return retry(pl, function () { load(true); });
      items = items.concat(r.data || []); done = (r.data || []).length < PAGE;
      pl.innerHTML = items.length ? items.map(payCard).join('') : Z.empty({ icon: 'payout', title: filter === 'open' ? 'Nothing to process' : 'No requests', text: filter === 'open' ? 'New payout requests will appear here.' : '' });
      pm.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="pmb">Load more</button>';
      var b = Z.$('#pmb', pm); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }

    function payCard(p) {
      var u = relation(p.profiles) || {};
      var open = p.status === 'pending' || p.status === 'processing';
      return '<div class="card pay-card" data-id="' + p.id + '">' +
        '<div class="pc-top">' + Z.methodLogo(p.method) + '<div class="pc-who"><b>' + Z.esc(u.full_name || 'Unknown') + '</b><span>' + Z.esc(u.email || '') + '</span></div>' + Z.badge(p.status) + '</div>' +
        '<div class="summary">' +
        lineKV('Method', (Z.methods[p.method] || {}).name) +
        lineKV('Account holder', Z.esc(p.account_name)) +
        '<div class="kv"><span>Account number</span><b>' + Z.esc(p.account_number) + ' <button class="icon-btn sm" data-copy="' + Z.esc(p.account_number) + '" aria-label="Copy account number">' + Z.icon('copy') + '</button></b></div>' +
        lineKV('Requested', Z.money(p.amount)) + lineKV('Fee', Z.money(p.fee)) +
        '<div class="kv total"><span>Send to user</span><b>' + Z.money(p.net_amount) + ' <button class="icon-btn sm" data-copy="' + Number(p.net_amount).toFixed(2) + '" aria-label="Copy amount">' + Z.icon('copy') + '</button></b></div>' +
        lineKV('Submitted', Z.fmtDate(p.created_at)) +
        (p.processed_at ? lineKV('Processed', Z.fmtDate(p.processed_at)) : '') +
        (p.payment_reference ? lineKV('Reference', Z.esc(p.payment_reference)) : '') +
        (p.reject_reason ? lineKV('Reason', Z.esc(p.reject_reason)) : '') + '</div>' +
        (open ? '<div class="pc-actions">' +
          (p.status === 'pending' ? '<button class="btn btn-tonal btn-sm" data-act="processing">Approve</button>' : '') +
          '<button class="btn btn-primary btn-sm" data-act="paid">Mark paid</button>' +
          '<button class="btn btn-danger-ghost btn-sm" data-act="rejected">Reject</button></div>' : '') + '</div>';
    }

    Z.$('.chips', body).addEventListener('click', function (e) {
      var c = e.target.closest('[data-pf]'); if (!c || c.getAttribute('data-pf') === filter) return;
      filter = c.getAttribute('data-pf');
      Z.$$('.chip', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
    });

    pl.addEventListener('click', async function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var id = btn.closest('[data-id]').getAttribute('data-id'), act = btn.getAttribute('data-act');
      var p = items.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      if (act === 'processing') {
        if (!await Z.confirm({ title: 'Approve this request?', text: 'Mark it as approved and processing. The user will see the update.', confirm: 'Approve' })) return;
        return Z.run(btn, async function () { await callPayout(id, 'processing'); load(true); });
      }
      if (act === 'paid') {
        var sh = Z.sheet('<h2 class="sheet-title">Mark as paid</h2><p class="sheet-text">Only confirm after you sent <b>' + Z.money(p.net_amount) + '</b> to ' + Z.esc(p.account_number) + ' on ' + (Z.methods[p.method] || {}).name + '.</p>' +
          '<form id="pdf">' + Z.field({ id: 'ref', label: 'Transaction reference (optional)', attrs: 'maxlength="80"' }) + '<div id="pderr"></div>' +
          '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Confirm payment sent</button><button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
        Z.$('#pdf', sh.el).addEventListener('submit', function (ev) {
          ev.preventDefault();
          Z.run(Z.$('button[type=submit]', sh.el), async function () {
            await callPayout(id, 'paid', null, Z.$('#ref', sh.el).value);
            Z.toast('Marked as paid', 'ok'); sh.close(); load(true);
          }, Z.$('#pderr', sh.el));
        });
      }
      if (act === 'rejected') {
        var s2 = Z.sheet('<h2 class="sheet-title">Reject request</h2><p class="sheet-text">' + Z.money(p.amount) + ' will be returned to the user\u2019s balance.</p>' +
          '<form id="rjf">' + Z.field({ id: 'rs', label: 'Reason (shown to the user)', type: 'textarea', rows: 3, attrs: 'maxlength="200"' }) + '<div id="rjerr"></div>' +
          '<div class="sheet-actions"><button class="btn btn-danger btn-block" type="submit">Reject and refund</button><button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
        Z.$('#rjf', s2.el).addEventListener('submit', function (ev) {
          ev.preventDefault();
          var reason = Z.$('#rs', s2.el).value.trim();
          if (reason.length < 3) return Z.formError(Z.$('#rjerr', s2.el), 'Enter a reason of at least 3 characters.');
          Z.run(Z.$('button[type=submit]', s2.el), async function () {
            await callPayout(id, 'rejected', reason);
            Z.toast('Request rejected and refunded', 'ok'); s2.close(); load(true);
          }, Z.$('#rjerr', s2.el));
        });
      }
    });
    load(true);
  };

  async function callPayout(id, status, reason, ref) {
    var r = await sb.rpc('admin_update_payout', { p_id: id, p_status: status, p_reason: reason || null, p_reference: ref || null });
    if (r.error) throw r.error;
    return r.data;
  }

  /* ---------------- Transactions ---------------- */
  SECTIONS.transactions = async function (body, ctx) {
    var type = '', q = '', items = [], done = false, loading = false;
    var typeOpts = [['', 'All types']].concat(Object.keys(Z.TX).map(function (k) { return [k, Z.TX[k].label]; }));
    body.innerHTML = '<div class="search">' + Z.icon('search') + '<input class="input" id="tq" type="search" placeholder="Search by user email" autocomplete="off"></div>' +
      Z.field({ id: 'tt', label: 'Type', type: 'select', value: '', options: typeOpts }) +
      '<div class="card" id="tl"></div><div id="tm"></div>';
    var tl = Z.$('#tl', body), tm = Z.$('#tm', body);

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; tl.innerHTML = Z.skel(4, 60); tm.innerHTML = ''; }
      var qq = sb.from('transactions').select('id,type,amount,balance_after,note,created_at,profiles!inner(email,full_name)')
        .order('created_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
      if (type) qq = qq.eq('type', type);
      if (q) { var c = q.replace(/[,()%*\\]/g, ' ').trim(); if (c) qq = qq.ilike('profiles.email', '%' + c + '%'); }
      var r = await qq; loading = false;
      if (ctx.stale()) return;
      if (r.error) return retry(tl, function () { load(true); });
      items = items.concat(r.data || []); done = (r.data || []).length < PAGE;
      tl.innerHTML = items.length ? items.map(function (t) {
        var u = relation(t.profiles) || {}, m = Z.TX[t.type] || { label: t.type, icon: 'coin', cls: '' }, amt = Number(t.amount);
        return '<div class="row"><span class="row-ic ' + m.cls + '">' + Z.icon(m.icon) + '</span><span class="row-main"><span class="row-title">' + m.label + '</span>' +
          '<span class="row-sub">' + Z.esc(u.email || '') + ' \u00b7 ' + Z.fmtDate(t.created_at) + '</span></span>' +
          (amt !== 0 ? '<span class="amt ' + (amt > 0 ? 'pos' : 'neg') + '">' + Z.money(amt, { sign: true }) + '</span>' : '') + '</div>';
      }).join('') : Z.empty({ icon: 'receipt', title: 'No transactions found' });
      tm.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="tmb">Load more</button>';
      var b = Z.$('#tmb', tm); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }
    Z.$('#tt', body).addEventListener('change', function (e) { type = e.target.value; load(true); });
    Z.$('#tq', body).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim(); load(true); }, 350));
    load(true);
  };

  /* ---------------- Settings ---------------- */
  SECTIONS.settings = async function (body, ctx) {
    var r = await sb.from('platform_settings').select('*').eq('id', true).single();
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var s = r.data;
    body.innerHTML = '<div class="page-head"><div><h2>Settings</h2><p class="sub">Payout rules shown to users.</p></div></div>' +
      '<form class="card form" id="sf" novalidate>' +
      Z.field({ id: 'cs', label: 'Currency symbol', value: s.currency_symbol, attrs: 'maxlength="6"' }) +
      Z.field({ id: 'mp', label: 'Minimum payout', value: s.min_payout, attrs: 'inputmode="decimal"' }) +
      '<div class="two">' + Z.field({ id: 'fp', label: 'Fee percent', value: s.fee_percent, attrs: 'inputmode="decimal"' }) +
      Z.field({ id: 'ff', label: 'Fixed fee', value: s.fee_fixed, attrs: 'inputmode="decimal"' }) + '</div>' +
      Z.field({ id: 'pn', label: 'Payout notice', type: 'textarea', rows: 3, value: s.payout_notice, hint: 'Shown on the Payout screen.' }) +
      Z.switchEl('pe', s.payouts_enabled, 'Payouts enabled') +
      '<div id="serr"></div><button class="btn btn-primary btn-block" type="submit">Save settings</button></form>';
    Z.$('#sf', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var p = {
        currency_symbol: Z.$('#cs', body).value.trim(), min_payout: parseFloat(Z.$('#mp', body).value),
        fee_percent: parseFloat(Z.$('#fp', body).value), fee_fixed: parseFloat(Z.$('#ff', body).value),
        payout_notice: Z.$('#pn', body).value.trim(), payouts_enabled: Z.$('#pe', body).checked
      };
      var err = Z.$('#serr', body);
      if (!p.currency_symbol) return Z.formError(err, 'Enter a currency symbol.');
      if (!isFinite(p.min_payout) || p.min_payout <= 0) return Z.formError(err, 'Minimum payout must be above zero.');
      if (!isFinite(p.fee_percent) || p.fee_percent < 0 || p.fee_percent >= 50) return Z.formError(err, 'Fee percent must be from 0 to under 50.');
      if (!isFinite(p.fee_fixed) || p.fee_fixed < 0) return Z.formError(err, 'Fixed fee cannot be negative.');
      Z.run(Z.$('button[type=submit]', body), async function () {
        var u = await sb.from('platform_settings').update(p).eq('id', true).select().single();
        if (u.error) throw u.error;
        Z.state.settings = u.data;
        Z.formError(err, '');
        Z.toast('Settings saved', 'ok');
      }, err);
    });
  };
})();
