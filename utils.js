/* Shared helpers */
(function () {
  'use strict';
  var Z = window.Z = window.Z || {};
  Z.views = Z.views || {};
  Z.state = { session: null, user: null, isAdmin: false, settings: null, summary: null, summaryAt: 0 };

  Z.$ = function (s, r) { return (r || document).querySelector(s); };
  Z.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  Z.esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  Z.icon = function (name, cls) {
    return '<svg class="ic ' + (cls || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  };

  /* ---------- Formatting ---------- */
  var nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  Z.money = function (n, opt) {
    var v = Number(n) || 0;
    var sym = (Z.state.settings && Z.state.settings.currency_symbol) || 'Rs';
    var sign = v < 0 ? '\u2212' : (opt && opt.sign && v > 0 ? '+' : '');
    return sign + sym + '\u00a0' + nf.format(Math.abs(v));
  };
  Z.fmtDate = function (d) {
    if (!d) return '\u2014';
    return new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };
  Z.fmtDay = function (d) {
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  /* ---------- Errors ---------- */
  var ERR = {
    not_authenticated: 'Please log in again.',
    account_suspended: 'Your account is suspended. Contact support if you think this is a mistake.',
    ad_unavailable: 'This ad is no longer available.',
    daily_limit_reached: 'You have reached today\u2019s limit for this ad.',
    limit_reached: 'You have reached the limit for this ad.',
    too_early: 'Keep watching a little longer to earn this reward.',
    already_completed: 'This reward was already claimed.',
    view_not_found: 'This ad session was not found. Start it again.',
    view_expired: 'This ad session expired. Start it again.',
    payouts_disabled: 'Payouts are paused right now. Please try again later.',
    invalid_method: 'Choose Easypaisa or JazzCash.',
    invalid_name: 'Enter the account holder\u2019s full name.',
    invalid_number: 'Enter a valid mobile account number, like 03XXXXXXXXX.',
    invalid_amount: 'Enter a valid amount.',
    below_minimum: 'The amount is below the minimum payout.',
    insufficient_balance: 'Not enough balance for this.',
    amount_too_low_for_fee: 'The amount is too low to cover the fee.',
    cannot_cancel: 'Only pending requests can be cancelled.',
    forbidden: 'You do not have permission to do that.',
    already_final: 'This request has already been finalised.',
    invalid_transition: 'That status change is not allowed.',
    reason_required: 'Enter a reason of at least 3 characters.',
    cannot_modify_self: 'You cannot change your own account.',
    not_found: 'That item could not be found.',
    device_taken: 'This phone already has a Zyven account. Each phone can have only one account, so please log in to your existing account.',
    'provider is not enabled': 'Google sign-in is not set up yet. Please use email and password.',
    'Unsupported provider': 'Google sign-in is not set up yet. Please use email and password.',
    'anual linking is disabled': 'Linking Google is not switched on yet. Please contact support.',
    'already linked': 'That Google account is already linked to another Zyven account.',
    maintenance_platform: 'Zyven is under maintenance right now. Please try again later.',
    maintenance_payout: 'Payouts are paused for maintenance right now. Please try again later.',
    ad_not_loaded: 'The ad was not shown. Turn off your ad blocker or Private DNS, then try again.',
    offer_not_done: 'Open the offer and stay on it for the full time first.',
    invalid_event: 'Something went wrong. Please try again.',
    push_denied: 'Notifications are blocked. Allow them in your browser settings, then try again.',
    push_unsupported: 'This browser does not support push notifications.',
    push_ios_install: 'On iPhone, add Zyven to your Home Screen first, then turn on notifications.',
    'Invalid login credentials': 'Incorrect email or password.',
    'Email not confirmed': 'Verify your email first. Check your inbox for the link.',
    'User already registered': 'An account with this email already exists. Try logging in.',
    'Password should be at least': 'Password is too short. Use at least 8 characters.',
    'same password': 'Choose a password different from your current one.',
    'rate limit': 'Too many attempts. Wait a moment and try again.',
    'over_email_send_rate_limit': 'Too many emails requested. Wait a minute and try again.',
    'Unable to validate email address': 'Enter a valid email address.',
    'Signup requires a valid password': 'Enter a valid password.'
  };
  Z.errMsg = function (e) {
    var m = (e && (e.message || e.error_description || e.msg)) || (typeof e === 'string' ? e : '');
    if (e) console.error('[Zyven]', e);
    if (m.indexOf('maintenance_') !== -1 && Z.maint && !Z._maintBusy) {   // maintenance began while the user was active: show the right screen
      Z._maintBusy = true;
      Z.maint.refresh(true).then(function () { Z.route(); }).then(function () { Z._maintBusy = false; }, function () { Z._maintBusy = false; });
    }
    for (var k in ERR) { if (m.indexOf(k) !== -1) return ERR[k]; }
    if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'No connection. Check your internet and try again.';
    return 'Something went wrong. Please try again.';
  };

  /* ---------- Toast ---------- */
  Z.toast = function (msg, type) {
    var root = Z.$('#toast-root');
    var t = document.createElement('div');
    t.className = 'toast' + (type ? ' t-' + type : '');
    t.textContent = msg;
    root.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 250);
    }, 3200);
  };

  /* ---------- Buttons ---------- */
  Z.busy = function (btn, on) {
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle('is-loading', !!on);
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
  };
  // Runs fn with the button in a loading state; shows a friendly toast on failure.
  Z.run = async function (btn, fn, errTarget) {
    Z.busy(btn, true);
    try { return await fn(); }
    catch (e) {
      var msg = Z.errMsg(e);
      if (errTarget) Z.formError(errTarget, msg); else Z.toast(msg, 'error');
    }
    finally { Z.busy(btn, false); }
  };
  Z.formError = function (el, msg, extraHtml) {
    if (!el) return;
    el.innerHTML = msg ? '<div class="alert a-error">' + Z.icon('alert') + '<div>' + Z.esc(msg) + (extraHtml || '') + '</div></div>' : '';
  };

  /* ---------- Bottom sheet / dialogs ---------- */
  Z.sheet = function (html, opts) {
    opts = opts || {};
    var root = Z.$('#sheet-root');
    var back = document.createElement('div');
    back.className = 'sheet-backdrop' + (opts.center ? ' center' : '');
    back.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-grab"></div>' + html + '</div>';
    root.appendChild(back);
    document.body.classList.add('no-scroll');
    var done = false;
    var api = {
      el: back.firstChild,
      close: function () {
        if (done) return; done = true;
        back.classList.remove('open');
        setTimeout(function () {
          back.remove();
          if (!root.children.length && !Z.$('.viewer')) document.body.classList.remove('no-scroll');
        }, 200);
        document.removeEventListener('keydown', onKey);
        if (opts.onClose) opts.onClose();
      }
    };
    function onKey(e) { if (e.key === 'Escape') api.close(); }
    document.addEventListener('keydown', onKey);
    back.addEventListener('click', function (e) { if (e.target === back) api.close(); });
    api.el.addEventListener('click', function (e) { if (e.target.closest('[data-close]')) api.close(); });
    requestAnimationFrame(function () { back.classList.add('open'); });
    return api;
  };

  Z.confirm = function (o) {
    return new Promise(function (resolve) {
      var settled = false;
      var s = Z.sheet(
        '<h2 class="sheet-title">' + Z.esc(o.title) + '</h2>' +
        (o.html ? '<div class="sheet-text">' + o.html + '</div>' : '<p class="sheet-text">' + Z.esc(o.text || '') + '</p>') +
        '<div class="sheet-actions">' +
        '<button class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + ' btn-block" data-ok>' + Z.esc(o.confirm || 'Confirm') + '</button>' +
        '<button class="btn btn-ghost btn-block" data-close>' + Z.esc(o.cancel || 'Cancel') + '</button></div>',
        { onClose: function () { if (!settled) { settled = true; resolve(false); } } }
      );
      Z.$('[data-ok]', s.el).addEventListener('click', function () { settled = true; s.close(); resolve(true); });
    });
  };

  /* ---------- UI snippets ---------- */
  Z.skel = function (n, h) {
    var out = '';
    for (var i = 0; i < (n || 3); i++) out += '<div class="skel" style="height:' + (h || 64) + 'px"></div>';
    return '<div class="skel-list">' + out + '</div>';
  };
  Z.empty = function (o) {
    return '<div class="empty">' +
      '<div class="empty-ic">' + Z.icon(o.icon || 'inbox') + '</div>' +
      '<h3>' + Z.esc(o.title) + '</h3>' +
      (o.text ? '<p>' + Z.esc(o.text) + '</p>' : '') +
      (o.action || '') + '</div>';
  };
  Z.errorState = function (retryAttr) {
    return Z.empty({
      icon: 'alert', title: 'Something went wrong', text: 'Please try again.',
      action: '<button class="btn btn-tonal" ' + (retryAttr || 'data-retry') + '>Try again</button>'
    });
  };
  var BADGES = {
    pending: 'Pending', processing: 'Processing', paid: 'Paid', rejected: 'Rejected', cancelled: 'Cancelled',
    active: 'Active', suspended: 'Suspended', inactive: 'Inactive', scheduled: 'Scheduled', expired: 'Expired', live: 'Live', off: 'Off', nocode: 'No code', valid: 'Valid', invalid: 'Invalid', ongoing: 'In progress', ended: 'Ended', locked: 'Locked', transferred: 'Unlocked'
  };
  // Profile verification badge (check icon when verified)
  Z.verBadge = function (v) {
    return '<span class="badge ' + (v ? 'b-verified' : 'b-unverified') + '">' + (v ? Z.icon('check', 'bi') : '') + (v ? 'Verified' : 'Unverified') + '</span>';
  };
  Z.badge = function (s) { return '<span class="badge b-' + s + '">' + (BADGES[s] || Z.esc(s)) + '</span>'; };

  Z.field = function (o) {
    var id = o.id, attrs = o.attrs || '';
    var control;
    if (o.type === 'textarea') {
      control = '<textarea class="input ' + (o.mono ? 'mono' : '') + '" id="' + id + '" rows="' + (o.rows || 4) + '" placeholder="' + Z.esc(o.placeholder || '') + '" ' + attrs + '>' + Z.esc(o.value || '') + '</textarea>';
    } else if (o.type === 'select') {
      control = '<select class="input" id="' + id + '" ' + attrs + '>' + o.options.map(function (p) {
        return '<option value="' + Z.esc(p[0]) + '"' + (String(p[0]) === String(o.value) ? ' selected' : '') + '>' + Z.esc(p[1]) + '</option>';
      }).join('') + '</select>';
    } else {
      control = '<input class="input" id="' + id + '" type="' + (o.type || 'text') + '" value="' + Z.esc(o.value == null ? '' : o.value) + '" placeholder="' + Z.esc(o.placeholder || '') + '" ' + attrs + '>';
    }
    if (o.type === 'password') {
      control = '<div class="input-wrap">' + control + '<button type="button" class="icon-btn input-eye" data-eye="' + id + '" aria-label="Show password">' + Z.icon('eye') + '</button></div>';
    }
    return '<div class="field"><label for="' + id + '">' + Z.esc(o.label) + '</label>' + control +
      (o.hint ? '<div class="hint" id="' + id + '-hint">' + o.hint + '</div>' : '') + '</div>';
  };

  Z.switchEl = function (id, checked, label) {
    return '<label class="switch-row"><span>' + Z.esc(label) + '</span>' +
      '<span class="switch"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '><i></i></span></label>';
  };

  Z.chips = function (items, active, attr) {
    return '<div class="chips" role="tablist">' + items.map(function (it) {
      return '<button class="chip' + (it[0] === active ? ' on' : '') + '" ' + attr + '="' + it[0] + '">' + Z.esc(it[1]) + '</button>';
    }).join('') + '</div>';
  };

  // Folded history: shows the first `limit` rows, the rest sit behind a "Show N more" toggle.
  Z.fold = function (rows, opts) {
    opts = opts || {};
    var limit = opts.limit || 2, expanded = !!opts.expanded;
    if (rows.length <= limit) return rows.join('');
    var rest = rows.length - limit;
    return rows.slice(0, limit).join('') +
      '<div class="fold-more"' + (expanded ? '' : ' hidden') + '>' + rows.slice(limit).join('') + '</div>' +
      '<button type="button" class="fold-toggle" data-fold data-rest="' + rest + '" aria-expanded="' + expanded + '">' +
      '<span>' + (expanded ? 'Show less' : 'Show ' + rest + ' more') + '</span>' + Z.icon('chevron', 'fold-chev') + '</button>';
  };

  Z.copy = async function (text) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      Z.toast('Copied');
    } catch (e) { Z.toast('Could not copy', 'error'); }
  };

  Z.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); };
  };

  Z.toLocalInput = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  Z.siteUrl = function () { return window.location.origin + window.location.pathname; };

  /* ---------- Payment methods (logos are optional files next to index.html) ---------- */
  Z.methods = {
    easypaisa: { name: 'Easypaisa', img: 'easypaisa.png' },
    jazzcash: { name: 'JazzCash', img: 'jazzcash.png' }
  };
  Z.methodLogo = function (m, big) {
    var meta = Z.methods[m] || { name: m, img: '' };
    return '<span class="mlogo' + (big ? ' big' : '') + '"><b>' + Z.esc(meta.name.charAt(0)) + '</b>' +
      '<img src="' + meta.img + '" alt="" loading="lazy" onload="this.parentNode.classList.add(\'has-img\')" onerror="this.remove()"></span>';
  };

  /* ---------- Summary cache (avoids repeat requests) ---------- */
  Z.loadSummary = async function (force) {
    if (!force && Z.state.summary && Date.now() - Z.state.summaryAt < 20000) return Z.state.summary;
    var r = await sb.rpc('my_summary');
    if (r.error) throw r.error;
    Z.state.summary = r.data; Z.state.summaryAt = Date.now();
    Z.updateBalanceChip();
    if (typeof r.data.unread_notifications === 'number') {
      Z.state.unread = r.data.unread_notifications; Z.state.unreadAt = Date.now();
      if (Z.updateBell) Z.updateBell();
    }
    return r.data;
  };
  Z.invalidateSummary = function () { Z.state.summaryAt = 0; };
  Z.updateBalanceChip = function () {
    var chip = Z.$('#bar-balance'), s = Z.state.summary;
    if (s) chip.textContent = Z.money(s.balance);
  };

  // Delegated handlers shared across the app
  document.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); Z.go(go.getAttribute('data-go')); return; }
    var eye = e.target.closest('[data-eye]');
    if (eye) {
      var inp = document.getElementById(eye.getAttribute('data-eye'));
      var show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eye.innerHTML = Z.icon(show ? 'eye-off' : 'eye');
      eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      return;
    }
    var fd = e.target.closest('[data-fold]');
    if (fd) {
      var more = fd.previousElementSibling, open = more.hidden; // hidden now => about to expand
      more.hidden = !open;
      fd.setAttribute('aria-expanded', open);
      fd.firstChild.textContent = open ? 'Show less' : 'Show ' + fd.getAttribute('data-rest') + ' more';
      fd.dispatchEvent(new CustomEvent('zfold', { bubbles: true, detail: { expanded: open } }));
      return;
    }
    var cp = e.target.closest('[data-copy]');
    if (cp) Z.copy(cp.getAttribute('data-copy'));
  });
})();
