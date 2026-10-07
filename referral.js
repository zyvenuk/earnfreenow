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

  function refRow(r, need) {
    var valid = r.status === 'valid';
    var sub1 = valid ? 'Validated ' + Z.fmtDay(r.validated_at) : r.ads_done + '/' + need + ' ads completed' + (r.email_verified ? '' : ' \u00b7 email not verified');
    var sub2 = '';
    if (r.bonus_status === 'locked') sub2 = 'Bonus ' + Z.money(r.bonus_amount) + ' \u00b7 unlocks ' + Z.fmtDay(r.bonus_unlock_at);
    else if (r.bonus_status === 'transferred') sub2 = 'Bonus ' + Z.money(r.bonus_amount) + ' unlocked';
    else if (valid) sub2 = 'No one-time bonus';
    return '<div class="row ref-row">' +
      '<span class="avatar sm">' + Z.esc((r.display_name || '?').charAt(0).toUpperCase()) + '</span>' +
      '<span class="row-main"><span class="row-title">' + Z.esc(r.display_name) + ' <span class="lvl">L' + r.level + '</span></span>' +
      '<span class="row-sub">' + sub1 + '</span>' + (sub2 ? '<span class="row-sub">' + sub2 + '</span>' : '') + '</span>' +
      '<span class="col-end">' + Z.badge(r.status) +
      (valid ? '<span class="amt pos small">' + Z.money(r.commission_earned, { sign: true }) + '</span>' : '') + '</span></div>';
  }

  Z.views.referral = async function (el, ctx) {
    var res = await Promise.all([sb.rpc('my_referral_stats'), Z.refreshSettings()]);
    if (ctx.stale()) return;
    if (res[0].error) throw res[0].error;
    var d = res[0].data, st = Z.state.settings || {};
    var link = Z.siteUrl() + '?ref=' + d.code;
    var need = d.required_ads;

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
      '<div class="alert a-info">' + Z.icon('info') + '<div>A referral becomes <b>valid</b> when the person has a verified email and has completed ' + need + ' ads. Invalid referrals earn nothing. ' +
      'One-time bonuses wait in your Referral Wallet for ' + Number(st.ref_unlock_days) + (Number(st.ref_unlock_days) === 1 ? ' day' : ' days') + ', then move to your Main Wallet automatically. Commission goes straight to your Main Wallet.</div></div>' +

      '<div class="section-head"><h3>Earnings</h3></div>' +
      '<div class="stat-grid">' +
      '<div class="stat"><span>Referral Wallet</span><b>' + Z.money(d.referral_balance) + '</b><em>Locked, not withdrawable</em></div>' +
      '<div class="stat"><span>Commission earned</span><b>' + Z.money(d.commission_earned) + '</b><em>Paid to Main Wallet</em></div>' +
      '<div class="stat"><span>Bonuses unlocked</span><b>' + Z.money(d.bonus_transferred) + '</b><em>Moved to Main Wallet</em></div>' +
      '<div class="stat"><span>Total referral earnings</span><b>' + Z.money(d.total_earnings) + '</b><em>Bonuses + commission</em></div></div>' +

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
