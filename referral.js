/* Referral page. All numbers come from database functions; nothing is calculated or trusted client-side. */
(function () {
  'use strict';
  var Z = window.Z;
  var PAGE = 10;

  function rewardText(bonus, rate) {
    var parts = [];
    if (Number(bonus) > 0) parts.push(Z.money(bonus) + ' one-time bonus');
    if (Number(rate) > 0) parts.push(Number(rate) + '% lifetime commission');
    return parts.length ? parts.join(' + ') : 'Not active right now';
  }


  /* The admin decides what makes a referral valid. These helpers turn those settings into plain text. */
  function reqLines(st) {
    var l = [];
    if (Number(st.ref_req_ads) > 0) l.push('completed ' + st.ref_req_ads + (Number(st.ref_req_ads) === 1 ? ' ad' : ' ads'));
    if (Number(st.ref_req_distinct_ads) > 0) l.push('watched ' + st.ref_req_distinct_ads + ' different ads');
    if (st.ref_req_email) l.push('verified their email');
    if (Number(st.ref_req_age_days) > 0) l.push('had the account for ' + st.ref_req_age_days + (Number(st.ref_req_age_days) === 1 ? ' day' : ' days'));
    if (Number(st.ref_req_active_days) > 0) l.push('been active on ' + st.ref_req_active_days + ' different days');
    if (Number(st.ref_req_earned) > 0) l.push('earned ' + Z.money(st.ref_req_earned));
    if (st.ref_req_plan) l.push('activated a plan');
    if (st.ref_req_paid_plan) l.push('bought a paid plan');
    if (st.ref_req_device) l.push('registered their phone');
    return l;
  }
  function unmetText(checks) {
    var out = [];
    (checks || []).forEach(function (c) {
      if (c.met) return;
      var have = Number(c.have), need = Number(c.need);
      out.push(({
        ads: 'Ads ' + have + '/' + need,
        distinct_ads: 'Different ads ' + have + '/' + need,
        email: 'Email not verified',
        age: 'Account age ' + have + '/' + need + ' days',
        active_days: 'Active days ' + have + '/' + need,
        earned: 'Earned ' + Z.money(have) + '/' + Z.money(need),
        plan: 'No plan yet',
        paid_plan: 'No paid plan yet',
        device: 'Phone not registered'
      })[c.key] || c.key);
    });
    return out.join(' \u00b7 ');
  }

  function refRow(r, need) {
    var valid = r.status === 'valid';
    var joined = 'Joined ' + Z.fmtDate(r.joined_at);
    var sub1 = valid ? 'Validated ' + Z.fmtDay(r.validated_at) : (unmetText(r.checks) || (r.ads_done + '/' + need + ' ads completed' + (r.email_verified ? '' : ' \u00b7 email not verified')));
    var sub2 = '';
    if (r.bonus_status === 'locked') sub2 = 'Bonus ' + Z.money(r.bonus_amount) + ' \u00b7 unlocks ' + Z.fmtDay(r.bonus_unlock_at);
    else if (r.bonus_status === 'transferred') sub2 = 'Bonus ' + Z.money(r.bonus_amount) + ' unlocked';
    else if (valid) sub2 = 'No one-time bonus';
    return '<div class="row ref-row">' +
      '<span class="avatar sm">' + Z.esc((r.display_name || '?').charAt(0).toUpperCase()) + '</span>' +
      '<span class="row-main"><span class="row-title">' + Z.esc(r.display_name) + ' <span class="lvl">L' + r.level + '</span></span>' +
      '<span class="row-sub">' + joined + '</span><span class="row-sub">' + sub1 + '</span>' + (sub2 ? '<span class="row-sub">' + sub2 + '</span>' : '') + '</span>' +
      '<span class="col-end">' + Z.badge(r.status) +
      (valid ? '<span class="amt pos small">' + Z.money(r.commission_earned, { sign: true }) + '</span>' : '') + '</span></div>';
  }

  /* ---------------- Referral Milestones (rewards are paid by the database, automatically) ---------------- */
  function msLevel(n, count, items) {
    items = (items || []).filter(function (i) { return Number(i.level) === n; }).sort(function (a, b) { return a.target - b.target; });
    if (!items.length) return '';
    var next = items.filter(function (m) { return count < m.target; })[0];
    var done = !next, target = done ? items[items.length - 1].target : next.target;
    var pct = Math.min(100, Math.floor(count / target * 100)), tag = 'L' + n;
    var paysAny = items.some(function (m) { return Number(m.reward) > 0; });
    return '<div class="ms-level">' +
      '<button class="ms-head lv' + n + '" data-ms aria-expanded="true">' +
      '<span class="ms-crown">' + Z.icon('crown') + '<b>' + tag + '</b></span>' +
      '<span class="ms-ht"><b>' + tag + ' Valid Referrals</b><span>' + (done ? 'Every ' + tag + ' milestone is complete' : (paysAny ? 'Reach each milestone to earn money in your Main Wallet' : 'Reach each ' + tag + ' milestone, one by one')) + '</span></span>' +
      Z.icon('chevron', 'ms-chev') + '</button>' +
      '<div class="ms-body">' +
      '<div class="ms-top"><span>Your ' + tag + ' Referrals: <b>' + count + '</b></span><span class="ms-target">' + (done ? 'Completed' : 'Target: <b>' + target + '</b>') + '</span></div>' +
      '<div class="ms-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><i style="width:' + pct + '%">' + (pct >= 18 ? '<em>' + pct + '%</em>' : '') + '</i>' + (pct < 18 ? '<em class="out">' + pct + '%</em>' : '') + '</div>' +
      (!done && Number(next.reward) > 0 ? '<div class="ms-next">' + Z.icon('gift') + '<span>Reach ' + target + ' to earn <b>' + Z.money(next.reward) + '</b>, added automatically</span></div>' : '') +
      '<div class="ms-grid">' + items.map(function (m) {
        var ok = count >= m.target, amt = m.claimed ? Number(m.paid) : Number(m.reward);
        return '<div class="ms-m' + (ok ? ' ok' : '') + '"><span class="ms-mt"><b>' + m.target + '</b>' + (amt > 0 ? '<small>' + (m.claimed ? 'Got ' : '+') + Z.money(amt) + '</small>' : '') + '</span>' + Z.icon(ok ? 'check' : 'lock', 'ms-state') + '</div>';
      }).join('') + '</div></div></div>';
  }

  Z.views.milestones = async function (el, ctx) {
    var res = await sb.rpc('my_referral_milestones');   // also pays anything already reached but not yet received
    if (ctx.stale()) return;
    if (res.error) throw res.error;
    var d = res.data, c1 = Number(d.l1_valid), c2 = Number(d.l2_valid);
    if (Number(d.earned) > 0) Z.invalidateSummary();   // balance may have changed
    var levels = msLevel(1, c1, d.items) + msLevel(2, c2, d.items);
    el.innerHTML = '<section class="page">' +
      '<div class="card ms-total"><span class="ms-total-ic">' + Z.icon('users') + '</span>' +
      '<div><small>Your Total Valid Referrals</small><b>' + (c1 + c2) + '</b>' +
      (Number(d.earned) > 0 ? '<span class="ms-earned">Milestone rewards earned: <b>' + Z.money(d.earned) + '</b></span>' : '') + '</div>' +
      '<span class="ms-total-ic">' + Z.icon('trophy') + '</span></div>' +
      (levels || '<div class="card">' + Z.empty({ icon: 'trophy', title: 'No milestones yet', text: 'Milestones will appear here once they are set up.' }) + '</div>') +
      '</section>';
    el.addEventListener('click', function (e) {
      var h = e.target.closest('[data-ms]'); if (!h) return;
      var body = h.parentNode.querySelector('.ms-body'), open = body.hidden;   // hidden now -> opening
      body.hidden = !open; h.setAttribute('aria-expanded', open);
    });
  };

  Z.views.referral = async function (el, ctx) {
    var res = await Promise.all([sb.rpc('my_referral_stats'), Z.refreshSettings()]);
    if (ctx.stale()) return;
    if (res[0].error) throw res[0].error;
    var d = res[0].data, st = Z.state.settings || {};
    var link = Z.siteUrl() + '?ref=' + d.code;
    var need = d.required_ads;
    var msRow = Number(d.milestone_count) > 0 ? '<div class="card"><button class="row row-btn" data-go="/milestones"><span class="row-ic acc">' + Z.icon('trophy') + '</span>' +
      '<span class="row-main"><span class="row-title">Referral Milestones</span><span class="row-sub">' + d.l1_valid + ' L1 \u00b7 ' + d.l2_valid + ' L2 valid referrals</span></span>' + Z.icon('chevron', 'row-chev') + '</button></div>' : '';

    function levelCard(n, total, valid, invalid) {
      return '<div class="card lvl-card"><div class="lvl-head"><b>Level ' + n + '</b><span>' + (n === 1 ? 'Direct' : 'Indirect') + '</span></div>' +
        '<div class="lvl-nums"><div><b>' + total + '</b><span>Total</span></div><div><b class="pos">' + valid + '</b><span>Valid</span></div><div><b class="warn">' + invalid + '</b><span>Invalid</span></div></div></div>';
    }

    el.innerHTML = '<section class="page">' +
      '<div class="card ref-hero">' +
      '<span class="bc-label dark">Your referral code</span>' +
      '<div class="ref-code"><b>' + Z.esc(d.code) + '</b><button class="icon-btn" data-copy="' + Z.esc(d.code) + '" aria-label="Copy code">' + Z.icon('copy') + '</button></div>' +
      '<div class="ref-link">' + Z.esc(link) + '</div>' +
      '<div class="ref-actions"><button class="btn btn-primary" id="share">' + Z.icon('external') + 'Share link</button>' +
      '<button class="btn btn-tonal" data-copy="' + Z.esc(link) + '">' + Z.icon('copy') + 'Copy link</button></div></div>' +

      '<div class="card">' +
      '<div class="row"><span class="row-ic acc">' + Z.icon('user') + '</span><span class="row-main"><span class="row-title">Level 1 \u00b7 Direct</span><span class="row-sub wrap">' + rewardText(st.ref_l1_bonus, st.ref_l1_commission) + '</span></span></div>' +
      '<div class="row"><span class="row-ic acc">' + Z.icon('users') + '</span><span class="row-main"><span class="row-title">Level 2 \u00b7 Indirect</span><span class="row-sub wrap">' + rewardText(st.ref_l2_bonus, st.ref_l2_commission) + '</span></span></div></div>' +
      msRow +
      '<div class="alert a-info">' + Z.icon('info') + '<div>A referral becomes <b>valid</b> when the person has ' + (reqLines(st).join(', ') || 'signed up') + '. Invalid referrals earn nothing. ' +
      'One-time bonuses wait in your Referral Wallet for ' + Number(st.ref_unlock_days) + (Number(st.ref_unlock_days) === 1 ? ' day' : ' days') + ', then move to your Main Wallet automatically. Commission goes straight to your Main Wallet.</div></div>' +

      '<div class="section-head"><h3>Earnings</h3></div>' +
      '<div class="stat-grid">' +
      '<div class="stat"><span>Referral Wallet</span><b>' + Z.money(d.referral_balance) + '</b><em>Locked, not withdrawable</em></div>' +
      '<div class="stat"><span>Commission earned</span><b>' + Z.money(d.commission_earned) + '</b><em>Paid to Main Wallet</em></div>' +
      '<div class="stat"><span>Bonuses unlocked</span><b>' + Z.money(d.bonus_transferred) + '</b><em>Moved to Main Wallet</em></div>' +
      '<div class="stat"><span>Total referral earnings</span><b>' + Z.money(d.total_earnings) + '</b><em>Bonuses, commission, milestones</em></div></div>' +

      '<div class="section-head"><h3>Your referrals</h3></div>' +
      '<div class="two">' + levelCard(1, d.l1_total, d.l1_valid, d.l1_invalid) + levelCard(2, d.l2_total, d.l2_valid, d.l2_invalid) + '</div>' +
      Z.chips([['', 'All'], ['1', 'Level 1'], ['2', 'Level 2']], '', 'data-lv') +
      '<div class="card" id="rl"></div><div id="rm"></div></section>';

    Z.$('#share', el).addEventListener('click', function () {
      var data = { title: 'Join Zyven', text: 'Watch ads and earn rewards on Zyven. Use my referral code ' + d.code + '.', url: link };
      if (navigator.share) navigator.share(data).catch(function () { /* user closed the share sheet */ });
      else Z.copy(link);
    });

    /* Referral list (folded to 2 rows; server paging only after expanding) */
    var level = '', items = [], done = false, loading = false, expanded = false;
    var rl = Z.$('#rl', el), rm = Z.$('#rm', el);

    function renderMore() {
      rm.innerHTML = done || !items.length || !expanded ? '' : '<button class="btn btn-tonal btn-block" id="rmb">Load more</button>';
      var b = Z.$('#rmb', rm);
      if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }
    rl.addEventListener('zfold', function (e) { expanded = e.detail.expanded; renderMore(); });

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; done = false; expanded = false; rl.innerHTML = Z.skel(2, 64); rm.innerHTML = ''; }
      var r = await sb.rpc('my_referral_list', { p_level: level ? parseInt(level, 10) : null, p_limit: PAGE, p_offset: items.length });
      loading = false;
      if (ctx.stale()) return;
      if (r.error) {
        rl.innerHTML = Z.errorState();
        Z.$('[data-retry]', rl).addEventListener('click', function () { load(true); });
        return;
      }
      items = items.concat(r.data || []);
      done = (r.data || []).length < PAGE;
      rl.innerHTML = items.length
        ? Z.fold(items.map(function (x) { return refRow(x, need); }), { expanded: expanded })
        : Z.empty({ icon: 'users', title: 'No referrals yet', text: 'Share your link. People who sign up with it will appear here.' });
      renderMore();
    }

    Z.$('.chips', el).addEventListener('click', function (e) {
      var c = e.target.closest('[data-lv]');
      if (!c || c.getAttribute('data-lv') === level) return;
      level = c.getAttribute('data-lv');
      Z.$$('.chip', el).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
    });
    load(true);
  };
})();
