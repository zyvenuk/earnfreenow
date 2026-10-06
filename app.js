/* App boot, router and session handling */
(function () {
  'use strict';
  var Z = window.Z;
  var view = Z.$('#view');
  var tok = 0;

  var TITLES = { home: 'Zyven', watch: 'Watch ads', wallet: 'Wallet', payout: 'Payout', profile: 'Profile' };
  var AUTH_ROUTES = ['login', 'signup', 'forgot', 'verify'];

  Z.ready = false;
  Z.recovery = false;
  Z.currentRoute = '';

  Z.go = function (path) {
    if (location.hash === '#' + path) Z.route(); else location.hash = path;
  };

  function setMode(mode) { document.body.setAttribute('data-mode', mode); }

  function chrome(name, mode) {
    var isTab = !!TITLES[name];
    setMode(mode);
    Z.$('#bar-title').textContent = mode === 'admin' ? 'Admin' : (TITLES[name] || 'Zyven');
    Z.$('#bar-back').hidden = mode !== 'admin';
    Z.$('#bar-logo').hidden = mode === 'admin';
    Z.$('#bar-balance').hidden = !(mode === 'app' && isTab && name !== 'home' && name !== 'wallet');
    Z.$$('.nav-item').forEach(function (n) { n.classList.toggle('on', n.getAttribute('data-tab') === name); });
    if (mode === 'app' && Z.state.summary) Z.updateBalanceChip();
  }

  Z.route = async function () {
    if (!Z.ready) return;
    var path = (location.hash || '').replace(/^#/, '').split('?')[0];
    var parts = path.split('/').filter(Boolean);
    var root = parts[0] || '', sub = parts[1] || '';
    var name, mode = 'app';

    if (Z.recovery) { name = 'reset'; mode = 'auth'; }
    else if (!Z.state.user) {
      name = AUTH_ROUTES.indexOf(root) !== -1 ? root : 'login';
      mode = 'auth';
    } else if (root === 'admin') {
      if (!Z.state.isAdmin) return Z.go('/home');
      name = 'admin'; mode = 'admin';
    } else if (TITLES[root]) name = root;
    else return Z.go('/home');

    // normalise URL for signed-out users
    if (!Z.state.user && !Z.recovery && AUTH_ROUTES.indexOf(root) === -1) { history.replaceState(null, '', '#/login'); }

    Z.currentRoute = name;
    var myTok = ++tok;
    var ctx = { sub: sub, stale: function () { return myTok !== tok; } };
    chrome(name, mode);
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
    Z.state.settings = res[0].data;
    Z.state.isAdmin = res[1].data === true;
    Z.slots.load(true);
  }

  function resetState() {
    Z.state.session = null; Z.state.user = null; Z.state.isAdmin = false; Z.state.summary = null; Z.state.summaryAt = 0;
    Z.recovery = false;
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
    try { await loadContext(); }
    catch (e) { console.error(e); Z.toast('Something went wrong. Please try again.', 'error'); }
    Z.ready = true; hideSplash();
    if (/^#\/(login|signup|forgot|verify|reset)?$/.test(location.hash) || !location.hash) location.hash = '#/home';
    if (/type=signup/.test(Z.bootHash) && !Z.welcomed) { Z.welcomed = true; Z.toast('Email verified. Welcome to Zyven!', 'ok'); }
    Z.route();
  }

  // Boot
  var booted = false;
  function boot() {
    if (booted) return; booted = true;
    window.addEventListener('hashchange', Z.route);
    Z.$('#bar-back').addEventListener('click', function () { Z.go('/profile'); });

    // Expired / invalid email links come back as #error=...
    if (/error_description|error_code/.test(Z.bootHash)) {
      Z.toast('That link is invalid or has expired. Please request a new one.', 'error');
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
