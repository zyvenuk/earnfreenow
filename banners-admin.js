/* Admin: Banner management for the Home carousel. Every write is enforced by the database (admin-only RLS and constraints);
   this file only provides the screens. Pictures live in Supabase Storage (plan-assets/banners/...), never in the database. */
(function () {
  'use strict';
  var Z = window.Z;
  var BA = Z.bannersAdmin = {};
  var BUCKET = 'plan-assets', W = 1280, H = 560;   // 16:7, same ratio the carousel shows
  var PAGES = [['/home', 'Home'], ['/watch', 'Watch ads'], ['/plans', 'Plans'], ['/browse', 'Browse'], ['/profile', 'Profile'], ['/payout', 'Payout'],
    ['/referral', 'Referrals'], ['/leaderboard', 'Leaderboard'], ['/promotions', 'My Promotions'], ['/support', 'Support'], ['/notifications', 'Notifications']];
  var FILTERS = [['all', 'All'], ['active', 'Active'], ['scheduled', 'Scheduled'], ['inactive', 'Inactive'], ['expired', 'Expired']];

  function retry(box, fn) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', fn); }
  function url(path) { return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }
  function removeFile(path) { if (path) sb.storage.from(BUCKET).remove([path]).then(function () {}, function () {}); }
  function pageName(p) { var m = PAGES.filter(function (x) { return x[0] === p; })[0]; return m ? m[1] : p; }

  // <input type="datetime-local"> works in the admin's own time zone; the database stores the exact moment.
  function toLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function toIso(v) { if (!v) return null; var d = new Date(v); return isNaN(d.getTime()) ? NaN : d.toISOString(); }

  /* Crop to 16:7 (centre) and shrink, so the preview is exactly what users get and files stay small. */
  async function prepare(file) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) throw { message: 'invalid_image' };
    if (file.size > 12 * 1024 * 1024) throw { message: 'image_too_large' };
    var bmp = await createImageBitmap(file);
    var ratio = W / H, sw = bmp.width, sh = bmp.height, cw = sw, ch = sh;
    if (sw / sh > ratio) cw = Math.round(sh * ratio); else ch = Math.round(sw / ratio);
    var sx = Math.round((sw - cw) / 2), sy = Math.round((sh - ch) / 2), tw = Math.min(W, cw), th = Math.round(tw / ratio);
    var c = document.createElement('canvas'); c.width = tw; c.height = th;
    c.getContext('2d').drawImage(bmp, sx, sy, cw, ch, 0, 0, tw, th);
    var blob = null;
    for (var q of [0.85, 0.7, 0.55]) {
      blob = await new Promise(function (res) { c.toBlob(res, 'image/webp', q); });
      if (blob && blob.size < 900 * 1024) break;
    }
    if (!blob || blob.size >= 1024 * 1024) throw { message: 'image_too_large' };
    return blob;
  }
  async function upload(file) {
    var blob = await prepare(file);
    var path = 'banners/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2)) + '.webp';
    var r = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/webp', cacheControl: '31536000' });
    if (r.error) throw r.error;
    return path;
  }

  function when(b) {
    if (b.status === 'scheduled') return 'Starts ' + Z.fmtDate(b.starts_at) + (b.ends_at ? ' · ends ' + Z.fmtDate(b.ends_at) : '');
    if (b.status === 'expired') return 'Ended ' + Z.fmtDate(b.ends_at);
    if (b.status === 'inactive') return 'Switched off';
    return b.ends_at ? 'Live until ' + Z.fmtDate(b.ends_at) : 'Live, no end date';
  }
  function actionText(b) {
    if (b.action_type === 'internal') return 'Opens ' + pageName(b.action_target);
    if (b.action_type === 'external') return 'Opens ' + b.action_target;
    return 'No action';
  }

  BA.list = async function (body, ctx) {
    var r = await sb.rpc('admin_list_banners');
    if (ctx.stale()) return;
    if (r.error) return retry(body, function () { Z.route(); });
    var all = r.data.items || [], filter = 'all';
    var count = function (s) { return all.filter(function (b) { return b.status === s; }).length; };

    body.innerHTML = '<div class="page-head"><div><h2>Banners</h2><p class="sub">The carousel on the Home page. Changes reach users within seconds, no code needed.</p></div>' +
      '<button class="btn btn-primary btn-sm" id="newb">' + Z.icon('plus') + 'New banner</button></div>' +
      '<div class="stat-grid"><div class="stat"><span>Live now</span><b>' + count('active') + '</b></div><div class="stat"><span>Scheduled</span><b>' + count('scheduled') + '</b></div></div>' +
      Z.chips(FILTERS, 'all', 'data-bf') + '<div id="bl"></div>';
    var bl = Z.$('#bl', body);

    function card(b) {
      return '<div class="card banner-card" data-id="' + b.id + '">' +
        '<div class="banner-prev"><img src="' + Z.esc(url(b.image_path)) + '" alt="" loading="lazy" onerror="this.remove()"></div>' +
        '<div class="banner-body"><div class="plan-top"><div class="plan-name"><b>' + Z.esc(b.title) + '</b><span>' + Z.esc(when(b)) + '</span></div>' + Z.badge(b.status) + '</div>' +
        '<div class="summary"><div class="kv"><span>Click</span><b class="wrap">' + Z.esc(actionText(b)) + '</b></div>' +
        '<div class="kv"><span>Shown for</span><b>' + b.display_seconds + ' seconds</b></div>' +
        '<div class="kv"><span>Order</span><b>' + b.sort_order + '</b></div></div>' +
        '<label class="switch-row"><span>Enabled</span><span class="switch"><input type="checkbox" data-toggle="' + b.id + '"' + (b.is_enabled ? ' checked' : '') + ' aria-label="Enabled"><i></i></span></label>' +
        '<div class="two"><button class="btn btn-tonal" data-edit="' + b.id + '">Edit</button><button class="btn btn-danger-ghost" data-del="' + b.id + '">Delete</button></div></div></div>';
    }
    function paint() {
      var rows = all.filter(function (b) { return filter === 'all' || b.status === filter; });
      bl.innerHTML = rows.length ? rows.map(card).join('') :
        '<div class="card">' + Z.empty({ icon: 'layout', title: all.length ? 'No banners in this view' : 'No banners yet', text: all.length ? 'Try another filter.' : 'Create the first banner. Users will see it on the Home page.' }) + '</div>';
    }
    paint();

    var find = function (id) { return all.filter(function (b) { return b.id === id; })[0]; };
    Z.$('#newb', body).addEventListener('click', function () { form(null); });
    Z.$('.chips', body).addEventListener('click', function (e) {
      var c = e.target.closest('[data-bf]'); if (!c) return;
      filter = c.getAttribute('data-bf');
      Z.$$('.chip', body).forEach(function (x) { x.classList.toggle('on', x === c); });
      paint();
    });
    bl.addEventListener('click', async function (e) {
      var ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) form(find(ed.getAttribute('data-edit')));
      if (dl) {
        var b = find(dl.getAttribute('data-del'));
        if (!await Z.confirm({ title: 'Delete "' + b.title + '"?', text: 'The banner disappears from the Home page and its picture is removed from storage. This cannot be undone. To hide it for now, switch it off instead.', confirm: 'Delete', danger: true })) return;
        Z.run(dl, async function () {
          var d = await sb.from('banners').delete().eq('id', b.id).select('image_path');
          if (d.error) throw d.error;
          (d.data || []).forEach(function (x) { removeFile(x.image_path); });
          Z.toast('Banner deleted', 'ok'); Z.route();
        });
      }
    });
    bl.addEventListener('change', async function (e) {
      var t = e.target.closest('[data-toggle]'); if (!t) return;
      var r2 = await sb.from('banners').update({ is_enabled: t.checked }).eq('id', t.getAttribute('data-toggle'));
      if (r2.error) { t.checked = !t.checked; Z.toast(Z.errMsg(r2.error), 'error'); }
      else { Z.toast(t.checked ? 'Banner enabled' : 'Banner switched off', 'ok'); Z.route(); }
    });
  };

  function form(b) {
    var isNew = !b;
    b = b || { title: '', alt_text: '', action_type: 'none', action_target: '', display_seconds: 5, is_enabled: true, sort_order: 0 };
    var ext = b.action_type === 'external' ? b.action_target : '', internal = b.action_type === 'internal' ? b.action_target : '/plans';
    var sh = Z.sheet('<h2 class="sheet-title">' + (isNew ? 'New banner' : 'Edit banner') + '</h2><form id="bf" novalidate>' +
      Z.field({ id: 'bt', label: 'Name (only you see this)', value: b.title, placeholder: 'e.g. Eid offer', attrs: 'maxlength="80"' }) +
      '<div class="field"><label>Banner picture</label><div class="banner-prev big" id="bp-prev">' + (b.image_path ? '<img src="' + Z.esc(url(b.image_path)) + '" alt="">' : '<span class="muted small">No picture yet</span>') + '</div>' +
      '<div class="img-pick"><label class="btn btn-tonal btn-sm" for="bp-file">' + (isNew ? 'Choose picture' : 'Replace picture') + '</label>' +
      '<input type="file" id="bp-file" accept="image/png,image/jpeg,image/webp" hidden></div>' +
      '<div class="hint">Wide picture, about 1280 × 560 (16:7). It is centred and cropped to that shape automatically.</div></div>' +
      Z.field({ id: 'ba', label: 'Picture description (optional)', value: b.alt_text || '', attrs: 'maxlength="120"', hint: 'Read aloud by screen readers. Defaults to the name.' }) +
      Z.field({ id: 'bc', label: 'When a user taps the banner', type: 'select', value: b.action_type, options: [['none', 'Nothing'], ['internal', 'Open a page in the app'], ['external', 'Open a website link']] }) +
      '<div id="bc-int">' + Z.field({ id: 'bi', label: 'Page', type: 'select', value: internal, options: PAGES }) + '</div>' +
      '<div id="bc-ext">' + Z.field({ id: 'be', label: 'Link', type: 'url', value: ext, placeholder: 'https://', attrs: 'inputmode="url" autocapitalize="off" maxlength="500"' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'bd', label: 'Seconds on screen', value: b.display_seconds, attrs: 'inputmode="numeric"', hint: '2 to 60' }) +
      Z.field({ id: 'bo', label: 'Order', value: b.sort_order, attrs: 'inputmode="numeric"', hint: 'Lower shows first' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'bs', label: 'Start (optional)', type: 'datetime-local', value: toLocal(b.starts_at) }) +
      Z.field({ id: 'bn', label: 'End (optional)', type: 'datetime-local', value: toLocal(b.ends_at) }) + '</div>' +
      '<p class="hint" style="margin-top:-6px">Times use this device\'s time zone. Empty start means "from now", empty end means "until you stop it".</p>' +
      Z.switchEl('bon', b.is_enabled, 'Enabled') +
      '<div id="bferr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">' + (isNew ? 'Create banner' : 'Save changes') + '</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el, chosen = null, inp = Z.$('#bp-file', el);

    function syncAction() {
      var t = Z.$('#bc', el).value;
      Z.$('#bc-int', el).hidden = t !== 'internal'; Z.$('#bc-ext', el).hidden = t !== 'external';
    }
    syncAction();
    Z.$('#bc', el).addEventListener('change', syncAction);
    inp.addEventListener('change', function () {
      chosen = inp.files && inp.files[0] || null;
      if (chosen) Z.$('#bp-prev', el).innerHTML = '<img src="' + URL.createObjectURL(chosen) + '" alt="">';
    });

    Z.$('#bf', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#bferr', el), type = Z.$('#bc', el).value;
      var v = {
        title: Z.$('#bt', el).value.trim(), alt_text: Z.$('#ba', el).value.trim() || null, action_type: type,
        action_target: type === 'internal' ? Z.$('#bi', el).value : type === 'external' ? Z.$('#be', el).value.trim() : null,
        display_seconds: Number(Z.$('#bd', el).value), sort_order: Number(Z.$('#bo', el).value || 0),
        starts_at: toIso(Z.$('#bs', el).value), ends_at: toIso(Z.$('#bn', el).value), is_enabled: Z.$('#bon', el).checked
      };
      if (!v.title) return Z.formError(err, 'Enter a name for this banner.');
      if (isNew && !chosen) return Z.formError(err, 'Choose a picture for the banner.');
      if (!Number.isInteger(v.display_seconds) || v.display_seconds < 2 || v.display_seconds > 60) return Z.formError(err, 'Seconds on screen must be a whole number from 2 to 60.');
      if (!Number.isInteger(v.sort_order) || Math.abs(v.sort_order) > 100000) return Z.formError(err, 'Order must be a whole number.');
      if (type === 'external' && !/^https?:\/\/\S{4,}$/i.test(v.action_target)) return Z.formError(err, 'Enter a link that starts with https://');
      if (Number.isNaN(v.starts_at) || Number.isNaN(v.ends_at)) return Z.formError(err, 'Check the start and end date.');
      if (v.starts_at && v.ends_at && new Date(v.ends_at) <= new Date(v.starts_at)) return Z.formError(err, 'The end time must be after the start time.');
      Z.formError(err, '');
      Z.run(Z.$('button[type=submit]', el), async function () {
        var np = null;
        if (chosen) { np = await upload(chosen); v.image_path = np; }
        var r = isNew ? await sb.from('banners').insert(v) : await sb.from('banners').update(v).eq('id', b.id);
        if (r.error) { removeFile(np); throw r.error; }          // the new picture is not kept if the save failed
        if (np && b.image_path) removeFile(b.image_path);         // replaced: the old file is removed
        Z.toast(isNew ? 'Banner created' : 'Banner saved', 'ok'); sh.close(); Z.route();
      }, err);
    });
  }
})();
