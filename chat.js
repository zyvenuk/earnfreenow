/* Community chat (user side), WhatsApp style.
   - One shared Realtime channel (started after login) feeds the chat screen AND the unread number on Home.
   - A message can be replied to (with a quote), reacted to, and deleted by its author (it stays as "This message was deleted").
   - Messages are grouped under "Today" / "Yesterday" / the date.
   - Everything that matters is enforced by the database: cooldown, daily limit, mute, length, links, lifetime, who may delete.
   - A reply sends a push notification to the person who was replied to (through the chat-push function). */
(function () {
  'use strict';
  var Z = window.Z;
  var CH = Z.chat = {};
  var PKT = 'Asia/Karachi', KEEP = 100;
  // 👍 ❤️ 😂 😮 😢 🙏 (written as escapes so no editor can change them)
  var EMOJI = ['\uD83D\uDC4D', '\u2764\uFE0F', '\uD83D\uDE02', '\uD83D\uDE2E', '\uD83D\uDE22', '\uD83D\uDE4F'];

  /* ======================= shared live stream + unread number ======================= */
  var bus = {}, stream = null, fails = 0, backoff = 60000, retryT = null;
  CH.live = false; CH.unread = 0; CH.viewOpen = false;

  function emit(ev, p) { (bus[ev] || []).slice().forEach(function (f) { try { f(p); } catch (e) { /* a listener must never break the stream */ } }); }
  CH.on = function (ev, fn) { (bus[ev] = bus[ev] || []).push(fn); return function () { bus[ev] = (bus[ev] || []).filter(function (x) { return x !== fn; }); }; };
  CH.onUnread = function (fn) { return CH.on('unread', fn); };
  function setUnread(n) { n = Math.max(0, Number(n) || 0); if (n === CH.unread) return; CH.unread = n; emit('unread', n); }

  // Server truth (comes with every Home summary). While the chat is open nothing is unread.
  CH.setBase = function (n) { setUnread(CH.viewOpen ? 0 : n); };

  function dropStream() {
    if (stream) { try { sb.removeChannel(stream); } catch (e) { /* already closed */ } }
    stream = null; CH.live = false;
  }
  CH.start = function () {
    if (stream || !Z.state.user) return;
    if (Z.state.settings && Z.state.settings.chat_enabled === false) return;
    var ch = sb.channel('community-chat', { config: { private: true } });
    stream = ch;
    ch.on('broadcast', { event: 'msg' }, function (p) { if (p && p.payload) { if (!CH.viewOpen) setUnread(CH.unread + 1); emit('msg', p.payload); } })
      .on('broadcast', { event: 'del' }, function (p) { if (p && p.payload) emit('del', p.payload); })
      .on('broadcast', { event: 'udel' }, function (p) { if (p && p.payload) emit('udel', p.payload); })
      .on('broadcast', { event: 'react' }, function (p) { if (p && p.payload) emit('react', p.payload); })
      .on('broadcast', { event: 'refresh' }, function () { emit('refresh'); })
      .subscribe(function (status) {
        if (stream !== ch) return;
        if (status === 'SUBSCRIBED') { fails = 0; backoff = 60000; CH.live = true; emit('status', true); return; }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          CH.live = false; emit('status', false);
          if (status !== 'CLOSED' && ++fails >= 3) {            // keeps failing: stop hammering the server, try again later
            dropStream(); clearTimeout(retryT);
            var wait = backoff; backoff = Math.min(backoff * 2, 600000);
            retryT = setTimeout(function () { retryT = null; fails = 0; CH.start(); }, wait);
          }
        }
      });
  };
  CH.stop = function () { clearTimeout(retryT); retryT = null; dropStream(); fails = 0; backoff = 60000; CH.unread = 0; emit('unread', 0); };

  // The red/green number on the Home "Chat" shortcut. Updates live while Home is on screen.
  CH.bindBadge = function (root) {
    var b = Z.$('[data-chat-badge]', root);
    if (!b) return;
    function paint(n) { b.hidden = !(n > 0); b.textContent = n > 99 ? '99+' : String(n); }
    paint(CH.unread);
    var off = CH.onUnread(paint);
    (Z.leaveHooks = Z.leaveHooks || []).push(off);
  };

  CH.homeCard = function () {
    if (Z.state.settings && Z.state.settings.chat_enabled === false) return '';
    return '<div class="card"><button class="row row-btn" data-go="/community"><span class="row-ic acc">' + Z.icon('chat') + '</span>' +
      '<span class="row-main"><span class="row-title">Community chat</span><span class="row-sub">Talk with other members</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>';
  };

  /* ======================= helpers ======================= */
  function clock(ms) { return new Date(ms).toLocaleTimeString('en-GB', { timeZone: PKT, hour: 'numeric', minute: '2-digit', hour12: true }); }
  function dayKey(ms) { return new Date(ms).toLocaleDateString('en-CA', { timeZone: PKT }); }   // YYYY-MM-DD in Pakistan time
  function dayLabel(ms, nowMs) {
    var k = dayKey(ms);
    if (k === dayKey(nowMs)) return 'Today';
    if (k === dayKey(nowMs - 86400000)) return 'Yesterday';
    return new Date(ms).toLocaleDateString('en-GB', { timeZone: PKT, weekday: 'short', day: 'numeric', month: 'short' });
  }
  function lifeText(min) {
    if (min % 1440 === 0) return (min / 1440) + (min === 1440 ? ' day' : ' days');
    if (min % 60 === 0) return (min / 60) + (min === 60 ? ' hour' : ' hours');
    return min + (min === 1 ? ' minute' : ' minutes');
  }
  function snip(s) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > 100 ? s.slice(0, 100) + '\u2026' : s; }

  /* ======================= the chat screen ======================= */
  Z.views.community = async function (el, ctx) {
    var offset = 0, cfg = null, msgs = [], seen = {}, me = { sent: 0, nextAt: 0 };
    var live = false, pollT = null, dead = false, unseen = 0, busy = false, replyTo = null, reacting = false, readT = null;
    var offs = [];

    function now() { return Date.now() + offset; }
    CH.viewOpen = true; setUnread(0);
    function leave() {
      dead = true; CH.viewOpen = false;
      clearInterval(sweepT); clearInterval(tickT); clearTimeout(pollT); clearTimeout(readT);
      document.removeEventListener('visibilitychange', onVis);
      offs.forEach(function (f) { f(); });
      try { sb.rpc('chat_mark_read').then(function () {}, function () {}); } catch (e) { /* the number self-corrects on the next Home load */ }
    }
    (Z.leaveHooks = Z.leaveHooks || []).push(leave);

    el.innerHTML = '<section class="chat"><div class="chat-note" id="cnote"></div><div class="chat-list" id="clist">' + Z.skel(4, 56) + '</div>' +
      '<button class="chat-new" id="cnew" type="button" hidden>New messages</button>' +
      '<form class="chat-bar" id="cform" novalidate hidden>' +
      '<div class="chat-reply" id="creply" hidden><span class="chat-reply-bar"></span><div class="chat-reply-t" id="creplyt"></div><button type="button" class="chat-reply-x" id="crx" aria-label="Cancel reply">' + Z.icon('x') + '</button></div>' +
      '<div class="chat-status" id="cstat"></div>' +
      '<div class="chat-row"><textarea id="cin" rows="1" placeholder="Write a message" autocomplete="off" aria-label="Message"></textarea>' +
      '<button class="chat-send" id="csend" type="submit" aria-label="Send">' + Z.icon('send') + '</button></div></form></section>';
    var list = Z.$('#clist', el), note = Z.$('#cnote', el), form = Z.$('#cform', el), input = Z.$('#cin', el), sendBtn = Z.$('#csend', el), stat = Z.$('#cstat', el), pill = Z.$('#cnew', el);
    var replyBar = Z.$('#creply', el), replyT = Z.$('#creplyt', el);

    function nearBottom() { return list.scrollHeight - list.scrollTop - list.clientHeight < 90; }
    function toBottom() { list.scrollTop = list.scrollHeight; unseen = 0; pill.hidden = true; }
    function life() { return (cfg ? cfg.lifetime_minutes : 60) * 60000; }
    function live1(m) { return m.at + life() > now(); }
    function markRead() {
      clearTimeout(readT);
      readT = setTimeout(function () { if (!dead && document.visibilityState === 'visible') sb.rpc('chat_mark_read').then(function () {}, function () {}); }, 1200);
    }

    /* ---------- header note: online members (live) + how long messages stay ---------- */
    function paintNote() {
      if (!cfg) return;
      var n = Z.online && Z.online.count ? Z.online.count() : null;
      note.innerHTML = (n === null ? '' : '<span class="chat-online"><i class="online-dot" data-s="live"></i><b>' + n + '</b> online</span><span class="chat-sep">\u00b7</span>') +
        '<span>Messages disappear after ' + lifeText(cfg.lifetime_minutes) + '.</span>';
    }
    if (Z.online && Z.online.onChange) offs.push(Z.online.onChange(function () { if (!dead) paintNote(); }));

    /* ---------- links in messages: turn URLs into tappable green links ---------- */
    var LINK_RE = /(^|[^\w@\/.\-])((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9\-]+\.)*(?:whatsapp\.com|wa\.me|t\.me|telegram\.me|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|x\.com|twitter\.com)\/[^\s<>"']*)/gi;
    function linkify(text) {
      text = String(text == null ? '' : text);
      var out = '', last = 0, m;
      LINK_RE.lastIndex = 0;
      while ((m = LINK_RE.exec(text))) {
        var lead = m[1], raw = m[2], tail = '';
        // trailing punctuation belongs to the sentence, not the link
        var t = raw.match(/[.,!?;:'")\]}]+$/);
        if (t) { tail = t[0]; raw = raw.slice(0, raw.length - tail.length); }
        if (!raw) continue;
        var href = /^https?:\/\//i.test(raw) ? raw : 'https://' + raw;
        var start = m.index + lead.length;
        out += Z.esc(text.slice(last, start)) +
          '<a class="cm-link" href="' + Z.esc(href) + '" target="_blank" rel="noopener noreferrer nofollow ugc">' + Z.esc(raw) + '</a>';
        last = start + raw.length;
        LINK_RE.lastIndex = last;
      }
      return out + Z.esc(text.slice(last));
    }

    /* ---------- messages ---------- */
    function reactionsHtml(m) {
      var parts = EMOJI.filter(function (e) { return m.reactions && m.reactions[e] > 0; });
      if (!parts.length) return '';
      return '<div class="cm-rx">' + parts.map(function (e) {
        return '<button type="button" class="cm-rxb' + (m.myReaction === e ? ' on' : '') + '" data-rx="' + e + '" aria-label="' + Z.esc(e + ' ' + m.reactions[e]) + '"><span>' + e + '</span><b>' + m.reactions[e] + '</b></button>';
      }).join('') + '</div>';
    }
    function quoteHtml(m) {
      if (!m.reply) return '';
      var r = m.reply;
      return '<button type="button" class="cm-q" data-q="' + Z.esc(r.id) + '"><b>' + Z.esc(r.name) + '</b><span>' + (r.deleted ? '<i>Message deleted</i>' : Z.esc(r.body)) + '</span></button>';
    }
    function bubble(m, prev, newDay) {
      var same = prev && !newDay && prev.name === m.name && prev.mine === m.mine && m.at - prev.at < 120000 && !m.reply;
      var toMe = m.reply && seen[m.reply.id] && seen[m.reply.id].mine && !m.mine;
      var body = m.deleted ? '<div class="cm-t cm-gone">' + Z.icon('x') + 'This message was deleted</div>' : '<div class="cm-t">' + linkify(m.body) + '</div>';
      return '<div class="cm' + (m.mine ? ' mine' : '') + (same ? ' cont' : '') + (m.deleted ? ' gone' : '') + (toMe ? ' to-me' : '') + '" data-id="' + Z.esc(m.id) + '">' +
        (m.mine ? '' : '<span class="cm-av">' + (same ? '' : Z.avatarHtml(m.name)) + '</span>') +
        '<div class="cm-b"' + (m.deleted ? '' : ' data-act="' + Z.esc(m.id) + '"') + '>' + (same || m.mine ? '' : '<div class="cm-n">' + Z.esc(m.name) + '</div>') +
        (m.deleted ? '' : quoteHtml(m)) + body + '<div class="cm-m">' + Z.esc(clock(m.at)) + '</div>' + (m.deleted ? '' : reactionsHtml(m)) + '</div></div>';
    }
    function paint(stick) {
      msgs = msgs.filter(live1);
      var keep = list.scrollTop;
      if (!msgs.length) {
        list.innerHTML = Z.empty({ icon: 'chat', title: 'No messages yet', text: 'Say hello. Messages disappear after ' + lifeText(cfg.lifetime_minutes) + '.' });
        return;
      }
      var html = '', lastKey = '';
      msgs.forEach(function (m, i) {
        var k = dayKey(m.at), fresh = k !== lastKey;
        if (fresh) { html += '<div class="cm-date"><span>' + Z.esc(dayLabel(m.at, now())) + '</span></div>'; lastKey = k; }
        html += bubble(m, msgs[i - 1], fresh);
      });
      list.innerHTML = html;
      if (stick) toBottom(); else list.scrollTop = keep;
    }
    function record(m) {
      return { id: m.id, name: m.name || 'Member', body: m.body || '', at: new Date(m.created_at).getTime(), mine: !!m.mine, deleted: !!m.deleted,
               reply: m.reply || null, reactions: m.reactions || {}, myReaction: m.my_reaction || null };
    }
    function add(m, mineHint) {
      if (!m || !m.id) return;
      if (seen[m.id]) { if (mineHint) { seen[m.id].mine = true; paint(false); } return; }
      var rec = record(m); if (mineHint) rec.mine = true;
      if (!live1(rec)) return;
      var stick = rec.mine || nearBottom();
      seen[rec.id] = rec; msgs.push(rec); msgs.sort(function (a, b) { return a.at - b.at; });
      if (msgs.length > KEEP) { var old = msgs.shift(); delete seen[old.id]; }
      paint(stick);
      if (!stick) { unseen++; pill.textContent = unseen === 1 ? '1 new message' : unseen + ' new messages'; pill.hidden = false; }
      else if (!rec.mine) markRead();
    }
    function remove(id) {       // removed by the admin: gone for everyone
      if (!seen[id]) return;
      msgs = msgs.filter(function (m) { return m.id !== id; }); delete seen[id];
      msgs.forEach(function (m) { if (m.reply && m.reply.id === id) m.reply = { id: id, name: m.reply.name, body: '', deleted: true }; });
      paint(false);
    }
    function markDeleted(id) {  // deleted by its author: stays as a placeholder
      var m = seen[id]; if (!m) return;
      m.deleted = true; m.body = ''; m.reactions = {}; m.myReaction = null;
      msgs.forEach(function (x) { if (x.reply && x.reply.id === id) x.reply = { id: id, name: x.reply.name, body: '', deleted: true }; });
      if (replyTo && replyTo.id === id) setReply(null);
      paint(false);
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
      if (!d.enabled) {
        form.hidden = true; note.hidden = true;
        list.innerHTML = Z.empty({ icon: 'chat', title: 'Community chat is off', text: 'The chat is turned off for now. Please check back later.' });
        return;
      }
      note.hidden = false; paintNote(); input.maxLength = d.max_length;
      msgs = []; seen = {};
      (d.items || []).forEach(function (m) { var rec = record(m); if (live1(rec)) { msgs.push(rec); seen[rec.id] = rec; } });
      paint(first || nearBottom());
      form.hidden = false; refreshBar(); markRead();
    }

    /* ---------- composer + reply bar ---------- */
    function setReply(m) {
      replyTo = m ? { id: m.id, name: m.name, body: snip(m.body), mine: m.mine } : null;
      replyBar.hidden = !replyTo;
      if (replyTo) { replyT.innerHTML = '<b>' + Z.esc(replyTo.mine ? 'You' : replyTo.name) + '</b><span>' + Z.esc(replyTo.body) + '</span>'; if (!input.disabled) input.focus(); }
    }
    Z.$('#crx', el).addEventListener('click', function () { setReply(null); });

    function refreshBar() {
      if (!cfg || !cfg.enabled) return;
      var left = cfg.daily_limit - me.sent, wait = Math.ceil((me.nextAt - now()) / 1000), why = '';
      if (cfg.muted) why = 'You cannot send messages right now.' + (cfg.muted_until ? ' Until ' + new Date(cfg.muted_until).toLocaleString('en-GB', { timeZone: PKT, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' PKT.' : '');
      else if (left <= 0) why = 'You reached today\u2019s limit of ' + cfg.daily_limit + ' messages. It resets at midnight (PKT).';
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
      var quoting = replyTo;
      try {
        var r = await sb.rpc('send_chat_message', { p_body: text, p_reply_to: quoting ? quoting.id : null });
        if (r.error) throw r.error;
        var d = r.data; offset = new Date(d.server_now).getTime() - Date.now();
        me.sent = d.sent_today; me.nextAt = new Date(d.created_at).getTime() + d.cooldown * 1000;
        add({ id: d.id, name: 'You', body: d.body, created_at: d.created_at, reply: quoting ? { id: quoting.id, name: quoting.mine ? 'You' : quoting.name, body: quoting.body, deleted: false } : null }, true);
        input.value = ''; grow(); setReply(null);
        // Tell the person who was replied to (the server decides who and what; this only asks it to send)
        if (quoting && !quoting.mine) { try { sb.functions.invoke('chat-push', { body: { action: 'reply', message_id: d.id } }).then(function () {}, function () {}); } catch (e2) { /* the reply is posted either way */ } }
      } catch (err) {
        var m = err && err.message || '', hint = Number(err && err.hint);
        if (m.indexOf('chat_cooldown') !== -1) { me.nextAt = now() + (hint || 5) * 1000; }
        else if (m.indexOf('chat_daily_limit') !== -1) { me.sent = cfg.daily_limit; Z.toast('You reached today\u2019s message limit.', 'error'); }
        else if (m.indexOf('chat_muted') !== -1) { cfg.muted = true; Z.toast(Z.errMsg(err), 'error'); }
        else if (m.indexOf('chat_too_long') !== -1) Z.toast('Message is too long. Keep it under ' + (hint || cfg.max_length) + ' characters.', 'error');
        else if (m.indexOf('chat_reply_gone') !== -1) { setReply(null); Z.toast('That message is no longer in the chat. Your text is kept.', 'error'); }
        else { Z.toast(Z.errMsg(err), 'error'); if (m.indexOf('chat_disabled') !== -1) load(false); }
      } finally { busy = false; refreshBar(); if (!input.disabled) input.focus(); }
    });

    pill.addEventListener('click', toBottom);
    list.addEventListener('scroll', function () { if (nearBottom()) { unseen = 0; pill.hidden = true; } });

    /* ---------- reactions ---------- */
    async function react(id, emoji) {
      var m = seen[id]; if (!m || m.deleted || reacting) return;
      reacting = true;
      var before = { reactions: Object.assign({}, m.reactions), mine: m.myReaction };
      // show it at once, the server answer replaces it
      var counts = Object.assign({}, m.reactions);
      if (m.myReaction) counts[m.myReaction] = Math.max(0, (counts[m.myReaction] || 1) - 1);
      if (m.myReaction !== emoji) counts[emoji] = (counts[emoji] || 0) + 1;
      m.myReaction = m.myReaction === emoji ? null : emoji; m.reactions = counts; paint(false);
      try {
        var r = await sb.rpc('chat_react', { p_message_id: id, p_emoji: emoji });
        if (r.error) throw r.error;
        m.reactions = r.data.reactions || {}; m.myReaction = r.data.my_reaction || null;
      } catch (err) {
        m.reactions = before.reactions; m.myReaction = before.mine;
        var msg = err && err.message || '';
        if (msg.indexOf('chat_react_wait') === -1) Z.toast(Z.errMsg(err), 'error');
      } finally { reacting = false; if (!dead) paint(false); }
    }

    /* ---------- tap a message: reactions, reply, copy, delete (admin: moderation) ---------- */
    function openActions(id) {
      var m = seen[id]; if (!m || m.deleted) return;
      var admin = Z.state.isAdmin && !m.mine;
      var sh = Z.sheet('<div class="cm-sheet"><div class="cm-pick">' + EMOJI.map(function (e) {
          return '<button type="button" class="' + (m.myReaction === e ? 'on' : '') + '" data-emoji="' + e + '" aria-label="React ' + Z.esc(e) + '">' + e + '</button>';
        }).join('') + '</div>' +
        '<p class="sheet-text"><b>' + Z.esc(m.mine ? 'You' : m.name) + '</b><br>' + Z.esc(snip(m.body)) + '</p>' +
        '<div class="sheet-actions"><button class="btn btn-tonal" data-act="reply">' + Z.icon('send') + 'Reply</button>' +
        '<button class="btn btn-tonal" data-act="copy">' + Z.icon('copy') + 'Copy text</button>' +
        (m.mine ? '<button class="btn btn-danger" data-act="del">' + Z.icon('trash') + 'Delete for everyone</button>' : '') +
        (admin ? '<button class="btn btn-danger" data-act="adel">Delete (admin)</button><button class="btn btn-tonal" data-act="m60">Mute author 1 hour</button>' +
          '<button class="btn btn-tonal" data-act="m1440">Mute author 1 day</button><button class="btn btn-tonal" data-act="mx">Mute author until I lift it</button>' : '') +
        '<button class="btn btn-ghost" data-close>Close</button></div></div>');
      sh.el.addEventListener('click', function (ev) {
        var em = ev.target.closest('[data-emoji]');
        if (em) { sh.close(); react(id, em.getAttribute('data-emoji')); return; }
        var b = ev.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act');
        if (a === 'reply') { sh.close(); setReply(m); return; }
        if (a === 'copy') {
          sh.close();
          var done = function () { Z.toast('Copied', 'ok'); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m.body).then(done, function () { Z.toast('Could not copy', 'error'); });
          else Z.toast('Could not copy', 'error');
          return;
        }
        if (a === 'del') {
          sh.close();
          Z.confirm({ title: 'Delete this message?', text: 'It will be deleted for everyone in the chat.', confirm: 'Delete', danger: true }).then(function (ok) {
            if (!ok) return;
            sb.rpc('chat_delete_message', { p_id: id }).then(function (r) {
              if (r.error) { Z.toast(Z.errMsg(r.error), 'error'); return; }
              markDeleted(id); Z.toast('Message deleted', 'ok');
            });
          });
          return;
        }
        Z.run(b, async function () {      // admin moderation
          var r = a === 'adel' ? await sb.rpc('admin_delete_chat_message', { p_id: id })
            : await sb.rpc('admin_mute_chat_author', { p_message_id: id, p_minutes: a === 'mx' ? null : Number(a.slice(1)), p_delete_messages: true });
          if (r.error) throw r.error;
          Z.toast(a === 'adel' ? 'Message deleted' : 'Author muted', 'ok'); sh.close();
          if (a === 'adel') remove(id); else load(false);
        });
      });
    }

    list.addEventListener('click', function (e) {
      if (e.target.closest('a.cm-link')) return;                               // a link opens, nothing else
      var rx = e.target.closest('[data-rx]');
      if (rx) { var host = rx.closest('.cm'); if (host) react(host.getAttribute('data-id'), rx.getAttribute('data-rx')); return; }
      var q = e.target.closest('[data-q]');
      if (q) {
        var target = list.querySelector('.cm[data-id="' + q.getAttribute('data-q') + '"]');
        if (!target) { Z.toast('That message is no longer in the chat', 'info'); return; }
        target.scrollIntoView({ block: 'center', behavior: Z.reducedMotion && Z.reducedMotion() ? 'auto' : 'smooth' });
        target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash');
        return;
      }
      var b = e.target.closest('[data-act]');
      if (b) openActions(b.getAttribute('data-act'));
    });

    /* ---------- live updates (shared stream) ---------- */
    function startPoll() {
      clearTimeout(pollT);
      if (dead || CH.live) return;
      pollT = setTimeout(async function () { if (document.visibilityState === 'visible') await load(false); startPoll(); }, 12000);   // fallback only while Realtime is down
    }
    function onVis() { if (document.visibilityState === 'visible' && !dead) { load(false); setUnread(0); } }
    document.addEventListener('visibilitychange', onVis);

    await load(true);
    if (dead || ctx.stale() || !cfg || !cfg.enabled) return;
    offs.push(CH.on('msg', function (p) { add(p, false); }));
    offs.push(CH.on('del', function (p) { remove(p.id); }));
    offs.push(CH.on('udel', function (p) { markDeleted(p.id); }));
    offs.push(CH.on('react', function (p) {
      var m = seen[p.id]; if (!m || m.deleted || reacting) return;
      m.reactions = p.reactions || {};
      if (m.myReaction && !(m.reactions[m.myReaction] > 0)) m.myReaction = null;   // taken back from another device
      paint(false);
    }));
    offs.push(CH.on('refresh', function () { load(false); }));
    offs.push(CH.on('status', function (ok) { if (dead) return; if (ok) { clearTimeout(pollT); load(false); } else startPoll(); }));
    CH.start();                                  // normally already running since login
    if (CH.live) clearTimeout(pollT);
    setTimeout(function () { if (!dead && !CH.live) startPoll(); }, 8000);
  };
})();
