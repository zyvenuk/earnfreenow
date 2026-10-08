/* Community features: Support, welcome/follow popup, notifications.
   All links come from platform_settings (edited in Admin > Settings), never hard-coded. */
(function () {
  'use strict';
  var Z = window.Z;

  /* ---- Easy-to-change behaviour for the post-login follow popup ----
     cooldownHours: 0  = show after every fresh login
                    24 = at most once every 24 hours per user on this device
     enabled: false hides the popup completely. */
  Z.config = Z.config || {};
  Z.config.followPopup = { enabled: true, cooldownHours: 0, storagePrefix: 'zyven:follow:' };

  Z.ANN = {
    info: { label: 'Info', icon: 'info', cls: 'acc' },
    update: { label: 'Update', icon: 'megaphone', cls: 'acc' },
    reward: { label: 'Reward', icon: 'coin', cls: 'pos' },
    warning: { label: 'Warning', icon: 'alert', cls: 'warn' }
  };

  // Settings can change while the app is open; re-read them occasionally (cached 5 min).
  Z.refreshSettings = async function (force) {
    if (!force && Z.state.settingsAt && Date.now() - Z.state.settingsAt < 5 * 60 * 1000) return Z.state.settings;
    var r = await sb.from('platform_settings').select('*').eq('id', true).single();
    if (!r.error && r.data) { Z.state.settings = r.data; Z.state.settingsAt = Date.now(); }
    return Z.state.settings;
  };

  /* ---------------- Support ---------------- */
  Z.views.support = async function (el, ctx) {
    await Z.refreshSettings();
    if (ctx.stale()) return;
    var st = Z.state.settings || {};
    var opts = [
      { title: 'Telegram Support', desc: 'Chat with our support team on Telegram.', icon: 'send', cls: 'tg', href: st.support_telegram, label: 'Open Telegram' },
      { title: 'WhatsApp Support', desc: 'Message our support team on WhatsApp.', icon: 'chat', cls: 'wa', href: st.support_whatsapp, label: 'Open WhatsApp' },
      { title: 'Email Support', desc: st.support_email ? Z.esc(st.support_email) : 'Send us an email.', icon: 'mail', cls: 'em', href: st.support_email ? 'mailto:' + st.support_email : '', label: 'Send email', mail: true }
    ];
    el.innerHTML = '<section class="page"><div><h2 class="greet">How can we help?</h2><p class="sub">Pick the way that suits you best.</p></div>' +
      opts.map(function (o) {
        var action = o.href
          ? '<a class="btn btn-tonal btn-block" href="' + Z.esc(o.href) + '"' + (o.mail ? '' : ' target="_blank" rel="noopener noreferrer"') + '>' + Z.esc(o.label) + '</a>'
          : '<button class="btn btn-tonal btn-block" disabled>Not available yet</button>';
        return '<div class="card support-card"><div class="sup-top"><span class="sup-ic ' + o.cls + '">' + Z.icon(o.icon) + '</span>' +
          '<span class="row-main"><span class="row-title">' + o.title + '</span><span class="row-sub wrap">' + o.desc + '</span></span></div>' + action + '</div>';
      }).join('') + '</section>';
  };

  /* ---------------- Follow popup (after a fresh login only) ---------------- */
  Z.maybeShowFollowPopup = async function () {
    var cfg = Z.config.followPopup;
    if (!cfg.enabled || !Z.state.user || Z.recovery) return;
    var key = cfg.storagePrefix + Z.state.user.id, last = 0;
    try { last = Number(localStorage.getItem(key) || 0); } catch (e) { /* storage unavailable: just show */ }
    if (cfg.cooldownHours > 0 && Date.now() - last < cfg.cooldownHours * 3600 * 1000) return;

    await Z.refreshSettings();
    var st = Z.state.settings || {};
    if (!st.channel_whatsapp && !st.channel_telegram) return;
    try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* ignore */ }

    function opt(href, cls, icon, title, desc) {
      if (!href) return '';
      return '<a class="follow-opt" href="' + Z.esc(href) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="sup-ic ' + cls + '">' + Z.icon(icon) + '</span>' +
        '<span class="row-main"><span class="row-title">' + title + '</span><span class="row-sub">' + desc + '</span></span>' +
        '<span class="btn btn-primary btn-sm">Join</span></a>';
    }
    var sh = Z.sheet('<div class="follow">' +
      '<img src="monogram.png" alt="Zyven" class="follow-logo" onerror="this.style.display=\'none\'">' +
      '<h2>Welcome to Zyven</h2>' +
      '<p>Join our official channels to get updates, new ads and announcements first.</p>' +
      '<div class="follow-list">' +
      opt(st.channel_whatsapp, 'wa', 'chat', 'WhatsApp Channel', 'Follow for updates') +
      opt(st.channel_telegram, 'tg', 'send', 'Telegram Channel', 'Join for updates') +
      '</div><button class="btn btn-ghost btn-block" data-close>Skip for now</button></div>', { center: true });
    Z.$$('.follow-opt', sh.el).forEach(function (a) {
      a.addEventListener('click', function () { setTimeout(sh.close, 250); });
    });
  };

  /* ---------------- Notifications ---------------- */
  Z.updateBell = function () {
    var b = Z.$('#bell-badge'), n = Z.state.unread || 0;
    if (!b) return;
    b.hidden = n < 1;
    b.textContent = n > 9 ? '9+' : String(n);
    Z.$('#bar-bell').setAttribute('aria-label', n > 0 ? 'Notifications, ' + n + ' unread' : 'Notifications');
  };

  // Cheap unread-count refresh (at most every 90s, plus whenever the summary loads)
  Z.refreshUnread = async function (force) {
    if (!Z.state.user) return;
    if (!force && Z.state.unreadAt && Date.now() - Z.state.unreadAt < 90000) return;
    Z.state.unreadAt = Date.now();
    var r = await sb.rpc('unread_notification_count');
    if (!r.error && typeof r.data === 'number') { Z.state.unread = r.data; Z.updateBell(); }
  };

  function ago(d) {
    var m = Math.floor((Date.now() - new Date(d).getTime()) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    return Z.fmtDay(d);
  }

  /* Bell screen: two tabs.
       My Mails     : messages meant only for this account (payout updates, personal notes from Zyven)
       Zyven Alerts : news sent to every user */
  var NTABS = {
    mails: { label: 'My Mails', sub: 'Messages about your account.', empty: 'Payout updates and personal messages from Zyven will appear here.' },
    alerts: { label: 'Zyven Alerts', sub: 'News and updates from Zyven for everyone.', empty: 'Announcements from Zyven will show up here.' }
  };

  Z.views.notifications = async function (el, ctx) {
    el.innerHTML = '<section class="page">' + Z.skel(1, 44) + Z.skel(3, 90) + '</section>';
    var c = await sb.rpc('unread_notification_counts');
    if (ctx.stale()) return;
    var counts = c.error ? { mails: 0, alerts: 0 } : { mails: c.data.mails || 0, alerts: c.data.alerts || 0 };
    var tab = ctx.sub === 'alerts' || ctx.sub === 'mails' ? ctx.sub : (counts.mails > 0 ? 'mails' : (counts.alerts > 0 ? 'alerts' : 'mails'));
    var cache = {};   // tab -> loaded items

    function syncBell() { Z.state.unread = counts.mails + counts.alerts; Z.state.unreadAt = Date.now(); Z.updateBell(); }
    syncBell();

    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>Notifications</h2><p class="sub" id="nsub"></p></div>' +
      '<button class="btn btn-tonal btn-sm" id="readall" hidden>Mark all read</button></div>' +
      '<div class="seg" role="tablist">' + ['mails', 'alerts'].map(function (k) {
        return '<button class="seg-btn" role="tab" data-t="' + k + '">' + NTABS[k].label + '<i class="seg-count" id="cnt-' + k + '" hidden></i></button>';
      }).join('') + '</div><div id="nl"></div></section>';
    var nl = Z.$('#nl', el), all = Z.$('#readall', el);

    function paintTabs() {
      ['mails', 'alerts'].forEach(function (k) {
        Z.$('[data-t="' + k + '"]', el).classList.toggle('on', k === tab);
        var b = Z.$('#cnt-' + k, el); b.hidden = counts[k] < 1; b.textContent = counts[k] > 9 ? '9+' : counts[k];
      });
      Z.$('#nsub', el).textContent = NTABS[tab].sub;
      all.hidden = !(counts[tab] > 0);
    }

    function card(n) {
      var t = Z.ANN[n.type] || Z.ANN.info;
      return '<button class="notif' + (n.is_read ? '' : ' unread') + '" data-id="' + n.id + '">' +
        '<span class="row-ic ' + t.cls + '">' + Z.icon(t.icon) + '</span>' +
        '<span class="notif-main"><span class="notif-top"><b>' + Z.esc(n.title) + '</b>' +
        (n.priority >= 2 ? '<span class="badge b-rejected">Urgent</span>' : n.priority === 1 ? '<span class="badge b-pending">Important</span>' : '') + '</span>' +
        '<span class="notif-msg">' + Z.esc(n.message) + '</span>' +
        '<span class="notif-time">' + ago(n.created_at) + '</span></span><i class="dot"></i></button>';
    }

    async function show(k) {
      tab = k; paintTabs();
      if (cache[k]) { draw(); return; }
      nl.innerHTML = Z.skel(3, 90);
      var r = await sb.rpc('my_notifications', { p_scope: k });
      if (ctx.stale() || tab !== k) return;
      if (r.error) { nl.innerHTML = Z.errorState(); Z.$('[data-retry]', nl).addEventListener('click', function () { show(k); }); return; }
      cache[k] = r.data || [];
      counts[k] = cache[k].filter(function (n) { return !n.is_read; }).length;   // exact for what is listed
      syncBell(); paintTabs(); draw();
    }
    function draw() {
      var items = cache[tab];
      nl.innerHTML = items.length ? items.map(card).join('')
        : '<div class="card">' + Z.empty({ icon: tab === 'mails' ? 'mail' : 'bell', title: tab === 'mails' ? 'No mails' : 'No alerts', text: NTABS[tab].empty }) + '</div>';
    }

    Z.$('.seg', el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-t]');
      if (b && b.getAttribute('data-t') !== tab) show(b.getAttribute('data-t'));
    });

    nl.addEventListener('click', function (e) {
      var c = e.target.closest('.notif'); if (!c) return;
      c.classList.toggle('open');
      var k = tab, n = (cache[k] || []).filter(function (x) { return x.id === c.getAttribute('data-id'); })[0];
      if (n && !n.is_read) {
        n.is_read = true; c.classList.remove('unread');
        counts[k] = Math.max(0, counts[k] - 1); syncBell(); paintTabs();
        sb.rpc('mark_announcement_read', { p_id: n.id }).then(function (res) {
          if (res.error) { n.is_read = false; counts[k] += 1; c.classList.add('unread'); syncBell(); paintTabs(); }
        });
      }
    });

    all.addEventListener('click', function () {
      var k = tab;
      Z.run(all, async function () {
        var res = await sb.rpc('mark_all_announcements_read', { p_scope: k });
        if (res.error) throw res.error;
        (cache[k] || []).forEach(function (n) { n.is_read = true; });
        Z.$$('.notif.unread', el).forEach(function (x) { x.classList.remove('unread'); });
        counts[k] = 0; syncBell(); paintTabs();
      });
    });

    show(tab);
  };

  /* ---------------- Follow Zyven (always visible on Home) ---------------- */
  Z.followCard = function () {
    var st = Z.state.settings || {};
    function row(href, cls, icon, title, text) {
      if (!href) return '';
      return '<a class="row follow-row" href="' + Z.esc(href) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="sup-ic ' + cls + '">' + Z.icon(icon) + '</span>' +
        '<span class="row-main"><span class="row-title">' + title + '</span><span class="row-sub">' + text + '</span></span>' +
        '<span class="btn btn-tonal btn-sm">Follow</span></a>';
    }
    var rows = row(st.channel_whatsapp, 'wa', 'chat', 'Zyven on WhatsApp', 'Official channel') +
               row(st.channel_telegram, 'tg', 'send', 'Zyven on Telegram', 'Official channel');
    return rows ? '<div class="card follow-card"><div class="follow-card-head"><b>Follow Zyven</b><span>Updates, new ads and announcements first</span></div>' + rows + '</div>' : '';
  };
})();
