/* Maintenance system.
   Two scopes: "platform" (everything) and "payout" (payout requests only).
   Users are blocked by the database itself; the admin account is never blocked.
   Times: scheduled start, end time or "until further notice". The server clock is used for all comparisons. */
(function () {
  'use strict';
  var Z = window.Z;
  var M = Z.maint = { data: null, at: 0, offset: 0, timer: null, cd: null };

  /* Default texts (also stored in the database as the starting values) */
  M.defaults = {
    platform: {
      title: 'Zyven is under maintenance',
      message: 'We are improving Zyven to make it faster and more reliable. Watching ads and other features are temporarily unavailable. Your balance and earnings are safe. Please check back soon.'
    },
    payout: {
      title: 'Payouts are temporarily paused',
      message: 'We are updating our payout system. You can still watch ads and earn rewards, and your balance is safe. Payout requests will open again as soon as maintenance ends.'
    }
  };
  var LABEL = { platform: 'Whole platform', payout: 'Payouts' };

  M.now = function () { return Date.now() + M.offset; };

  /* ---------------- State ---------------- */
  function signature() {
    return ['platform', 'payout'].map(function (k) { var s = M.state(k); return s.status + '|' + (s.title || '') + '|' + (s.starts_at || '') + '|' + (s.ends_at || ''); }).join('#');
  }

  // Fetch (cached 60s unless force). Resolves true if what users should see has changed.
  M.refresh = async function (force) {
    if (!force && M.data && Date.now() - M.at < 60000) return false;
    var before = M.data ? signature() : '';
    var r = await sb.rpc('maintenance_status');
    if (r.error || !r.data) return false;
    M.data = r.data; M.at = Date.now();
    M.offset = new Date(r.data.now).getTime() - Date.now();
    M.arm();
    return signature() !== before;
  };

  // Status for a scope, re-evaluated with the server clock so start/end happen on time
  M.state = function (scope) {
    var d = M.data && M.data[scope];
    if (!d || d.status === 'off') return { status: 'off' };
    var n = M.now(), s = d.starts_at ? new Date(d.starts_at).getTime() : null, e = d.ends_at ? new Date(d.ends_at).getTime() : null;
    var st = (s && n < s) ? 'scheduled' : (e && n >= e ? 'ended' : 'active');
    return { status: st, title: d.title, message: d.message, starts_at: d.starts_at, ends_at: d.ends_at, start: s, end: e };
  };
  M.active = function (scope) { return !Z.state.isAdmin && M.state(scope).status === 'active'; };

  // Re-check the moment a start/end time passes, so the app reacts without a reload
  M.arm = function () {
    clearTimeout(M.timer);
    var n = M.now(), next = null;
    ['platform', 'payout'].forEach(function (k) {
      var s = M.state(k);
      [s.start, s.end].forEach(function (t) { if (t && t > n && (next === null || t < next)) next = t; });
    });
    if (next !== null && next - n < 2147000000) {
      M.timer = setTimeout(function () { M.refresh(true).then(function () { Z.route(); }); }, next - n + 500);
    }
  };

  /* ---------------- Text helpers ---------------- */
  function when(ms) { return Z.fmtDate(new Date(ms).toISOString()); }
  function left(ms) {
    var t = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
    return m + 'm ' + s + 's';
  }
  function rangeText(st) {
    return (st.status === 'scheduled' ? 'Starts ' : 'Started ') + when(st.start || M.now()) + ' \u00b7 ' + (st.end ? 'Expected back ' + when(st.end) : 'Until further notice');
  }

  /* ---------------- Notices (cards) ---------------- */
  // Active = warning, scheduled = heads-up. Admin never sees user notices.
  M.notices = function (scopes) {
    if (Z.state.isAdmin) return '';
    return scopes.map(function (k) {
      var st = M.state(k);
      if (st.status === 'active') {
        return '<div class="alert a-warn maint-note">' + Z.icon('alert') + '<div><b>' + Z.esc(st.title) + '</b><br>' + Z.esc(st.message) + '<br><small>' + rangeText(st) + '</small></div></div>';
      }
      if (st.status === 'scheduled') {
        return '<div class="alert a-info maint-note">' + Z.icon('info') + '<div><b>Upcoming maintenance: ' + Z.esc(LABEL[k].toLowerCase()) + '</b><br>' + Z.esc(st.title) +
          '<br><small>' + rangeText(st) + '</small></div></div>';
      }
      return '';
    }).join('');
  };

  // Login / signup screens: users can still log in, they just get told first
  M.authBanner = function () {
    var h = M.notices(['platform']);
    return h ? '<div class="auth-maint">' + h + '</div>' : '';
  };

  /* ---------------- Full screen for users while the platform is down ---------------- */
  Z.views.maintenance = async function (el, ctx) {
    clearInterval(M.cd);
    var st = M.state('platform'), s = Z.state.settings || {};
    function link(href, cls, icon, text) {
      return href ? '<a class="row follow-row" href="' + Z.esc(href) + '" target="_blank" rel="noopener noreferrer"><span class="sup-ic ' + cls + '">' + Z.icon(icon) + '</span>' +
        '<span class="row-main"><span class="row-title">' + text + '</span></span><span class="btn btn-tonal btn-sm">Open</span></a>' : '';
    }
    var help = link(s.channel_telegram, 'tg', 'send', 'Zyven on Telegram') + link(s.channel_whatsapp, 'wa', 'chat', 'Zyven on WhatsApp') +
      link(s.support_telegram, 'tg', 'send', 'Telegram support') + link(s.support_whatsapp, 'wa', 'chat', 'WhatsApp support') +
      (s.support_email ? '<a class="row follow-row" href="mailto:' + Z.esc(s.support_email) + '"><span class="sup-ic em">' + Z.icon('mail') + '</span><span class="row-main"><span class="row-title">Email support</span></span><span class="btn btn-tonal btn-sm">Send</span></a>' : '');

    el.innerHTML = '<section class="maint">' +
      '<img src="monogram.png" alt="Zyven" class="auth-logo" onerror="this.style.display=\'none\'">' +
      '<div class="maint-ic">' + Z.icon('wrench') + '</div>' +
      '<h1>' + Z.esc(st.title) + '</h1><p>' + Z.esc(st.message) + '</p>' +
      '<div class="card maint-times">' +
      '<div class="kv"><span>Maintenance started</span><b>' + when(st.start || M.now()) + '</b></div>' +
      '<div class="kv"><span>Expected back</span><b>' + (st.end ? when(st.end) : 'Until further notice') + '</b></div>' +
      (st.end ? '<div class="kv total"><span>Time remaining</span><b id="cd"></b></div>' : '') + '</div>' +
      '<button class="btn btn-primary btn-block" id="chk">Check again</button>' +
      (help ? '<div class="card maint-help">' + help + '</div>' : '') +
      '<button class="btn btn-ghost btn-block" id="lo">Log out</button></section>';

    function paint() {
      var cd = Z.$('#cd', el);
      if (!cd) return;
      var rem = st.end - M.now();
      if (rem <= 0) { clearInterval(M.cd); M.refresh(true).then(function () { Z.route(); }); return; }
      cd.textContent = left(rem);
    }
    if (st.end) { paint(); M.cd = setInterval(paint, 1000); }

    Z.$('#chk', el).addEventListener('click', function () {
      var b = this; Z.busy(b, true);
      M.refresh(true).then(function () {
        Z.busy(b, false);
        if (M.active('platform')) Z.toast('Still under maintenance. Please check again later.');
        else Z.route();
      });
    });
    Z.$('#lo', el).addEventListener('click', function () { Z.signOut(); });
  };

  /* ---------------- Admin ---------------- */
  M.adminNotice = function () {
    var out = ['platform', 'payout'].map(function (k) {
      var st = M.state(k);
      if (st.status !== 'active' && st.status !== 'scheduled') return '';
      return '<div class="alert a-warn" data-go="/admin/maintenance" style="cursor:pointer">' + Z.icon('alert') + '<div><b>' + LABEL[k] + ' maintenance ' +
        (st.status === 'active' ? 'is ON for users' : 'is scheduled') + '.</b> You are not affected as admin. <u>Manage</u></div></div>';
    }).join('');
    return out;
  };

  M.adminView = async function (body, ctx) {
    var r = await sb.from('maintenance').select('*');
    if (ctx.stale()) return;
    if (r.error) { body.innerHTML = Z.errorState(); Z.$('[data-retry]', body).addEventListener('click', function () { Z.route(); }); return; }
    var rows = {}; (r.data || []).forEach(function (x) { rows[x.scope] = x; });
    await M.refresh(true);
    if (ctx.stale()) return;

    function card(k) {
      var row = rows[k], st = M.state(k);
      var badge = st.status === 'active' ? Z.badge('ongoing') : st.status === 'scheduled' ? Z.badge('scheduled') : st.status === 'ended' ? Z.badge('ended') : Z.badge('off');
      return '<div class="card maint-card"><div class="pc-top"><span class="row-ic ' + (st.status === 'active' ? 'warn' : '') + '">' + Z.icon(k === 'platform' ? 'wrench' : 'payout') + '</span>' +
        '<div class="pc-who"><b>' + LABEL[k] + '</b><span>' + (k === 'platform' ? 'Blocks the whole app for users' : 'Pauses payout requests only') + '</span></div>' + badge + '</div>' +
        '<div class="summary">' + lineKV('Title', Z.esc(row.title)) +
        (st.status !== 'off' ? lineKV(st.status === 'scheduled' ? 'Starts' : 'Started', st.start ? when(st.start) : 'Immediately') + lineKV('Ends', st.end ? when(st.end) : 'Until further notice') : lineKV('Status', 'Not enabled')) + '</div>' +
        '<div class="pc-actions"><button class="btn btn-primary btn-sm" data-m="' + k + '">' + (st.status === 'off' || st.status === 'ended' ? 'Set up' : 'Manage') + '</button>' +
        (st.status === 'active' || st.status === 'scheduled' ? '<button class="btn btn-danger-ghost btn-sm" data-off="' + k + '">' + (st.status === 'active' ? 'End now' : 'Cancel') + '</button>' : '') + '</div></div>';
    }
    function lineKV(a, b) { return '<div class="kv"><span>' + a + '</span><b>' + b + '</b></div>'; }

    body.innerHTML = '<div class="page-head"><div><h2>Maintenance</h2><p class="sub">Only users are affected. The admin account always works normally.</p></div></div>' +
      card('platform') + card('payout');

    body.addEventListener('click', async function (e) {
      var mb = e.target.closest('[data-m]');
      if (mb) return form(mb.getAttribute('data-m'), rows[mb.getAttribute('data-m')]);
      var ob = e.target.closest('[data-off]');
      if (ob) {
        var k = ob.getAttribute('data-off');
        if (!await Z.confirm({ title: 'End ' + LABEL[k].toLowerCase() + ' maintenance?', text: 'Users get access again immediately.', confirm: 'End maintenance' })) return;
        Z.run(ob, async function () {
          var u = await sb.from('maintenance').update({ is_enabled: false }).eq('scope', k);
          if (u.error) throw u.error;
          Z.toast('Maintenance ended', 'ok'); Z.route();
        });
      }
    });
  };

  function form(k, row) {
    var st = M.state(k), enabledNow = row.is_enabled && st.status !== 'ended';
    var startOpts = [['now', 'Start now'], ['later', 'Schedule a start time']];
    if (enabledNow && row.starts_at) startOpts.unshift(['keep', 'Keep current start (' + Z.fmtDate(row.starts_at) + ')']);
    var sh = Z.sheet('<h2 class="sheet-title">' + LABEL[k] + ' maintenance</h2><form id="mf" novalidate>' +
      Z.switchEl('me', true, 'Maintenance enabled') +
      Z.field({ id: 'ms', label: 'Start', type: 'select', value: enabledNow && row.starts_at ? 'keep' : 'now', options: startOpts }) +
      '<div id="msd-box" hidden>' + Z.field({ id: 'msd', label: 'Starts at', type: 'datetime-local', value: Z.toLocalInput(row.starts_at && st.status === 'scheduled' ? row.starts_at : '') }) + '</div>' +
      Z.field({ id: 'mx', label: 'End', type: 'select', value: row.ends_at && enabledNow ? 'at' : 'none', options: [['none', 'Until further notice (no end time)'], ['at', 'End at a set time']] }) +
      '<div id="med-box" hidden>' + Z.field({ id: 'med', label: 'Ends at', type: 'datetime-local', value: Z.toLocalInput(row.ends_at && enabledNow ? row.ends_at : ''), hint: 'Users get access back automatically at this time.' }) + '</div>' +
      Z.field({ id: 'mt', label: 'Title', value: row.title, attrs: 'maxlength="100"' }) +
      Z.field({ id: 'mm', label: 'Description', type: 'textarea', rows: 4, value: row.message, attrs: 'maxlength="600"' }) +
      '<button type="button" class="link-btn" id="mdef">Use the default text</button>' +
      Z.switchEl('mn', false, 'Notify users now (alert + push)') +
      '<div id="mferr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Save</button>' +
      '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
    var el = sh.el;
    function sync() {
      Z.$('#msd-box', el).hidden = Z.$('#ms', el).value !== 'later';
      Z.$('#med-box', el).hidden = Z.$('#mx', el).value !== 'at';
    }
    Z.$('#ms', el).addEventListener('change', sync); Z.$('#mx', el).addEventListener('change', sync); sync();
    Z.$('#mdef', el).addEventListener('click', function () { Z.$('#mt', el).value = M.defaults[k].title; Z.$('#mm', el).value = M.defaults[k].message; });

    Z.$('#mf', el).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#mferr', el), on = Z.$('#me', el).checked;
      var title = Z.$('#mt', el).value.trim() || M.defaults[k].title, message = Z.$('#mm', el).value.trim() || M.defaults[k].message;
      var mode = Z.$('#ms', el).value, endMode = Z.$('#mx', el).value;
      var startIso = null, endIso = null;
      if (on) {
        if (mode === 'later') {
          var v = Z.$('#msd', el).value;
          if (!v) return Z.formError(err, 'Choose the start date and time.');
          startIso = new Date(v).toISOString();
          if (new Date(startIso) <= new Date()) return Z.formError(err, 'The start time must be in the future. Use "Start now" instead.');
        } else if (mode === 'keep') startIso = row.starts_at;
        else startIso = new Date().toISOString();
        if (endMode === 'at') {
          var ev = Z.$('#med', el).value;
          if (!ev) return Z.formError(err, 'Choose the end date and time.');
          endIso = new Date(ev).toISOString();
          if (new Date(endIso) <= new Date()) return Z.formError(err, 'The end time must be in the future.');
          if (startIso && new Date(endIso) <= new Date(startIso)) return Z.formError(err, 'The end time must be after the start time.');
        }
      }
      var notify = Z.$('#mn', el).checked && on;
      var upd = on ? { is_enabled: true, title: title, message: message, starts_at: startIso, ends_at: endIso } : { is_enabled: false, title: title, message: message };
      Z.run(Z.$('button[type=submit]', el), async function () {
        var r = await sb.from('maintenance').update(upd).eq('scope', k);
        if (r.error) throw r.error;
        var msg = on ? 'Maintenance saved' : 'Maintenance turned off';
        if (notify) {
          var sched = startIso && new Date(startIso) > new Date();
          var body = message + ' ' + (sched ? 'Starts ' + Z.fmtDate(startIso) + '. ' : '') + (endIso ? 'Expected back ' + Z.fmtDate(endIso) + '.' : 'Until further notice.');
          var head = (sched ? 'Upcoming maintenance: ' : '') + title;
          try {
            var a = await sb.from('announcements').insert({ title: head.slice(0, 100), message: body.slice(0, 1000), type: 'warning', priority: 2, is_active: true, expires_at: endIso });
            if (a.error) throw a.error;
            var pr = await Z.push.adminSend({ title: head, body: body.slice(0, 200), url: '#/notifications/alerts' });
            msg += '. Users notified (' + pr.sent + (pr.sent === 1 ? ' device)' : ' devices)');
          } catch (e2) { console.error(e2); msg += ', but notifying users failed'; }
        }
        Z.toast(msg, 'ok'); sh.close(); Z.route();
      }, err);
    });
  }
})();
