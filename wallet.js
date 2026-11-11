/* Home, Wallet, Profile */
(function () {
  'use strict';
  var Z = window.Z;

  var TX = {
    ad_reward: { label: 'Ad reward', icon: 'play', cls: 'pos' },
    admin_adjustment: { label: 'Balance adjustment', icon: 'sliders', cls: '' },
    payout_request: { label: 'Payout requested', icon: 'payout', cls: 'neg' },
    payout_paid: { label: 'Payout paid', icon: 'check', cls: 'pos' },
    payout_rejected: { label: 'Payout rejected, refunded', icon: 'refresh', cls: 'pos' },
    payout_cancelled: { label: 'Payout cancelled, refunded', icon: 'refresh', cls: 'pos' },
    referral_bonus: { label: 'Referral bonus (locked)', icon: 'gift', cls: '' },
    referral_unlock_out: { label: 'Moved to Main Wallet', icon: 'refresh', cls: '' },
    referral_unlock_in: { label: 'Referral bonus unlocked', icon: 'gift', cls: 'pos' },
    referral_commission: { label: 'Referral commission', icon: 'users', cls: 'pos' },
    referral_milestone: { label: 'Milestone reward', icon: 'trophy', cls: 'pos' },
    checkin_reward: { label: 'Daily check-in', icon: 'calendar', cls: 'pos' },
    checkin_milestone: { label: 'Streak reward', icon: 'trophy', cls: 'pos' },
    admin_reward: { label: 'Reward from Zyven', icon: 'gift', cls: 'pos' },
    plan_purchase: { label: 'Plan purchase', icon: 'layout', cls: 'neg' },
    app_purchase: { label: 'Premium app', icon: 'download', cls: 'neg' },
    promo_payment: { label: 'Promotion payment', icon: 'megaphone', cls: 'neg' },
    promo_refund: { label: 'Promotion refund', icon: 'refresh', cls: 'pos' }
  };
  Z.TX = TX;

  Z.txRow = function (t) {
    var m = TX[t.type] || { label: t.type, icon: 'coin', cls: '' };
    var amt = Number(t.amount), inRef = t.wallet === 'referral'; // Referral Wallet rows are not withdrawable: shown neutral
    return '<div class="row">' +
      '<span class="row-ic ' + m.cls + '">' + Z.icon(m.icon) + '</span>' +
      '<span class="row-main"><span class="row-title">' + m.label + '</span>' +
      '<span class="row-sub">' + Z.fmtDate(t.created_at) + (inRef ? ' \u00b7 Referral Wallet' : (t.note ? ' \u00b7 ' + Z.esc(t.note) : '')) + '</span></span>' +
      (amt !== 0 ? '<span class="amt ' + (inRef ? 'muted' : (amt > 0 ? 'pos' : 'neg')) + '">' + Z.moneyHtml(amt, { sign: true }) + '</span>' : '') +
      '</div>';
  };

  /* One shared profile picture for every user (profile.png next to index.html). If the file is missing the initial stays visible. */
  Z.avatarHtml = function (name, cls) {
    var initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
    return '<span class="avatar ' + (cls || '') + '"><b class="av-i">' + Z.esc(initial) + '</b>' +
      '<img src="profile.png" alt="" decoding="async" onerror="this.remove()"></span>';
  };
  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  }


  /* Home: shortcuts (only sections that are switched on). These replace the old row buttons. */
  function quickAccess(pv, s) {
    var t = [];
    if (Z.plans.enabled()) t.push(['/plans', 'layout', 'Plans']);
    t.push(['/referral', 'gift', 'Refer']);
    t.push(['/milestones', 'star', 'Milestones']);
    t.push(['/activity', 'receipt', 'Transactions']);
    if (!(Z.state.settings && Z.state.settings.chat_enabled === false)) t.push(['/community', 'chat', 'Chat']);
    if (Z.promos.enabled()) t.push(['/promotions', 'megaphone', 'Promote', Number(s.promo_live) || 0]);
    if (Z.leaderboard.enabled()) t.push(['/leaderboard', 'trophy', 'Ranking']);
    if (Z.appsVisible()) t.push(['/apps', 'download', 'Apps']);
    return '<div class="qa-grid">' + t.slice(0, 8).map(function (x) {
      return '<button class="qa" data-go="' + x[0] + '"><span class="qa-ic">' + Z.icon(x[1]) + (x[3] > 0 ? '<em class="qa-badge">' + x[3] + '</em>' : '') + '</span><span>' + x[2] + '</span></button>';
    }).join('') + '</div>';
  }

  /* Home: referral overview (counts come with the summary) */
  function referralOverview(s) {
    var total = Number(s.ref_total) || 0, l1 = Number(s.ref_l1) || 0, l2 = Number(s.ref_l2) || 0, valid = l1 + l2;
    if (!total) {
      return '<div class="card ref-ov"><div class="ov-head"><span class="row-ic acc">' + Z.icon('gift') + '</span><div class="row-main"><span class="row-title">Referrals</span><span class="row-sub">Share your code to start earning</span></div></div>' +
        Z.empty({ icon: 'users', title: 'No referrals yet', text: 'When friends join with your code and become valid, you earn bonuses and commission.', action: '<button class="btn btn-primary" data-go="/referral">Invite friends</button>' }) + '</div>';
    }
    return '<div class="card ref-ov"><button class="ov-head row-btn" data-go="/referral" style="padding:0;background:none;border:0;text-align:left"><span class="row-ic acc">' + Z.icon('gift') + '</span>' +
      '<div class="row-main"><span class="row-title">Referrals</span><span class="row-sub">Level 1 and Level 2 overview</span></div>' + Z.icon('chevron', 'row-chev') + '</button>' +
      '<div class="ov-stats"><div><b data-count="' + l1 + '" data-kind="int" data-ck="rl1">' + l1 + '</b><span>Level 1 valid</span></div>' +
      '<div><b data-count="' + l2 + '" data-kind="int" data-ck="rl2">' + l2 + '</b><span>Level 2 valid</span></div>' +
      '<div><b data-count="' + total + '" data-kind="int" data-ck="rtotal">' + total + '</b><span>All referrals</span></div></div>' +
      Z.progress({ label: 'Valid referrals', value: valid, max: total, right: valid + ' of ' + total }) + '</div>';
  }

  /* ---------------- Home ---------------- */
  Z.views.home = async function (el, ctx) {
    var both = await Promise.all([Z.loadSummary(true), Z.refreshSettings(false, 30000).catch(function () {})]);
    var s = both[0];
    if (ctx.stale()) return;
    var pst = Z.plans.enabled() ? await Z.plans.status(true).catch(function () { return null; }) : null;   // server-clock plan status
    if (ctx.stale()) return;
    var html = '<section class="page">';

    if (s.status === 'suspended') {
      html += '<div class="alert a-error">' + Z.icon('alert') + '<div>Your account is suspended, so earning and payouts are paused. Contact support if you think this is a mistake.' + (s.note ? '<br><b>' + Z.esc(s.note) + '</b>' : '') + '</div></div>';
    }

    var pv = Z.payoutVisible();   // the admin can hide the Payout page completely
    html += Z.maint.notices(pv ? ['platform', 'payout'] : ['platform']);

    // One card: who you are on top, what you have below.
    html += '<div class="balance-card hero">' +
      '<button class="hero-me" data-go="/profile" aria-label="Open your profile">' + Z.avatarHtml(s.full_name) +
      '<span class="me-text"><span class="me-hi">' + greeting() + '</span><b class="me-name">' + Z.esc(s.full_name || 'Member') + '</b>' +
      '<span class="me-meta">' + Z.verBadge(s.email_verified) + '<span class="me-since">Since ' + Z.fmtDay(s.created_at) + '</span></span></span>' +
      Z.icon('chevron', 'row-chev') + '</button>' +
      '<div class="hero-body">' +
      '<span class="bc-label">Main Wallet balance</span>' +
      '<div class="bc-amount" data-count="' + Number(s.balance) + '" data-kind="money" data-ck="balance">' + Z.moneyHtml(s.balance) + '</div>' +
      '<div class="bc-stats"><div><b data-count="' + Number(s.today_earned) + '" data-kind="money" data-ck="today">' + Z.moneyHtml(s.today_earned) + '</b><span>Earned today</span></div>' +
      '<div><b data-count="' + Number(s.today_views) + '" data-kind="int" data-ck="views">' + s.today_views + '</b><span>Ads today</span></div>' +
      '<button class="bc-ref" data-go="/referral"><b data-count="' + Number(s.referral_balance) + '" data-kind="money" data-ck="refbal">' + Z.moneyHtml(s.referral_balance) + '</b><span>Referral, locked</span></button></div>' +
      '<div class="bc-actions"><button class="btn btn-light" data-go="/watch">' + Z.icon('play') + 'Watch ads</button>' +
      (pv ? '<button class="btn btn-glass" data-go="/payout">' + Z.icon('payout') + 'Withdraw</button>' : '') + '</div></div></div>';

    html += Z.followCard();          // official channels: right under the balance card
    html += quickAccess(pv, s);      // shortcuts to the main sections
    html += Z.checkin.homeCard(s);   // daily check-in streak
    html += Z.banners.slot();        // promotional carousel (filled from the database, hidden when there is nothing to show)

    // Earnings: real numbers from the summary, last 7 days as a tappable chart
    html += Z.weekChart(s.week,
      '<div><b data-count="' + Number(s.total_earned) + '" data-kind="money" data-ck="earned">' + Z.moneyHtml(s.total_earned) + '</b><span>Total earned</span></div>' +
      '<div><b data-count="' + Number(s.total_paid_out) + '" data-kind="money" data-ck="paid">' + Z.moneyHtml(s.total_paid_out) + '</b><span>Paid out</span></div>' +
      '<div><b data-count="' + Number(s.available_ads) + '" data-kind="int" data-ck="ready">' + s.available_ads + '</b><span>Ads ready</span></div>');

    html += Z.plans.homeCard(pst);
    html += referralOverview(s);
    html += Z.pwa.cards();

    html += Z.slots.html('home_top');

    // A payout that is still being processed stays visible: it is a status, not a shortcut.
    if (pv && s.open_payouts > 0) {
      html += '<div class="card"><button class="row row-btn" data-go="/payout">' +
        '<span class="row-ic warn">' + Z.icon('clock') + '</span>' +
        '<span class="row-main"><span class="row-title">' + s.open_payouts + (s.open_payouts === 1 ? ' payout' : ' payouts') + ' in progress</span>' +
        '<span class="row-sub">' + Z.money(s.open_payout_amount) + ' to be sent manually</span></span>' +
        Z.icon('chevron', 'row-chev') + '</button></div>';
    }

    html += Z.slots.html('home_bottom') + '</section>';
    el.innerHTML = html;
    if (pst) Z.plans.tickLeft(el);
    Z.weekBind(el, s.week);
    Z.countUp(el);
    Z.pwa.bindCards(el);
    Z.checkin.bindHome(el);
    Z.banners.mount(Z.$('#bn', el), ctx);
    Z.slots.attach(el, ctx);
  };

  /* ---------------- Transaction & Recent Activity (opened from Profile) ---------------- */
  Z.views.activity = async function (el, ctx) {
    var PAGE = 20;
    var TXF = {
      all: null, rewards: ['ad_reward'], checkin: ['checkin_reward', 'checkin_milestone'], payouts: ['payout_request', 'payout_paid', 'payout_rejected', 'payout_cancelled'],
      referral: ['referral_bonus', 'referral_unlock_out', 'referral_unlock_in', 'referral_commission', 'referral_milestone'],
      other: ['admin_adjustment', 'admin_reward', 'plan_purchase', 'promo_payment', 'promo_refund', 'app_purchase']
    };
    var f = 'all', items = [], done = false, loading = false;

    el.innerHTML = '<section class="page">' +
      '<div class="section-head"><h3>All transactions</h3><button class="link-btn" id="txclear">Clear history</button></div>' +
      Z.chips([['all', 'All'], ['rewards', 'Rewards'], ['checkin', 'Check-in'], ['referral', 'Referral'], ['payouts', 'Payouts'], ['other', 'Adjustments']], 'all', 'data-tf') +
      '<div class="card" id="tx"></div><div id="txmore"></div></section>';

    var box = Z.$('#tx', el), more = Z.$('#txmore', el);
    function renderMore() {
      more.innerHTML = done || !items.length ? '' : '<button class="btn btn-tonal btn-block" id="txmb">Load more</button>';
      var b = Z.$('#txmb', more);
      if (b) b.addEventListener('click', function () { Z.busy(b, true); load(false); });
    }
    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; done = false; box.innerHTML = Z.skel(3, 56); more.innerHTML = ''; }
      var q = sb.from('transactions').select('id,type,amount,balance_after,wallet,note,created_at')
        .order('created_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
      if (TXF[f]) q = q.in('type', TXF[f]);
      var r = await q;
      loading = false;
      if (ctx.stale()) return;
      if (r.error) { box.innerHTML = Z.errorState(); Z.$('[data-retry]', box).addEventListener('click', function () { load(true); }); more.innerHTML = ''; return; }
      items = items.concat(r.data || []);
      done = (r.data || []).length < PAGE;
      box.innerHTML = items.length ? items.map(Z.txRow).join('') : Z.empty({ icon: 'receipt', title: 'No activity yet', text: 'Your rewards, payouts and balance changes will show up here.' });
      renderMore();
    }
    Z.$('[data-tf]', el).parentNode.addEventListener('click', function (e) {
      var c = e.target.closest('[data-tf]');
      if (!c || c.getAttribute('data-tf') === f) return;
      f = c.getAttribute('data-tf');
      Z.$$('[data-tf]', el).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
    });
    // Clearing only hides the list for you. Your balance and earnings are not affected.
    Z.$('#txclear', el).addEventListener('click', async function () {
      if (!items.length) return Z.toast('There is nothing to clear.');
      if (!await Z.confirm({ title: 'Clear transaction history?', text: 'Your transaction list will be emptied. Your balance and earnings are not changed.', confirm: 'Clear history', danger: true })) return;
      var b = this;
      Z.run(b, async function () {
        var r = await sb.rpc('clear_my_transactions');
        if (r.error) throw r.error;
        Z.invalidateSummary();
        Z.toast('History cleared', 'ok');
        load(true);
      });
    });
    load(true);
  };

  /* ---------------- Account verification ---------------- */
  async function verifySheet(btn) {
    Z.busy(btn, true);
    var r = await sb.rpc('my_verification');      // live from Supabase Auth
    Z.busy(btn, false);
    if (r.error) return Z.toast(Z.errMsg(r.error), 'error');
    var d = r.data;

    if (d.verified) {   // already done: nothing to do
      Z.sheet('<div class="follow"><div class="sup-ic big" style="background:var(--pos-soft);color:var(--pos)">' + Z.icon('check') + '</div>' +
        '<h2>Already verified</h2><p>Your account is verified. Nothing more to do.</p>' +
        '<div class="summary" style="width:100%;text-align:left"><div class="kv"><span>Email</span><b>' + Z.esc(d.email || '') + '</b></div>' +
        '<div class="kv"><span>Verified with</span><b>' + (d.google ? 'Google' : 'Email confirmation') + '</b></div>' +
        (d.verified_at ? '<div class="kv"><span>Since</span><b>' + Z.fmtDay(d.verified_at) + '</b></div>' : '') + '</div>' +
        '<button class="btn btn-primary btn-block" data-close>Done</button></div>', { center: true });
      return;
    }

    var sh = Z.sheet('<h2 class="sheet-title">Verify your account</h2>' +
      '<p class="sheet-text">Verify your Gmail / Google account to get the Verified badge. Referrals only count once the referred person is verified.</p>' +
      '<div class="sheet-actions"><button class="btn btn-google btn-block" id="v-google">' + Z.icon('google', 'g') + 'Verify with Google</button>' +
      (d.email_confirmed ? '' : '<button class="btn btn-tonal btn-block" id="v-mail">' + Z.icon('mail') + 'Send verification email</button>') +
      '<button class="btn btn-ghost btn-block" data-close>Not now</button></div>');
    Z.$('#v-google', sh.el).addEventListener('click', function () {
      var b = this;
      Z.run(b, async function () {
        try { sessionStorage.setItem('zyven:linked', '1'); } catch (e) { /* ignore */ }
        var res = await sb.auth.linkIdentity({ provider: 'google', options: { redirectTo: Z.siteUrl() } });
        if (res.error) { try { sessionStorage.removeItem('zyven:linked'); } catch (e) { /* ignore */ } throw res.error; }
      });
    });
    var mb = Z.$('#v-mail', sh.el);
    if (mb) mb.addEventListener('click', function () {
      Z.run(mb, async function () {
        var res = await sb.auth.resend({ type: 'signup', email: d.email, options: { emailRedirectTo: Z.siteUrl() } });
        if (res.error) throw res.error;
        Z.toast('Verification email sent. Check your inbox.', 'ok'); sh.close();
      });
    });
  }

  /* ---------------- Profile ---------------- */
  Z.views.profile = async function (el, ctx) {
    var s = (await Promise.all([Z.loadSummary(), Z.refreshSettings(false, 30000).catch(function () {})]))[0];
    if (ctx.stale()) return;
    var since = Z.fmtDay(s.created_at);
    function stat(label, amount, key) { return '<div><b data-count="' + Number(amount) + '" data-kind="money" data-ck="' + key + '">' + Z.moneyHtml(amount) + '</b><span>' + label + '</span></div>'; }
    el.innerHTML = '<section class="page pf">' +
      // identity + the three numbers that matter
      '<div class="pf-hero">' +
        '<div class="pf-id">' + Z.avatarHtml(s.full_name, 'lg') +
        '<div class="pf-text"><h2 id="pname">' + Z.esc(s.full_name) + '</h2><p>' + Z.esc(s.email) + '</p><div class="ph-badges">' + Z.verBadge(s.email_verified) + Z.badge(s.status) + '</div></div>' +
        '<button class="pf-edit" id="edit-name" aria-label="Edit name">' + Z.icon('edit') + '</button></div>' +
        '<div class="pf-stats">' + stat('Balance', s.balance, 'balance') + stat('Total earned', s.total_earned, 'earned') + stat('Paid out', s.total_paid_out, 'paid') + '</div>' +
        '<p class="pf-since">Member since ' + Z.esc(since) + '</p>' +
      '</div>' +
      // money
      '<h3 class="pf-title">Earnings</h3><div class="card">' +
      (Z.payoutVisible() ? '<button class="row row-btn" data-go="/payout"><span class="row-ic acc">' + Z.icon('payout') + '</span><span class="row-main"><span class="row-title">Payout</span><span class="row-sub">Withdraw your earnings</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' : '') +
      '<button class="row row-btn" data-go="/activity"><span class="row-ic acc">' + Z.icon('receipt') + '</span><span class="row-main"><span class="row-title">Transaction &amp; Recent Activity</span><span class="row-sub">All your rewards, payouts and balance changes</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      '<button class="row row-btn" data-go="/referral"><span class="row-ic acc">' + Z.icon('gift') + '</span><span class="row-main"><span class="row-title">Referrals</span><span class="row-sub">Invite friends and earn</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      (Z.appsVisible() ? '<button class="row row-btn" data-go="/myapps"><span class="row-ic acc">' + Z.icon('download') + '</span><span class="row-main"><span class="row-title">My Apps</span><span class="row-sub">Purchased premium apps</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' : '') +
      '</div>' +
      // account
      '<h3 class="pf-title">Account</h3><div class="card">' +
      '<button class="row row-btn" id="verify"><span class="row-ic ' + (s.email_verified ? 'pos' : 'warn') + '">' + Z.icon('shield') + '</span>' +
      '<span class="row-main"><span class="row-title">Account verification</span><span class="row-sub">' + (s.email_verified ? 'Your Gmail / email is verified' : 'Not verified. Tap to verify') + '</span></span>' +
      Z.icon('chevron', 'row-chev') + '</button>' +
      '<button class="row row-btn" id="change-pw"><span class="row-ic">' + Z.icon('lock') + '</span><span class="row-main"><span class="row-title">Change password</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      Z.pwa.profileRows() +
      '</div>' +
      // help
      '<h3 class="pf-title">Help</h3><div class="card">' +
      '<button class="row row-btn" data-go="/support"><span class="row-ic ">' + Z.icon('lifebuoy') + '</span><span class="row-main"><span class="row-title">Help &amp; support</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      (Z.state.isAdmin ? '<button class="row row-btn" data-go="/admin"><span class="row-ic acc">' + Z.icon('shield') + '</span><span class="row-main"><span class="row-title">Admin panel</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' : '') +
      '</div>' +
      Z.slots.html('profile_bottom') +
      '<p class="build-line">Zyven \u00b7 build ' + Z.esc(Z.BUILD) + '</p>' +
      '<button class="btn btn-danger-ghost btn-block" id="logout">' + Z.icon('logout') + 'Log out</button>' +
      '</section>';
    Z.countUp(el);
    Z.slots.attach(el, ctx);

    Z.pwa.bindProfile(el);
    Z.$('#verify', el).addEventListener('click', function () { verifySheet(this); });
    Z.$('#logout', el).addEventListener('click', async function () {
      if (await Z.confirm({ title: 'Log out?', text: 'You can log back in any time.', confirm: 'Log out' })) Z.signOut();
    });

    Z.$('#edit-name', el).addEventListener('click', function () {
      var sh = Z.sheet('<h2 class="sheet-title">Edit name</h2><form id="nf" novalidate>' +
        Z.field({ id: 'nn', label: 'Full name', value: s.full_name, attrs: 'maxlength="60" autocomplete="name"' }) +
        '<div id="nerr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Save</button>' +
        '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
      Z.$('#nf', sh.el).addEventListener('submit', function (e) {
        e.preventDefault();
        var v = Z.$('#nn', sh.el).value.trim();
        if (v.length < 2) return Z.formError(Z.$('#nerr', sh.el), 'Enter your full name.');
        Z.run(Z.$('button[type=submit]', sh.el), async function () {
          var r = await sb.from('profiles').update({ full_name: v }).eq('id', Z.state.user.id);
          if (r.error) throw r.error;
          s.full_name = v; Z.state.summary.full_name = v;
          Z.$('#pname', el).textContent = v;
          Z.$('.avatar .av-i', el).textContent = v.charAt(0).toUpperCase();
          sh.close(); Z.toast('Name updated', 'ok');
        }, Z.$('#nerr', sh.el));
      });
    });

    Z.$('#change-pw', el).addEventListener('click', function () {
      var sh = Z.sheet('<h2 class="sheet-title">Change password</h2><form id="pf" novalidate>' +
        Z.field({ id: 'p1', label: 'New password', type: 'password', placeholder: 'At least 8 characters', attrs: 'autocomplete="new-password"' }) +
        Z.field({ id: 'p2', label: 'Confirm password', type: 'password', attrs: 'autocomplete="new-password"' }) +
        '<div id="perr"></div><div class="sheet-actions"><button class="btn btn-primary btn-block" type="submit">Update password</button>' +
        '<button class="btn btn-ghost btn-block" type="button" data-close>Cancel</button></div></form>');
      Z.$('#pf', sh.el).addEventListener('submit', function (e) {
        e.preventDefault();
        var a = Z.$('#p1', sh.el).value, b = Z.$('#p2', sh.el).value, err = Z.$('#perr', sh.el);
        if (a.length < 8) return Z.formError(err, 'Password must be at least 8 characters.');
        if (a !== b) return Z.formError(err, 'Passwords do not match.');
        Z.run(Z.$('button[type=submit]', sh.el), async function () {
          var r = await sb.auth.updateUser({ password: a });
          if (r.error) throw r.error;
          sh.close(); Z.toast('Password updated', 'ok');
        }, err);
      });
    });
  };
})();
