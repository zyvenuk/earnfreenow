/* Admin: Cleanup. Shows how much of the free plan is used, sets how long old data is kept,
   runs the cleanup now (it also runs by itself every night at 3:00 AM Pakistan time) and removes images nobody uses. */
(function () {
  'use strict';
  var Z = window.Z;
  var C = Z.cleanupAdmin = {};
  var BUCKET = 'plan-assets', DB_LIMIT = 500 * 1048576, FILE_LIMIT = 1024 * 1048576;   // Supabase free plan

  function mb(b) { b = Number(b) || 0; return (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'; }
  function bar(used, limit) {
    var pct = Math.min(100, Math.round(used / limit * 100));
    return '<div class="pn-bar' + (pct >= 80 ? ' hot' : '') + '"><i style="width:' + Math.max(pct, 1) + '%"></i></div>';
  }

  C.view = async function (body, ctx) {
    var res = await Promise.all([sb.rpc('admin_storage_stats'),
      sb.from('platform_settings').select('retain_tx_days,retain_views_days,retain_mail_days').eq('id', true).single()]);
    if (ctx.stale()) return;
    if (res[0].error || res[1].error) { body.innerHTML = Z.errorState(); Z.$('[data-retry]', body).addEventListener('click', function () { Z.route(); }); return; }
    var d = res[0].data, st = res[1].data;

    body.innerHTML = '<div class="page-head"><div><h2>Cleanup</h2><p class="sub">Keeps the database small so the free plan is enough.</p></div></div>' +
      '<div class="card info-card"><div class="ic-line"><span>Database</span><b>' + mb(d.db_bytes) + '</b></div>' + bar(d.db_bytes, DB_LIMIT) +
      '<div class="ic-line small"><span>Free plan limit</span><b>' + mb(DB_LIMIT) + '</b></div>' +
      '<div class="ic-line" style="margin-top:8px"><span>Image storage</span><b>' + mb(d.storage_bytes) + '</b></div>' + bar(d.storage_bytes, FILE_LIMIT) +
      '<div class="ic-line small"><span>' + d.storage_files + ' files \u00b7 free plan limit</span><b>' + mb(FILE_LIMIT) + '</b></div></div>' +
      '<div class="section-head"><h3>Biggest tables</h3></div><div class="card">' + d.tables.map(function (t) {
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(t.name) + '</span><span class="row-sub">' + Number(t.rows).toLocaleString() + ' rows</span></span><span class="amt">' + mb(t.bytes) + '</span></div>';
      }).join('') + '</div>' +

      '<form class="card form" id="rf3" novalidate><h3 class="mini-title" style="margin:0">How long to keep data</h3>' +
      '<p class="hint" style="margin-top:-6px">Older data is deleted every night. Balances, payouts, plans and referrals are never touched.</p>' +
      Z.field({ id: 'rt', label: 'Transactions (days)', value: st.retain_tx_days, attrs: 'inputmode="numeric"', hint: 'A user can also clear their own list at any time.' }) +
      Z.field({ id: 'rv', label: 'Finished ad views (days)', value: st.retain_views_days, attrs: 'inputmode="numeric"', hint: 'Voided and abandoned ad sessions are removed after 1 day.' }) +
      Z.field({ id: 'rm', label: 'Personal mails (days)', value: st.retain_mail_days, attrs: 'inputmode="numeric"', hint: 'Mails a user deletes are removed at once. Expired alerts go 7 days after they end; switched-off alerts after 30 days.' }) +
      '<div id="rerr3"></div><button class="btn btn-primary btn-block" type="submit">Save</button></form>' +

      '<div class="card form"><h3 class="mini-title" style="margin:0">Clean now</h3>' +
      '<button class="btn btn-tonal btn-block" id="runc">Run database cleanup now</button>' +
      '<button class="btn btn-tonal btn-block" id="runi">Remove unused images</button></div>';

    Z.$('#rf3', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#rerr3', body);
      var p = { retain_tx_days: parseInt(Z.$('#rt', body).value, 10), retain_views_days: parseInt(Z.$('#rv', body).value, 10), retain_mail_days: parseInt(Z.$('#rm', body).value, 10) };
      if ([p.retain_tx_days, p.retain_views_days, p.retain_mail_days].some(function (n) { return !isFinite(n) || n < 7 || n > 3650; })) return Z.formError(err, 'Each value must be a whole number of days from 7 to 3650.');
      Z.run(Z.$('button[type=submit]', body), async function () {
        var r = await sb.from('platform_settings').update(p).eq('id', true);
        if (r.error) throw r.error;
        Z.formError(err, ''); Z.toast('Saved', 'ok');
      }, err);
    });

    Z.$('#runc', body).addEventListener('click', function () {
      var b = this;
      Z.run(b, async function () {
        var r = await sb.rpc('admin_run_cleanup');
        if (r.error) throw r.error;
        var x = r.data, total = x.ad_sessions + x.old_ad_views + x.transactions + x.announcements + x.push_devices + x.daily_stats;
        Z.toast(total ? total + ' old records removed' : 'Nothing to clean right now', 'ok');
        Z.route();
      });
    });

    Z.$('#runi', body).addEventListener('click', function () {
      var b = this;
      Z.run(b, async function () {
        var used = {};
        var q = await Promise.all([sb.from('plans').select('logo_path'), sb.from('plan_badges').select('image_path')]);
        if (q[0].error || q[1].error) throw (q[0].error || q[1].error);
        (q[0].data || []).forEach(function (p) { if (p.logo_path) used[p.logo_path] = 1; });
        (q[1].data || []).forEach(function (p) { if (p.image_path) used[p.image_path] = 1; });
        var orphans = [], bytes = 0, cutoff = Date.now() - 3600 * 1000;   // newer than 1 hour: maybe still being saved
        for (var f of ['plans', 'badges']) {
          var l = await sb.storage.from(BUCKET).list(f, { limit: 1000 });
          if (l.error) throw l.error;
          (l.data || []).forEach(function (o) {
            var path = f + '/' + o.name;
            if (o.id && !used[path] && new Date(o.created_at).getTime() < cutoff) { orphans.push(path); bytes += Number(o.metadata && o.metadata.size) || 0; }
          });
        }
        if (!orphans.length) { Z.toast('No unused images found', 'ok'); return; }
        if (!await Z.confirm({ title: 'Remove ' + orphans.length + ' unused image' + (orphans.length === 1 ? '' : 's') + '?', text: 'About ' + mb(bytes) + ' will be freed. Images used by plans and badges are not touched.', confirm: 'Remove', danger: true })) return;
        var rm = await sb.storage.from(BUCKET).remove(orphans);
        if (rm.error) throw rm.error;
        Z.toast(orphans.length + ' unused images removed', 'ok'); Z.route();
      });
    });
  };
})();
