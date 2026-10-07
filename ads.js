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

    var r = await sb.rpc('list_available_ads');
    if (ctx.stale()) return;
    var list = Z.$('#list', el);
    if (r.error) {
      list.innerHTML = Z.errorState();
      Z.$('[data-retry]', list).addEventListener('click', function () { Z.route(); });
      return;
    }
    var ads = r.data || [];
    Z.state.ads = ads;
    if (!ads.length) {
      list.innerHTML = Z.empty({ icon: 'play', title: 'No ads right now', text: 'New ads appear here when they are available. Check back soon.' });
      return;
    }
    var html = Z.slots.html('watch_top');
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

  /* ---------------- Viewer ---------------- */
  var V = Z.viewer = {};
  var cur = null;

  V.open = async function (ad) {
    var root = Z.$('#viewer-root');
    var wrap = document.createElement('div');
    wrap.className = 'viewer';
    wrap.innerHTML = '<div class="viewer-bar"><button class="icon-btn" data-act="close" aria-label="Close">' + Z.icon('x') + '</button>' +
      '<div class="viewer-title">' + Z.esc(ad.title) + '</div></div><div class="viewer-body center-all"><div class="spinner"></div></div>';
    root.appendChild(wrap);
    document.body.classList.add('no-scroll');
    var me = cur = { wrap: wrap, ad: ad, timer: null, claimed: false, closed: false };
    Z.$('[data-act=close]', wrap).addEventListener('click', function () { V.close(true); });

    // Phone back button / gesture must close the ad (and cancel it), not leave it running underneath.
    if (!(history.state && history.state.zv)) history.pushState({ zv: 1 }, '');
    me.onPop = function () { if (cur === me) V.close(true, false, true); };
    window.addEventListener('popstate', me.onPop);
    me.onVis = function () { if (cur === me) onReturn(); };
    document.addEventListener('visibilitychange', me.onVis);

    var r = await sb.rpc('start_ad', { p_ad_id: ad.id });
    if (cur !== me) return; // closed while starting
    if (r.error) {
      Z.toast(Z.errMsg(r.error), 'error');
      return V.close(true);
    }
    cur.s = r.data;
    render();
  };

  function render() {
    var s = cur.s, wrap = cur.wrap, direct = s.ad_type === 'direct_link';
    wrap.innerHTML =
      '<div class="viewer-bar"><button class="icon-btn" data-act="close" aria-label="Close">' + Z.icon('x') + '</button>' +
      '<div class="viewer-title">' + Z.esc(s.title) + '</div><div class="reward-chip">' + Z.money(s.reward, { sign: true }) + '</div></div>' +
      '<div class="viewer-progress"><i id="vp"></i></div>' +
      '<div class="viewer-body" id="vbody"></div>' +
      '<div class="viewer-foot"><div class="viewer-status" id="vs"></div>' +
      '<button class="btn btn-primary btn-block" id="claim" disabled>Claim ' + Z.money(s.reward) + '</button></div>';
    Z.$('[data-act=close]', wrap).addEventListener('click', function () { V.close(); });

    var body = Z.$('#vbody', wrap);
    cur.remaining = s.required_seconds;
    cur.last = performance.now();
    cur.running = !direct; // in-app ads count down while the page is visible

    if (direct) {
      cur.offerOpened = false; cur.ready = false; cur.hiddenAt = null; cur.closedAt = null; cur.offerWin = null;
      body.innerHTML = '<div class="offer">' + '<div class="offer-ic">' + Z.icon('external') + '</div>' +
        '<h3>Open the offer</h3><p>Tap the button, then stay on the offer page for <b>' + s.required_seconds + ' seconds</b>. ' +
        'When the time is up, come back here to claim your reward.</p>' +
        '<p class="offer-warn">If you come back early, the timer restarts.</p>' +
        '<div id="offer-note"></div><button class="btn btn-tonal" id="open-offer">Open offer</button></div>';
      Z.$('#open-offer', wrap).addEventListener('click', openOffer);
    } else {
      var host = document.createElement('div');
      host.className = 'viewer-ad';
      body.appendChild(host);
      Z.slots.frame(host, s.ad_code || '', s.ad_type === 'video' ? 360 : 300, Math.min(window.innerWidth - 32, 640));
    }

    cur.timer = setInterval(tick, 250);
    tick();
    Z.$('#claim', wrap).addEventListener('click', claim);
  }

  /* ---- Direct link / Smart link offers ----
     The offer opens in another tab. Time only counts while the user is AWAY from this page (on the offer).
     Coming back before the full time = the attempt is void and a fresh timer/session starts. */
  function setNote(msg, type) {
    var n = Z.$('#offer-note', cur.wrap);
    if (n) n.innerHTML = msg ? '<div class="alert a-' + (type || 'warn') + '">' + Z.icon(type === 'ok' ? 'check' : 'alert') + '<div>' + Z.esc(msg) + '</div></div>' : '';
  }

  function openOffer() {
    var s = cur.s;
    // open a blank tab first so we can cut its link back to this page, then send it to the offer
    var w = window.open('', '_blank');
    if (!w) return Z.toast('Please allow pop-ups to open the offer.', 'error');
    try { w.opener = null; } catch (e) { /* ignore */ }
    w.location.href = s.target_url;
    cur.offerWin = w; cur.offerOpened = true; cur.hiddenAt = null; cur.closedAt = null;
    setNote('', '');
    tick();
  }

  function onReturn() {
    if (!cur.s || cur.s.ad_type !== 'direct_link' || cur.claimed || cur.ready || !cur.offerOpened) return;
    if (document.visibilityState === 'hidden') { if (!cur.hiddenAt) cur.hiddenAt = Date.now(); return; }
    if (!cur.hiddenAt) return; // never actually left this page, nothing to judge
    var end = cur.closedAt || Date.now();
    var away = Math.max(0, (end - cur.hiddenAt) / 1000);
    cur.hiddenAt = null;
    if (away + 0.4 >= cur.s.required_seconds) {
      cur.ready = true; cur.remaining = 0;
      setNote('Time completed. You can claim your reward now.', 'ok');
      var ob = Z.$('#open-offer', cur.wrap); if (ob) ob.hidden = true;
      tick();
    } else {
      restartDirect(Math.floor(away));
    }
  }

  async function restartDirect(away) {
    var me = cur;
    if (me.restarting) return;
    me.restarting = true;
    me.offerOpened = false; me.ready = false; me.hiddenAt = null; me.closedAt = null; me.remaining = me.s.required_seconds;
    var btn = Z.$('#claim', me.wrap); if (btn) btn.disabled = true;
    setNote(away > 0
      ? 'You came back after ' + away + 's. Open the offer again and stay on it for the full ' + me.s.required_seconds + ' seconds.'
      : 'Open the offer again and stay on it for the full ' + me.s.required_seconds + ' seconds.', 'warn');
    tick();
    // a fresh server session voids the old one, so an old timestamp can never be reused
    var r = await sb.rpc('start_ad', { p_ad_id: me.ad.id });
    if (cur !== me) return;
    me.restarting = false;
    if (r.error) { Z.toast(Z.errMsg(r.error), 'error'); return V.close(true); }
    me.s = r.data;
  }

  function tick() {
    if (!cur || !cur.s) return;
    var s = cur.s, direct = s.ad_type === 'direct_link', req = s.required_seconds;
    var vp = Z.$('#vp', cur.wrap), vs = Z.$('#vs', cur.wrap), btn = Z.$('#claim', cur.wrap);
    if (!vp || !vs || !btn) return;

    if (direct) {
      // notice if the offer tab gets closed while the user is away (best effort)
      if (cur.offerOpened && !cur.ready && cur.hiddenAt && !cur.closedAt && cur.offerWin) {
        try { if (cur.offerWin.closed) cur.closedAt = Date.now(); } catch (e) { /* ignore */ }
      }
      vp.style.width = cur.ready ? '100%' : '0%';
      if (cur.ready) {
        vs.textContent = 'Reward ready';
        if (!cur.claimed && !cur.restarting && !btn.classList.contains('is-loading')) btn.disabled = false;
      } else if (cur.offerOpened) {
        vs.textContent = 'Stay on the offer for ' + req + 's, then come back';
      } else {
        vs.textContent = 'Open the offer to start the timer';
      }
      return;
    }

    var now = performance.now(), dt = Math.min(1, (now - cur.last) / 1000);
    cur.last = now;
    if (cur.running && document.visibilityState === 'visible') cur.remaining = Math.max(0, cur.remaining - dt);
    vp.style.width = ((1 - cur.remaining / req) * 100).toFixed(1) + '%';
    if (cur.remaining <= 0) {
      vs.textContent = 'Reward ready';
      if (!cur.claimed && !btn.classList.contains('is-loading')) btn.disabled = false;
    } else {
      vs.textContent = 'Keep watching \u00b7 ' + Math.ceil(cur.remaining) + 's';
    }
  }

  async function claim() {
    var btn = Z.$('#claim', cur.wrap);
    if (cur.claimed) return;
    Z.busy(btn, true);
    var r = await sb.rpc('complete_ad', { p_view_id: cur.s.view_id });
    if (r.error) {
      Z.busy(btn, false);
      Z.toast(Z.errMsg(r.error), 'error');
      if (/too_early/.test(r.error.message || '')) {
        if (cur.s.ad_type === 'direct_link') restartDirect(0);
        else { cur.remaining = 2; cur.running = true; btn.disabled = true; }
      }
      else if (/limit|already|expired|not_found|suspended/.test(r.error.message || '')) V.close(true);
      return;
    }
    cur.claimed = true;
    clearInterval(cur.timer);
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

  V.isOpen = function () { return !!cur; };

  // force: skip the "leave?" prompt. silent: don't refresh the list. keepHistory: history entry already popped / reused.
  V.close = async function (force, silent, keepHistory) {
    if (!cur) return;
    if (!force && !cur.claimed && cur.s && cur.remaining > 0) {
      var ok = await Z.confirm({ title: 'Leave this ad?', text: 'You will not earn the reward unless you finish.', confirm: 'Leave', cancel: 'Keep watching', danger: true });
      if (!ok || !cur) return;
    }
    var me = cur;
    cur = null;
    clearInterval(me.timer);
    me.closed = true;
    window.removeEventListener('popstate', me.onPop);
    document.removeEventListener('visibilitychange', me.onVis);
    // Unfinished ad = void on the server too, so it can never be claimed later.
    if (!me.claimed && me.s) sb.rpc('cancel_ad', { p_view_id: me.s.view_id }).then(function () {}, function () {});
    me.wrap.remove();
    if (!keepHistory && history.state && history.state.zv) history.back();
    if (!Z.$('#sheet-root').children.length) document.body.classList.remove('no-scroll');
    if (!silent && Z.currentRoute === 'watch') Z.route();
  };
})();
