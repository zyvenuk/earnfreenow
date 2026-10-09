/* Authentication: login, signup, verify, forgot, reset */
(function () {
  'use strict';
  var Z = window.Z;

  function shell(title, sub, body) {
    return '<section class="auth">' + (Z.maint ? Z.maint.authBanner() : '') +
      '<div class="auth-head"><img src="monogram.png" alt="Zyven" class="auth-logo" onerror="this.style.display=\'none\'">' +
      '<h1>' + title + '</h1><p>' + sub + '</p></div>' + body + '</section>';
  }
  // "Continue with Google" button + divider (placed at the top of the login / signup card)
  function googleBlock(label) {
    return '<div class="or"><span>or</span></div>' +
      '<button class="btn btn-google btn-block" type="button" id="goog">' + Z.icon('google', 'g') + label + '</button>';
  }
  function bindGoogle(el, signup, errBox) {
    var b = Z.$('#goog', el);
    if (!b) return;
    b.addEventListener('click', function () {
      Z.run(b, async function () {
        if (signup) {
          var ref = ((Z.$('#ref', el) || {}).value || '').trim().toUpperCase();
          if (/^[A-Z0-9]{4,12}$/.test(ref)) { try { localStorage.setItem('zyven:ref', ref); } catch (e) { /* ignore */ } }
          if (!(await Z.device.available())) throw { message: 'device_taken' };   // one phone, one account
        }
        try { sessionStorage.setItem('zyven:fresh', '1'); } catch (e) { /* ignore */ }   // survives the trip to Google and back
        var r = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: Z.siteUrl(), queryParams: { prompt: 'select_account' } } });
        if (r.error) throw r.error;
      }, errBox);
    });
  }

  function storedRef() { try { return localStorage.getItem('zyven:ref') || ''; } catch (e) { return ''; } }
  function validEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }

  Z.views.login = function (el) {
    el.innerHTML = shell('Welcome back', 'Log in to watch ads and track your rewards.',
      '<form class="card form" id="f" novalidate>' +
      Z.field({ id: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', attrs: 'autocomplete="email" inputmode="email" autocapitalize="off" required' }) +
      Z.field({ id: 'pw', label: 'Password', type: 'password', placeholder: 'Your password', attrs: 'autocomplete="current-password" required' }) +
      '<div id="err"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Log in</button>' +
      googleBlock('Continue with Google') +
      '<button class="link-btn center" type="button" data-go="/forgot">Forgot password?</button>' +
      '</form>' +
      '<p class="auth-alt">New to Zyven? <a data-go="/signup" class="link">Create an account</a></p>');

    var f = Z.$('#f', el), err = Z.$('#err', el);
    bindGoogle(el, false, err);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = Z.$('#email', el).value.trim(), pw = Z.$('#pw', el).value;
      if (!validEmail(email)) return Z.formError(err, 'Enter a valid email address.');
      if (!pw) return Z.formError(err, 'Enter your password.');
      Z.formError(err, '');
      Z.run(Z.$('button[type=submit]', f), async function () {
        Z.freshLogin = true; // set before the auth event fires; cleared again if login fails
        var r = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) {
          Z.freshLogin = false;
          var msg = Z.errMsg(r.error);
          var unconfirmed = /not confirmed/i.test(r.error.message || '');
          Z.formError(err, msg, unconfirmed ? ' <button type="button" class="link-btn" id="resend">Resend email</button>' : '');
          var rs = Z.$('#resend', el);
          if (rs) rs.addEventListener('click', function () { Z.resendVerification(email, rs); });
        }
        // success: onAuthStateChange routes the user, then the follow popup shows
      });
    });
  };

  Z.views.signup = function (el) {
    el.innerHTML = shell('Create your account', 'Start earning rewards for watching ads.',
      '<form class="card form" id="f" novalidate>' +
      Z.field({ id: 'name', label: 'Full name', placeholder: 'Your name', attrs: 'autocomplete="name" maxlength="60" required' }) +
      Z.field({ id: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', attrs: 'autocomplete="email" inputmode="email" autocapitalize="off" required' }) +
      Z.field({ id: 'pw', label: 'Password', type: 'password', placeholder: 'At least 8 characters', attrs: 'autocomplete="new-password" required' }) +
      Z.field({ id: 'ref', label: 'Referral code (optional)', value: storedRef(), placeholder: 'Enter a friend\u2019s code', attrs: 'maxlength="12" autocomplete="off" autocapitalize="characters" style="text-transform:uppercase"' }) +
      '<div id="err"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Create account</button>' +
      googleBlock('Sign up with Google') +
      '</form>' +
      '<p class="auth-alt">Already have an account? <a data-go="/login" class="link">Log in</a></p>');

    var f = Z.$('#f', el), err = Z.$('#err', el);
    bindGoogle(el, true, err);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = Z.$('#name', el).value.trim(), email = Z.$('#email', el).value.trim(), pw = Z.$('#pw', el).value;
      if (name.length < 2) return Z.formError(err, 'Enter your full name.');
      if (!validEmail(email)) return Z.formError(err, 'Enter a valid email address.');
      if (pw.length < 8) return Z.formError(err, 'Password must be at least 8 characters.');
      var ref = Z.$('#ref', el).value.trim().toUpperCase();
      if (ref && !/^[A-Z0-9]{4,12}$/.test(ref)) return Z.formError(err, 'That referral code does not look right.');
      Z.formError(err, '');
      Z.run(Z.$('button[type=submit]', f), async function () {
        if (!(await Z.device.available())) throw { message: 'device_taken' };   // one phone, one account
        var meta = { full_name: name };
        if (ref) meta.referral_code = ref;
        var r = await sb.auth.signUp({ email: email, password: pw, options: { data: meta, emailRedirectTo: Z.siteUrl() } });
        if (r.error) throw r.error;
        try { localStorage.removeItem('zyven:ref'); } catch (e) { /* ignore */ }
        if (r.data.session) { Z.freshLogin = true; return; } // email confirmation disabled: signed in, listener routes
        if (r.data.user && r.data.user.identities && r.data.user.identities.length === 0) {
          return Z.formError(err, 'An account with this email already exists. Try logging in.');
        }
        Z.pendingEmail = email;
        Z.go('/verify');
      }, err);
    });
  };

  Z.views.verify = function (el) {
    var email = Z.pendingEmail || '';
    if (!email) return Z.go('/login');
    el.innerHTML = shell('Check your email', 'We sent a verification link to <b>' + Z.esc(email) + '</b>. Open it to activate your account, then log in.',
      '<div class="card form">' +
      '<button class="btn btn-tonal btn-block" id="resend">Resend email</button>' +
      '<button class="btn btn-ghost btn-block" data-go="/login">Back to log in</button></div>');
    var rs = Z.$('#resend', el);
    rs.addEventListener('click', function () { Z.resendVerification(email, rs); });
  };

  Z.resendVerification = function (email, btn) {
    return Z.run(btn, async function () {
      var r = await sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: Z.siteUrl() } });
      if (r.error) throw r.error;
      Z.toast('Verification email sent');
      if (btn) { btn.disabled = true; setTimeout(function () { btn.disabled = false; }, 30000); }
    });
  };

  Z.views.forgot = function (el) {
    el.innerHTML = shell('Reset password', 'Enter your email and we will send you a reset link.',
      '<form class="card form" id="f" novalidate>' +
      Z.field({ id: 'email', label: 'Email', type: 'email', placeholder: 'you@example.com', attrs: 'autocomplete="email" inputmode="email" autocapitalize="off" required' }) +
      '<div id="err"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Send reset link</button>' +
      '</form>' +
      '<p class="auth-alt"><a data-go="/login" class="link">Back to log in</a></p>');
    var f = Z.$('#f', el), err = Z.$('#err', el);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = Z.$('#email', el).value.trim();
      if (!validEmail(email)) return Z.formError(err, 'Enter a valid email address.');
      Z.run(Z.$('button[type=submit]', f), async function () {
        var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: Z.siteUrl() });
        if (r.error) throw r.error;
        f.innerHTML = '<div class="alert a-ok">' + Z.icon('check') + '<div>If an account exists for <b>' + Z.esc(email) + '</b>, a reset link is on its way. Check your inbox.</div></div>';
      }, err);
    });
  };

  Z.views.reset = function (el) {
    el.innerHTML = shell('Set a new password', 'Choose a password you have not used before.',
      '<form class="card form" id="f" novalidate>' +
      Z.field({ id: 'pw', label: 'New password', type: 'password', placeholder: 'At least 8 characters', attrs: 'autocomplete="new-password" required' }) +
      Z.field({ id: 'pw2', label: 'Confirm password', type: 'password', placeholder: 'Repeat password', attrs: 'autocomplete="new-password" required' }) +
      '<div id="err"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">Save password</button>' +
      '</form>');
    var f = Z.$('#f', el), err = Z.$('#err', el);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = Z.$('#pw', el).value, pw2 = Z.$('#pw2', el).value;
      if (pw.length < 8) return Z.formError(err, 'Password must be at least 8 characters.');
      if (pw !== pw2) return Z.formError(err, 'Passwords do not match.');
      Z.run(Z.$('button[type=submit]', f), async function () {
        var r = await sb.auth.updateUser({ password: pw });
        if (r.error) throw r.error;
        Z.recovery = false;
        Z.toast('Password updated', 'ok');
        Z.go('/home');
      }, err);
    });
  };

  Z.signOut = async function () {
    try { if (Z.push) await Z.push.detach(); await sb.auth.signOut(); } catch (e) { console.warn(e); }
  };
})();
