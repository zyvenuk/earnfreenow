/* Admin: Plans, Subscriptions, Badges. Every write is protected by the database (admin-only RLS, column grants and triggers);
   this file only provides the screens. */
(function () {
  'use strict';
  var Z = window.Z;
  var A = Z.plansAdmin = {};
  var PAGE = 20, BUCKET = 'plan-assets';
  function rel(x) { return Array.isArray(x) ? x[0] : x; }
  function retry(box, fn) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', fn); }
  function num(v) { v = String(v == null ? '' : v).trim(); return v === '' ? null : Number(v); }
  function intOrNull(v) { var n = num(v); return n === null ? null : (Number.isInteger(n) ? n : NaN); }

  /* ---------------- Images picked from the device gallery ---------------- */
  async function prepare(file) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw { message: 'invalid_image' };
    if (file.size > 8 * 1024 * 1024) throw { message: 'image_too_large' };
    var bmp = await createImageBitmap(file), max = 256, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
    var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * sc)); c.height = Math.max(1, Math.round(bmp.height * sc));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    var blob = await new Promise(function (res) { c.toBlob(res, 'image/webp', 0.85); });
    if (!blob) throw { message: 'invalid_image' };
    return blob;
  }
  async function upload(file, folder) {
    var blob = await prepare(file);
    var path = folder + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) + (blob.type === 'image/png' ? '.png' : '.webp');
    var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
    if (r.error) throw r.error;
    return path;
  }
  function removeFile(path) { if (path) sb.storage.from(BUCKET).remove([path]).then(function () {}, function () {}); }

  function picker(id, label, path, hint) {
    return '<div class="field"><label>' + label + '</label><div class="img-pick"><span class="img-prev" id="' + id + '-prev">' +
      Z.plans.logo(path, 'sm') + '</span><label class="btn btn-tonal btn-sm" for="' + id + '-file">Choose from gallery</label>' +
      '<input type="file" id="' + id + '-file" accept="image/png,image/jpeg,image/webp" hidden></div><div class="hint">' + hint + '</div></div>';
  }
  function bindPicker(el, id) {
    var chosen = null, inp = Z.$('#' + id + '-file', el);
    inp.addEventListener('change', function () {
      chosen = inp.files && inp.files[0] || null;
      if (chosen) Z.$('#' + id + '-prev', el).innerHTML = '<span class="plan-logo sm"><img src="' + URL.createObjectURL(chosen) + '" alt=""></span>';
    });
    return function () { return chosen; };
  }

  /* ---------------- Plans ---------------- */
  A.plans = async function (body, ctx) {
    var res = await Promise.all([sb.rpc('admin_list_plans'), sb.from('platform_settings').select('*').eq('id', true).single()]);
    if (ctx.stale()) return;
    if (res[0].error || res[1].error) return retry(body, function () { Z.route(); });
    var all = res[0].data, st = res[1].data, filter = 'all', q = '';

    body.innerHTML = '<div class="page-head"><div><h2>Plans</h2><p class="sub">What users can activate or buy.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="newp">' + Z.icon('plus') + 'New plan</button></div>' +

      '<form class="card form" id="rules" novalidate><h3 class="mini-title" style="margin:0">Plan rules</h3>' +
      Z.switchEl('pe', st.plans_enabled, 'Plans system enabled') +
      '<p class="hint" style="margin-top:-6px">OFF: ads work as before. ON: users need an active plan to watch ads, and the plan sets their daily limit and reward per ad.</p>' +
      Z.field({ id: 'pp', label: 'Several plans at once', type: 'select', value: st.plan_policy, options: [['highest', 'Allowed. The best plan is used; limits never add up'], ['one_active', 'Not allowed. One active plan per user']] }) +
      Z.field({ id: 'pm', label: 'Max plans per user (all time)', value: st.plan_max_per_user, placeholder: 'No limit', attrs: 'inputmode="numeric"' }) +
      Z.switchEl('pr', st.plan_allow_repurchase, 'Same plan can be activated again after it ends') +
      Z.switchEl('pf', st.plan_free_counts, 'Free plans count toward the per-user limit') +
      Z.field({ id: 'pb', label: 'Popularity is counted from', type: 'select', value: st.badge_count_mode, options: [['active', 'Users who currently hold the plan'], ['all', 'Every user who ever activated it']] }) +
      '<div id="rerr"></div><button class="btn btn-primary btn-block" type="submit">Save rules</button></form>' +

      '<div class="search">' + Z.icon('search') + '<input class="input" id="pq" type="search" placeholder="Search plan name or number" autocomplete="off"></div>' +
      Z.chips([['all', 'All'], ['free', 'Free'], ['paid', 'Paid'], ['active', 'Active'], ['inactive', 'Inactive'], ['archived', 'Archived']], 'all', 'data-pf') +
      '<div id="plist"></div>';

    var box = Z.$('#plist', body);
    function paint() {
      var rows = all.filter(function (p) {
        if (filter === 'free' || filter === 'paid') { if (p.plan_type !== filter) return false; }
        else if (filter === 'active') { if (!p.is_active || p.is_archived) return false; }
        else if (filter === 'inactive') { if (p.is_active) return false; }
        else if (filter === 'archived') { if (!p.is_archived) return false; }
        return !q || (p.name.toLowerCase().indexOf(q) !== -1 || String(p.plan_no) === q);
      });
      box.innerHTML = rows.length ? rows.map(function (p) {
        var pot = Z.plans.potential(p);
        return '<div class="card plan-card admin"><div class="plan-top">' + Z.plans.logo(p.logo_path) +
          '<div class="plan-name"><b>Plan ' + p.plan_no + ' \u00b7 ' + Z.esc(p.name) + '</b><span>' + Z.plans.tag(p.plan_type) + ' ' +
          (p.is_archived ? '<i class="pop">Archived</i>' : p.is_active ? '' : '<i class="pop">Inactive</i>') + '</span></div>' + Z.plans.badge(p.badge) + '</div>' +
          '<div class="plan-price ' + (p.plan_type === 'free' ? 'free' : '') + '">' + Z.plans.price(p) + '</div>' +
          '<div class="plan-calc"><span>' + pot.line + '</span><b>' + Z.money(pot.total) + '</b><em>potential</em></div>' +
          '<div class="plan-stats four"><div><b>' + p.active_users + '</b><span>Active</span></div><div><b>' + p.expired_count + '</b><span>Expired</span></div>' +
          '<div><b>' + p.total_activations + '</b><span>Total</span></div><div><b>' + p.popularity + '</b><span>Popularity</span></div></div>' +
          '<p class="plan-note">Limit: ' + (p.max_activations ? p.activations + ' / ' + p.max_activations + ' activations' : p.activations + ' activations, no limit') +
          ' \u00b7 ' + (p.per_user_limit ? p.per_user_limit + ' per user' : 'no per-user limit') +
          (p.plan_type === 'paid' ? ' \u00b7 spent by users ' + Z.money(p.spent_by_users) : '') + '</p>' +
          '<button class="btn btn-tonal btn-block" data-edit="' + p.id + '">Edit plan</button></div>';
      }).join('') : '<div class="card">' + Z.empty({ icon: 'layout', title: 'No plans found' }) + '</div>';
    }
    paint();

    Z.$('#pq', body).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim().toLowerCase(); paint(); }, 200));
    Z.$('[data-pf]', body).parentNode.addEventListener('click', function (e) {
      var c = e.target.closest('[data-pf]'); if (!c) return;
      filter = c.getAttribute('data-pf');
      Z.$$('[data-pf]', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      paint();
    });
    Z.$('#newp', body).addEventListener('click', function () { planForm(null, all); });
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit]'); if (!b) return;
      planForm(all.filter(function (p) { return p.id === b.getAttribute('data-edit'); })[0], all);
    });

    Z.$('#rules', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#rerr', body), mx = intOrNull(Z.$('#pm', body).value);
      if (Number.isNaN(mx) || (mx !== null && mx < 1)) return Z.formError(err, 'Max plans per user must be a whole number above zero, or empty.');
      var on = Z.$('#pe', body).checked;
      var payload = { plans_enabled: on, plan_policy: Z.$('#pp', body).value, plan_max_per_user: mx,
        plan_allow_repurchase: Z.$('#pr', body).checked, plan_free_counts: Z.$('#pf', body).checked, badge_count_mode: Z.$('#pb', body).value };
      if (on && !st.plans_enabled && !all.some(function (p) { return p.plan_type === 'free' && p.is_active && !p.is_archived; })) {
        return Z.formError(err, 'Add and activate at least one FREE plan first, or users will have no way to start earning.');
      }
      Z.run(Z.$('button[type=submit]', body), async function () {
        var r = await sb.from('platform_settings').update(payload).eq('id', true).select().single();
        if (r.error) throw r.error;
        Z.state.settings = r.data; st = r.data; Z.formError(err, '');
        Z.toast('Plan rules saved', 'ok');
      }, err);
    });
  };

  function planForm(p, all) {
    var isNew = !p;
    p = p || { plan_type: 'free', price: 0, daily_ad_limit: 5, reward_per_ad: '', duration_days: 30, is_active: true, is_archived: false, sort_order: 0,
      plan_no: Math.max.apply(null, [0].concat(all.map(function (x) { return x.plan_no; }))) + 1 };
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New plan' : 'Edit plan ' + p.plan_no) + '</h2><form id="pf2" novalidate>' +
      (isNew ? '' : '<div class="alert a-info">' + Z.icon('info') + '<div>Subscribers keep the terms they activated with. Changes apply to new activations only.</div></div>') +
      '<div class="two">' + Z.field({ id: 'no', label: 'Plan number', value: p.plan_no, attrs: 'inputmode="numeric"' }) +
      Z.field({ id: 'ty', label: 'Type', type: 'select', value: p.plan_type, options: [['free', 'Free'], ['paid', 'Paid']] }) + '</div>' +
      Z.field({ id: 'nm', label: 'Plan name', value: p.name, attrs: 'maxlength="60"' }) +
      picker('lg', 'Plan logo', p.logo_path, 'Pick a picture from your phone. It is resized automatically.') +
      '<div id="price-box">' + Z.field({ id: 'pr', label: 'Price (paid from the user\u2019s Main Wallet)', value: p.plan_type === 'paid' ? p.price : '', attrs: 'inputmode="decimal"' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'dl', label: 'Ads per day', value: p.daily_ad_limit, attrs: 'inputmode="numeric"' }) +
      Z.field({ id: 'rw', label: 'Reward per ad', value: p.reward_per_ad, attrs: 'inputmode="decimal"' }) + '</div>' +
      Z.field({ id: 'du', label: 'Duration (days)', value: p.duration_days, attrs: 'inputmode="numeric"' }) +
      '<div class="plan-calc" id="pot"></div>' +
      Z.field({ id: 'ds', label: 'Description', type: 'textarea', rows: 2, value: p.description, attrs: 'maxlength="500"' }) +
      Z.field({ id: 'bn', label: 'Benefits (one per line)', type: 'textarea', rows: 3, value: p.benefits, attrs: 'maxlength="800"' }) +
      '<div class="two">' + Z.field({ id: 'mx', label: 'Max activations (all users)', value: p.max_activations, placeholder: 'No limit', attrs: 'inputmode="numeric"' }) +
      Z.field({ id: 'pu', label: 'Max per user (this plan)', value: p.per_user_limit, placeholder: 'No limit', attrs: 'inputmode="numeric"' }) + '</div>' +
      Z.field({ id: 'so', label: 'Sort order', value: p.sort_order, attrs: 'inputmode="numeric"', hint: 'Lower numbers show first.' }) +
      Z.switchEl('ac', p.is_active, 'Active') +
      '<p class="hint" style="margin-top:-6px">Inactive hides the plan and pauses earning for its current subscribers.</p>' +
      Z.switchEl('ar', p.is_archived, 'Archived') +
      '<p class="hint" style="margin-top:-6px">Archived hides it from new buyers. Current subscribers keep earning until it ends.</p>' +
      '<div id="pferr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Create plan' : 'Save changes') + '</button>' +
      (isNew ? '' : '<button class="btn btn-tonal btn-block" type="button" id="subs">View subscriptions</button>') +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el, getFile = bindPicker(el, 'lg');

    function sync() {
      var paid = Z.$('#ty', el).value === 'paid';
      Z.$('#price-box', el).hidden = !paid;
      var d = num(Z.$('#dl', el).value), r = num(Z.$('#rw', el).value), n = num(Z.$('#du', el).value);
      Z.$('#pot', el).innerHTML = (d > 0 && r > 0 && n > 0)
        ? '<span>' + d + ' ads \u00d7 ' + Z.money(r) + ' \u00d7 ' + n + ' days = </span><b>' + Z.money(d * r * n) + '</b><em>potential rewards</em>' : '<span class="muted">Fill the numbers above to preview the potential rewards.</span>';
    }
    ['ty', 'dl', 'rw', 'du'].forEach(function (id) { Z.$('#' + id, el).addEventListener('input', sync); Z.$('#' + id, el).addEventListener('change', sync); });
    sync();
    var sb2 = Z.$('#subs', el);
    if (sb2) sb2.addEventListener('click', function () { Z.state.subsPlan = p.id; sh.close(); Z.go('/admin/subscriptions'); });

    Z.$('#pf2', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#pferr', el), paid = Z.$('#ty', el).value === 'paid';
      var v = {
        plan_no: intOrNull(Z.$('#no', el).value), name: Z.$('#nm', el).value.trim(), plan_type: paid ? 'paid' : 'free',
        price: paid ? num(Z.$('#pr', el).value) : 0, daily_ad_limit: intOrNull(Z.$('#dl', el).value), reward_per_ad: num(Z.$('#rw', el).value),
        duration_days: intOrNull(Z.$('#du', el).value), description: Z.$('#ds', el).value.trim() || null, benefits: Z.$('#bn', el).value.trim() || null,
        max_activations: intOrNull(Z.$('#mx', el).value), per_user_limit: intOrNull(Z.$('#pu', el).value),
        sort_order: intOrNull(Z.$('#so', el).value) || 0, is_active: Z.$('#ac', el).checked, is_archived: Z.$('#ar', el).checked
      };
      function bad(m) { Z.formError(err, m); return true; }
      if (!v.plan_no || v.plan_no < 1 || Number.isNaN(v.plan_no)) return bad('Enter a plan number (1 or higher).');
      if (!v.name) return bad('Enter a plan name.');
      if (paid && !(v.price > 0)) return bad('A paid plan needs a price above zero.');
      if (!(v.daily_ad_limit >= 1 && v.daily_ad_limit <= 1000)) return bad('Ads per day must be a whole number from 1 to 1000.');
      if (!(v.reward_per_ad > 0)) return bad('Enter a reward per ad above zero.');
      if (!(v.duration_days >= 1 && v.duration_days <= 3650)) return bad('Duration must be a whole number of days from 1 to 3650.');
      if (Number.isNaN(v.max_activations) || (v.max_activations !== null && v.max_activations < 1)) return bad('Max activations must be a whole number above zero, or empty.');
      if (Number.isNaN(v.per_user_limit) || (v.per_user_limit !== null && v.per_user_limit < 1)) return bad('Max per user must be a whole number above zero, or empty.');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var file = getFile(), newPath = null;
        if (file) { newPath = await upload(file, 'plans'); v.logo_path = newPath; }
        var r = isNew ? await sb.from('plans').insert(v) : await sb.from('plans').update(v).eq('id', p.id);
        if (r.error) { removeFile(newPath); throw r.error; }
        if (newPath && p.logo_path) removeFile(p.logo_path);
        Z.toast(isNew ? 'Plan created' : 'Plan saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
  }

  /* ---------------- Subscriptions ---------------- */
  A.subs = async function (body, ctx) {
    var pl = await sb.from('plans').select('id,plan_no,name').order('plan_no');
    if (ctx.stale()) return;
    var plans = pl.data || [], status = 'all', planId = Z.state.subsPlan || '', q = '', items = [], done = false, loading = false;
    Z.state.subsPlan = '';
    body.innerHTML = '<div class="page-head"><div><h2>Subscriptions</h2><p class="sub">Every activation and purchase, with its dates.</p></div></div>' +
      '<div class="search">' + Z.icon('search') + '<input class="input" id="sq" type="search" placeholder="Search user name or email" autocomplete="off"></div>' +
      Z.field({ id: 'sp', label: 'Plan', type: 'select', value: planId, options: [['', 'All plans']].concat(plans.map(function (x) { return [x.id, 'Plan ' + x.plan_no + ' \u00b7 ' + x.name]; })) }) +
      Z.chips([['all', 'All'], ['active', 'Active'], ['expired', 'Expired']], 'all', 'data-ss') +
      '<div class="card" id="sl"></div><div id="sm"></div>';
    var sl = Z.$('#sl', body), sm = Z.$('#sm', body);

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; done = false; sl.innerHTML = Z.skel(3, 80); sm.innerHTML = ''; }
      var nowIso = new Date().toISOString();
      var qq = sb.from('user_plans').select('id,plan_id,plan_no,plan_name,plan_type,price_paid,activated_at,expires_at,status,profiles(full_name,email)')
        .order('activated_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
      if (planId) qq = qq.eq('plan_id', planId);
      if (status === 'active') qq = qq.eq('status', 'active').gt('expires_at', nowIso);
      if (status === 'expired') qq = qq.or('status.eq.expired,expires_at.lte.' + nowIso);
      var none = false;
      if (q) {
        var c = q.replace(/[,()%*\\]/g, ' ').trim();
        var pr = await sb.from('profiles').select('id').or('email.ilike.%' + c + '%,full_name.ilike.%' + c + '%').limit(25);
        var ids = (pr.data || []).map(function (x) { return x.id; });
        if (!ids.length) none = true; else qq = qq.in('user_id', ids);
      }
      var r = none ? { data: [] } : await qq;
      loading = false;
      if (ctx.stale()) return;
      if (r.error) return retry(sl, function () { load(true); });
      items = items.concat(r.data || []); done = (r.data || []).length < PAGE;
      var now = Date.now();
      sl.innerHTML = items.length ? items.map(function (x) {
        var u = rel(x.profiles) || {}, live = x.status === 'active' && new Date(x.expires_at).getTime() > now;
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(u.full_name || 'Unknown') + '</span>' +
          '<span class="row-sub">' + Z.esc(u.email || '') + '</span>' +
          '<span class="row-sub wrap">Plan ' + x.plan_no + ' \u00b7 ' + Z.esc(x.plan_name) + ' \u00b7 ' + (x.plan_type === 'free' ? 'Free' : 'Paid ' + Z.money(x.price_paid)) + '</span>' +
          '<span class="row-sub wrap">' + Z.fmtDate(x.activated_at) + ' \u2192 ' + Z.fmtDate(x.expires_at) + '</span></span>' +
          '<span class="badge ' + (live ? 'b-active' : 'b-ended') + '">' + (live ? 'Active' : 'Expired') + '</span></div>';
      }).join('') : Z.empty({ icon: 'receipt', title: 'No subscriptions found' });
      sm.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="smb">Load more</button>';
      var b = Z.$('#smb', sm); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }
    Z.$('#sq', body).addEventListener('input', Z.debounce(function (e) { q = e.target.value.trim(); load(true); }, 350));
    Z.$('#sp', body).addEventListener('change', function (e) { planId = e.target.value; load(true); });
    Z.$('[data-ss]', body).parentNode.addEventListener('click', function (e) {
      var c = e.target.closest('[data-ss]'); if (!c) return;
      status = c.getAttribute('data-ss');
      Z.$$('[data-ss]', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
    });
    load(true);
  };

  /* ---------------- Badges ---------------- */
  A.badges = async function (body, ctx) {
    var res = await Promise.all([sb.from('plan_badges').select('*').order('priority', { ascending: false }), sb.from('platform_settings').select('badge_count_mode').eq('id', true).single()]);
    if (ctx.stale()) return;
    if (res[0].error) return retry(body, function () { Z.route(); });
    var list = res[0].data || [], mode = res[1].data && res[1].data.badge_count_mode;
    body.innerHTML = '<div class="page-head"><div><h2>Plan badges</h2><p class="sub">Assigned to plans automatically. Each plan gets the highest-ranking badge whose threshold it meets.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="newb">' + Z.icon('plus') + 'New badge</button></div>' +
      '<div class="alert a-info">' + Z.icon('info') + '<div>Popularity = ' + (mode === 'all' ? 'every user who ever activated the plan' : 'users who currently hold the plan') +
      '. It rises and falls on its own, and badges follow. Change this under Plans \u2192 Plan rules.</div></div>' +
      '<div class="card">' + (list.length ? list.map(function (b) {
        return '<div class="row">' + '<span class="row-main-btn" style="flex:none">' + Z.plans.badge(b) + '</span>' +
          '<button class="row-btn row-main-btn" data-edit="' + b.id + '"><span class="row-main"><span class="row-title">' + Z.esc(b.name) + '</span>' +
          '<span class="row-sub">' + b.min_count + '+ users \u00b7 rank ' + b.priority + '</span></span></button>' +
          '<label class="switch"><input type="checkbox" data-toggle="' + b.id + '"' + (b.is_active ? ' checked' : '') + ' aria-label="Active"><i></i></label></div>';
      }).join('') : Z.empty({ icon: 'shield', title: 'No badges yet', text: 'Create badges such as New, Rising, Popular, Hot.' })) + '</div>';

    Z.$('#newb', body).addEventListener('click', function () { badgeForm(null); });
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit]'); if (!b) return;
      badgeForm(list.filter(function (x) { return x.id === b.getAttribute('data-edit'); })[0]);
    });
    body.addEventListener('change', async function (e) {
      var t = e.target.closest('[data-toggle]'); if (!t) return;
      var r = await sb.from('plan_badges').update({ is_active: t.checked }).eq('id', t.getAttribute('data-toggle'));
      if (r.error) { t.checked = !t.checked; Z.toast(Z.errMsg(r.error), 'error'); }
      else { Z.toast(t.checked ? 'Badge activated' : 'Badge deactivated', 'ok'); Z.route(); }
    });
  };

  function badgeForm(b) {
    var isNew = !b;
    b = b || { name: '', min_count: 1, priority: 1, is_active: true };
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New badge' : 'Edit badge') + '</h2><form id="bf2" novalidate>' +
      '<div class="field"><label>Preview</label><div id="bprev"></div></div>' +
      Z.field({ id: 'bn', label: 'Badge name', value: b.name, placeholder: 'e.g. Popular', attrs: 'maxlength="30"' }) +
      picker('bi', 'Badge symbol / image', b.image_path, 'Optional. Pick a small picture from your phone.') +
      '<div class="two">' + Z.field({ id: 'bm', label: 'Minimum users', value: b.min_count, attrs: 'inputmode="numeric"' }) +
      Z.field({ id: 'bp', label: 'Rank (priority)', value: b.priority, attrs: 'inputmode="numeric"', hint: 'Higher rank = needs more users.' }) + '</div>' +
      Z.switchEl('ba', b.is_active, 'Active') +
      '<div id="bferr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Create badge' : 'Save changes') + '</button>' +
      (isNew ? '' : '<button class="btn btn-danger-ghost btn-block" type="button" id="bdel">Delete badge</button>') +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el, getFile = bindPicker(el, 'bi'), tmpUrl = null;
    function prev() {
      var name = Z.$('#bn', el).value.trim() || 'Badge', f = getFile();
      if (f && !tmpUrl) tmpUrl = URL.createObjectURL(f);
      var img = f ? '<img src="' + tmpUrl + '" alt="">' : (b.image_path ? '<img src="' + Z.esc(Z.plans.url(b.image_path)) + '" alt="">' : '');
      Z.$('#bprev', el).innerHTML = '<span class="plan-badge">' + img + Z.esc(name) + '</span>';
    }
    Z.$('#bn', el).addEventListener('input', prev);
    Z.$('#bi-file', el).addEventListener('change', function () { tmpUrl = null; prev(); });
    prev();

    Z.$('#bf2', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#bferr', el);
      var v = { name: Z.$('#bn', el).value.trim(), min_count: intOrNull(Z.$('#bm', el).value), priority: intOrNull(Z.$('#bp', el).value), is_active: Z.$('#ba', el).checked };
      if (!v.name) return Z.formError(err, 'Enter a badge name.');
      if (!(v.min_count >= 1)) return Z.formError(err, 'Minimum users must be a whole number of 1 or more.');
      if (!(v.priority >= 1 && v.priority <= 1000)) return Z.formError(err, 'Rank must be a whole number from 1 to 1000.');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var file = getFile(), newPath = null;
        if (file) { newPath = await upload(file, 'badges'); v.image_path = newPath; }
        var r = isNew ? await sb.from('plan_badges').insert(v) : await sb.from('plan_badges').update(v).eq('id', b.id);
        if (r.error) { removeFile(newPath); throw r.error; }
        if (newPath && b.image_path) removeFile(b.image_path);
        Z.toast(isNew ? 'Badge created' : 'Badge saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
    var del = Z.$('#bdel', el);
    if (del) del.addEventListener('click', async function () {
      if (!await Z.confirm({ title: 'Delete this badge?', text: 'Plans that showed it will fall back to the next badge they qualify for.', confirm: 'Delete', danger: true })) return;
      Z.run(del, async function () {
        var r = await sb.from('plan_badges').delete().eq('id', b.id);
        if (r.error) throw r.error;
        removeFile(b.image_path);
        Z.toast('Badge deleted', 'ok'); sh.close(); Z.route();
      });
    });
  }
})();
