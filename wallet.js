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
    plan_purchase: { label: 'Plan purchase', icon: 'layout', cls: 'neg' },
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
      (amt !== 0 ? '<span class="amt ' + (inRef ? 'muted' : (amt > 0 ? 'pos' : 'neg')) + '">' + Z.money(amt, { sign: true }) + '</span>' : '') +
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

  /* ---------------- Home ---------------- */
  Z.views.home = async function (el, ctx) {
    var both = await Promise.all([Z.loadSummary(true), Z.refreshSettings().catch(function () {})]);
    var s = both[0];
    if (ctx.stale()) return;
    var pst = Z.plans.enabled() ? await Z.plans.status(true).catch(function () { return null; }) : null;   // server-clock plan status
    if (ctx.stale()) return;
    var html = '<section class="page">';

    if (s.status === 'suspended') {
      html += '<div class="alert a-error">' + Z.icon('alert') + '<div>Your account is suspended, so earning and payouts are paused. Contact support if you think this is a mistake.' + (s.note ? '<br><b>' + Z.esc(s.note) + '</b>' : '') + '</div></div>';
    }

    html += Z.maint.notices(['platform', 'payout']);

    html += '<button class="card me-card" data-go="/profile" aria-label="Open your profile">' + Z.avatarHtml(s.full_name) +
      '<span class="me-text"><span class="me-hi">' + greeting() + '</span><b class="me-name">' + Z.esc(s.full_name || 'Member') + '</b>' +
      '<span class="me-meta">' + Z.verBadge(s.email_verified) + '<span class="me-since">Since ' + Z.fmtDay(s.created_at) + '</span></span></span>' +
      Z.icon('chevron', 'row-chev') + '</button>';

    html += '<div class="balance-card">' +
      '<span class="bc-label">Main Wallet balance</span>' +
      '<div class="bc-amount">' + Z.money(s.balance) + '</div>' +
      '<div class="bc-stats"><div><b>' + Z.money(s.today_earned) + '</b><span>Earned today</span></div>' +
      '<div><b>' + s.today_views + '</b><span>Ads today</span></div>' +
      '<button class="bc-ref" data-go="/referral"><b>' + Z.money(s.referral_balance) + '</b><span>Referral, locked</span></button></div>' +
      '<div class="bc-actions"><button class="btn btn-light" data-go="/watch">' + Z.icon('play') + 'Watch ads</button>' +
      '<button class="btn btn-glass" data-go="/payout">' + Z.icon('payout') + 'Withdraw</button></div></div>';

    html += Z.banners.slot();   // promotional carousel (filled from the database, hidden when there is nothing to show)

    html += '<div class="quick-grid">' +
      '<button class="quick" data-go="/referral"><span class="quick-ic">' + Z.icon('gift') + '</span><span class="quick-t"><b>Invite friends</b><span>Earn from referrals</span></span></button>' +
      '<button class="quick" data-go="/support"><span class="quick-ic">' + Z.icon('lifebuoy') + '</span><span class="quick-t"><b>Support</b><span>Get help</span></span></button></div>';

    html += Z.leaderboard.homeCard();
    html += Z.promos.homeCard();
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

    html += '<div class="section-head"><h3>Recent activity</h3><button class="link-btn" data-go="/payout">See all</button></div>';
    if (s.recent && s.recent.length) html += '<div class="card">' + Z.fold(s.recent.map(Z.txRow)) + '</div>';
    else html += '<div class="card">' + Z.empty({ icon: 'receipt', title: 'No activity yet', text: 'Your rewards and payouts will show up here.' }) + '</div>';

    html += Z.slots.html('home_bottom') + '</section>';
    el.innerHTML = html;
    if (pst) Z.plans.tickLeft(el);
    Z.pwa.bindCards(el);
    Z.banners.mount(Z.$('#bn', el), ctx);
    Z.slots.attach(el, ctx);
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

    el.innerHTML = '<section class="page">' +
      '<div class="profile-head">' + Z.avatarHtml(s.full_name, 'lg') +
      '<div class="ph-text"><h2 id="pname">' + Z.esc(s.full_name) + '</h2><p>' + Z.esc(s.email) + '</p><div class="ph-badges">' + Z.verBadge(s.email_verified) + Z.badge(s.status) + '</div></div></div>' +
      '<div class="card">' +
      '<div class="row">' + '<span class="row-ic">' + Z.icon('coin') + '</span><span class="row-main"><span class="row-title">Total earned</span></span><span class="amt">' + Z.money(s.total_earned) + '</span></div>' +
      '<div class="row">' + '<span class="row-ic">' + Z.icon('clock') + '</span><span class="row-main"><span class="row-title">Member since</span></span><span class="amt muted">' + Z.fmtDay(s.created_at) + '</span></div>' +
      '</div>' +
      '<div class="card">' +
      '<button class="row row-btn" data-go="/payout"><span class="row-ic acc">' + Z.icon('payout') + '</span><span class="row-main"><span class="row-title">Payout</span><span class="row-sub">Withdraw your earnings</span></span>' + Z.icon('chevron', 'row-chev') + '</button>' +
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
