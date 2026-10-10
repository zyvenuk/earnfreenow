/* Watch Ads: list + viewer. Rewards are only credited by the complete_ad() database function. */
(function () {
  'use strict';
  var Z = window.Z;

  var TYPES = {
    banner: { icon: 'layout', label: 'Banner' },
    native: { icon: 'layout', label: 'Native' },
    video: { icon: 'play', label: 'Video' },
    direct_link: { icon: 'external', label: 'Offer' }
  };

  function adCard(a) {
    var t = TYPES[a.ad_type] || TYPES.banner;
    var done = !a.available;
    var doneText = a.daily_limit && a.done_today >= a.daily_limit ? 'Done for today' : 'Completed';
    return '<button class="ad-card' + (done ? ' is-done' : '') + '" data-ad="' + a.id + '"' + (done ? ' aria-disabled="true"' : '') + '>' +
      '<span class="ad-ic">' + Z.icon(done ? 'check' : t.icon) + '</span>' +
      '<span class="ad-main"><span class="ad-title">' + Z.esc(a.title) + '</span>' +
      '<span class="ad-sub">' + (a.description ? Z.esc(a.description) : t.label) + '</span>' +
      '<span class="ad-meta">' + Z.icon('clock') + a.duration_seconds + 's' +
      (a.daily_limit ? '<i></i>' + Math.min(a.done_today, a.daily_limit) + '/' + a.daily_limit + ' today' : '') + '</span></span>' +
      (done ? '<span class="ad-done">' + doneText + '</span>' : '<span class="ad-reward">' + Z.money(a.reward, { sign: true }) + '</span>') +
      '</button>';
  }

  Z.views.watch = async function (el, ctx) {
    el.innerHTML = '<section class="page"><div class="page-head"><div><h2>Watch ads</h2><p class="sub">Finish an ad to earn its reward.</p></div>' +
      '<button class="icon-btn" id="reload" aria-label="Refresh">' + Z.icon('refresh') + '</button></div>' +
      '<div id="list">' + Z.skel(4, 84) + '</div></section>';
    Z.$('#reload', el).addEventListener('click', function () { Z.route(); });

    var plansOn = Z.plans.enabled();
    var rr = await Promise.all([sb.rpc('list_available_ads'), plansOn ? Z.plans.status(true).catch(function () { return null; }) : null]);
    var r = rr[0], pst = rr[1];
    if (ctx.stale()) return;
    var list = Z.$('#list', el);
    if (r.error) {
      list.innerHTML = Z.errorState();
      Z.$('[data-retry]', list).addEventListener('click', function () { Z.route(); });
      return;
    }
    var ads = r.data || [];
    Z.state.ads = ads;
    if (plansOn && pst && !pst.current) { list.innerHTML = Z.maint.notices(['platform']) + '<div class="card">' + Z.plans.noPlan() + '</div>'; return; }
    var head = plansOn && pst ? Z.plans.watchHeader(pst) : '';
    if (!ads.length) {
      list.innerHTML = Z.maint.notices(['platform']) + head + (plansOn && pst && pst.remaining < 1 ? '' :
        '<div class="card">' + Z.empty({ icon: 'play', title: 'No ads right now', text: 'New ads appear here when they are available. Check back soon.' }) + '</div>');
      return;
    }
    var html = Z.maint.notices(['platform']) + head + Z.slots.html('watch_top');
    ads.forEach(function (a, i) {
      html += adCard(a);
      if (i === 1 && ads.length > 2) html += Z.slots.html('watch_between');
    });
    html += Z.slots.html('watch_bottom');
    list.innerHTML = html;
    Z.slots.attach(list, ctx);

    list.addEventListener('click', function (e) {
      var card = e.target.closest('[data-ad]');
      if (!card) return;
      var ad = ads.filter(function (x) { return x.id === card.getAttribute('data-ad'); })[0];
      if (!ad) return;
      if (!ad.available) return Z.toast('You have already completed this ad for now.');
      if (Z.state.summary && Z.state.summary.status === 'suspended') return Z.toast(Z.errMsg({ message: 'account_suspended' }), 'error');
      Z.viewer.open(ad);
    });
  };

  /* ---------------- Viewer ----------------
     The server decides whether an ad earned its reward:
       in-app ads : ad must have really rendered (not blocked), then be on screen continuously (heartbeats)
       direct link: user must stay away on the offer for the full time, coming back early voids the attempt
     Leaving, going back or hiding the page restarts the ad from zero. */
  var V = Z.viewer = {};
  var cur = null;
  var BEAT_MS = 2000;

  V.isOpen = function () { return !!cur; };

  V.open = async function (ad) {
    var root = Z.$('#viewer-root');
    var wrap = document.createElement('div');
    wrap.className = 'viewer';
    wrap.innerHTML = '<div class="viewer-bar"><button class="icon-btn" data-act="close" aria-label="Close">' + Z.icon('x') + '</button>' +
      '<div class="viewer-title">' + Z.esc(ad.title) + '</div></div><div class="viewer-body center-all"><div class="spinner"></div></div>';
    root.appendChild(wrap);
    document.body.classList.add('no-scroll');
    var me = cur = { wrap: wrap, ad: ad, claimed: false, closed: false };
    Z.$('[data-act=close]', wrap).addEventListener('click', function () { V.close(true); });

    // Phone back button / gesture closes the ad and voids it
    if (!(history.state && history.state.zv)) history.pushState({ zv: 1 }, '');
    me.onPop = function () { if (cur === me) V.close(true, false, true); };
    me.onVis = function () { if (cur !== me) return; if (document.visibilityState === 'hidden') awayStart(); else awayEnd(); };
    me.onBlur = function () { if (cur === me && me.s && me.s.ad_type === 'direct_link') awayStart(); };
    me.onFocus = function () { if (cur === me) awayEnd(); };
    me.onTap = function () { if (cur === me) awayEnd(); };   // any tap on this page proves the user is back
    window.addEventListener('popstate', me.onPop);
    document.addEventListener('visibilitychange', me.onVis);
    window.addEventListener('blur', me.onBlur);
    window.addEventListener('focus', me.onFocus);
    window.addEventListener('pageshow', me.onFocus);
    wrap.addEventListener('pointerdown', me.onTap, true);

    var r = await sb.rpc('start_ad', { p_ad_id: ad.id });
    if (cur !== me) return; // closed while starting
    if (r.error) { Z.toast(Z.errMsg(r.error), 'error'); return V.close(true); }
    me.s = r.data;
    render();
  };

  function stopTimers(me) {
    clearInterval(me.timer); clearInterval(me.detect); clearInterval(me.beatTimer);
  }

  function setNote(msg, type) {
    var n = cur && Z.$('#vnote', cur.wrap);
    if (n) n.innerHTML = msg ? '<div class="alert a-' + (type || 'warn') + '">' + Z.icon(type === 'ok' ? 'check' : 'alert') + '<div>' + Z.esc(msg) + '</div></div>' : '';
  }

  function isDone(me) {
    if (!me.s || !me.loaded) return false;
    return me.s.ad_type === 'direct_link' ? !!me.ready : me.srvActive >= me.s.required_seconds - 2;
  }

  // Start the same ad again from zero (the new server session voids the old one)
  async function restart(note) {
    var me = cur;
    if (!me || me.restarting) return;
    me.restarting = true;
    stopTimers(me);
    var r = await sb.rpc('start_ad', { p_ad_id: me.ad.id });
    if (cur !== me) return;
    me.restarting = false;
    if (r.error) { Z.toast(Z.errMsg(r.error), 'error'); return V.close(true); }
    me.s = r.data; me.note = note || '';
    render();
  }

  function render() {
    var me = cur, s = me.s, wrap = me.wrap, direct = s.ad_type === 'direct_link';
    stopTimers(me);
    me.ready = false; me.loaded = false; me.failed = false; me.offerOpened = false;
    me.hiddenAt = null; me.closedAt = null; me.leftAt = null; me.offerWin = null;
    me.srvActive = 0; me.srvAt = performance.now(); me.beatBusy = false; me.lastForce = 0;

    wrap.innerHTML =
      '<div class="viewer-bar"><button class="icon-btn" data-act="close" aria-label="Close">' + Z.icon('x') + '</button>' +
      '<div class="viewer-title">' + Z.esc(s.title) + '</div><div class="reward-chip">' + Z.money(s.reward, { sign: true }) + '</div></div>' +
      '<div class="viewer-progress"><i id="vp"></i></div>' +
      '<div class="viewer-body" id="vbody"><div id="vnote"></div></div>' +
      '<div class="viewer-foot"><div class="viewer-status" id="vs"></div>' +
      '<button class="btn btn-primary btn-block" id="claim" disabled>Claim ' + Z.money(s.reward) + '</button></div>';
    Z.$('[data-act=close]', wrap).addEventListener('click', function () { V.close(); });
    Z.$('#claim', wrap).addEventListener('click', claim);
    if (me.note) { setNote(me.note, 'warn'); me.note = ''; }

    if (direct) initDirect(); else initInApp();
    me.timer = setInterval(tick, 250);
    tick();
  }

  /* ---------- Banner / native / video ads ---------- */
  function initInApp() {
    var me = cur, s = me.s;
    var host = document.createElement('div');
    host.className = 'viewer-ad';
    Z.$('#vbody', me.wrap).appendChild(host);
    var frame = Z.slots.frame(host, s.ad_code || '', s.ad_type === 'video' ? 360 : 300, Math.min(window.innerWidth - 32, 640));

    // Is the ad really showing? Blockers either refuse the request or hide what it draws.
    var hint = false, t0 = Date.now();
    Z.slots.probe(Z.slots.urlsFrom(s.ad_code || '')).then(function (r) { if (r === 'blocked') hint = true; });
    me.detect = setInterval(function () {
      if (cur !== me || me.s !== s) return clearInterval(me.detect);
      if (Z.slots.rendered(frame)) {
        clearInterval(me.detect);
        me.loaded = true;
        me.beatTimer = setInterval(beat, BEAT_MS);
        beat();
        return;
      }
      var waited = Date.now() - t0;
      if ((hint && waited > 4000) || waited > 12000) { clearInterval(me.detect); adFailed(hint); }
    }, 400);
  }

  function adFailed(blocked) {
    var me = cur;
    if (!me) return;
    me.failed = true;
    clearInterval(me.detect); clearInterval(me.beatTimer);
    Z.$('#vbody', me.wrap).innerHTML = '<div id="vnote"></div><div class="offer"><div class="offer-ic warn">' + Z.icon('alert') + '</div>' +
      '<h3>' + (blocked ? 'Ad blocked' : 'Ad could not load') + '</h3>' +
      '<p>' + (blocked
        ? 'An ad blocker, Private DNS or browser shield is blocking this ad. Turn it off for Zyven and try again. Blocked ads do not earn a reward.'
        : 'The ad was not shown. Check your connection and try again. An ad has to be shown to earn its reward.') + '</p>' +
      '<button class="btn btn-tonal" id="retry">Try again</button></div>';
    Z.$('#retry', me.wrap).addEventListener('click', function () { restart(''); });
    tick();
  }

  async function beat() {
    var me = cur;
    if (!me || !me.s || !me.loaded || me.claimed || me.failed || me.beatBusy) return;
    if (document.visibilityState !== 'visible') return;
    var s = me.s;
    me.beatBusy = true;
    var r = await sb.rpc('ad_heartbeat', { p_view_id: s.view_id, p_loaded: true });
    me.beatBusy = false;
    if (cur !== me || me.s !== s) return;
    if (r.error) {
      if (/view_expired/.test(r.error.message || '')) { Z.toast(Z.errMsg(r.error), 'error'); V.close(true); }
      return; // temporary network problem: the next beat retries
    }
    me.srvActive = Number(r.data.active) || 0;
    me.srvAt = performance.now();
    if (r.data.restarted) setNote('The timer restarted because the ad was not on screen. Keep this page open.', 'warn');
  }

  /* ---------- Direct link / smart link offers ---------- */
  function initDirect() {
    var me = cur, s = me.s;
    Z.$('#vbody', me.wrap).insertAdjacentHTML('beforeend',
      '<div class="offer"><div class="offer-ic">' + Z.icon('external') + '</div>' +
      '<h3>Open the offer</h3><p>Tap the button, then stay on the offer page for <b>' + s.required_seconds + ' seconds</b> (this includes the time the page takes to load). ' +
      'When the time is up, come back here to claim your reward.</p>' +
      '<p class="offer-warn">If you come back early, the timer restarts.</p>' +
      '<button class="btn btn-tonal" id="open-offer" disabled>Open offer</button></div>');
    Z.$('#open-offer', me.wrap).addEventListener('click', openOffer);

    var origin = '';
    try { origin = new URL(s.target_url).origin + '/'; } catch (e) { /* bad url */ }
    Z.slots.probe(origin ? [origin] : []).then(async function (res) {
      if (cur !== me || me.s !== s) return;
      if (res === 'blocked') return adFailed(true);
      var h = await sb.rpc('ad_heartbeat', { p_view_id: s.view_id, p_loaded: true });   // tells the server the offer is reachable
      if (cur !== me || me.s !== s) return;
      if (h.error) { Z.toast(Z.errMsg(h.error), 'error'); return V.close(true); }
      me.loaded = true;
      var ob = Z.$('#open-offer', me.wrap); if (ob) ob.disabled = false;
    });
  }

  function openOffer() {
    var me = cur, s = me.s;
    if (!me.loaded || me.offerOpened && me.ready) return;
    me.offerOpened = true; me.hiddenAt = null; me.closedAt = null;   // set first: blur/hidden fire the moment the tab opens
    var w = window.open('', '_blank');
    if (!w) { me.offerOpened = false; return Z.toast('Please allow pop-ups to open the offer.', 'error'); }
    try { w.opener = null; } catch (e) { /* ignore */ }
    w.location.href = s.target_url;
    me.offerWin = w;
    setNote('', '');
    tick();
  }

  // The page went to the background (user is on the offer / another app / another tab)
  // Tell the server, at the moment of leaving, that the user went to the offer. The server keeps its own clock.
  // keepalive lets the request finish even while the page goes to the background.
  function sendLeft(viewId) {
    var tok = Z.state.session && Z.state.session.access_token;
    try {
      if (tok && window.fetch) {
        fetch(Z.SUPABASE_URL + '/rest/v1/rpc/ad_offer_left', {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json', apikey: Z.SUPABASE_KEY, Authorization: 'Bearer ' + tok },
          body: JSON.stringify({ p_view_id: viewId })
        }).catch(function () { /* backup below */ });
      }
    } catch (e) { /* ignore */ }
    sb.rpc('ad_offer_left', { p_view_id: viewId }).then(function () {}, function () {});   // backup; the server only keeps the first one
  }

  function awayStart() {
    var me = cur;
    if (!me || !me.s) return;
    if (me.s.ad_type === 'direct_link') {
      if (me.offerOpened && !me.ready && !me.hiddenAt) { me.hiddenAt = Date.now(); sendLeft(me.s.view_id); }
    }
    else if (document.visibilityState === 'hidden' && !me.leftAt) me.leftAt = Date.now();
  }
  function awayEnd() {
    var me = cur;
    if (!me || !me.s || document.visibilityState === 'hidden') return;
    if (me.s.ad_type === 'direct_link') returnDirect(); else returnInApp();
  }

  function returnInApp() {
    var me = cur, left = me.leftAt;
    me.leftAt = null;
    if (!left || me.claimed || me.restarting || me.failed || isDone(me)) return;
    if (Date.now() - left < 1500) return;   // a blink, e.g. pulling down the notification shade
    restart('You left the ad, so the timer restarted. Watch it until the end.');
  }

  // Back from the offer. The server measures the time away from its own clock: the browser cannot claim a number.
  async function returnDirect() {
    var me = cur, s = me.s;
    if (!me.offerOpened || !me.hiddenAt || me.ready || me.claimed || me.restarting) return;
    me.hiddenAt = null;
    var r = await sb.rpc('ad_offer_back', { p_view_id: s.view_id });
    if (cur !== me || me.s !== s) return;
    if (r.error) return restart('Something went wrong. Open the offer again and stay on it for the full time.');
    if (r.data && r.data.ok) {
      me.ready = true;
      setNote('Time completed. You can claim your reward now.', 'ok');
      var ob = Z.$('#open-offer', me.wrap); if (ob) ob.hidden = true;
      tick();
    } else {
      var away = Math.floor(Number(r.data && r.data.away) || 0);
      restart(away > 0
        ? 'You came back after ' + away + 's. Open the offer again and stay on it for the full ' + s.required_seconds + ' seconds.'
        : 'We could not confirm you were on the offer. Open it again and stay on it for the full ' + s.required_seconds + ' seconds.');
    }
  }

  /* ---------- Status / progress ---------- */
  function tick() {
    var me = cur;
    if (!me || !me.s) return;
    var s = me.s, req = s.required_seconds;
    var vp = Z.$('#vp', me.wrap), vs = Z.$('#vs', me.wrap), btn = Z.$('#claim', me.wrap);
    if (!vp || !vs || !btn) return;
    var canClaim = false, pct = 0, text = '';

    if (me.failed) {
      text = 'Ad not shown';
    } else if (s.ad_type === 'direct_link') {
      // safety net: if the browser missed the "came back" event, a visible and focused page still counts as back
      if (me.offerOpened && !me.ready && me.hiddenAt && !me.restarting && document.visibilityState === 'visible' && document.hasFocus()) returnDirect();
      if (me.ready) { canClaim = true; pct = 100; text = 'Reward ready'; }
      else if (!me.loaded) text = 'Checking offer\u2026';
      else if (me.offerOpened) text = 'Stay on the offer for ' + req + 's, then come back';
      else text = 'Open the offer to start the timer';
    } else if (!me.loaded) {
      text = 'Loading ad\u2026';
    } else {
      var vis = document.visibilityState === 'visible';
      var shown = me.srvActive + (vis ? (performance.now() - me.srvAt) / 1000 : 0);   // server count + smooth in-between
      var remaining = Math.max(0, req - shown);
      pct = Math.min(100, shown / req * 100);
      if (me.srvActive >= req - 2) { canClaim = true; pct = 100; text = 'Reward ready'; }
      else if (remaining <= 0) {
        text = 'Confirming\u2026';
        if (Date.now() - me.lastForce > 1500) { me.lastForce = Date.now(); beat(); }
      } else text = 'Keep watching \u00b7 ' + Math.ceil(remaining) + 's';
    }
    vp.style.width = pct.toFixed(1) + '%';
    vs.textContent = text;
    if (!me.claimed && !btn.classList.contains('is-loading')) btn.disabled = !canClaim;
  }

  async function claim() {
    var me = cur, btn = Z.$('#claim', me.wrap);
    if (me.claimed || btn.disabled) return;
    Z.busy(btn, true);
    var r = await sb.rpc('complete_ad', { p_view_id: me.s.view_id });
    if (cur !== me) return;
    if (r.error) {
      Z.busy(btn, false);
      var m = r.error.message || '';
      Z.toast(Z.errMsg(r.error), 'error');
      if (/too_early|ad_not_loaded|offer_not_done/.test(m)) restart('The reward could not be confirmed. Please watch the ad again.');
      else if (/limit|already|expired|not_found|suspended/.test(m)) V.close(true);
      return;
    }
    me.claimed = true;
    stopTimers(me);
    Z.invalidateSummary();
    if (Z.state.summary) { Z.state.summary.balance = r.data.balance; Z.updateBalanceChip(); }
    success(r.data);
  }

  function success(d) {
    var wrap = cur.wrap;
    wrap.innerHTML = '<div class="viewer-bar"><button class="icon-btn" data-act="close" aria-label="Close">' + Z.icon('x') + '</button></div>' +
      '<div class="viewer-body center-all"><div class="win">' +
      '<div class="win-ic">' + Z.icon('check') + '</div>' +
      '<h2>' + Z.money(d.reward, { sign: true }) + '</h2><p>Added to your balance.</p>' +
      '<div class="win-bal">New balance <b>' + Z.money(d.balance) + '</b></div></div></div>' +
      '<div class="viewer-foot"><button class="btn btn-primary btn-block" id="next">Watch next ad</button>' +
      '<button class="btn btn-ghost btn-block" data-act="close">Done</button></div>';
    Z.$$('[data-act=close]', wrap).forEach(function (b) { b.addEventListener('click', function () { V.close(true); }); });
    Z.$('#next', wrap).addEventListener('click', async function () {
      var btn = this, prev = cur.ad.id;
      Z.busy(btn, true);
      var r = await sb.rpc('list_available_ads');
      Z.busy(btn, false);
      var next = r.data && r.data.filter(function (a) { return a.available && a.id !== prev; })[0];
      if (!next) { Z.toast('No more ads available right now.'); return V.close(true); }
      V.close(true, true, true);
      V.open(next);
    });
  }

  // force: skip the "leave?" prompt. silent: don't refresh the list. keepHistory: history entry already popped / reused.
  V.close = async function (force, silent, keepHistory) {
    if (!cur) return;
    if (!force && !cur.claimed && cur.s && !cur.failed && !isDone(cur)) {
      var ok = await Z.confirm({ title: 'Leave this ad?', text: 'You will not earn the reward unless you finish.', confirm: 'Leave', cancel: 'Keep watching', danger: true });
      if (!ok || !cur) return;
    }
    var me = cur;
    cur = null;
    stopTimers(me);
    me.closed = true;
    window.removeEventListener('popstate', me.onPop);
    document.removeEventListener('visibilitychange', me.onVis);
    window.removeEventListener('blur', me.onBlur);
    window.removeEventListener('focus', me.onFocus);
    window.removeEventListener('pageshow', me.onFocus);
    // Unfinished ad = void on the server too, so it can never be claimed later.
    if (!me.claimed && me.s) sb.rpc('cancel_ad', { p_view_id: me.s.view_id }).then(function () {}, function () {});
    me.wrap.remove();
    if (!keepHistory && history.state && history.state.zv) history.back();
    if (!Z.$('#sheet-root').children.length) document.body.classList.remove('no-scroll');
    if (!silent && Z.currentRoute === 'watch') Z.route();
  };
})();
