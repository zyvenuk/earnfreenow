/* Daily check-in streak: the user page, the Home card and the admin page.
   Every rule and every payment lives in the database (do_checkin). This file only shows it and sends the tap. */
(function () {
  'use strict';
  var Z = window.Z;
  var C = Z.checkin = {};
  var A = Z.checkinAdmin = {};
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function days(n) { return n + (Number(n) === 1 ? ' day' : ' days'); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + p2(m) + '-' + p2(d); }

  /* Reward for reaching a streak length. Mirrors the database rule and is only used to decorate the calendar. */
  function bonusFor(p, st) {
    var ms = st.milestones || [], hit = ms.filter(function (m) { return Number(m.days) === p; })[0];
    if (hit) return Number(hit.reward);
    var last = ms.length ? Number(ms[ms.length - 1].days) : 0, rd = Number(st.repeat_days);
    if (rd > 0 && Number(st.repeat_reward) > 0 && p > last && (p - last) % rd === 0) return Number(st.repeat_reward);
    return 0;
  }

  function resultText(d) {
    var t = Number(d.total);
    return 'Day ' + d.streak + ' checked in' + (t > 0 ? '. ' + Z.money(t) + ' added to your Main Wallet' : '');
  }
  function celebrate(d) {
    if (!(Number(d.bonus) > 0)) return;
    Z.sheet('<div class="ci-cel"><span class="ci-cel-ic">' + Z.icon('trophy') + '</span>' +
      '<h2 class="sheet-title">' + days(d.streak) + ' streak!</h2>' +
      '<p class="muted">You earned a streak reward of <b>' + Z.money(d.bonus) + '</b>' + (Number(d.reward) > 0 ? ' plus <b>' + Z.money(d.reward) + '</b> for today' : '') + '. It is already in your Main Wallet.</p>' +
      '<button class="btn btn-primary btn-block" data-close>Great</button></div>', { center: true });
  }
  async function tap() {
    var r = await sb.rpc('do_checkin');
    if (r.error) throw r.error;
    Z.invalidateSummary();
    Z.toast(resultText(r.data), 'ok');
    celebrate(r.data);
    return r.data;
  }

  /* ---------------- Home card (the summary already carries the streak, so no extra request) ---------------- */
  C.homeCard = function (s) {
    if (!s || !s.checkin_enabled) return '';
    var n = Number(s.checkin_streak) || 0, done = !!s.checkin_done;
    return '<div class="card ci-home"><button class="row row-btn" data-go="/checkin">' +
      '<span class="row-ic acc">' + Z.icon('calendar') + '</span>' +
      '<span class="row-main"><span class="row-title">Daily Check-in</span><span class="row-sub">' +
      (n > 0 ? '<span class="ci-fl">' + Z.icon('flame') + '</span>' + days(n) + ' streak' + (done ? ' \u00b7 checked in today' : ' \u00b7 check in to keep it') : 'Start your streak today') + '</span></span>' +
      (done ? '<span class="ci-done">' + Z.icon('check') + '</span>' : '<span class="btn btn-primary btn-sm" role="button" data-ci-now>Check in</span>') +
      '</button></div>';
  };
  C.bindHome = function (el) {
    var b = Z.$('[data-ci-now]', el);
    if (!b) return;
    b.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();      // do not open the page, just check in
      if (b.getAttribute('data-busy')) return;
      b.setAttribute('data-busy', '1');
      Z.run(b, async function () { await tap(); Z.route(); }).then(function () { b.removeAttribute('data-busy'); });
    });
  };

  /* ---------------- The Daily Check-in page ---------------- */
  Z.views.checkin = async function (el, ctx) {
    var r = await sb.rpc('my_checkin_status');
    if (ctx.stale()) return;
    if (r.error) throw r.error;
    var st = r.data;
    if (!st.enabled) {
      el.innerHTML = '<section class="page"><div class="card">' + Z.empty({ icon: 'calendar', title: 'Check-in is paused', text: 'Daily check-in is not available right now. Please come back later.' }) + '</div></section>';
      return;
    }
    var tp = st.today.split('-').map(Number), ty = tp[0], tm = tp[1], td = tp[2];
    var view = { y: ty, m: tm }, rows = {};
    var n = Number(st.streak), next = st.next;
    var unlimited = Number(st.repeat_days) > 0 && Number(st.repeat_reward) > 0;

    function hero() {
      var pct = next ? Math.min(100, Math.round(n / Number(next.days) * 100)) : 100;
      var sub = st.checked_today ? 'You are on a roll. Come back tomorrow to keep it going!' :
        n > 0 ? 'Check in today to keep your streak alive!' : 'Check in today to start your streak.';
      var action;
      if (st.checked_today) {
        action = '<button class="btn btn-block ci-done-btn" disabled>' + Z.icon('check') + 'Checked in today</button>';
      } else if (st.can_checkin) {
        action = '<button class="btn btn-primary btn-block" id="cibtn">' + Z.icon('check') + 'Check in now' + (Number(st.daily_reward) > 0 ? ' \u00b7 +' + Z.money(st.daily_reward) : '') + '</button>';
      } else {
        var left = Number(st.min_ads) - Number(st.ads_today);
        action = '<button class="btn btn-tonal btn-block" data-go="/watch">' + Z.icon('play') + 'Watch ' + left + ' more ' + (left === 1 ? 'ad' : 'ads') + ' to check in</button>' +
          '<p class="hint ci-hint">Check-in needs ' + st.min_ads + (Number(st.min_ads) === 1 ? ' ad' : ' ads') + ' finished today (' + st.ads_today + ' done).</p>';
      }
      return '<div class="card ci-hero">' +
        '<div class="ci-top"><span class="ci-cal">' + Z.icon('calendar') + '</span>' +
        '<div class="ci-mid"><small>Daily Check-in Streak</small><div class="ci-streak"><span class="ci-flame">' + Z.icon('flame') + '</span><b>' + n + '</b><span>' + (n === 1 ? 'Day' : 'Days') + '</span></div></div>' +
        '<div class="ci-badge"><b>' + (unlimited ? '\u221e' : st.milestones.length) + '</b><span>' + (unlimited ? 'Unlimited Milestones' : 'Streak Milestones') + '</span></div></div>' +
        '<p class="ci-sub">' + sub + '</p>' +
        '<div class="ci-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%"></i><span class="ci-star">' + Z.icon('star') + '</span></div>' +
        '<div class="ci-next">' + (next ?
          '<span>' + Z.icon('gift') + 'Next Milestone: <b>' + days(next.days) + '</b></span>' + (Number(next.reward) > 0 ? '<i></i><span>' + Z.icon('gift') + 'Reward: <b>' + Z.money(next.reward) + '</b></span>' : '') :
          '<span>' + Z.icon('trophy') + 'You have reached every milestone</span>') + '</div>' +
        action +
        '<div class="ci-stats"><div><b>' + st.best + '</b><span>Best streak</span></div><div><b>' + st.total_days + '</b><span>Days checked in</span></div><div><b>' + Z.money(st.earned) + '</b><span>Earned</span></div></div>' +
        '</div>';
    }

    function calendar() {
      var count = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
      var isCur = view.y === ty && view.m === tm;
      var back = (ty * 12 + tm) - (view.y * 12 + view.m);
      var cells = '';
      for (var d = 1; d <= count; d++) {
        var ok = rows[d] != null, cls = 'ci-d', inner = '<b>' + d + '</b>';
        if (ok) { cls += ' ok'; inner += Z.icon('check'); }
        if (isCur && d === td) cls += ' today';
        if (isCur && d > td) {
          var proj = (st.checked_today ? n : n + 1) + (d - td);
          cls += ' future';
          if (bonusFor(proj, st) > 0) inner += Z.icon('gift');
        } else if (isCur && d === td && !ok) {
          inner += '<small>Today</small>';
        } else if (!ok) cls += ' miss';
        cells += '<div class="' + cls + '">' + inner + '</div>';
      }
      return '<div class="ci-cal-head">' + Z.icon('calendar') + '<b>Check-in Calendar</b>' +
        '<span class="ci-month"><button data-mv="-1" aria-label="Previous month"' + (back >= 11 ? ' disabled' : '') + '>' + Z.icon('back') + '</button>' +
        '<em>' + (isCur ? 'This Month' : MONTHS[view.m - 1] + ' ' + view.y) + '</em>' +
        '<button data-mv="1" aria-label="Next month"' + (isCur ? ' disabled' : '') + '>' + Z.icon('chevron') + '</button></span></div>' +
        '<div class="ci-grid">' + cells + '</div>' +
        (isCur ? '<p class="hint ci-leg">' + Z.icon('gift') + ' marks a day where your streak reward is waiting.</p>' : '');
    }

    function benefits() {
      var h = '<h2 class="sheet-title">Streak Benefits</h2><p class="muted small">Check in every day. If you miss a day, the streak starts again from day 1.</p><div class="ci-ben">';
      if (Number(st.daily_reward) > 0) h += '<div class="row"><span class="row-ic acc">' + Z.icon('calendar') + '</span><span class="row-main"><span class="row-title">Every check-in</span><span class="row-sub">Paid each day you check in</span></span><b class="amt">+' + Z.money(st.daily_reward) + '</b></div>';
      st.milestones.forEach(function (m) {
        var got = n >= Number(m.days);
        h += '<div class="row"><span class="row-ic ' + (got ? 'pos' : 'acc') + '">' + Z.icon(got ? 'check' : 'gift') + '</span>' +
          '<span class="row-main"><span class="row-title">' + days(m.days) + ' streak</span><span class="row-sub">' + (got ? 'Reached' : (Number(m.days) - n) + ' to go') + '</span></span>' +
          (Number(m.reward) > 0 ? '<b class="amt">+' + Z.money(m.reward) + '</b>' : '') + '</div>';
      });
      if (unlimited) {
        var last = st.milestones.length ? Number(st.milestones[st.milestones.length - 1].days) : 0;
        h += '<div class="row"><span class="row-ic acc">' + Z.icon('trophy') + '</span><span class="row-main"><span class="row-title">Unlimited milestones</span><span class="row-sub">After day ' + last + ', every ' + days(st.repeat_days) + ' of streak, forever</span></span><b class="amt">+' + Z.money(st.repeat_reward) + '</b></div>';
      }
      return h + '</div><button class="btn btn-ghost btn-block" data-close>Close</button>';
    }

    async function loadMonth() {
      var count = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
      var q = await sb.from('daily_checkins').select('day,streak').gte('day', ymd(view.y, view.m, 1)).lte('day', ymd(view.y, view.m, count));
      rows = {};
      (q.data || []).forEach(function (x) { rows[Number(x.day.slice(8, 10))] = x.streak; });
    }

    el.innerHTML = '<section class="page">' + hero() + '<div class="card ci-calendar" id="cical"></div>' +
      '<div class="card ci-promo"><span class="ci-trophy">' + Z.icon('trophy') + '</span>' +
      '<div class="ci-promo-t"><b>Reach Higher Milestones!</b><span>Continue your daily streak to unlock bigger rewards!</span></div>' +
      '<button class="btn btn-primary btn-sm" id="cibenef">Streak Benefits' + Z.icon('chevron') + '</button></div></section>';
    var cal = Z.$('#cical', el);
    await loadMonth();
    if (ctx.stale()) return;
    cal.innerHTML = calendar();

    cal.addEventListener('click', async function (e) {
      var b = e.target.closest('[data-mv]');
      if (!b || b.disabled) return;
      var m = view.m + Number(b.getAttribute('data-mv')), y = view.y;
      if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
      view = { y: y, m: m };
      await loadMonth();
      if (ctx.stale()) return;
      cal.innerHTML = calendar();
    });
    Z.$('#cibenef', el).addEventListener('click', function () { Z.sheet(benefits()); });
    var btn = Z.$('#cibtn', el);
    if (btn) btn.addEventListener('click', function () {
      Z.run(btn, async function () { await tap(); Z.route(); });
    });
  };

  /* ---------------- Admin ---------------- */
  function stat(label, value, sub) { return '<div class="stat"><span>' + label + '</span><b>' + value + '</b>' + (sub ? '<em>' + sub + '</em>' : '') + '</div>'; }
  function rowHtml(d, r) {
    return '<div class="ms-ed-row"><input class="input" inputmode="numeric" placeholder="Streak days" aria-label="Streak days" value="' + Z.esc(d) + '">' +
      '<input class="input" inputmode="decimal" placeholder="Reward" aria-label="Reward" value="' + Z.esc(r) + '">' +
      '<button type="button" class="icon-btn" data-delck aria-label="Remove milestone">' + Z.icon('trash') + '</button></div>';
  }

  A.view = async function (body, ctx) {
    var res = await Promise.all([sb.rpc('admin_checkin_stats'),
      sb.from('platform_settings').select('checkin_enabled,checkin_daily_reward,checkin_min_ads,checkin_repeat_days,checkin_repeat_reward').eq('id', true).single(),
      sb.from('checkin_milestones').select('days,reward').order('days')]);
    if (ctx.stale()) return;
    if (res[0].error || res[1].error || res[2].error) { body.innerHTML = Z.errorState(); Z.$('[data-retry]', body).addEventListener('click', function () { Z.route(); }); return; }
    var d = res[0].data, s = res[1].data, ms = res[2].data || [];

    body.innerHTML = '<div class="page-head"><div><h2>Daily check-in</h2><p class="sub">Users check in once a day. Their streak grows every day in a row and starts again after a missed day.</p></div></div>' +
      '<div class="stat-grid">' + stat('Checked in today', d.today) + stat('Active streaks', d.active_streaks, 'checked in today or yesterday') +
      stat('Best streak', days(d.best_streak)) + stat('Total check-ins', d.total_checkins) + stat('Rewards paid', Z.money(d.paid_total), d.users + ' users') + '</div>' +

      '<form class="card form" id="ck" novalidate><h3 class="mini-title" style="margin:0">Rules and daily reward</h3>' +
      Z.field({ id: 'ck-on', label: 'Daily check-in', type: 'select', value: s.checkin_enabled ? '1' : '0', options: [['1', 'On'], ['0', 'Off (hidden from users)']] }) +
      Z.field({ id: 'ck-daily', label: 'Reward for every check-in', value: Number(s.checkin_daily_reward), attrs: 'inputmode="decimal"', hint: 'Paid to the Main Wallet each day a user checks in. 0 = no daily reward, only milestones pay.' }) +
      Z.field({ id: 'ck-ads', label: 'Ads needed before check-in', value: s.checkin_min_ads, attrs: 'inputmode="numeric"', hint: '0 = anyone can check in. Set 1 or more so only users who really watch ads earn from check-in.' }) +
      '<div class="two">' + Z.field({ id: 'ck-rd', label: 'Then repeat every (days)', value: s.checkin_repeat_days, attrs: 'inputmode="numeric"' }) +
      Z.field({ id: 'ck-rr', label: 'Repeat reward', value: Number(s.checkin_repeat_reward), attrs: 'inputmode="decimal"' }) + '</div>' +
      '<p class="hint">Unlimited milestones: after the last milestone below, this reward is paid every N days of streak, forever. Leave both at 0 to stop at the last milestone.</p>' +
      '<div id="ckerr"></div><button class="btn btn-primary btn-block" type="submit">Save rules</button></form>' +

      '<form class="card form" id="ckm" novalidate><h3 class="mini-title" style="margin:0">Streak milestones</h3>' +
      '<p class="hint" style="margin-top:-6px">When a streak reaches this many days, the reward is added to the Main Wallet at once. It is paid again if a user builds a new streak that far. Reward 0 = the milestone only shows on the page.</p>' +
      '<div id="ckrows" class="ms-ed">' + ms.map(function (m) { return rowHtml(m.days, Number(m.reward)); }).join('') + '</div>' +
      '<button class="btn btn-tonal btn-block" type="button" id="ckadd">' + Z.icon('plus') + 'Add milestone</button>' +
      '<div id="ckmerr"></div><button class="btn btn-primary btn-block" type="submit">Save milestones</button></form>' +

      '<div class="section-head"><h3>Longest active streaks</h3></div><div class="card">' +
      ((d.top || []).length ? d.top.map(function (u) {
        return '<div class="row"><span class="row-main"><span class="row-title">' + Z.esc(u.full_name || 'Member') + '</span><span class="row-sub">' + Z.esc(u.email) + '</span></span><b class="amt">' + days(u.streak) + '</b></div>';
      }).join('') : Z.empty({ icon: 'calendar', title: 'No active streaks yet', text: 'Streaks appear here once users start checking in.' })) + '</div>';

    function whole(id, max) { var v = String(Z.$(id, body).value).trim(); return /^\d+$/.test(v) && Number(v) <= max ? Number(v) : NaN; }
    function money(id, max) { var v = String(Z.$(id, body).value).trim().replace(/,/g, '') || '0'; var n = Number(v); return isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : NaN; }

    Z.$('#ck', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#ckerr', body);
      var p = { checkin_enabled: Z.$('#ck-on', body).value === '1', checkin_daily_reward: money('#ck-daily', 1000), checkin_min_ads: whole('#ck-ads', 100),
        checkin_repeat_days: whole('#ck-rd', 3650), checkin_repeat_reward: money('#ck-rr', 100000) };
      if (!isFinite(p.checkin_daily_reward)) return Z.formError(err, 'The daily reward must be between 0 and 1000.');
      if (!isFinite(p.checkin_min_ads)) return Z.formError(err, 'Ads needed must be a whole number from 0 to 100.');
      if (!isFinite(p.checkin_repeat_days) || !isFinite(p.checkin_repeat_reward)) return Z.formError(err, 'Repeat days must be a whole number (0 = off) and the repeat reward 0 or more.');
      if ((p.checkin_repeat_days > 0) !== (p.checkin_repeat_reward > 0)) return Z.formError(err, 'Set both the repeat days and the repeat reward, or leave both at 0.');
      Z.run(Z.$('#ck button[type=submit]', body), async function () {
        var u = await sb.from('platform_settings').update(p).eq('id', true).select().single();
        if (u.error) throw u.error;
        Z.state.settings = u.data; Z.formError(err, '');
        Z.toast('Check-in rules saved', 'ok');
      }, err);
    });

    Z.$('#ckm', body).addEventListener('click', function (e) {
      var box = Z.$('#ckrows', body);
      if (e.target.closest('#ckadd')) {
        if (Z.$$('.ms-ed-row', box).length >= 30) return Z.toast('Up to 30 milestones.');
        box.insertAdjacentHTML('beforeend', rowHtml('', ''));
        Z.$$('.ms-ed-row input', box).slice(-2)[0].focus();
      } else { var del = e.target.closest('[data-delck]'); if (del) del.closest('.ms-ed-row').remove(); }
    });
    Z.$('#ckm', body).addEventListener('submit', function (e) {
      e.preventDefault();
      var err = Z.$('#ckmerr', body), items = [], seen = {}, bad = '';
      Z.$$('#ckrows .ms-ed-row', body).forEach(function (row) {
        var f = Z.$$('input', row), dv = f[0].value.trim(), rv = f[1].value.trim().replace(/,/g, '');
        if (!dv && !rv) return;
        var dn = /^\d+$/.test(dv) ? Number(dv) : NaN, rw = rv === '' ? 0 : Number(rv);
        if (!isFinite(dn) || dn < 1 || dn > 100000) bad = 'Streak days must be a whole number from 1 to 100000.';
        else if (!isFinite(rw) || rw < 0 || rw > 100000) bad = 'Reward must be 0 or more.';
        else if (seen[dn]) bad = 'The streak of ' + dn + ' days is listed twice.';
        seen[dn] = 1; items.push({ days: dn, reward: Math.round(rw * 100) / 100 });
      });
      if (bad) return Z.formError(err, bad);
      items.sort(function (a, b) { return a.days - b.days; });
      Z.run(Z.$('#ckm button[type=submit]', body), async function () {
        var r = await sb.rpc('admin_save_checkin_milestones', { p_items: items });
        if (r.error) throw r.error;
        Z.formError(err, '');
        Z.toast('Milestones saved', 'ok');
        Z.route();
      }, err);
    });
  };
})();
