/* Community chat (user side).
   Light on the database by design: one small RPC loads the last live messages, new ones arrive over a Realtime broadcast
   (no polling while the connection is healthy), and the screen only listens while it is open.
   The database enforces everything that matters: cooldown, daily limit, mute, length, links and the message lifetime. */
(function () {
  'use strict';
  var Z = window.Z;
  var CH = Z.chat = {};
  var PKT = 'Asia/Karachi', KEEP = 100;

  CH.homeCard = function () {
    if (Z.state.settings && Z.state.settings.chat_enabled === false) return '';
    return '<div class="card"><button class="row row-btn" data-go="/community"><span class="row-ic acc">' + Z.icon('chat') + '</span>' +
      '<span class="row-main"><span class="row-title">Community chat</span><span class="row-sub">Talk with other members</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>';
  };

  function clock(ms) {
    return new Date(ms).toLocaleTimeString('en-GB', { timeZone: PKT, hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function lifeText(min) {
    if (min % 1440 === 0) return (min / 1440) + (min === 1440 ? ' day' : ' days');
    if (min % 60 === 0) return (min / 60) + (min === 60 ? ' hour' : ' hours');
    return min + (min === 1 ? ' minute' : ' minutes');
  }

  Z.views.community = async function (el, ctx) {
    var offset = 0, cfg = null, msgs = [], seen = {}, me = { sent: 0, nextAt: 0 };
    var ch = null, live = false, pollT = null, dead = false, unseen = 0, busy = false;

    function now() { return Date.now() + offset; }
    function leave() { dead = true; clearInterval(sweepT); clearInterval(tickT); clearTimeout(pollT); document.removeEventListener('visibilitychange', onVis); if (ch) { try { sb.removeChannel(ch); } catch (e) { /* ignore */ } ch = null; } }
    (Z.leaveHooks = Z.leaveHooks || []).push(leave);

    el.innerHTML = '<section class="chat"><div class="chat-note" id="cnote"></div><div class="chat-list" id="clist">' + Z.skel(4, 56) + '</div>' +
      '<button class="chat-new" id="cnew" type="button" hidden>New messages</button>' +
      '<form class="chat-bar" id="cform" novalidate hidden><div class="chat-status" id="cstat"></div>' +
      '<div class="chat-row"><textarea id="cin" rows="1" placeholder="Write a message" autocomplete="off" aria-label="Message"></textarea>' +
      '<button class="chat-send" id="csend" type="submit" aria-label="Send">' + Z.icon('send') + '</button></div></form></section>';
    var list = Z.$('#clist', el), note = Z.$('#cnote', el), form = Z.$('#cform', el), input = Z.$('#cin', el), sendBtn = Z.$('#csend', el), stat = Z.$('#cstat', el), pill = Z.$('#cnew', el);

    function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 90; }
    function toBottom() { list.scrollTop = list.scrollHeight; unseen = 0; pill.hidden = true; }

    function life() { return (cfg ? cfg.lifetime_minutes : 60) * 60000; }
    function live1(m) { return m.at + life() > now(); }

    /* ---------- messages ---------- */
    function bubble(m, prev) {
      var same = prev && prev.name === m.name && prev.mine === m.mine && m.at - prev.at < 120000;
      var admin = Z.state.isAdmin ? ' data-mod="' + Z.esc(m.id) + '"' : '';
      return '<div class="cm' + (m.mine ? ' mine' : '') + (same ? ' cont' : '') + '" data-id="' + Z.esc(m.id) + '"' + admin + '>' +
        (m.mine ? '' : '<span class="cm-av">' + (same ? '' : Z.avatarHtml(m.name)) + '</span>') +
        '<div class="cm-b">' + (same || m.mine ? '' : '<div class="cm-n">' + Z.esc(m.name) + '</div>') +
        '<div class="cm-t">' + Z.esc(m.body) + '</div><div class="cm-m">' + Z.esc(clock(m.at)) + '</div></div></div>';
    }
    function paint(stick) {
      msgs = msgs.filter(live1);
      if (!msgs.length) {
        list.innerHTML = Z.empty({ icon: 'chat', title: 'No messages yet', text: 'Say hello. Messages disappear after ' + lifeText(cfg.lifetime_minutes) + '.' });
        return;
      }
      list.innerHTML = msgs.map(function (m, i) { return bubble(m, msgs[i - 1]); }).join('');
      if (stick) toBottom();
    }
    function add(m, mineHint) {
      if (!m || !m.id) return;
      var at = new Date(m.created_at).getTime();
      if (seen[m.id]) { if (mineHint) { seen[m.id].mine = true; paint(false); } return; }
      var rec = { id: m.id, name: m.name || 'Member', body: m.body, at: at, mine: !!(m.mine || mineHint) };
      if (!live1(rec)) return;
      var stick = rec.mine || nearBottom();
      seen[rec.id] = rec; msgs.push(rec); msgs.sort(function (a, b) { return a.at - b.at; });
      if (msgs.length > KEEP) { var old = msgs.shift(); delete seen[old.id]; }
      paint(stick);
      if (!stick) { unseen++; pill.textContent = unseen === 1 ? '1 new message' : unseen + ' new messages'; pill.hidden = false; }
    }
    function remove(id) {
      if (!seen[id]) return;
      msgs = msgs.filter(function (m) { return m.id !== id; }); delete seen[id]; paint(false);
    }
    var sweepT = setInterval(function () {      // expired messages leave the screen by themselves
      var before = msgs.length; msgs = msgs.filter(live1);
      if (msgs.length !== before) { Object.keys(seen).forEach(function (k) { if (!msgs.some(function (m) { return m.id === k; })) delete seen[k]; }); paint(false); }
    }, 15000);

    /* ---------- load ---------- */
    async function load(first) {
      var r = await sb.rpc('list_chat_messages', { p_limit: 60 });
      if (dead || ctx.stale()) return;
      if (r.error) {
        if (first) { list.innerHTML = Z.errorState(); Z.$('[data-retry]', list).addEventListener('click', function () { Z.route(); }); }
        return;
      }
      var d = r.data; cfg = d; offset = new Date(d.server_now).getTime() - Date.now();
      me.sent = d.sent_today; me.nextAt = d.last_sent ? new Date(d.last_sent).getTime() + d.cooldown * 1000 : 0;
      note.textContent = 'Messages disappear after ' + lifeText(d.lifetime_minutes) + '.';
      if (!d.enabled) {
        form.hidden = true; note.hidden = true;
        list.innerHTML = Z.empty({ icon: 'chat', title: 'Community chat is off', text: 'The chat is turned off for now. Please check back later.' });
        return;
      }
      note.hidden = false; input.maxLength = d.max_length;
      msgs = []; seen = {};
      (d.items || []).forEach(function (m) { var at = new Date(m.created_at).getTime(); var rec = { id: m.id, name: m.name, body: m.body, at: at, mine: m.mine }; if (live1(rec)) { msgs.push(rec); seen[rec.id] = rec; } });
      paint(first || nearBottom());
      form.hidden = false; refreshBar();
    }

    /* ---------- composer ---------- */
    function refreshBar() {
      if (!cfg || !cfg.enabled) return;
      var left = cfg.daily_limit - me.sent, wait = Math.ceil((me.nextAt - now()) / 1000), why = '';
      if (cfg.muted) why = 'You cannot send messages right now.' + (cfg.muted_until ? ' Until ' + new Date(cfg.muted_until).toLocaleString('en-GB', { timeZone: PKT, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' PKT.' : '');
      else if (left <= 0) why = 'You reached today’s limit of ' + cfg.daily_limit + ' messages. It resets at midnight (PKT).';
      input.disabled = !!why;
      sendBtn.disabled = !!why || busy || wait > 0;
      sendBtn.classList.toggle('wait', !why && wait > 0);
      sendBtn.innerHTML = !why && wait > 0 ? '<span>' + wait + '</span>' : Z.icon('send');
      var len = input.value.length;
      stat.textContent = why || (len > cfg.max_length * 0.7 ? len + ' / ' + cfg.max_length : (left <= 10 ? left + (left === 1 ? ' message left today' : ' messages left today') : ''));
      stat.classList.toggle('warn', !!why);
      stat.hidden = !stat.textContent;
    }
    var tickT = setInterval(function () { if (cfg) refreshBar(); }, 500);
    function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; }
    input.addEventListener('input', function () { grow(); refreshBar(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && window.matchMedia && matchMedia('(pointer: fine)').matches) { e.preventDefault(); form.requestSubmit(); }
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (busy || !cfg) return;
      var text = input.value.trim();
      if (!text) return;
      if (me.nextAt - now() > 0) return;
      busy = true; refreshBar();
      try {
        var r = await sb.rpc('send_chat_message', { p_body: text });
        if (r.error) throw r.error;
        var d = r.data; offset = new Date(d.server_now).getTime() - Date.now();
        me.sent = d.sent_today; me.nextAt = new Date(d.created_at).getTime() + d.cooldown * 1000;
        add({ id: d.id, name: 'You', body: d.body, created_at: d.created_at }, true);
        input.value = ''; grow();
      } catch (err) {
        var m = err && err.message || '', hint = Number(err && err.hint);
        if (m.indexOf('chat_cooldown') !== -1) { me.nextAt = now() + (hint || 5) * 1000; }
        else if (m.indexOf('chat_daily_limit') !== -1) { me.sent = cfg.daily_limit; Z.toast('You reached today’s message limit.', 'error'); }
        else if (m.indexOf('chat_muted') !== -1) { cfg.muted = true; Z.toast(Z.errMsg(err), 'error'); }
        else if (m.indexOf('chat_too_long') !== -1) Z.toast('Message is too long. Keep it under ' + (hint || cfg.max_length) + ' characters.', 'error');
        else { Z.toast(Z.errMsg(err), 'error'); if (m.indexOf('chat_disabled') !== -1) load(false); }
      } finally { busy = false; refreshBar(); if (!input.disabled) input.focus(); }
    });

    pill.addEventListener('click', toBottom);
    list.addEventListener('scroll', function () { if (nearBottom()) { unseen = 0; pill.hidden = true; } });

    /* ---------- admin: moderate a message from the chat itself ---------- */
    list.addEventListener('click', function (e) {
      var row = e.target.closest('[data-mod]'); if (!row) return;
      var id = row.getAttribute('data-mod'), m = seen[id]; if (!m) return;
      var sh = Z.sheet('<h2 class="sheet-title">Moderate message</h2><p class="sheet-text"><b>' + Z.esc(m.name) + '</b><br>' + Z.esc(m.body) + '</p>' +
        '<div class="sheet-actions"><button class="btn btn-danger" data-act="del">Delete this message</button>' +
        '<button class="btn btn-tonal" data-act="m60">Mute author 1 hour</button><button class="btn btn-tonal" data-act="m1440">Mute author 1 day</button>' +
        '<button class="btn btn-tonal" data-act="mx">Mute author until I lift it</button><button class="btn btn-ghost" data-close>Close</button></div>');
      sh.el.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act');
        Z.run(b, async function () {
          var r = a === 'del' ? await sb.rpc('admin_delete_chat_message', { p_id: id })
            : await sb.rpc('admin_mute_chat_author', { p_message_id: id, p_minutes: a === 'mx' ? null : Number(a.slice(1)), p_delete_messages: true });
          if (r.error) throw r.error;
          Z.toast(a === 'del' ? 'Message deleted' : 'Author muted', 'ok'); sh.close();
          if (a === 'del') remove(id); else load(false);
        });
      });
    });

    /* ---------- live updates ---------- */
    function startPoll() {
      clearTimeout(pollT);
      if (dead || live) return;
      pollT = setTimeout(async function () { if (document.visibilityState === 'visible') await load(false); startPoll(); }, 12000);   // fallback only while Realtime is down
    }
    function onVis() { if (document.visibilityState === 'visible' && !dead) load(false); }
    document.addEventListener('visibilitychange', onVis);

    await load(true);
    if (dead || ctx.stale() || !cfg || !cfg.enabled) return;
    ch = sb.channel('community-chat', { config: { private: true } });
    ch.on('broadcast', { event: 'msg' }, function (p) { if (p && p.payload) add(p.payload, false); })
      .on('broadcast', { event: 'del' }, function (p) { if (p && p.payload) remove(p.payload.id); })
      .on('broadcast', { event: 'refresh' }, function () { load(false); })
      .subscribe(function (status) {
        if (dead) return;
        if (status === 'SUBSCRIBED') { var was = live; live = true; clearTimeout(pollT); if (!was) load(false); }   // catch anything sent while connecting
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { live = false; startPoll(); }
      });
    setTimeout(function () { if (!dead && !live) startPoll(); }, 8000);
  };
})();
