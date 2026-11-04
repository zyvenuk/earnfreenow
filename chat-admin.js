/* Admin: Community chat. Rules are saved in platform_settings and enforced by the database on every message. */
(function () {
  'use strict';
  var Z = window.Z;
  var CA = Z.chatAdmin = {};
  var UNITS = [['minutes', 'Minutes', 1], ['hours', 'Hours', 60], ['days', 'Days', 1440]];

  function split(min) {   // 90 -> {v: 90, u: minutes}, 120 -> {v: 2, u: hours}
    for (var i = UNITS.length - 1; i >= 0; i--) if (min % UNITS[i][2] === 0) return { v: min / UNITS[i][2], u: UNITS[i][0] };
    return { v: min, u: 'minutes' };
  }
  function when(iso) {
    return new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' PKT';
  }

  CA.render = async function (body, ctx) {
    var s = await Z.refreshSettings(true);
    if (ctx.stale()) return;
    var lt = split(s.chat_lifetime_minutes || 60);

    body.innerHTML = '<div class="page-head"><div><h2>Community chat</h2><p class="sub">Rules apply to every user and are enforced by the database.</p></div></div>' +
      '<form class="card form" id="chf" novalidate>' +
      Z.switchEl('che', s.chat_enabled !== false, 'Chat is on') +
      '<div class="two">' + Z.field({ id: 'chc', label: 'Cooldown (seconds)', value: s.chat_cooldown_seconds, attrs: 'inputmode="numeric"', hint: 'Wait between two messages. 0 to 3600.' }) +
      Z.field({ id: 'chd', label: 'Messages per user per day', value: s.chat_daily_limit, attrs: 'inputmode="numeric"', hint: 'Resets at midnight PKT. 1 to 10000.' }) + '</div>' +
      '<div class="two">' + Z.field({ id: 'chl', label: 'Delete messages after', value: lt.v, attrs: 'inputmode="numeric"', hint: 'Every message is removed from the chat and the database after this time.' }) +
      Z.field({ id: 'chu', label: 'Unit', type: 'select', value: lt.u, options: UNITS.map(function (u) { return [u[0], u[1]]; }) }) + '</div>' +
      Z.field({ id: 'chm', label: 'Longest message (characters)', value: s.chat_max_length, attrs: 'inputmode="numeric"', hint: '20 to 1000.' }) +
      Z.switchEl('cha', !!s.chat_allow_links, 'Allow links in messages') +
      '<p class="hint" style="margin-top:-6px">Off blocks web links, t.me and wa.me addresses, which stops most spam.</p>' +
      '<div id="cherr"></div><button class="btn btn-primary btn-block" type="submit">Save chat rules</button></form>' +
      '<div class="page-head"><div><h2>Live messages</h2><p class="sub" id="chn">Loading...</p></div><button class="icon-btn" id="chr" aria-label="Refresh">' + Z.icon('refresh') + '</button></div>' +
      '<div id="chlist">' + Z.skel(3, 64) + '</div>' +
      '<button class="btn btn-danger-ghost btn-block" id="chx">Clear all messages now</button>' +
      '<div class="page-head"><div><h2>Muted users</h2><p class="sub">They can read the chat but cannot send.</p></div></div><div id="chmu">' + Z.skel(1, 56) + '</div>';

    Z.$('#chf', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#cherr', body), unit = UNITS.filter(function (u) { return u[0] === Z.$('#chu', body).value; })[0] || UNITS[1];
      var v = {
        chat_enabled: Z.$('#che', body).checked, chat_cooldown_seconds: Number(Z.$('#chc', body).value), chat_daily_limit: Number(Z.$('#chd', body).value),
        chat_lifetime_minutes: Number(Z.$('#chl', body).value) * unit[2], chat_max_length: Number(Z.$('#chm', body).value), chat_allow_links: Z.$('#cha', body).checked
      };
      function bad(n, a, b) { return !Number.isInteger(n) || n < a || n > b; }
      if (bad(v.chat_cooldown_seconds, 0, 3600)) return Z.formError(err, 'Cooldown must be a whole number from 0 to 3600 seconds.');
      if (bad(v.chat_daily_limit, 1, 10000)) return Z.formError(err, 'Daily messages must be a whole number from 1 to 10000.');
      if (bad(v.chat_lifetime_minutes, 1, 10080)) return Z.formError(err, 'Messages can live from 1 minute up to 7 days.');
      if (bad(v.chat_max_length, 20, 1000)) return Z.formError(err, 'Message length must be from 20 to 1000 characters.');
      Z.formError(err, '');
      Z.run(Z.$('button[type=submit]', body), async function () {
        var r = await sb.from('platform_settings').update(v).eq('id', true);
        if (r.error) throw r.error;
        await Z.refreshSettings(true);
        Z.toast('Chat rules saved', 'ok');
      }, err);
    });

    async function messages() {
      var box = Z.$('#chlist', body), n = Z.$('#chn', body);
      var r = await sb.rpc('admin_list_chat', { p_limit: 50 });
      if (ctx.stale()) return;
      if (r.error) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', messages); return; }
      var items = r.data.items || [];
      n.textContent = r.data.total + ' stored right now' + (r.data.total > items.length ? ' (showing the newest ' + items.length + ')' : '');
      box.innerHTML = items.length ? '<div class="card flat">' + items.map(function (m) {
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(m.name) + (m.muted ? ' <span class="badge b-suspended">Muted</span>' : '') + '</span>' +
          '<span class="row-sub wrap">' + Z.esc(m.body) + '</span><span class="row-sub">' + Z.esc(m.email || '') + ' · ' + Z.esc(when(m.created_at)) + '</span></span>' +
          '<button class="icon-btn sm" data-del="' + m.id + '" aria-label="Delete">' + Z.icon('trash') + '</button>' +
          '<button class="btn btn-tonal btn-sm" data-mute="' + m.id + '">Mute</button></div>';
      }).join('') + '</div>' : '<div class="card">' + Z.empty({ icon: 'chat', title: 'No messages right now', text: 'Messages disappear by themselves after the time you set.' }) + '</div>';
    }
    async function mutes() {
      var box = Z.$('#chmu', body);
      var r = await sb.rpc('admin_list_chat_mutes');
      if (ctx.stale()) return;
      if (r.error) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', mutes); return; }
      var rows = r.data || [];
      box.innerHTML = rows.length ? '<div class="card flat">' + rows.map(function (u) {
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(u.name) + '</span><span class="row-sub">' + Z.esc(u.email || '') + '</span>' +
          '<span class="row-sub">' + (u.until ? 'Until ' + Z.esc(when(u.until)) : 'Until you unmute') + (u.reason ? ' · ' + Z.esc(u.reason) : '') + '</span></span>' +
          '<button class="btn btn-tonal btn-sm" data-unmute="' + u.user_id + '">Unmute</button></div>';
      }).join('') + '</div>' : '<div class="card">' + Z.empty({ icon: 'check', title: 'Nobody is muted' }) + '</div>';
    }
    messages(); mutes();
    Z.$('#chr', body).addEventListener('click', function () { messages(); mutes(); });

    Z.$('#chx', body).addEventListener('click', async function () {
      var b = this;
      if (!await Z.confirm({ title: 'Clear the whole chat?', text: 'Every message is deleted now for everyone. Users keep their daily counts.', confirm: 'Clear all', danger: true })) return;
      Z.run(b, async function () {
        var r = await sb.rpc('admin_clear_chat'); if (r.error) throw r.error;
        Z.toast(r.data + ' messages deleted', 'ok'); messages();
      });
    });

    body.addEventListener('click', function (e) {
      var d = e.target.closest('[data-del]'), m = e.target.closest('[data-mute]'), u = e.target.closest('[data-unmute]');
      if (d) Z.run(d, async function () {
        var r = await sb.rpc('admin_delete_chat_message', { p_id: d.getAttribute('data-del') }); if (r.error) throw r.error;
        Z.toast('Message deleted', 'ok'); messages();
      });
      if (u) Z.run(u, async function () {
        var r = await sb.rpc('admin_unmute_chat_user', { p_user_id: u.getAttribute('data-unmute') }); if (r.error) throw r.error;
        Z.toast('User can send again', 'ok'); mutes(); messages();
      });
      if (m) {
        var id = m.getAttribute('data-mute');
        var sh = Z.sheet('<h2 class="sheet-title">Mute this user</h2><p class="sheet-text">Their messages in the chat are deleted too.</p>' +
          Z.field({ id: 'mr', label: 'Reason (optional)', attrs: 'maxlength="200"' }) +
          '<div class="sheet-actions"><button class="btn btn-tonal" data-m="60">Mute for 1 hour</button><button class="btn btn-tonal" data-m="1440">Mute for 1 day</button>' +
          '<button class="btn btn-tonal" data-m="10080">Mute for 7 days</button><button class="btn btn-danger" data-m="0">Mute until I unmute</button><button class="btn btn-ghost" data-close>Cancel</button></div>');
        sh.el.addEventListener('click', function (ev) {
          var b = ev.target.closest('[data-m]'); if (!b) return;
          var mins = Number(b.getAttribute('data-m')), reason = Z.$('#mr', sh.el).value.trim();
          Z.run(b, async function () {
            var r = await sb.rpc('admin_mute_chat_author', { p_message_id: id, p_minutes: mins || null, p_delete_messages: true, p_reason: reason || null });
            if (r.error) throw r.error;
            Z.toast('User muted', 'ok'); sh.close(); messages(); mutes();
          });
        });
      }
    });
  };
})();
