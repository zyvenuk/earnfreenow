/* Admin: Promotion services and promotion requests. Every action is enforced by the database (admin-only functions and RLS). */
(function () {
  'use strict';
  var Z = window.Z;
  var PA = Z.promoAdmin = {};
  var PAGE = 20;
  function retry(box, fn) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', fn); }
  function num(v) { v = String(v == null ? '' : v).trim(); return v === '' ? null : Number(v); }
  function intOrNull(v) { var n = num(v); return n === null ? null : (Number.isInteger(n) ? n : NaN); }
  function ruleText(r) { return (r.from_pos === r.to_pos ? 'Position ' + r.from_pos : 'Positions ' + r.from_pos + '\u2013' + r.to_pos) + ': ' + Z.money(r.price) + ' per step'; }
  var STATUS = { pending: ['Pending Approval', 'b-pending'], active: ['Active', 'b-active'], rejected: ['Rejected', 'b-rejected'], expired: ['Expired', 'b-ended'], suspended: ['Suspended', 'b-rejected'], removed: ['Removed', 'b-ended'] };
  function sbadge(s) { var m = STATUS[s] || [s, '']; return '<span class="badge ' + m[1] + '">' + Z.esc(m[0]) + '</span>'; }

  /* ---------------- Services ---------------- */
  PA.services = async function (body, ctx) {
    var res = await Promise.all([sb.from('promo_services').select('*').order('sort_order').order('name'), sb.from('promo_position_prices').select('*').order('from_pos')]);
    if (ctx.stale()) return;
    if (res[0].error || res[1].error) return retry(body, function () { Z.route(); });
    var list = res[0].data || [], rules = res[1].data || [];
    body.innerHTML = '<div class="page-head"><div><h2>Promotion services</h2><p class="sub">Add any service (WhatsApp, YouTube, TikTok ...) without touching code.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="news">' + Z.icon('plus') + 'New service</button></div>' +
      (list.length ? list.map(function (s) {
        var rs = rules.filter(function (r) { return r.service_id === s.id; });
        return '<div class="card plan-card admin"><div class="plan-top">' + Z.plans.logo(s.logo_path) +
          '<div class="plan-name"><b>' + Z.esc(s.name) + '</b><span>' + (s.is_active ? '<i class="pop">Active</i>' : '<i class="pop">Inactive</i>') + ' \u00b7 ' + Z.esc(s.action_label) + '</span></div>' +
          '<label class="switch"><input type="checkbox" data-toggle="' + s.id + '"' + (s.is_active ? ' checked' : '') + ' aria-label="Active"><i></i></label></div>' +
          '<div class="plan-stats"><div><b>' + Z.money(s.price_per_day) + '</b><span>Per day</span></div><div><b>' + Z.money(s.step_price) + '</b><span>Per position up</span></div><div><b>' + s.min_days + '\u2013' + s.max_days + '</b><span>Days</span></div></div>' +
          '<p class="plan-note">' + (s.allowed_domains ? 'Links allowed from: ' + Z.esc(s.allowed_domains) : 'Any https link') + '</p>' +
          (rs.length ? '<p class="plan-note">' + rs.map(function (r) { return Z.esc(ruleText(r)); }).join(' \u00b7 ') + '</p>' : '') +
          '<div class="two"><button class="btn btn-tonal" data-edit="' + s.id + '">Edit</button><button class="btn btn-tonal" data-rules="' + s.id + '">Position prices</button></div></div>';
      }).join('') : '<div class="card">' + Z.empty({ icon: 'megaphone', title: 'No services yet', text: 'Create the first service users can promote.' }) + '</div>');

    Z.$('#news', body).addEventListener('click', function () { serviceForm(null); });
    body.addEventListener('click', function (e) {
      var ed = e.target.closest('[data-edit]'), rl = e.target.closest('[data-rules]');
      if (ed) serviceForm(list.filter(function (s) { return s.id === ed.getAttribute('data-edit'); })[0]);
      if (rl) rulesSheet(list.filter(function (s) { return s.id === rl.getAttribute('data-rules'); })[0]);
    });
    body.addEventListener('change', async function (e) {
      var t = e.target.closest('[data-toggle]'); if (!t) return;
      var r = await sb.from('promo_services').update({ is_active: t.checked }).eq('id', t.getAttribute('data-toggle'));
      if (r.error) { t.checked = !t.checked; Z.toast(Z.errMsg(r.error), 'error'); }
      else { Z.toast(t.checked ? 'Service activated' : 'Service switched off. No new promotions can use it.', 'ok'); Z.route(); }
    });
  };

  function serviceForm(s) {
    var isNew = !s, A = Z.plansAdmin;
    s = s || { price_per_day: '', step_price: 0, min_days: 1, max_days: 30, action_label: 'Visit', is_active: true, sort_order: 0 };
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New service' : 'Edit service') + '</h2><form id="sf3" novalidate>' +
      Z.field({ id: 'nm', label: 'Service name', value: s.name, placeholder: 'e.g. YouTube Channel', attrs: 'maxlength="40"' }) +
      A.picker('sl', 'Service logo', s.logo_path, 'Pick a picture from your phone. It is resized automatically.') +
      '<div class="two">' + Z.field({ id: 'pd', label: 'Price per day', value: s.price_per_day, attrs: 'inputmode="decimal"' }) +
      Z.field({ id: 'sp', label: 'Per position up', value: s.step_price, attrs: 'inputmode="decimal"', hint: 'Default price for each position a user moves up.' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'mn', label: 'Minimum days', value: s.min_days, attrs: 'inputmode="numeric"' }) + Z.field({ id: 'mx', label: 'Maximum days', value: s.max_days, attrs: 'inputmode="numeric"' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'al', label: 'Button text', value: s.action_label, attrs: 'maxlength="20"', hint: 'Follow, Subscribe, Visit ...' }) + Z.field({ id: 'so', label: 'Sort order', value: s.sort_order, attrs: 'inputmode="numeric"' }) + '</div>' +
      Z.field({ id: 'dm', label: 'Allowed link domains', value: s.allowed_domains, placeholder: 'youtube.com, youtu.be', attrs: 'maxlength="200"', hint: 'Only links from these sites are accepted. Leave empty to accept any https link.' }) +
      Z.switchEl('ac', s.is_active, 'Active') +
      '<p class="hint" style="margin-top:-6px">When off, users cannot create new promotions for this service. Running ones continue.</p>' +
      '<div id="sferr3"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Create service' : 'Save changes') + '</button>' +
      (isNew ? '' : '<button class="btn btn-danger-ghost btn-block" type="button" id="sdel">Delete service</button>') +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el, getFile = A.bindPicker(el, 'sl');
    Z.$('#sf3', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#sferr3', el);
      var v = { name: Z.$('#nm', el).value.trim(), price_per_day: num(Z.$('#pd', el).value), step_price: num(Z.$('#sp', el).value) || 0,
        min_days: intOrNull(Z.$('#mn', el).value), max_days: intOrNull(Z.$('#mx', el).value), action_label: Z.$('#al', el).value.trim() || 'Visit',
        allowed_domains: Z.$('#dm', el).value.trim() || null, sort_order: intOrNull(Z.$('#so', el).value) || 0, is_active: Z.$('#ac', el).checked };
      if (!v.name) return Z.formError(err, 'Enter a service name.');
      if (!(v.price_per_day >= 0) || v.price_per_day === null) return Z.formError(err, 'Enter the price per day (0 or more).');
      if (!(v.step_price >= 0)) return Z.formError(err, 'Per position price cannot be negative.');
      if (!(v.min_days >= 1) || !(v.max_days >= v.min_days) || v.max_days > 365) return Z.formError(err, 'Days must be whole numbers: minimum 1 or more, maximum up to 365 and not below the minimum.');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var file = getFile(), np = null;
        if (file) { np = await A.upload(file, 'promo'); v.logo_path = np; }
        var r = isNew ? await sb.from('promo_services').insert(v) : await sb.from('promo_services').update(v).eq('id', s.id);
        if (r.error) { A.removeFile(np); throw r.error; }
        if (np && s.logo_path) A.removeFile(s.logo_path);
        Z.toast(isNew ? 'Service created' : 'Service saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
    var del = Z.$('#sdel', el);
    if (del) del.addEventListener('click', async function () {
      if (!await Z.confirm({ title: 'Delete this service?', text: 'Only possible if no promotion ever used it. Otherwise switch it off.', confirm: 'Delete', danger: true })) return;
      Z.run(del, async function () {
        var r = await sb.rpc('admin_delete_promo_service', { p_id: s.id });
        if (r.error) throw r.error;
        A.removeFile(r.data && r.data.logo_path);
        Z.toast('Service deleted', 'ok'); sh.close(); Z.route();
      });
    });
  }

  // Price of moving up INTO a position (or range), per step
  function rulesSheet(svc) {
    var sh = Z.sheet('<h2 class="sheet-title">Position prices</h2><p class="sheet-text">' + Z.esc(svc.name) + ': every position a user moves up costs <b>' + Z.money(svc.step_price) + '</b> by default. Set a different price for one position or a range (for example 1 to 3).</p>' +
      '<div id="rlist"></div>' +
      '<form id="rf4" novalidate><div class="two">' + Z.field({ id: 'rf', label: 'From position', attrs: 'inputmode="numeric"' }) + Z.field({ id: 'rt', label: 'To position (optional)', attrs: 'inputmode="numeric"', placeholder: 'Same as from' }) + '</div>' +
      Z.field({ id: 'rp', label: 'Price per step', attrs: 'inputmode="decimal"' }) + '<div id="rerr4"></div>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Add price</button><button class="btn btn-ghost btn-block" type="button" data-close>Done</button></div></form>');
    var el = sh.el;
    async function draw() {
      var r = await sb.from('promo_position_prices').select('*').eq('service_id', svc.id).order('from_pos');
      Z.$('#rlist', el).innerHTML = (r.data || []).length ? '<div class="card flat">' + r.data.map(function (x) {
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(ruleText(x)) + '</span></span><button class="icon-btn sm" data-del="' + x.id + '" aria-label="Remove">' + Z.icon('trash') + '</button></div>';
      }).join('') + '</div>' : '<p class="muted small">No special prices yet.</p>';
    }
    Z.$('#rlist', el).addEventListener('click', async function (e) {
      var b = e.target.closest('[data-del]'); if (!b) return;
      var r = await sb.from('promo_position_prices').delete().eq('id', b.getAttribute('data-del'));
      if (r.error) return Z.toast(Z.errMsg(r.error), 'error');
      draw();
    });
    Z.$('#rf4', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#rerr4', el), f = intOrNull(Z.$('#rf', el).value), t = intOrNull(Z.$('#rt', el).value), p = num(Z.$('#rp', el).value);
      if (!(f >= 1) || Number.isNaN(t) || (t !== null && t < f)) return Z.formError(err, 'Enter whole positions (1 or higher). "To" cannot be below "From".');
      if (!(p >= 0) || p === null) return Z.formError(err, 'Enter the price per step.');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var r = await sb.from('promo_position_prices').insert({ service_id: svc.id, from_pos: f, to_pos: t === null ? f : t, price: p });
        if (r.error) throw r.error;
        Z.formError(err, ''); Z.$('#rf', el).value = ''; Z.$('#rt', el).value = ''; Z.$('#rp', el).value = ''; draw();
      }, err);
    });
    draw();
    sh.el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) Z.route(); });
  }

  /* ---------------- Promotion requests ---------------- */
  PA.list = async function (body, ctx) {
    var status = 'pending', items = [], done = false, loading = false;
    body.innerHTML = '<div class="page-head"><div><h2>Promotions</h2><p class="sub">Review requests and manage live promotions.</p></div></div>' +
      Z.chips([['pending', 'Pending'], ['active', 'Active'], ['expired', 'Expired'], ['rejected', 'Rejected'], ['suspended', 'Suspended'], ['all', 'All']], 'pending', 'data-ps') +
      '<div id="pl2"></div><div id="pm2"></div>';
    var pl = Z.$('#pl2', body), pm = Z.$('#pm2', body);

    function card(p) {
      var acts = '';
      if (p.status === 'pending') acts = '<button class="btn btn-primary btn-sm" data-act="approve">Approve</button><button class="btn btn-danger-ghost btn-sm" data-act="reject">Reject</button>';
      else if (p.status === 'active') acts = '<button class="btn btn-tonal btn-sm" data-act="move">Move position</button><button class="btn btn-tonal btn-sm" data-act="suspend">Suspend</button><button class="btn btn-danger-ghost btn-sm" data-act="remove">Remove</button>';
      else if (p.status === 'suspended') acts = '<button class="btn btn-primary btn-sm" data-act="reactivate">Reactivate</button><button class="btn btn-danger-ghost btn-sm" data-act="remove">Remove</button>';
      return '<div class="card plan-card admin" data-id="' + p.id + '"><div class="plan-top">' + Z.plans.logo(p.logo_path) +
        '<div class="plan-name"><b>' + Z.esc(p.title) + '</b><span>' + Z.esc(p.service_name) + ' \u00b7 ' + Z.esc(p.category) + '</span></div>' + sbadge(p.status) + '</div>' +
        '<div class="summary"><div class="kv"><span>User</span><b>' + Z.esc(p.full_name) + '</b></div><div class="kv"><span>Email</span><b>' + Z.esc(p.email) + '</b></div>' +
        '<div class="kv"><span>Link</span><b><a class="link" href="' + Z.esc(p.link) + '" target="_blank" rel="noopener noreferrer nofollow">Open link</a></b></div>' +
        '<div class="kv"><span>Duration</span><b>' + p.days + ' days</b></div>' +
        '<div class="kv"><span>Position</span><b>' + (p.position ? '#' + p.position + ' live' : '#' + p.requested_pos + ' requested') + '</b></div>' +
        '<div class="kv"><span>Price</span><b>' + Z.money(p.duration_price) + ' + ' + Z.money(p.position_price) + '</b></div>' +
        '<div class="kv total"><span>Total paid</span><b>' + Z.money(p.total_price) + '</b></div>' +
        '<div class="kv"><span>Requested</span><b>' + Z.fmtDate(p.created_at) + '</b></div>' +
        (p.expires_at ? '<div class="kv"><span>' + (p.status === 'expired' ? 'Expired' : 'Expires') + '</span><b>' + Z.fmtDate(p.expires_at) + '</b></div>' : '') + '</div>' +
        '<p class="plan-desc">' + Z.esc(p.description) + '</p>' +
        (p.reject_reason ? '<div class="alert a-error">' + Z.icon('info') + '<div>' + Z.esc(p.reject_reason) + '</div></div>' : '') +
        (acts ? '<div class="pc-actions">' + acts + '</div>' : '') + '</div>';
    }

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; done = false; pl.innerHTML = Z.skel(2, 260); pm.innerHTML = ''; }
      var r = await sb.rpc('admin_list_promotions', { p_status: status, p_limit: PAGE, p_offset: items.length });
      loading = false;
      if (ctx.stale()) return;
      if (r.error) return retry(pl, function () { load(true); });
      items = items.concat(r.data || []); done = (r.data || []).length < PAGE;
      pl.innerHTML = items.length ? items.map(card).join('') : '<div class="card">' + Z.empty({ icon: 'megaphone', title: status === 'pending' ? 'No requests waiting' : 'Nothing here', text: status === 'pending' ? 'New promotion requests will appear here.' : '' }) + '</div>';
      pm.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="pmb2">Load more</button>';
      var b = Z.$('#pmb2', pm); if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }

    function reasonSheet(title, text, label, required, btn, fn) {
      var sh = Z.sheet('<h2 class="sheet-title">' + title + '</h2><p class="sheet-text">' + text + '</p><form id="rs2" novalidate>' +
        Z.field({ id: 'rr', label: label, type: 'textarea', rows: 3, attrs: 'maxlength="300"' }) + '<div id="rserr"></div>' +
        '<div class="sheet-actions"><button class="btn btn-danger btn-block" type="submit">' + btn + '</button><button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
      Z.$('#rs2', sh.el).addEventListener('submit', function (e) {
        e.preventDefault();
        var reason = Z.$('#rr', sh.el).value.trim();
        if (required && reason.length < 3) return Z.formError(Z.$('#rserr', sh.el), 'Enter a reason of at least 3 characters.');
        Z.run(Z.$('button[type=submit]', sh.el), async function () { await fn(reason); sh.close(); load(true); }, Z.$('#rserr', sh.el));
      });
    }

    pl.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-act]'); if (!b) return;
      var id = b.closest('[data-id]').getAttribute('data-id'), act = b.getAttribute('data-act');
      var p = items.filter(function (x) { return x.id === id; })[0];
      if (act === 'approve') {
        if (!await Z.confirm({ title: 'Approve this promotion?', text: 'It goes live at position #' + p.requested_pos + ' (or the next free number) and its ' + p.days + ' days start now.', confirm: 'Approve' })) return;
        Z.run(b, async function () {
          var r = await sb.rpc('admin_approve_promotion', { p_id: id });
          if (r.error) throw r.error;
          Z.toast('Approved at position #' + r.data.position, 'ok'); load(true);
        });
      }
      if (act === 'reject') reasonSheet('Reject promotion', Z.money(p.total_price) + ' will be returned to the user\u2019s Main Wallet.', 'Reason (shown to the user)', true, 'Reject and refund', async function (reason) {
        var r = await sb.rpc('admin_reject_promotion', { p_id: id, p_reason: reason }); if (r.error) throw r.error; Z.toast('Rejected and refunded', 'ok');
      });
      if (act === 'suspend' || act === 'remove') reasonSheet(act === 'suspend' ? 'Suspend promotion' : 'Remove promotion', 'It disappears from the public page. Other promotions move up automatically. No refund is given.', 'Reason (optional, shown to the user)', false, act === 'suspend' ? 'Suspend' : 'Remove', async function (reason) {
        var r = await sb.rpc('admin_set_promotion_status', { p_id: id, p_status: act === 'suspend' ? 'suspended' : 'removed', p_reason: reason || null }); if (r.error) throw r.error; Z.toast(act === 'suspend' ? 'Suspended' : 'Removed', 'ok');
      });
      if (act === 'reactivate') {
        Z.run(b, async function () { var r = await sb.rpc('admin_set_promotion_status', { p_id: id, p_status: 'active' }); if (r.error) throw r.error; Z.toast('Promotion is live again', 'ok'); load(true); });
      }
      if (act === 'move') {
        var sh = Z.sheet('<h2 class="sheet-title">Move position</h2><p class="sheet-text">Currently #' + p.position + '. Other promotions shift automatically so numbers never repeat.</p><form id="mv" novalidate>' +
          Z.field({ id: 'mp', label: 'New position', value: p.position, attrs: 'inputmode="numeric"' }) + '<div id="mverr"></div>' +
          '<div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Move</button><button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
        Z.$('#mv', sh.el).addEventListener('submit', function (ev) {
          ev.preventDefault();
          var k = intOrNull(Z.$('#mp', sh.el).value);
          if (!(k >= 1)) return Z.formError(Z.$('#mverr', sh.el), 'Enter a whole position of 1 or higher.');
          Z.run(Z.$('button[type=submit]', sh.el), async function () {
            var r = await sb.rpc('admin_move_promotion', { p_id: id, p_position: k }); if (r.error) throw r.error;
            Z.toast('Position updated', 'ok'); sh.close(); load(true);
          }, Z.$('#mverr', sh.el));
        });
      }
    });
    Z.$('[data-ps]', body).parentNode.addEventListener('click', function (e) {
      var c = e.target.closest('[data-ps]'); if (!c || c.getAttribute('data-ps') === status) return;
      status = c.getAttribute('data-ps');
      Z.$$('[data-ps]', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
    });
    load(true);
  };
})();
