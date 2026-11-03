/* Admin: Premium Apps store. Every write is enforced by the database (admin-only RLS, constraints and functions);
   this file only provides the screens. Icons live in Supabase Storage (plan-assets/apps/...). */
(function () {
  'use strict';
  var Z = window.Z;
  var AA = Z.appsAdmin = {};
  var UNITS = [['hours', 'Hours'], ['days', 'Days'], ['months', 'Months']];
  var MAXV = { hours: 8760, days: 3650, months: 120 };

  function retry(box, fn) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', fn); }
  function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'link'; } }
  function icon(path, name) {
    return '<span class="app-ic"><b>' + Z.esc(String(name || '?').trim().charAt(0).toUpperCase()) + '</b>' +
      (path ? '<img src="' + Z.esc(Z.plans.url(path)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
  }

  AA.list = async function (body, ctx) {
    var r = await sb.rpc('admin_list_apps');
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var all = r.data.items || [];

    body.innerHTML = '<div class="page-head"><div><h2>Apps store</h2><p class="sub">Premium apps users can buy with their Main Wallet.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="newa" style="white-space:nowrap;flex:none">' + Z.icon('plus') + 'New app</button></div>' +
      '<button class="btn btn-tonal btn-block" id="sales" style="margin:12px 0">' + Z.icon('receipt') + 'Recent purchases</button><div id="apl"></div>';
    var al = Z.$('#apl', body);

    function card(a) {
      return '<div class="card app-card" data-id="' + a.id + '"><div class="app-top">' + icon(a.icon_path, a.name) +
        '<div class="app-name"><b>' + Z.esc(a.name) + '</b><span class="app-sub">' + Z.esc(Z.apps.duration(a.duration_value, a.duration_unit)) + ' access</span></div>' +
        Z.badge(a.is_active ? 'active' : 'inactive') + '</div>' +
        '<div class="summary"><div class="kv"><span>Price</span><b>' + Z.moneyHtml(a.price) + '</b></div>' +
        '<div class="kv"><span>Download link</span><b>' + Z.esc(host(a.download_url)) + '</b></div>' +
        '<div class="kv"><span>Sold</span><b>' + a.sales + ' (' + a.active_access + ' active now)</b></div>' +
        '<div class="kv"><span>Order</span><b>' + a.sort_order + '</b></div></div>' +
        '<label class="switch-row"><span>Available in the store</span><span class="switch"><input type="checkbox" data-toggle="' + a.id + '"' + (a.is_active ? ' checked' : '') + ' aria-label="Available in the store"><i></i></span></label>' +
        '<div class="two"><button class="btn btn-tonal" data-edit="' + a.id + '">Edit</button><button class="btn btn-danger-ghost" data-del="' + a.id + '">Delete</button></div></div>';
    }
    al.innerHTML = all.length ? all.map(card).join('') :
      '<div class="card">' + Z.empty({ icon: 'download', title: 'No apps yet', text: 'Add the first premium app. Users will see it in Premium Apps.' }) + '</div>';

    var find = function (id) { return all.filter(function (a) { return a.id === id; })[0]; };
    Z.$('#newa', body).addEventListener('click', function () { form(null); });
    Z.$('#sales', body).addEventListener('click', purchases);
    al.addEventListener('click', async function (e) {
      var ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) form(find(ed.getAttribute('data-edit')));
      if (dl) {
        var a = find(dl.getAttribute('data-del'));
        if (!await Z.confirm({ title: 'Delete "' + a.name + '"?', text: 'The app and its icon are removed from the store. Past purchases stay in the records. Deleting is blocked while any user still has active access; switch it off instead.', confirm: 'Delete', danger: true })) return;
        Z.run(dl, async function () {
          var d = await sb.rpc('admin_delete_store_app', { p_id: a.id });
          if (d.error) throw d.error;
          Z.plansAdmin.removeFile(d.data && d.data.icon_path);
          Z.toast('App deleted', 'ok'); Z.route();
        });
      }
    });
    al.addEventListener('change', async function (e) {
      var t = e.target.closest('[data-toggle]'); if (!t) return;
      var u = await sb.from('store_apps').update({ is_active: t.checked }).eq('id', t.getAttribute('data-toggle'));
      if (u.error) { t.checked = !t.checked; Z.toast(Z.errMsg(u.error), 'error'); }
      else { Z.toast(t.checked ? 'App is now in the store' : 'App hidden from the store. Users who already bought it keep their access.', 'ok'); Z.route(); }
    });
  };

  async function purchases() {
    var sh = Z.sheet('<h2 class="sheet-title">Recent purchases</h2><div id="pl">' + Z.skel(3, 64) + '</div><div class="sheet-actions"><button class="btn btn-ghost btn-block" data-close>Close</button></div>');
    var box = Z.$('#pl', sh.el);
    var r = await sb.rpc('admin_list_app_purchases', { p_limit: 50, p_offset: 0 });
    if (r.error) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', function () { sh.close(); purchases(); }); return; }
    var rows = r.data || [];
    box.innerHTML = rows.length ? '<div class="card flat">' + rows.map(function (p) {
      return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(p.app_name) + ' · ' + Z.moneyHtml(p.price_paid) + '</span>' +
        '<span class="row-sub">' + Z.esc(p.user_name || p.email || 'User') + '</span><span class="row-sub">' + Z.esc(Z.apps.fmt(p.purchased_at)) + '</span>' +
        '<span class="row-sub">Until ' + Z.esc(Z.apps.fmt(p.expires_at)) + '</span></span>' + Z.badge(p.status === 'active' ? 'active' : 'expired') + '</div>';
    }).join('') + '</div>' : Z.empty({ icon: 'receipt', title: 'No purchases yet' });
  }

  function form(a) {
    var isNew = !a, P = Z.plansAdmin;
    a = a || { name: '', description: '', price: '', duration_value: 7, duration_unit: 'days', download_url: '', sort_order: 0, is_active: true };
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New app' : 'Edit app') + '</h2><form id="af" novalidate>' +
      Z.field({ id: 'an', label: 'App name', value: a.name, attrs: 'maxlength="60"' }) +
      P.picker('ai', 'App icon', a.icon_path, 'Pick a square picture from your phone. It is resized automatically.') +
      Z.field({ id: 'ad', label: 'Short description', type: 'textarea', rows: 3, value: a.description, attrs: 'maxlength="300"' }) +
      Z.field({ id: 'ap', label: 'Price (PKR)', value: a.price, attrs: 'inputmode="decimal"', hint: 'Taken from the user’s Main Wallet.' }) +
      '<div class="two">' + Z.field({ id: 'av', label: 'Access time', value: a.duration_value, attrs: 'inputmode="numeric"' }) +
      Z.field({ id: 'au', label: 'Unit', type: 'select', value: a.duration_unit, options: UNITS }) + '</div>' +
      '<p class="hint" style="margin-top:-6px">Access starts at the moment of purchase. Each app has its own time.</p>' +
      Z.field({ id: 'al', label: 'TeraBox download link', type: 'url', value: a.download_url, placeholder: 'https://', attrs: 'inputmode="url" autocapitalize="off" maxlength="1000"',
        hint: 'Paste the public sharing link. Zyven only shows the Download button while access is active. TeraBox itself does not know about Zyven access, so anyone who has the link itself can still open it.' }) +
      Z.field({ id: 'ao', label: 'Order', value: a.sort_order, attrs: 'inputmode="numeric"', hint: 'Lower shows first' }) +
      Z.switchEl('aon', a.is_active, 'Available in the store') +
      '<div id="aferr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Add app' : 'Save changes') + '</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el, getFile = P.bindPicker(el, 'ai');

    Z.$('#af', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#aferr', el);
      var v = { name: Z.$('#an', el).value.trim(), description: Z.$('#ad', el).value.trim(), price: Number(Z.$('#ap', el).value),
        duration_value: Number(Z.$('#av', el).value), duration_unit: Z.$('#au', el).value, download_url: Z.$('#al', el).value.trim(),
        sort_order: Number(Z.$('#ao', el).value || 0), is_active: Z.$('#aon', el).checked };
      if (!v.name) return Z.formError(err, 'Enter the app name.');
      if (!isFinite(v.price) || v.price <= 0 || v.price > 1000000) return Z.formError(err, 'Enter a price above 0.');
      if (Math.round(v.price * 100) !== v.price * 100 && Math.abs(Math.round(v.price * 100) - v.price * 100) > 1e-6) return Z.formError(err, 'The price can have at most 2 decimals.');
      if (!Number.isInteger(v.duration_value) || v.duration_value < 1 || v.duration_value > MAXV[v.duration_unit]) return Z.formError(err, 'Access time must be a whole number from 1 to ' + MAXV[v.duration_unit] + ' ' + v.duration_unit + '.');
      if (!/^https:\/\/\S{4,}$/i.test(v.download_url)) return Z.formError(err, 'Enter the TeraBox link, starting with https://');
      if (!Number.isInteger(v.sort_order) || Math.abs(v.sort_order) > 100000) return Z.formError(err, 'Order must be a whole number.');
      Z.formError(err, '');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var file = getFile(), np = null;
        if (file) { np = await P.upload(file, 'apps'); v.icon_path = np; }
        var r = isNew ? await sb.from('store_apps').insert(v) : await sb.from('store_apps').update(v).eq('id', a.id);
        if (r.error) { P.removeFile(np); throw r.error; }          // the new icon is not kept if the save failed
        if (np && a.icon_path) P.removeFile(a.icon_path);          // replaced: the old file is removed
        Z.toast(isNew ? 'App added' : 'App saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
  }
})();
