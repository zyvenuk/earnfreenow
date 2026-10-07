/* App install shortcut + push notifications (client side) */
(function () {
  'use strict';
  var Z = window.Z;
  var P = Z.pwa = { deferred: null, installed: false };
  var PU = Z.push = {};
  var DISMISS_DAYS = 7;

  /* ---------------- Install ---------------- */
  P.isStandalone = function () {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  };
  P.isIOS = function () {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  P.canInstall = function () { return !P.isStandalone() && !P.installed && (!!P.deferred || P.isIOS()); };

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();            // keep the event so our own button can trigger the install dialog
    P.deferred = e;
  });
  window.addEventListener('appinstalled', function () {
    P.deferred = null; P.installed = true;
    Z.$$('[data-pwa-card="install"], #install-app').forEach(function (n) { n.remove(); });
    Z.toast('Zyven installed', 'ok');
  });

  P.install = async function () {
    if (P.deferred) {
      var ev = P.deferred;
      P.deferred = null;
      ev.prompt();
      var choice = await ev.userChoice.catch(function () { return {}; });
      return choice.outcome === 'accepted';
    }
    P.showHelp();
    return false;
  };

  P.showHelp = function () {
    var steps = P.isIOS()
      ? ['Tap the <b>Share</b> button in Safari.', 'Choose <b>Add to Home Screen</b>.', 'Tap <b>Add</b>.']
      : ['Open the browser menu (<b>\u22ee</b>).', 'Tap <b>Install app</b> or <b>Add to Home screen</b>.', 'Confirm with <b>Install</b>.'];
    Z.sheet('<h2 class="sheet-title">Install Zyven</h2><p class="sheet-text">Add Zyven to your home screen to open it like a normal app.</p>' +
      '<ol class="steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join('') + '</ol>' +
      '<div class="sheet-actions"><button class="btn btn-primary btn-block" data-close>Got it</button></div>');
  };

  /* ---------------- Service worker ---------------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('[Zyven] service worker', e); });
    });
    navigator.serviceWorker.addEventListener('message', function (ev) {
      if (ev.data && ev.data.type === 'navigate' && typeof ev.data.path === 'string') Z.go(ev.data.path);   // notification tapped
    });
  }

  /* ---------------- Push ---------------- */
  PU.supported = function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol !== 'file:'; };
  // iPhone/iPad only allow push for apps that were added to the Home Screen
  PU.needsInstall = function () { return P.isIOS() && !P.isStandalone(); };

  function getReg() {
    return Promise.race([navigator.serviceWorker.ready, new Promise(function (res) { setTimeout(function () { res(null); }, 5000); })]);
  }
  function keyBytes(b64u) {
    var pad = '='.repeat((4 - (b64u.length % 4)) % 4), raw = atob((b64u + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  PU.current = async function () {
    if (!PU.supported()) return null;
    var reg = await getReg();
    return reg ? reg.pushManager.getSubscription() : null;
  };
  PU.isOn = async function () {
    if (!PU.supported() || Notification.permission !== 'granted') return false;
    return !!(await PU.current());
  };

  PU.publicKey = async function () {
    var k = Z.state.settings && Z.state.settings.push_public_key;
    if (k) return k;
    var r = await sb.functions.invoke('push', { body: { action: 'key' } });   // creates the key pair the first time
    if (r.error || !r.data || !r.data.publicKey) throw r.error || new Error('push key unavailable');
    if (Z.state.settings) Z.state.settings.push_public_key = r.data.publicKey;
    return r.data.publicKey;
  };

  PU.save = async function (sub) {
    var j = sub.toJSON();
    var r = await sb.rpc('save_push_subscription', {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent.slice(0, 300)
    });
    if (r.error) throw r.error;
  };

  PU.enable = async function () {
    if (!PU.supported()) throw { message: 'push_unsupported' };
    if (PU.needsInstall()) throw { message: 'push_ios_install' };
    var perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') throw { message: 'push_denied' };
    var key = await PU.publicKey();
    var reg = await getReg();
    if (!reg) throw { message: 'push_unsupported' };
    var sub = await reg.pushManager.getSubscription();
    if (sub) {   // subscription made with another key can never receive our pushes
      var cur = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null, want = keyBytes(key);
      if (cur && (cur.length !== want.length || cur.some(function (b, i) { return b !== want[i]; }))) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    await PU.save(sub);
    return true;
  };

  PU.disable = async function () {
    var sub = await PU.current();
    if (!sub) return;
    await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  };

  // After login: attach this device to whoever is signed in now (shared phones follow the active user)
  PU.sync = async function () {
    try {
      if (!PU.supported() || Notification.permission !== 'granted') return;
      var sub = await PU.current();
      if (sub) await PU.save(sub);
    } catch (e) { console.warn('[Zyven] push sync', e); }
  };
  // Before logout: stop this account receiving pushes on this device
  PU.detach = async function () {
    try {
      var sub = await PU.current();
      if (sub) await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint });
    } catch (e) { /* ignore */ }
  };

  // Admin only (enforced by the Edge Function through the database admin check)
  PU.adminSend = async function (payload) {
    var body = Object.assign({ action: 'send' }, payload);
    var r = await sb.functions.invoke('push', { body: body });
    if (r.error) throw r.error;
    return r.data;
  };

  /* ---------------- Home cards ---------------- */
  function dismissed(k) {
    try { var t = Number(localStorage.getItem('zyven:dismiss:' + k) || 0); return t && Date.now() - t < DISMISS_DAYS * 86400000; } catch (e) { return false; }
  }
  function dismiss(k) { try { localStorage.setItem('zyven:dismiss:' + k, String(Date.now())); } catch (e) { /* ignore */ } }

  function card(k, icon, title, text, btn) {
    return '<div class="pwa-card" data-pwa-card="' + k + '"><span class="quick-ic">' + Z.icon(icon) + '</span>' +
      '<span class="pwa-text"><b>' + title + '</b><span>' + text + '</span></span>' +
      '<button class="btn btn-primary btn-sm" data-pwa-act="' + k + '">' + btn + '</button>' +
      '<button class="icon-btn sm" data-pwa-act="dismiss" data-k="' + k + '" aria-label="Dismiss">' + Z.icon('x') + '</button></div>';
  }

  P.cards = function () {
    var h = '';
    if (P.canInstall() && !dismissed('install')) h += card('install', 'download', 'Install Zyven', 'Add it to your home screen for a faster, app-like experience.', 'Install');
    if (PU.supported() && !PU.needsInstall() && Notification.permission === 'default' && !dismissed('push')) h += card('push', 'bell', 'Turn on notifications', 'Get payout updates and announcements instantly.', 'Enable');
    return h;
  };

  P.bindCards = function (root) {
    root.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-pwa-act]');
      if (!b || !root.contains(b)) return;
      var act = b.getAttribute('data-pwa-act');
      var el = b.closest('[data-pwa-card]');
      if (act === 'dismiss') { dismiss(b.getAttribute('data-k')); if (el) el.remove(); return; }
      if (act === 'install') {
        Z.busy(b, true);
        var ok = await P.install();
        Z.busy(b, false);
        if (ok && el) el.remove();
      }
      if (act === 'push') {
        Z.run(b, async function () {
          await PU.enable();
          Z.toast('Notifications are on', 'ok');
          if (el) el.remove();
        });
      }
    });
  };

  /* ---------------- Profile rows ---------------- */
  P.profileRows = function () {
    var h = '';
    if (!P.isStandalone() && !P.installed) {
      h += '<button class="row row-btn" id="install-app"><span class="row-ic acc">' + Z.icon('download') + '</span>' +
        '<span class="row-main"><span class="row-title">Install app</span><span class="row-sub">Add Zyven to your home screen</span></span>' + Z.icon('chevron', 'row-chev') + '</button>';
    }
    h += '<div class="row"><span class="row-ic">' + Z.icon('bell') + '</span>' +
      '<span class="row-main"><span class="row-title">Push notifications</span><span class="row-sub" id="push-sub">Checking\u2026</span></span>' +
      '<label class="switch"><input type="checkbox" id="push-sw" disabled aria-label="Push notifications"><i></i></label></div>';
    return h;
  };

  P.bindProfile = function (root) {
    var inst = Z.$('#install-app', root);
    if (inst) inst.addEventListener('click', function () { P.install(); });

    var sw = Z.$('#push-sw', root), sub = Z.$('#push-sub', root);
    if (!sw) return;
    async function paint() {
      if (!PU.supported()) { sub.textContent = 'Not supported on this browser'; sw.disabled = true; sw.checked = false; return; }
      if (PU.needsInstall()) { sub.textContent = 'Add Zyven to your Home Screen first'; sw.disabled = true; sw.checked = false; return; }
      if (Notification.permission === 'denied') { sub.textContent = 'Blocked. Allow it in browser settings'; sw.disabled = true; sw.checked = false; return; }
      var on = await PU.isOn();
      sw.checked = on; sw.disabled = false;
      sub.textContent = on ? 'On for this device' : 'Off';
    }
    paint();
    sw.addEventListener('change', async function () {
      var want = sw.checked;
      sw.disabled = true;
      try {
        if (want) await PU.enable(); else await PU.disable();
        Z.toast(want ? 'Notifications are on' : 'Notifications are off', 'ok');
      } catch (e) { Z.toast(Z.errMsg(e), 'error'); }
      paint();
    });
  };
})();
