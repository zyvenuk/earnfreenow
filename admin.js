/* Admin panel. UI gating here is cosmetic: every query/function is enforced by RLS + is_admin() in the database. */
(function () {
  'use strict';
  var Z = window.Z;

  var TABS = [
    ['dashboard', 'Dashboard', 'grid'], ['payouts', 'Payouts', 'payout'], ['users', 'Users', 'users'], ['rewards', 'Rewards', 'coin'], ['referrals', 'Referrals', 'gift'],
    ['ads', 'Ads', 'play'], ['adsterra', 'Adsterra', 'layout'], ['maintenance', 'Maintenance', 'wrench'], ['announcements', 'Announcements', 'megaphone'], ['transactions', 'Transactions', 'receipt'], ['settings', 'Settings', 'sliders']
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

  /* ---------------- Maintenance (see maintenance.js) ---------------- */
  SECTIONS.maintenance = function (body, ctx) { return Z.maint.adminView(body, ctx); };

  /* ---------------- Dashboard ---------------- */
  SECTIONS.dashboard = async function (body, ctx) {
    var r = await sb.rpc('admin_stats');
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var d = r.data;
    function stat(label, value, sub, go) {
      return '<div class="stat"' + (go ? ' data-go="' + go + '" role="link"' : '') + '><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>';
    }
    body.innerHTML = Z.maint.adminNotice() + '<div class="stat-grid">' +
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
      var qq = sb.from('profiles').select('id,email,full_name,status,email_verified,note,created_at,wallets(balance,total_earned,total_paid_out)')
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
          '<span class="col-end"><span class="amt">' + Z.money(w.balance) + '</span>' + (u.status !== 'active' ? Z.badge(u.status) : '') + (!u.email_verified ? Z.verBadge(false) : '') + '</span></button>';
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

  // Phones linked to this account (one phone = one account); shows when a phone model fingerprint is shared
  function deviceSection(devs) {
    var h = '<h3 class="mini-title">Phones (' + devs.length + ')</h3>';
    return h + (devs.length ? '<div class="card flat">' + devs.map(function (d) {
      return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(d.device_short) + '\u2026</span>' +
        '<span class="row-sub wrap">' + Z.esc((d.user_agent || '').slice(0, 70)) + '</span>' +
        '<span class="row-sub">First ' + Z.fmtDate(d.first_seen) + ' \u00b7 last ' + Z.fmtDate(d.last_seen) + '</span>' +
        (d.same_fp_accounts > 0 ? '<span class="row-sub" style="color:var(--warn)">Similar phone seen on ' + d.same_fp_accounts + ' other account' + (d.same_fp_accounts > 1 ? 's' : '') + '</span>' : '') +
        '</span></div>';
    }).join('') + '</div>' : '<p class="muted small">No phone linked yet.</p>');
  }

  // Referrals of one user: who referred them, and everyone they referred (name + email + date)
  function refSection(made, by) {
    var h = '<h3 class="mini-title">Referred by</h3>';
    h += by.length ? '<div class="card flat">' + by.map(function (r) {
      var w = relation(r.referrer) || {};
      return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(w.full_name || 'Unknown') + ' <span class="lvl">L' + r.level + '</span></span>' +
        '<span class="row-sub">' + Z.esc(w.email || '') + '</span><span class="row-sub">' + Z.fmtDate(r.created_at) + '</span></span></div>';
    }).join('') + '</div>' : '<p class="muted small">Nobody. This user signed up directly.</p>';
    h += '<h3 class="mini-title">Referrals made (' + made.length + ')</h3>';
    h += made.length ? '<div class="card flat">' + Z.fold(made.map(function (r) {
      var w = relation(r.referred) || {};
      return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(w.full_name || 'Unknown') + ' <span class="lvl">L' + r.level + '</span></span>' +
        '<span class="row-sub">' + Z.esc(w.email || '') + '</span><span class="row-sub">Joined ' + Z.fmtDate(r.created_at) + (r.validated_at ? ' \u00b7 valid ' + Z.fmtDay(r.validated_at) : '') + '</span></span>' + Z.badge(r.status) + '</div>';
    }), { limit: 3 }) + '</div>' : '<p class="muted small">No referrals yet.</p>';
    return h;
  }

  async function userSheet(u, onChange) {
    var w = relation(u.wallets) || {};
    var sh = Z.sheet('<h2 class="sheet-title">' + Z.esc(u.full_name) + '</h2>' +
      '<p class="muted small">' + Z.esc(u.email) + '</p>' +
      '<div class="summary">' + lineKV('Status', Z.badge(u.status)) + lineKV('Verification', Z.verBadge(u.email_verified)) + lineKV('Balance', Z.money(w.balance)) +
      lineKV('Total earned', Z.money(w.total_earned)) + lineKV('Paid out', Z.money(w.total_paid_out)) + lineKV('Joined', Z.fmtDay(u.created_at)) + '</div>' +
      (u.note ? '<div class="alert a-warn" style="margin-top:10px">' + Z.icon('alert') + '<div>' + Z.esc(u.note) + '</div></div>' : '') +
      '<div class="sheet-actions row-actions">' +
      '<button class="btn btn-tonal" id="adj">Adjust balance</button>' +
      '<button class="btn ' + (u.status === 'active' ? 'btn-danger-ghost' : 'btn-primary') + '" id="tg">' + (u.status === 'active' ? 'Suspend' : 'Reactivate') + '</button></div>' +
      '<h3 class="mini-title">Recent activity</h3><div id="ua">' + Z.skel(2, 50) + '</div>');

    Promise.all([
      sb.from('transactions').select('id,type,amount,note,created_at').eq('user_id', u.id).order('created_at', { ascending: false }).limit(8),
      sb.from('payout_requests').select('id,method,amount,status,created_at').eq('user_id', u.id).order('created_at', { ascending: false }).limit(5),
      sb.from('referrals').select('id,level,status,created_at,validated_at,referred:profiles!referrals_referred_id_fkey(full_name,email)').eq('referrer_id', u.id).order('created_at', { ascending: false }).limit(100),
      sb.from('referrals').select('id,level,status,created_at,referrer:profiles!referrals_referrer_id_fkey(full_name,email)').eq('referred_id', u.id).order('level'),
      sb.rpc('admin_user_devices', { p_user: u.id })
    ]).then(function (res) {
      var box = Z.$('#ua', sh.el); if (!box) return;
      if (res[0].error) { box.innerHTML = '<p class="muted small">Could not load activity.</p>'; return; }
      var txs = res[0].data || [], pays = (res[1].data || []);
      box.innerHTML = (txs.length ? '<div class="card flat">' + txs.map(Z.txRow).join('') + '</div>' : '<p class="muted small">No transactions yet.</p>') +
        (pays.length ? '<h3 class="mini-title">Payout requests</h3><div class="card flat">' + pays.map(function (p) {
          return '<div class="row"><span class="row-main"><span class="row-title">' + (Z.methods[p.method] || {}).name + ' \u00b7 ' + Z.money(p.amount) + '</span><span class="row-sub">' + Z.fmtDate(p.created_at) + '</span></span>' + Z.badge(p.status) + '</div>';
        }).join('') + '</div>' : '') +
        (!res[2].error && !res[3].error ? refSection(res[2].data || [], res[3].data || []) : '') +
        (!res[4].error ? deviceSection(res[4].data || []) : '');
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
      var q = sb.from('payout_requests').select('*,profiles!payout_requests_user_id_fkey(full_name,email)').range(items.length, items.length + PAGE - 1);
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
        return Z.run(btn, async function () { await callPayout(id, 'processing'); notifyPayout(p, 'processing'); load(true); });
      }
      if (act === 'paid') {
        var sh = Z.sheet('<h2 class="sheet-title">Mark as paid</h2><p class="sheet-text">Only confirm after you sent <b>' + Z.money(p.net_amount) + '</b> to ' + Z.esc(p.account_number) + ' on ' + (Z.methods[p.method] || {}).name + '.</p>' +
          '<form id="pdf">' + Z.field({ id: 'ref', label: 'Transaction reference (optional)', attrs: 'maxlength="80"' }) + '<div id="pderr"></div>' +
          '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Confirm payment sent</button><button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
        Z.$('#pdf', sh.el).addEventListener('submit', function (ev) {
          ev.preventDefault();
          Z.run(Z.$('button[type=submit]', sh.el), async function () {
            await callPayout(id, 'paid', null, Z.$('#ref', sh.el).value);
            notifyPayout(p, 'paid');
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
            notifyPayout(p, 'rejected', reason);
            Z.toast('Request rejected and refunded', 'ok'); s2.close(); load(true);
          }, Z.$('#rjerr', s2.el));
        });
      }
    });
    load(true);
  };

  // Best-effort push to the user whose payout changed (never blocks the admin action)
  function notifyPayout(p, status, reason) {
    var m = (Z.methods[p.method] || {}).name || 'payout';
    var t = { processing: ['Payout approved', 'Your ' + m + ' payout of ' + Z.money(p.net_amount) + ' is being processed.'],
              paid: ['Payout sent', Z.money(p.net_amount) + ' was sent to your ' + m + ' account.'],
              rejected: ['Payout rejected', (reason || 'Your request was rejected') + '. ' + Z.money(p.amount) + ' was returned to your balance.'] }[status];
    if (t && Z.push) Z.push.adminSend({ user_id: p.user_id, title: t[0], body: t[1].slice(0, 200), url: '#/payout' }).catch(function (e) { console.warn('[Zyven] payout push', e); });
  }

  async function callPayout(id, status, reason, ref) {
    var r = await sb.rpc('admin_update_payout', { p_id: id, p_status: status, p_reason: reason || null, p_reference: ref || null });
    if (r.error) throw r.error;
    return r.data;
  }

  /* ---------------- Announcements ----------------
     Everyone      -> "Zyven Alerts" tab in the app
     One user      -> "My Mails" tab of that user only */
  var PRIORITIES = [['0', 'Normal'], ['1', 'Important'], ['2', 'Urgent']];

  function annStatus(a) {
    if (!a.is_active) return 'inactive';
    if (a.expires_at && new Date(a.expires_at) <= Date.now()) return 'expired';
    return 'active';
  }
  function audience(a) {
    if (!a.user_id) return 'All users';
    var r = relation(a.recipient) || {};
    return 'To ' + Z.esc(r.full_name || 'user') + (r.email ? ' (' + Z.esc(r.email) + ')' : '');
  }

  SECTIONS.announcements = async function (body, ctx) {
    var both = await Promise.all([
      sb.from('announcements').select('*,recipient:profiles!announcements_user_id_fkey(full_name,email)').order('created_at', { ascending: false }).limit(150),
      sb.from('push_subscriptions').select('id', { count: 'exact', head: true })
    ]);
    var r = both[0], devices = both[1].count || 0;
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var list = r.data || [], filter = 'all';

    body.innerHTML = '<div class="page-head"><div><h2>Announcements</h2><p class="sub">Zyven Alerts go to everyone, My Mails to one user. ' + devices + (devices === 1 ? ' device has' : ' devices have') + ' push turned on.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="new">' + Z.icon('plus') + 'New</button></div>' +
      Z.chips([['all', 'All'], ['alerts', 'Zyven Alerts'], ['mails', 'My Mails']], 'all', 'data-af') +
      '<div class="card" id="alist"></div>';
    var box = Z.$('#alist', body);

    function paint() {
      var rows = list.filter(function (a) { return filter === 'all' || (filter === 'mails' ? !!a.user_id : !a.user_id); });
      box.innerHTML = rows.length ? rows.map(function (a) {
        var t = Z.ANN[a.type] || Z.ANN.info;
        return '<div class="row"><span class="row-ic ' + t.cls + '">' + Z.icon(a.user_id ? 'mail' : t.icon) + '</span>' +
          '<button class="row-btn row-main-btn" data-edit="' + a.id + '"><span class="row-main"><span class="row-title">' + Z.esc(a.title) + '</span>' +
          '<span class="row-sub">' + audience(a) + '</span>' +
          '<span class="row-sub">' + Z.fmtDate(a.created_at) + (a.priority > 0 ? ' \u00b7 ' + PRIORITIES[a.priority][1] : '') + (a.expires_at ? ' \u00b7 ends ' + Z.fmtDay(a.expires_at) : '') + '</span></span></button>' +
          Z.badge(annStatus(a)) +
          '<label class="switch"><input type="checkbox" data-toggle="' + a.id + '"' + (a.is_active ? ' checked' : '') + ' aria-label="Active"><i></i></label></div>';
      }).join('') : Z.empty({ icon: 'megaphone', title: 'Nothing here', text: 'Create an announcement for everyone, or send a mail to one user.' });
    }
    paint();

    Z.$('#new', body).addEventListener('click', function () { annForm(null); });
    Z.$('.chips', body).addEventListener('click', function (e) {
      var c = e.target.closest('[data-af]'); if (!c) return;
      filter = c.getAttribute('data-af');
      Z.$$('.chip', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      paint();
    });
    box.addEventListener('click', function (e) {
      var ed = e.target.closest('[data-edit]'); if (!ed) return;
      annForm(list.filter(function (a) { return a.id === ed.getAttribute('data-edit'); })[0]);
    });
    box.addEventListener('change', async function (e) {
      var t = e.target.closest('[data-toggle]'); if (!t) return;
      var res = await sb.from('announcements').update({ is_active: t.checked }).eq('id', t.getAttribute('data-toggle'));
      if (res.error) { t.checked = !t.checked; Z.toast(Z.errMsg(res.error), 'error'); }
      else { Z.toast(t.checked ? 'Activated' : 'Deactivated', 'ok'); Z.route(); }
    });
  };

  function annForm(a) {
    var isNew = !a; a = a || { type: 'info', priority: 0, is_active: true, user_id: null };
    var chosen = a.user_id ? Object.assign({ id: a.user_id }, relation(a.recipient) || {}) : null;
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New announcement' : 'Edit announcement') + '</h2><form id="anf" novalidate>' +
      (isNew
        ? Z.field({ id: 'au', label: 'Send to', type: 'select', value: 'all', options: [['all', 'Everyone (Zyven Alerts)'], ['user', 'One user (My Mails)']] })
        : '<div class="field"><label>Sent to</label><div class="pick-chosen"><div><b>' + (a.user_id ? 'One user (My Mails)' : 'Everyone (Zyven Alerts)') + '</b>' + (a.user_id ? '<span>' + audience(a).replace(/^To /, '') + '</span>' : '') + '</div></div></div>') +
      '<div id="pick-box" hidden><div class="field"><label>Recipient</label><div class="search">' + Z.icon('search') + '<input class="input" id="pk" type="search" placeholder="Search name or email" autocomplete="off"></div></div>' +
      '<div id="pk-res"></div></div><div id="pk-sel"></div>' +
      Z.field({ id: 'at', label: 'Title', value: a.title, attrs: 'maxlength="100"' }) +
      Z.field({ id: 'am', label: 'Message', type: 'textarea', rows: 4, value: a.message, attrs: 'maxlength="1000"' }) +
      '<div class="two">' + Z.field({ id: 'ty', label: 'Type', type: 'select', value: a.type, options: Object.keys(Z.ANN).map(function (k) { return [k, Z.ANN[k].label]; }) }) +
      Z.field({ id: 'pr', label: 'Priority', type: 'select', value: String(a.priority), options: PRIORITIES }) + '</div>' +
      Z.field({ id: 'ex', label: 'Expires (optional)', type: 'datetime-local', value: Z.toLocalInput(a.expires_at), hint: 'After this time it disappears for users.' }) +
      Z.switchEl('ac', a.is_active, 'Active') +
      Z.switchEl('pu', false, isNew ? 'Also send as push notification' : 'Send as push notification now') +
      '<div id="anerr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Send' : 'Save changes') + '</button>' +
      (isNew ? '' : '<button class="btn btn-danger-ghost btn-block" type="button" id="del">Delete</button>') +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el;

    /* recipient picker (only when creating a personal mail) */
    function drawChosen() {
      Z.$('#pk-sel', el).innerHTML = chosen && isNew
        ? '<div class="pick-chosen"><div><b>' + Z.esc(chosen.full_name || 'User') + '</b><span>' + Z.esc(chosen.email || '') + '</span></div><button type="button" class="link-btn" id="pk-change">Change</button></div>'
        : '';
      var ch = Z.$('#pk-change', el);
      if (ch) ch.addEventListener('click', function () { chosen = null; drawChosen(); syncAudience(); });
    }
    function syncAudience() {
      if (!isNew) return;
      var personal = Z.$('#au', el).value === 'user';
      Z.$('#pick-box', el).hidden = !personal || !!chosen;
      Z.$('#pk-sel', el).hidden = !personal;
    }
    if (isNew) {
      Z.$('#au', el).addEventListener('change', syncAudience);
      Z.$('#pk', el).addEventListener('input', Z.debounce(async function (e) {
        var q = e.target.value.replace(/[,()%*\\]/g, ' ').trim(), res = Z.$('#pk-res', el);
        if (q.length < 2) { res.innerHTML = ''; return; }
        var r = await sb.from('profiles').select('id,full_name,email').or('email.ilike.%' + q + '%,full_name.ilike.%' + q + '%').limit(6);
        res.innerHTML = r.error ? '' : ((r.data || []).map(function (u) {
          return '<button type="button" class="pick-row" data-u="' + u.id + '"><b>' + Z.esc(u.full_name) + '</b><span>' + Z.esc(u.email) + '</span></button>';
        }).join('') || '<p class="muted small" style="margin-top:8px">No user found.</p>');
        res._users = r.data || [];
      }, 300));
      Z.$('#pk-res', el).addEventListener('click', function (e) {
        var b = e.target.closest('[data-u]'); if (!b) return;
        chosen = (Z.$('#pk-res', el)._users || []).filter(function (u) { return u.id === b.getAttribute('data-u'); })[0] || null;
        Z.$('#pk-res', el).innerHTML = ''; drawChosen(); syncAudience();
      });
      syncAudience();
    }

    Z.$('#anf', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#anerr', el);
      var personal = isNew ? Z.$('#au', el).value === 'user' : !!a.user_id;
      var p = {
        title: Z.$('#at', el).value.trim(), message: Z.$('#am', el).value.trim(), type: Z.$('#ty', el).value,
        priority: parseInt(Z.$('#pr', el).value, 10),
        expires_at: Z.$('#ex', el).value ? new Date(Z.$('#ex', el).value).toISOString() : null,
        is_active: Z.$('#ac', el).checked
      };
      if (isNew && personal && !chosen) return Z.formError(err, 'Choose the user who should receive this mail.');
      if (isNew) p.user_id = personal ? chosen.id : null;
      if (!p.title) return Z.formError(err, 'Enter a title.');
      if (!p.message) return Z.formError(err, 'Enter a message.');
      if (p.expires_at && new Date(p.expires_at) <= Date.now() && p.is_active) return Z.formError(err, 'The expiry time must be in the future.');
      var target = isNew ? p.user_id : a.user_id;
      Z.run(Z.$('button[type=submit]', el), async function () {
        var r = isNew ? await sb.from('announcements').insert(p) : await sb.from('announcements').update(p).eq('id', a.id);
        if (r.error) throw r.error;
        var msg = isNew ? (personal ? 'Mail sent' : 'Announcement published') : 'Saved';
        if (Z.$('#pu', el).checked && p.is_active) {
          try {
            var pr = await Z.push.adminSend({ user_id: target || undefined, title: p.title, body: p.message.slice(0, 200), url: target ? '#/notifications/mails' : '#/notifications/alerts' });
            msg += '. Push sent to ' + pr.sent + (pr.sent === 1 ? ' device' : ' devices');
          } catch (e2) { console.error(e2); msg += ', but the push could not be sent'; }
        }
        Z.toast(msg, 'ok'); sh.close(); Z.route();
      }, err);
    });
    var del = Z.$('#del', el);
    if (del) del.addEventListener('click', async function () {
      if (!await Z.confirm({ title: 'Delete this?', text: a.user_id ? 'It will be removed from the user\u2019s mails. This cannot be undone.' : 'It will be removed for every user. This cannot be undone.', confirm: 'Delete', danger: true })) return;
      Z.run(del, async function () {
        var r = await sb.from('announcements').delete().eq('id', a.id);
        if (r.error) throw r.error;
        Z.toast('Deleted', 'ok'); sh.close(); Z.route();
      });
    });
  }

  /* ---------------- Rewards: credit every user in one tap ---------------- */
  var AUD = [['active', 'All active users'], ['verified', 'Verified users only']];

  SECTIONS.rewards = async function (body, ctx) {
    var h = await sb.from('bulk_rewards').select('*').order('created_at', { ascending: false }).limit(10);
    if (ctx.stale()) return;
    var hist = h.data || [];
    body.innerHTML = '<div class="page-head"><div><h2>Reward all users</h2><p class="sub">Credit the same reward to every account at once. Suspended accounts and your own are skipped.</p></div></div>' +
      '<form class="card form" id="bf" novalidate>' +
      Z.field({ id: 'ba', label: 'Reward per user', placeholder: '0.00', attrs: 'inputmode="decimal"', hint: 'Up to ' + Z.money(10000) + ' per user.' }) +
      Z.field({ id: 'bn', label: 'Message (shown to users)', value: 'Reward from Zyven', attrs: 'maxlength="120"' }) +
      Z.field({ id: 'bw', label: 'Who gets it', type: 'select', value: 'active', options: AUD }) +
      Z.switchEl('bm', true, 'Send each user a mail (My Mails)') +
      '<div class="summary" id="bsum"></div><div id="berr"></div>' +
      '<button class="btn btn-primary btn-block" type="submit" id="bgo">Send reward</button></form>' +
      '<div class="section-head"><h3>Recent rewards</h3></div><div class="card" id="bh">' + (hist.length ? hist.map(function (b) {
        return '<div class="row"><span class="row-ic pos">' + Z.icon('gift') + '</span><span class="row-main"><span class="row-title">' + Z.money(b.amount) + ' \u00d7 ' + b.recipients + ' users</span>' +
          '<span class="row-sub">' + Z.esc(b.note) + ' \u00b7 ' + (b.audience === 'verified' ? 'Verified only' : 'All active') + '</span><span class="row-sub">' + Z.fmtDate(b.created_at) + '</span></span>' +
          '<span class="amt">' + Z.money(b.total) + '</span></div>';
      }).join('') : Z.empty({ icon: 'gift', title: 'No rewards sent yet' })) + '</div>';

    var amtEl = Z.$('#ba', body), noteEl = Z.$('#bn', body), audEl = Z.$('#bw', body), sum = Z.$('#bsum', body);
    var reqId = null, lastKey = '', count = null;

    async function preview() {
      var r = await sb.rpc('admin_bulk_preview', { p_audience: audEl.value });
      if (ctx.stale()) return;
      count = r.error ? null : Number(r.data.recipients);
      paint();
    }
    function paint() {
      var a = parseFloat(amtEl.value);
      sum.innerHTML = count === null ? '' : '<div class="kv"><span>Users who will receive it</span><b>' + count + '</b></div>' +
        (isFinite(a) && a > 0 ? '<div class="kv total"><span>Total to credit</span><b>' + Z.money(a * count) + '</b></div>' : '');
    }
    amtEl.addEventListener('input', paint);
    audEl.addEventListener('change', preview);
    preview();

    Z.$('#bf', body).addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = Z.$('#berr', body), a = Math.round(parseFloat(amtEl.value) * 100) / 100, note = noteEl.value.trim();
      if (!isFinite(a) || a <= 0 || a > 10000) return Z.formError(err, 'Enter an amount above zero (up to ' + Z.money(10000) + ').');
      if (note.length < 3) return Z.formError(err, 'Enter a short message of at least 3 characters.');
      if (!count) return Z.formError(err, 'No users match this selection.');
      Z.formError(err, '');
      var ok = await Z.confirm({
        title: 'Credit ' + Z.money(a) + ' to ' + count + ' users?',
        html: '<div class="summary"><div class="kv"><span>Per user</span><b>' + Z.money(a) + '</b></div><div class="kv"><span>Users</span><b>' + count + '</b></div>' +
          '<div class="kv total"><span>Total</span><b>' + Z.money(a * count) + '</b></div></div><p class="muted small">This cannot be undone. A double tap will not pay twice.</p>',
        confirm: 'Send reward'
      });
      if (!ok) return;
      var key = [a, note, audEl.value, Z.$('#bm', body).checked].join('|');
      if (key !== lastKey || !reqId) { reqId = (crypto.randomUUID ? crypto.randomUUID() : null); lastKey = key; }   // same id on a retry = never paid twice
      Z.run(Z.$('#bgo', body), async function () {
        var r = await sb.rpc('admin_bulk_reward', { p_request_id: reqId, p_amount: a, p_note: note, p_audience: audEl.value, p_notify: Z.$('#bm', body).checked });
        if (r.error) throw r.error;
        reqId = null; lastKey = '';
        Z.toast(r.data.duplicate ? 'Already sent earlier' : 'Sent ' + Z.money(a) + ' to ' + r.data.recipients + ' users', 'ok');
        Z.route();
      }, err);
    });
  };

  /* ---------------- Referrals ---------------- */
  SECTIONS.referrals = async function (body, ctx) {
    var res = await Promise.all([sb.rpc('admin_referral_stats'), sb.from('platform_settings').select('*').eq('id', true).single()]);
    if (ctx.stale()) return;
    if (res[0].error || res[1].error) return retry(body, function () { Z.route(); });
    var d = res[0].data, s = res[1].data;
    function stat(label, value, sub) { return '<div class="stat"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; }

    body.innerHTML = '<div class="page-head"><div><h2>Referrals</h2><p class="sub">2-level program overview and rewards.</p></div></div>' +
      '<div class="stat-grid">' +
      stat('Total referrals', d.total, '') + stat('Level 1 / Level 2', d.l1 + ' / ' + d.l2, 'Direct / Indirect') +
      stat('Valid', d.valid, '') + stat('Invalid', d.invalid, 'Missing 3 ads or verified email') +
      stat('Referral bonuses', Z.money(Number(d.bonus_locked) + Number(d.bonus_transferred)), d.bonus_count + ' issued') +
      stat('Bonuses locked', Z.money(d.bonus_locked), 'Waiting in Referral Wallets') +
      stat('Bonuses unlocked', Z.money(d.bonus_transferred), 'Moved to Main Wallets') +
      stat('Commissions paid', Z.money(d.commission_total), d.commission_count + ' payments') + '</div>' +

      '<div class="page-head"><div><h2>Rewards</h2><p class="sub">Changes apply to future bonuses and commissions only. Past records keep the amount, rate and unlock date they were created with.</p></div></div>' +
      '<form class="card form" id="rf" novalidate>' +
      '<h3 class="mini-title" style="margin:0">Level 1 (direct)</h3><div class="two">' +
      Z.field({ id: 'b1', label: 'One-time bonus', value: s.ref_l1_bonus, attrs: 'inputmode="decimal"' }) +
      Z.field({ id: 'c1', label: 'Commission %', value: s.ref_l1_commission, attrs: 'inputmode="decimal"' }) + '</div>' +
      '<h3 class="mini-title" style="margin:0">Level 2 (indirect)</h3><div class="two">' +
      Z.field({ id: 'b2', label: 'One-time bonus', value: s.ref_l2_bonus, attrs: 'inputmode="decimal"' }) +
      Z.field({ id: 'c2', label: 'Commission %', value: s.ref_l2_commission, attrs: 'inputmode="decimal"' }) + '</div>' +
      Z.field({ id: 'ud', label: 'Bonus unlock delay (days)', value: s.ref_unlock_days, attrs: 'inputmode="numeric"', hint: 'Bonuses move from the Referral Wallet to the Main Wallet after this many days. Default 3.' }) +
      '<div id="rferr"></div><button class="btn btn-primary btn-block" type="submit">Save referral settings</button></form>' +

      '<div class="page-head"><div><h2>All referrals</h2><p class="sub">Who referred whom, with name, email and date.</p></div></div>' +
      '<div class="search">' + Z.icon('search') + '<input class="input" id="rfq" type="search" placeholder="Search name or email" autocomplete="off"></div>' +
      Z.chips([['all', 'All'], ['1', 'Level 1'], ['2', 'Level 2'], ['valid', 'Valid'], ['invalid', 'Invalid']], 'all', 'data-rf') +
      '<div class="card" id="rfl"></div><div id="rfm"></div>';

    Z.$('#rf', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#rferr', body);
      var p = {
        ref_l1_bonus: parseFloat(Z.$('#b1', body).value), ref_l1_commission: parseFloat(Z.$('#c1', body).value),
        ref_l2_bonus: parseFloat(Z.$('#b2', body).value), ref_l2_commission: parseFloat(Z.$('#c2', body).value),
        ref_unlock_days: parseInt(Z.$('#ud', body).value, 10)
      };
      if ([p.ref_l1_bonus, p.ref_l2_bonus].some(function (v) { return !isFinite(v) || v < 0; })) return Z.formError(err, 'Bonuses must be zero or more.');
      if ([p.ref_l1_commission, p.ref_l2_commission].some(function (v) { return !isFinite(v) || v < 0 || v > 50; })) return Z.formError(err, 'Commission must be between 0 and 50 percent.');
      if (!isFinite(p.ref_unlock_days) || p.ref_unlock_days < 0 || p.ref_unlock_days > 365) return Z.formError(err, 'Unlock delay must be 0 to 365 days.');
      Z.run(Z.$('button[type=submit]', body), async function () {
        var u = await sb.from('platform_settings').update(p).eq('id', true).select().single();
        if (u.error) throw u.error;
        Z.state.settings = u.data; Z.formError(err, '');
        Z.toast('Referral settings saved', 'ok');
      }, err);
    });

    /* list of every referral */
    var q = '', f = 'all', items = [], done = false, loading = false;
    var rfl = Z.$('#rfl', body), rfm = Z.$('#rfm', body);
    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; done = false; rfl.innerHTML = Z.skel(3, 80); rfm.innerHTML = ''; }
      var qq = sb.from('referrals').select('id,level,status,created_at,validated_at,referrer:profiles!referrals_referrer_id_fkey(full_name,email),referred:profiles!referrals_referred_id_fkey(full_name,email)')
        .order('created_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
      if (f === '1' || f === '2') qq = qq.eq('level', parseInt(f, 10));
      else if (f === 'valid' || f === 'invalid') qq = qq.eq('status', f);
      var none = false;
      if (q) {   // find the matching people first, then every referral where they are either side
        var c = q.replace(/[,()%*\\]/g, ' ').trim();
        var pr = await sb.from('profiles').select('id').or('email.ilike.%' + c + '%,full_name.ilike.%' + c + '%').limit(25);
        var ids = (pr.data || []).map(function (x) { return x.id; });
        if (!ids.length) none = true; else qq = qq.or('referrer_id.in.(' + ids.join(',') + '),referred_id.in.(' + ids.join(',') + ')');
      }
      var r = none ? { data: [] } : await qq;
      loading = false;
      if (ctx.stale()) return;
      if (r.error) return retry(rfl, function () { load(true); });
      items = items.concat(r.data || []); done = (r.data || []).length < PAGE;
      rfl.innerHTML = items.length ? items.map(function (x) {
        var a = relation(x.referred) || {}, b = relation(x.referrer) || {};
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(a.full_name || 'Unknown') + ' <span class="lvl">L' + x.level + '</span></span>' +
          '<span class="row-sub">' + Z.esc(a.email || '') + '</span>' +
          '<span class="row-sub wrap">Referred by ' + Z.esc(b.full_name || 'Unknown') + ' \u00b7 ' + Z.esc(b.email || '') + '</span>' +
          '<span class="row-sub">' + Z.fmtDate(x.created_at) + (x.validated_at ? ' \u00b7 valid ' + Z.fmtDay(x.validated_at) : '') + '</span></span>' + Z.badge(x.status) + '</div>';
      }).join('') : Z.empty({ icon: 'users', title: 'No referrals found' });
      rfm.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="rfmb">Load more</button>';
      var mb = Z.$('#rfmb', rfm); if (mb) mb.addEventListener('click', function () { Z.busy(mb, true); load(false); });
    }
    Z.$('#rfq', body).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim(); load(true); }, 350));
    Z.$('[data-rf]', body).parentNode.addEventListener('click', function (e) {
      var c = e.target.closest('[data-rf]'); if (!c || c.getAttribute('data-rf') === f) return;
      f = c.getAttribute('data-rf');
      Z.$$('[data-rf]', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
    });
    load(true);
  };

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
      '<div id="serr"></div><button class="btn btn-primary btn-block" type="submit">Save settings</button></form>' +
      '<div class="page-head"><div><h2>Support &amp; channels</h2><p class="sub">Links users see in Support and the welcome popup. Leave blank to hide.</p></div></div>' +
      '<form class="card form" id="cf" novalidate>' +
      Z.field({ id: 'sw', label: 'WhatsApp support link', type: 'url', value: s.support_whatsapp, placeholder: 'https://wa.me/923001234567', attrs: 'inputmode="url" autocapitalize="off"' }) +
      Z.field({ id: 'st', label: 'Telegram support link', type: 'url', value: s.support_telegram, placeholder: 'https://t.me/yoursupport', attrs: 'inputmode="url" autocapitalize="off"' }) +
      Z.field({ id: 'se', label: 'Support email', type: 'email', value: s.support_email, placeholder: 'support@example.com', attrs: 'inputmode="email" autocapitalize="off"' }) +
      Z.field({ id: 'cw', label: 'WhatsApp channel link', type: 'url', value: s.channel_whatsapp, placeholder: 'https://whatsapp.com/channel/...', attrs: 'inputmode="url" autocapitalize="off"' }) +
      Z.field({ id: 'ct', label: 'Telegram channel link', type: 'url', value: s.channel_telegram, placeholder: 'https://t.me/yourchannel', attrs: 'inputmode="url" autocapitalize="off"' }) +
      '<div id="cerr"></div><button class="btn btn-primary btn-block" type="submit">Save links</button></form>';
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

    Z.$('#cf', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#cerr', body), bad = null;
      function link(id, label) {
        var v = Z.$('#' + id, body).value.trim();
        if (v && !/^https?:\/\/\S+$/i.test(v)) bad = bad || (label + ' must start with https://');
        return v || null;
      }
      var p = {
        support_whatsapp: link('sw', 'WhatsApp support link'), support_telegram: link('st', 'Telegram support link'),
        channel_whatsapp: link('cw', 'WhatsApp channel link'), channel_telegram: link('ct', 'Telegram channel link'),
        support_email: Z.$('#se', body).value.trim() || null
      };
      if (bad) return Z.formError(err, bad);
      if (p.support_email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.support_email)) return Z.formError(err, 'Enter a valid support email.');
      Z.run(Z.$('#cf button[type=submit]', body), async function () {
        var u = await sb.from('platform_settings').update(p).eq('id', true).select().single();
        if (u.error) throw u.error;
        Z.state.settings = u.data;
        Z.formError(err, '');
        Z.toast('Links saved', 'ok');
      }, err);
    });
  };
})();
