/* App boot, router and session handling */
(function () {
  'use strict';
  var Z = window.Z;
  var view = Z.$('#view');
  var tok = 0;

  var TITLES = { home: 'Zyven', watch: 'Watch ads', wallet: 'Wallet', payout: 'Payout', profile: 'Profile' };
  // Screens opened from other screens (no bottom-nav tab of their own)
  var SUBS = {
    support: { title: 'Support', back: '/profile', tab: 'profile' },
    notifications: { title: 'Notifications', back: '/home', tab: '' },
    referral: { title: 'Referrals', back: '/profile', tab: 'profile' }
  };
  var AUTH_ROUTES = ['login', 'signup', 'forgot', 'verify'];

  Z.ready = false;
  Z.recovery = false;
  Z.currentRoute = '';

  Z.go = function (path) {
    if (location.hash === '#' + path) Z.route(); else location.hash = path;
  };

  function setMode(mode) { document.body.setAttribute('data-mode', mode); }

  function chrome(name, mode) {
    var isTab = !!TITLES[name], sub = SUBS[name];
    setMode(mode);
    Z.backTarget = mode === 'admin' ? '/profile' : (sub ? sub.back : '');
    Z.$('#bar-title').textContent = mode === 'admin' ? 'Admin' : (sub ? sub.title : (TITLES[name] || 'Zyven'));
    Z.$('#bar-back').hidden = !Z.backTarget;
    Z.$('#bar-logo').hidden = !!Z.backTarget;
    Z.$('#bar-bell').hidden = mode !== 'app' || name === 'notifications';
    Z.$('#bar-balance').hidden = !(mode === 'app' && isTab && name !== 'home' && name !== 'wallet');
    var active = sub ? sub.tab : name;
    Z.$$('.nav-item').forEach(function (n) { n.classList.toggle('on', n.getAttribute('data-tab') === active); });
    if (mode === 'app' && Z.state.summary) Z.updateBalanceChip();
    if (Z.updateBell) Z.updateBell();
  }

  Z.route = async function () {
    if (!Z.ready) return;
    if (Z.viewer && Z.viewer.isOpen()) Z.viewer.close(true, true, true); // never leave an ad timer running under another screen
    clearInterval(Z.maint.cd);
    if (!Z.maint.data) await Z.maint.refresh(true);                                                   // first look: wait for it
    else if (Date.now() - Z.maint.at > 60000) Z.maint.refresh().then(function (ch) { if (ch) Z.route(); });   // later: refresh quietly
    var path = (location.hash || '').replace(/^#/, '').split('?')[0];
    var parts = path.split('/').filter(Boolean);
    var root = parts[0] || '', sub = parts[1] || '';
    var name, mode = 'app';

    if (Z.recovery) { name = 'reset'; mode = 'auth'; }
    else if (!Z.state.user) {
      name = AUTH_ROUTES.indexOf(root) !== -1 ? root : (Z.refFromLink ? 'signup' : 'login');
      mode = 'auth';
    } else if (!Z.state.isAdmin && Z.maint.active('platform')) {
      name = 'maintenance'; mode = 'auth';        // whole-platform maintenance: users see only this screen (admin is exempt)
    } else if (root === 'admin') {
      if (!Z.state.isAdmin) return Z.go('/home');
      name = 'admin'; mode = 'admin';
    } else if (TITLES[root] || SUBS[root]) name = root;
    else return Z.go('/home');

    // normalise URL for signed-out users
    if (!Z.state.user && !Z.recovery && AUTH_ROUTES.indexOf(root) === -1) { history.replaceState(null, '', '#/' + name); Z.refFromLink = false; }

    Z.currentRoute = name;
    Z.online.release();   // the admin's presence listener lives only while the dashboard is open
    var myTok = ++tok;
    var ctx = { sub: sub, stale: function () { return myTok !== tok; } };
    chrome(name, mode);
    if (mode === 'app' && name !== 'notifications') Z.refreshUnread();
    window.scrollTo(0, 0);
    view.innerHTML = mode === 'auth' ? '' : '<section class="page">' + Z.skel(3, 90) + '</section>';

    try {
      await Z.views[name](view, ctx);
    } catch (e) {
      console.error('[Zyven] view error', e);
      if (!ctx.stale()) {
        view.innerHTML = '<section class="page">' + Z.errorState() + '</section>';
        Z.$('[data-retry]', view).addEventListener('click', function () { Z.route(); });
      }
    }
  };

  function hideSplash() {
    var s = Z.$('#splash');
    if (!s) return;
    s.classList.add('hide');
    setTimeout(function () { s.remove(); }, 300);
  }

  async function loadContext() {
    var res = await Promise.all([
      sb.from('platform_settings').select('*').eq('id', true).single(),
      sb.rpc('is_admin')
    ]);
    if (res[0].error) throw res[0].error;
    Z.state.settings = res[0].data; Z.state.settingsAt = Date.now();
    Z.state.isAdmin = res[1].data === true;
    Z.slots.load(true);
  }

  function resetState() {
    Z.state.session = null; Z.state.user = null; Z.state.isAdmin = false; Z.state.summary = null; Z.state.summaryAt = 0; Z.state.unread = 0; Z.state.unreadAt = 0;
    Z.recovery = false; Z.freshLogin = false;
    Z.slots.map = {}; Z.slots.loadedAt = 0;
  }

  async function onAuth(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      Z.recovery = true;
      Z.state.session = session; Z.state.user = session && session.user;
      try { await loadContext(); } catch (e) { console.error(e); }
      Z.ready = true; hideSplash(); return Z.route();
    }
    if (!session) {
      var hadUser = !!Z.state.user;
      var hadPageScript = Z.slots.pageInjected;
      Z.online.stop();
      resetState();
      Z.ready = true; hideSplash();
      if (hadUser && hadPageScript) { location.hash = '#/login'; return location.reload(); }
      return Z.route();
    }
    // session present
    if (Z.state.user && Z.state.user.id === session.user.id) {
      Z.state.session = session; Z.state.user = session.user;
      return; // token refresh / tab refocus: nothing to redo
    }
    Z.state.session = session; Z.state.user = session.user;
    var pendingRef = null;   // referral code saved before a Google signup (it cannot travel through OAuth)
    try { pendingRef = localStorage.getItem('zyven:ref'); localStorage.removeItem('zyven:ref'); } catch (e) { /* ignore */ }
    try { if (sessionStorage.getItem('zyven:fresh')) { Z.freshLogin = true; sessionStorage.removeItem('zyven:fresh'); } } catch (e) { /* ignore */ }
    try { await loadContext(); }
    catch (e) { console.error(e); Z.toast('Something went wrong. Please try again.', 'error'); }
    try {
      if (pendingRef) await sb.rpc('claim_referral', { p_code: pendingRef });   // only works for a brand-new account with no referrer
      var dev = await Z.device.register();                                      // one phone, one account
      if (dev && dev.ok === false && dev.suspended) Z.toast(Z.errMsg({ message: 'device_taken' }), 'error');
    } catch (e) { console.warn('[Zyven] post-login checks', e); }
    Z.ready = true; hideSplash();
    if (/^#\/(login|signup|forgot|verify|reset)?$/.test(location.hash) || !location.hash) location.hash = '#/home';
    if (/type=signup/.test(Z.bootHash) && !Z.welcomed) { Z.welcomed = true; Z.toast('Email verified. Welcome to Zyven!', 'ok'); }
    try {   // back from linking a Google account
      if (sessionStorage.getItem('zyven:linked')) { sessionStorage.removeItem('zyven:linked'); location.hash = '#/profile'; Z.toast('Google account linked', 'ok'); }
    } catch (e) { /* ignore */ }
    Z.route();
    setTimeout(function () { if (Z.push && Z.state.user) Z.push.sync(); }, 1500);
    Z.online.start();   // users only; the admin account never announces itself
    if (Z.freshLogin) {
      Z.freshLogin = false;
      setTimeout(function () { if (Z.state.user && !Z.recovery) Z.maybeShowFollowPopup(); }, 500);
    }
  }

  // Boot
  // Referral links look like https://site/?ref=CODE : remember the code until the visitor signs up.
  function captureRef() {
    try {
      var q = new URLSearchParams(location.search), c = q.get('ref');
      if (c && /^[A-Za-z0-9]{4,12}$/.test(c)) { localStorage.setItem('zyven:ref', c.toUpperCase()); Z.refFromLink = true; }
      if (q.has('ref')) {
        q.delete('ref');
        var qs = q.toString();
        history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
      }
    } catch (e) { /* storage blocked: referral code just won't be prefilled */ }
  }

  /* ---- New version detection: an old cached copy of the app must never keep running ---- */
  Z.BUILD = document.documentElement.getAttribute('data-build') || '';
  var bootAt = Date.now(), updChecked = 0;
  Z.reloadFresh = async function () {
    try {
      var ks = await caches.keys(); await Promise.all(ks.map(function (k) { return caches.delete(k); }));
      var reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update();
    } catch (e) { /* ignore */ }
    location.reload();
  };
  function showUpdate() {
    if (Z.$('#update-bar')) return;
    var bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.innerHTML = '<span>A new version of Zyven is ready.</span><button class="btn btn-primary btn-sm" type="button">Update</button>';
    bar.querySelector('button').addEventListener('click', Z.reloadFresh);
    document.body.appendChild(bar);
  }
  Z.checkUpdate = async function (force) {
    if (!Z.BUILD || (!force && Date.now() - updChecked < 5 * 60 * 1000)) return;
    updChecked = Date.now();
    try {
      var r = await fetch(location.pathname + '?cb=' + Date.now(), { cache: 'no-store' });
      var m = /data-build="([^"]+)"/.exec(await r.text());
      if (!m || m[1] === Z.BUILD) return;
      var again = false; try { again = !!sessionStorage.getItem('zyven:autoreload'); } catch (e) { /* ignore */ }
      if (!again && Date.now() - bootAt < 10000 && !(Z.viewer && Z.viewer.isOpen())) {   // just opened: refresh right away, once
        try { sessionStorage.setItem('zyven:autoreload', '1'); } catch (e) { /* ignore */ }
        Z.reloadFresh();
      } else showUpdate();
    } catch (e) { /* offline: try later */ }
  };

  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    captureRef();
    window.addEventListener('hashchange', Z.route);
    setTimeout(function () { Z.checkUpdate(true); }, 2500);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') Z.checkUpdate(); });
    document.addEventListener('visibilitychange', function () {   // coming back to the app: is maintenance different now?
      if (document.visibilityState === 'visible' && Z.ready && Z.maint.data && Date.now() - Z.maint.at > 30000) {
        Z.maint.refresh(true).then(function (ch) { if (ch) Z.route(); });
      }
    });
    Z.$('#bar-back').addEventListener('click', function () { Z.go(Z.backTarget || '/home'); });

    // Expired / invalid email links come back as #error=...
    if (/error_description|error_code/.test(Z.bootHash)) {
      var bh = decodeURIComponent(Z.bootHash.replace(/\+/g, ' '));
      Z.toast(/already.*linked/i.test(bh) ? 'That Google account is already linked to another Zyven account.'
        : /provider|oauth|identity|access_denied/i.test(bh) ? 'Google sign-in did not complete. Please try again or use email and password.'
        : 'That link is invalid or has expired. Please request a new one.', 'error');
      history.replaceState(null, '', location.pathname + location.search);
    }

    sb.auth.onAuthStateChange(function (event, session) {
      // Avoid calling Supabase inside this callback synchronously (can deadlock the SDK).
      setTimeout(function () { onAuth(event, session); }, 0);
    });

    // Safety net: if no auth event arrives, fall back to the login screen.
    setTimeout(function () {
      if (!Z.ready) { Z.ready = true; hideSplash(); Z.route(); }
    }, 7000);
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
