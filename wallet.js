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
    admin_reward: { label: 'Reward from Zyven', icon: 'gift', cls: 'pos' },
    plan_purchase: { label: 'Plan purchase', icon: 'layout', cls: 'neg' }
  };
  Z.TX = TX;

  Z.txRow = function (t) {
    var m = TX[t.type] || { label: t.type, icon: 'coin', cls: '' };
    var amt = Number(t.amount), inRef = t.wallet === 'referral'; // Referral Wallet rows are not withdrawable: shown neutral
    return '<div class="row">' +
      '<span class="row-ic ' + m.cls + '">' + Z.icon(m.icon) + '</span>' +
      '<span class="row-main"><span class="row-title">' + m.label + '</span>' +
      '<span class="row-sub">' + Z.fmtDate(t.created_at) + (inRef ? ' \u00b7 Referral Wallet' : (t.note ? ' \u00b7 ' + Z.esc(t.note) : '')) + '</span></span>' +
      (amt !== 0 ? '<span class="amt ' + (inRef ? 'muted' : (amt > 0 ? 'pos' : 'neg')) + '">' + Z.money(amt, { sign: true }) + '</span>' : '') +
      '</div>';
  };

  /* ---------------- Home ---------------- */
  Z.views.home = async function (el, ctx) {
    var both = await Promise.all([Z.loadSummary(true), Z.refreshSettings().catch(function () {})]);
    var s = both[0];
    if (ctx.stale()) return;
    var pst = Z.plans.enabled() ? await Z.plans.status(true).catch(function () { return null; }) : null;   // server-clock plan status
    if (ctx.stale()) return;
    var first = (s.full_name || '').split(' ')[0] || 'there';
    var html = '<section class="page">' +
      '<h2 class="greet">Hi, ' + Z.esc(first) + '</h2>';

    if (s.status === 'suspended') {
      html += '<div class="alert a-error">' + Z.icon('alert') + '<div>Your account is suspended, so earning and payouts are paused. Contact support if you think this is a mistake.' + (s.note ? '<br><b>' + Z.esc(s.note) + '</b>' : '') + '</div></div>';
    }

    html += Z.maint.notices(['platform', 'payout']);

    html += '<div class="balance-card">' +
      '<span class="bc-label">Available balance</span>' +
      '<div class="bc-amount">' + Z.money(s.balance) + '</div>' +
      '<div class="bc-stats"><div><b>' + Z.money(s.today_earned) + '</b><span>Earned today</span></div>' +
      '<div><b>' + s.today_views + '</b><span>Ads watched today</span></div></div>' +
      '<div class="bc-actions"><button class="btn btn-light" data-go="/watch">' + Z.icon('play') + 'Watch ads</button>' +
      '<button class="btn btn-glass" data-go="/payout">' + Z.icon('payout') + 'Withdraw</button></div></div>';

    html += '<div class="quick-grid">' +
      '<button class="quick" data-go="/referral"><span class="quick-ic">' + Z.icon('gift') + '</span><span class="quick-t"><b>Invite friends</b><span>Earn from referrals</span></span></button>' +
      '<button class="quick" data-go="/support"><span class="quick-ic">' + Z.icon('lifebuoy') + '</span><span class="quick-t"><b>Help &amp; support</b><span>We are here to help</span></span></button></div>';

    html += Z.plans.homeCard(pst);
    html += Z.followCard();
    html += Z.pwa.cards();

    html += Z.slots.html('home_top');

    html += '<div class="card"><button class="row row-btn" data-go="/watch">' +
      '<span class="row-ic acc">' + Z.icon('play') + '</span>' +
      '<span class="row-main"><span class="row-title">' + (s.available_ads > 0 ? s.available_ads + (s.available_ads === 1 ? ' ad' : ' ads') + ' ready' : 'No ads available') + '</span>' +
      '<span class="row-sub">' + (s.available_ads > 0 ? 'Watch and earn rewards' : 'Check back soon for new ads') + '</span></span>' +
      Z.icon('chevron', 'row-chev') + '</button>';
    if (s.open_payouts > 0) {
      html += '<button class="row row-btn" data-go="/payout">' +
        '<span class="row-ic warn">' + Z.icon('clock') + '</span>' +
        '<span class="row-main"><span class="row-title">' + s.open_payouts + (s.open_payouts === 1 ? ' payout' : ' payouts') + ' in progress</span>' +
        '<span class="row-sub">' + Z.money(s.open_payout_amount) + ' to be sent manually</span></span>' +
        Z.icon('chevron', 'row-chev') + '</button>';
    }
    html += '</div>';

    html += '<div class="section-head"><h3>Recent activity</h3><button class="link-btn" data-go="/wallet">See all</button></div>';
    if (s.recent && s.recent.length) html += '<div class="card">' + Z.fold(s.recent.map(Z.txRow)) + '</div>';
    else html += '<div class="card">' + Z.empty({ icon: 'receipt', title: 'No activity yet', text: 'Your rewards and payouts will show up here.' }) + '</div>';

    html += Z.slots.html('home_bottom') + '</section>';
    el.innerHTML = html;
    if (pst) Z.plans.tickLeft(el);
    Z.pwa.bindCards(el);
    Z.slots.attach(el, ctx);
  };

  /* ---------------- Wallet ---------------- */
  var FILTERS = {
    all: null,
    rewards: ['ad_reward'],
    payouts: ['payout_request', 'payout_paid', 'payout_rejected', 'payout_cancelled'],
    referral: ['referral_bonus', 'referral_unlock_out', 'referral_unlock_in', 'referral_commission'],
    other: ['admin_adjustment']
  };
  var PAGE = 10;

  Z.views.wallet = async function (el, ctx) {
    var s = await Z.loadSummary(true);
    if (ctx.stale()) return;
    var filter = 'all', items = [], done = false, loading = false, expanded = false;

    el.innerHTML = '<section class="page">' +
      '<div class="card wallet-card"><span class="bc-label dark">Available balance</span>' +
      '<div class="wc-amount">' + Z.money(s.balance) + '</div>' +
      '<div class="wc-grid"><div><span>Total earned</span><b>' + Z.money(s.total_earned) + '</b></div>' +
      '<div><span>Paid out</span><b>' + Z.money(s.total_paid_out) + '</b></div></div>' +
      '<button class="ref-wallet" data-go="/referral"><span class="row-ic">' + Z.icon('gift') + '</span><span class="row-main"><span class="row-title">Referral Wallet</span>' +
      '<span class="row-sub">Locked, not withdrawable. Moves to Main Wallet automatically.</span></span><b class="amt">' + Z.money(s.referral_balance) + '</b></button>' +
      '<button class="btn btn-primary btn-block" data-go="/payout">Request payout</button></div>' +
      '<div class="section-head"><h3>Transactions</h3></div>' +
      Z.chips([['all', 'All'], ['rewards', 'Rewards'], ['referral', 'Referral'], ['payouts', 'Payouts'], ['other', 'Adjustments']], 'all', 'data-f') +
      '<div class="card" id="tx"></div><div id="more"></div>' + Z.slots.html('wallet_bottom') + '</section>';
    Z.slots.attach(el, ctx);

    var tx = Z.$('#tx', el), more = Z.$('#more', el);

    // "Load more" (server paging) only appears once the folded list is expanded
    function renderMore() {
      more.innerHTML = done || !items.length || !expanded ? '' : '<button class="btn btn-tonal btn-block" id="more-btn">Load more</button>';
      var mb = Z.$('#more-btn', more);
      if (mb) mb.addEventListener('click', function () { Z.busy(mb, true); load(false); });
    }
    tx.addEventListener('zfold', function (e) { expanded = e.detail.expanded; renderMore(); });

    async function load(reset) {
      if (loading) return; loading = true;
      if (reset) { items = []; done = false; expanded = false; tx.innerHTML = Z.skel(2, 56); more.innerHTML = ''; }
      var q = sb.from('transactions').select('id,type,amount,balance_after,wallet,note,created_at')
        .order('created_at', { ascending: false }).range(items.length, items.length + PAGE - 1);
      if (FILTERS[filter]) q = q.in('type', FILTERS[filter]);
      var r = await q;
      loading = false;
      if (ctx.stale()) return;
      if (r.error) {
        tx.innerHTML = Z.errorState();
        Z.$('[data-retry]', tx).addEventListener('click', function () { load(true); });
        return;
      }
      items = items.concat(r.data || []);
      done = (r.data || []).length < PAGE;
      tx.innerHTML = items.length ? Z.fold(items.map(Z.txRow), { expanded: expanded }) : Z.empty({ icon: 'receipt', title: 'No transactions', text: 'Nothing here yet.' });
      renderMore();
    }

    Z.$('.chips', el).addEventListener('click', function (e) {
      var c = e.target.closest('[data-f]');
      if (!c || c.getAttribute('data-f') === filter) return;
      filter = c.getAttribute('data-f');
      Z.$$('.chip', el).forEach(function (x) { x.classList.toggle('on', x === c); });
      load(true);
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
    var s = await Z.loadSummary();
    if (ctx.stale()) return;
    var pst = Z.plans.enabled() ? await Z.plans.status().catch(function () { return null; }) : null;
    if (ctx.stale()) return;
    var initial = (s.full_name || '?').trim().charAt(0).toUpperCase();

    el.innerHTML = '<section class="page">' +
      '<div class="profile-head"><div class="avatar">' + Z.esc(initial) + '</div>' +
      '<div class="ph-text"><h2 id="pname">' + Z.esc(s.full_name) + '</h2><p>' + Z.esc(s.email) + '</p><div class="ph-badges">' + Z.verBadge(s.email_verified) + Z.badge(s.status) + '</div></div></div>' +
      '<div class="card">' +
      '<div class="row">' + '<span class="row-ic">' + Z.icon('coin') + '</span><span class="row-main"><span class="row-title">Total earned</span></span><span class="amt">' + Z.money(s.total_earned) + '</span></div>' +
      '<div class="row">' + '<span class="row-ic">' + Z.icon('clock') + '</span><span class="row-main"><span class="row-title">Member since</span></span><span class="amt muted">' + Z.fmtDay(s.created_at) + '</span></div>' +
      '</div>' +
      '<div class="card">' +
      Z.plans.profileRow(pst) +
      '<button class="row row-btn" id="verify"><span class="row-ic ' + (s.email_verified ? 'pos' : 'warn') + '">' + Z.icon('shield') + '</span>' +
      '<span class="row-main"><span class="row-title">Account verification</span><span class="row-sub">' + (s.email_verified ? 'Your Gmail / email is verified' : 'Not verified. Tap to verify') + '</span></span>' +
      Z.icon('chevron', 'row-chev') + '</button>' +
      '<button class="row row-btn" id="edit-name"><span class="row-ic">' + Z.icon('edit') + '</span><span class="row-main"><span class="row-title">Edit name</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      Z.pwa.profileRows() +
      '<button class="row row-btn" id="change-pw"><span class="row-ic">' + Z.icon('lock') + '</span><span class="row-main"><span class="row-title">Change password</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      '<button class="row row-btn" data-go="/support"><span class="row-ic">' + Z.icon('lifebuoy') + '</span><span class="row-main"><span class="row-title">Help &amp; support</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      '<button class="row row-btn" data-go="/referral"><span class="row-ic acc">' + Z.icon('gift') + '</span><span class="row-main"><span class="row-title">Referrals</span><span class="row-sub">Invite friends and earn</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
      (Z.state.isAdmin ? '<button class="row row-btn" data-go="/admin"><span class="row-ic acc">' + Z.icon('shield') + '</span><span class="row-main"><span class="row-title">Admin panel</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' : '') +
      '</div>' +
      Z.slots.html('profile_bottom') +
      '<p class="build-line">Zyven \u00b7 build ' + Z.esc(Z.BUILD) + '</p>' +
      '<button class="btn btn-danger-ghost btn-block" id="logout">' + Z.icon('logout') + 'Log out</button>' +
      '</section>';
    Z.slots.attach(el, ctx);

    Z.pwa.bindProfile(el);
    if (pst) Z.plans.tickLeft(el);
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
          Z.$('.avatar', el).textContent = v.charAt(0).toUpperCase();
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
