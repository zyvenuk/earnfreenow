/* Home banner carousel. Nothing here is hard-coded: the list comes from the database (list_banners), which only returns banners
   that are enabled and inside their schedule. Fresh data arrives three ways, so a banner change always reaches the user:
   1. Supabase Realtime: the database pings a private "banners" channel on every change, and we re-fetch.
   2. A timer set for the next start/end time (schedules need no ping: the server clock decides).
   3. Fallback polling (every 60s, 20s while Realtime is down), plus a refresh when the tab or the connection comes back. */
(function () {
  'use strict';
  var Z = window.Z;
  var B = Z.banners = { cache: null };
  var POLL_OK = 60000, POLL_DOWN = 20000;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  B.slot = function () { return '<div class="bn" id="bn" aria-live="off"></div>'; };

  function imgUrl(path) { return sb.storage.from('plan-assets').getPublicUrl(path).data.publicUrl; }
  function signature(items) { return JSON.stringify(items.map(function (b) { return [b.id, b.v, b.seconds, b.action_type, b.action_target]; })); }

  // Only actions that are safe and valid on this device are clickable; anything else renders as a plain picture.
  function actionOf(b) {
    if (b.action_type === 'internal' && /^\/[a-z]{3,20}$/.test(b.action_target || '') && Z.isRoute && Z.isRoute(b.action_target.slice(1))) return { kind: 'go', to: b.action_target };
    if (b.action_type === 'external' && /^https?:\/\/\S{4,}$/i.test(b.action_target || '')) return { kind: 'ext', to: b.action_target };
    return null;
  }

  function slideHtml(b, i, n, clone) {
    var a = actionOf(b), inner = '<img src="' + Z.esc(imgUrl(b.image_path)) + '" alt="' + (clone ? '' : Z.esc(b.alt)) + '" draggable="false" decoding="async" data-bid="' + Z.esc(b.id) + '">';
    var common = ' class="bn-slide' + (a ? ' link' : '') + '"' + (clone ? ' aria-hidden="true" tabindex="-1"' : ' role="group" aria-roledescription="slide" aria-label="' + (i + 1) + ' of ' + n + '"');
    if (a && a.kind === 'ext') return '<a' + common + ' draggable="false" href="' + Z.esc(a.to) + '" target="_blank" rel="noopener noreferrer nofollow">' + inner + '</a>';
    if (a) return '<button type="button"' + common + ' data-go="' + Z.esc(a.to) + '">' + inner + '</button>';
    return '<div' + common + '>' + inner + '</div>';
  }

  B.mount = function (host, ctx) {
    if (!host) return;
    var items = [], sig = '', bad = {}, pos = 0, view, track, dotsEl, timer = null, pollT = null, nextT = null, jumpT = null;
    var live = false, ch = null, dead = false, paused = false, inView = true, drag = null, busy = false, offset = 0, io = null;

    function clearTimers() { clearTimeout(timer); timer = null; }
    function teardown() {
      dead = true; clearTimers(); clearTimeout(pollT); clearTimeout(nextT); clearTimeout(jumpT);
      document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', onOnline);
      if (io) io.disconnect();
      if (ch) { try { sb.removeChannel(ch); } catch (e) { /* already closed */ } ch = null; }
    }
    (Z.leaveHooks = Z.leaveHooks || []).push(teardown);

    /* ---------- rendering ---------- */
    function n() { return items.length; }
    function slideAt(k) { return items[((k % n()) + n()) % n()]; }

    function render() {
      clearTimers();
      var list = items.filter(function (b) { return !bad[b.id]; });
      items = list;
      if (!n()) { host.innerHTML = ''; host.hidden = true; return; }
      host.hidden = false;
      var many = n() > 1;
      var slides = items.map(function (b, i) { return slideHtml(b, i, n(), false); });
      if (many) { slides.unshift(slideHtml(items[n() - 1], n() - 1, n(), true)); slides.push(slideHtml(items[0], 0, n(), true)); }
      host.innerHTML = '<div class="bn-view" role="region" aria-roledescription="carousel" aria-label="Offers and announcements"><div class="bn-track">' + slides.join('') + '</div></div>' +
        (many ? '<div class="bn-dots">' + items.map(function (b, i) { return '<button type="button" class="bn-dot" data-i="' + i + '" aria-label="Show banner ' + (i + 1) + ' of ' + n() + '"></button>'; }).join('') + '</div>' : '');
      view = Z.$('.bn-view', host); track = Z.$('.bn-track', host); dotsEl = Z.$('.bn-dots', host);
      Z.$$('img', track).forEach(function (im) {
        if (im.complete && im.naturalWidth) im.classList.add('ok');
        im.addEventListener('load', function () { im.classList.add('ok'); });
        im.addEventListener('error', function () {          // a missing/broken picture never leaves a blank slot: drop that banner
          var id = im.getAttribute('data-bid'); if (bad[id]) return; bad[id] = 1;
          clearTimeout(jumpT); jumpT = setTimeout(function () { if (!dead) { pos = 0; render(); } }, 50);
        });
      });
      if (many) bindInteraction();
      pos = Math.min(pos, n() - 1);
      place(false); schedule();
    }

    function place(animate) {
      if (!track) return;
      track.style.transition = animate && !reduce ? '' : 'none';
      track.style.transform = 'translate3d(' + (-(pos + (n() > 1 ? 1 : 0)) * 100) + '%,0,0)';
      if (dotsEl) Z.$$('.bn-dot', dotsEl).forEach(function (d, i) { var on = i === ((pos % n()) + n()) % n(); d.classList.toggle('on', on); if (on) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    }

    // After sliding onto a clone, jump (without animation) to the matching real slide: this is what makes the loop endless.
    function settle() {
      if (n() < 2) return;
      if (pos >= n()) pos = 0; else if (pos < 0) pos = n() - 1;
      place(false); busy = false; schedule();
    }
    function go(to, animate) {
      if (n() < 2 || busy) return;
      pos = to; busy = true; place(animate !== false);
      clearTimeout(jumpT);
      if (animate === false || reduce) { settle(); return; }
      var done = false, fin = function () { if (done) return; done = true; track.removeEventListener('transitionend', onEnd); clearTimeout(jumpT); settle(); };
      function onEnd(e) { if (e.target === track) fin(); }
      track.addEventListener('transitionend', onEnd);
      jumpT = setTimeout(fin, 700);                      // safety net if transitionend never fires
    }

    function schedule() {
      clearTimers();
      if (n() < 2 || reduce || paused || !inView || document.hidden || drag) return;
      var cur = slideAt(pos);
      timer = setTimeout(function () { go(pos + 1, true); }, Math.max(2, cur.seconds) * 1000);
    }

    /* ---------- swipe, dots, pause ---------- */
    function bindInteraction() {
      var moved = false;
      view.addEventListener('pointerdown', function (e) {
        if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
        drag = { x: e.clientX, y: e.clientY, t: Date.now(), dx: 0, on: false, id: e.pointerId, w: view.getBoundingClientRect().width };
        moved = false; clearTimers();
      });
      view.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.id) return;
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.on) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          if (Math.abs(dy) > Math.abs(dx)) { drag = null; schedule(); return; }   // vertical scroll wins
          drag.on = true; try { view.setPointerCapture(e.pointerId); } catch (x) { /* not capturable */ }
          track.style.transition = 'none';
        }
        drag.dx = dx; moved = Math.abs(dx) > 8 || moved;
        track.style.transform = 'translate3d(calc(' + (-(pos + 1) * 100) + '% + ' + dx + 'px),0,0)';
      });
      function end(e) {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        var d = drag; drag = null;
        if (!d.on) { schedule(); return; }
        var fast = Math.abs(d.dx) / Math.max(1, Date.now() - d.t) > 0.45;
        if (Math.abs(d.dx) > d.w * 0.2 || (fast && Math.abs(d.dx) > 24)) go(pos + (d.dx < 0 ? 1 : -1), true);
        else { place(true); schedule(); }
      }
      view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
      // a swipe must never count as a tap on the banner
      view.addEventListener('click', function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
      view.addEventListener('dragstart', function (e) { e.preventDefault(); });   // a mouse drag on a link/picture must swipe, not start a native drag
      view.addEventListener('mouseenter', function () { paused = true; clearTimers(); });
      view.addEventListener('mouseleave', function () { paused = false; schedule(); });
      view.addEventListener('focusin', function () { paused = true; clearTimers(); });
      view.addEventListener('focusout', function () { paused = false; schedule(); });
      view.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') go(pos + 1, true); else if (e.key === 'ArrowLeft') go(pos - 1, true); });
      dotsEl.addEventListener('click', function (e) { var d = e.target.closest('[data-i]'); if (!d) return; clearTimers(); go(parseInt(d.getAttribute('data-i'), 10), true); });
      if ('IntersectionObserver' in window) {
        io = new IntersectionObserver(function (en) { inView = en[0].isIntersecting; if (inView) schedule(); else clearTimers(); }, { threshold: 0.35 });
        io.observe(view);
      }
    }

    /* ---------- data ---------- */
    function apply(data, first) {
      items = data.items || [];
      var s = signature(items);
      if (!first && s === sig) return;                   // nothing changed: do not disturb what the user is looking at
      sig = s; bad = {}; render();
    }

    async function refresh(first) {
      var r;
      try { r = await sb.rpc('list_banners'); } catch (e) { r = { error: e }; }
      if (dead || ctx.stale()) return;
      if (r.error) {
        if (first && !items.length) {                    // first load failed and there is nothing to show yet
          host.hidden = false;
          host.innerHTML = '<div class="card bn-err"><span>Could not load offers.</span><button class="btn btn-tonal btn-sm" data-retry>Try again</button></div>';
          Z.$('[data-retry]', host).addEventListener('click', function () { host.innerHTML = '<div class="skel bn-skel"></div>'; refresh(true); });
        }
        armPoll(); return;                               // later failures keep what is on screen
      }
      B.cache = r.data;
      offset = new Date(r.data.server_now).getTime() - Date.now();
      apply(r.data, first || !sig);
      armNext(r.data.next_change_at); armPoll();
    }

    // A schedule boundary (a banner starting or ending) needs no ping from the database: the server clock decides.
    function armNext(at) {
      clearTimeout(nextT);
      if (!at) return;
      var ms = new Date(at).getTime() - (Date.now() + offset) + 800;
      if (ms > 0x7fffffff) return;
      nextT = setTimeout(function () { if (!dead) refresh(false); }, Math.max(1000, ms));
    }
    function armPoll() { clearTimeout(pollT); if (!dead) pollT = setTimeout(function () { refresh(false); }, live ? POLL_OK : POLL_DOWN); }
    function onVis() { if (document.hidden) clearTimers(); else { refresh(false); schedule(); } }
    function onOnline() { refresh(false); }

    function listen() {
      var pend = null;
      try {
        ch = sb.channel('banners', { config: { private: true } });
        ch.on('broadcast', { event: 'changed' }, function () { clearTimeout(pend); pend = setTimeout(function () { refresh(false); }, 400); })
          .subscribe(function (status) {
            live = status === 'SUBSCRIBED';
            if (live) refresh(false);                    // (re)connected: catch up on anything missed while offline
          });
      } catch (e) { live = false; }
    }

    document.addEventListener('visibilitychange', onVis); window.addEventListener('online', onOnline);
    if (B.cache) { apply(B.cache, true); } else { host.hidden = false; host.innerHTML = '<div class="skel bn-skel"></div>'; }
    refresh(true);
    listen();
  };
})();
