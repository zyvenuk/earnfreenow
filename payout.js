/* Payout: request form + history. The database reserves the amount; admin pays manually. */
(function () {
  'use strict';
  var Z = window.Z;
  var PAGE = 10;

  var STATUS_TEXT = {
    pending: 'Waiting for review',
    processing: 'Approved, being processed',
    paid: 'Paid',
    rejected: 'Rejected',
    cancelled: 'Cancelled'
  };

  function calcFee(amount, st) {
    return Math.round((amount * Number(st.fee_percent) / 100 + Number(st.fee_fixed)) * 100) / 100;
  }
  function normNumber(v) {
    v = String(v || '').replace(/[\s\-]/g, '');
    if (/^\+92\d{10}$/.test(v)) v = '0' + v.slice(3);
    else if (/^92\d{10}$/.test(v)) v = '0' + v.slice(2);
    return v;
  }

  function line(k, v) { return '<div class="kv"><span>' + k + '</span><b>' + v + '</b></div>'; }

  Z.payoutItem = function (p, opts) {
    var m = Z.methods[p.method] || { name: p.method };
    return '<div class="payout" data-id="' + p.id + '">' +
      '<button class="row row-btn p-head" data-toggle>' +
      Z.methodLogo(p.method) +
      '<span class="row-main"><span class="row-title">' + m.name + ' \u00b7 ' + Z.money(p.amount) + '</span>' +
      '<span class="row-sub">' + Z.fmtDate(p.created_at) + '</span></span>' + Z.badge(p.status) + '</button>' +
      '<div class="p-body" hidden>' +
      line('Status', STATUS_TEXT[p.status] || p.status) +
      line('Requested amount', Z.money(p.amount)) +
      line('Fee', Z.money(p.fee)) +
      line('You receive', Z.money(p.net_amount)) +
      line('Account holder', Z.esc(p.account_name)) +
      line('Account number', Z.esc(p.account_number)) +
      line('Submitted', Z.fmtDate(p.created_at)) +
      (p.processed_at ? line(p.status === 'paid' ? 'Paid on' : 'Updated', Z.fmtDate(p.processed_at)) : '') +
      (p.payment_reference ? line('Reference', Z.esc(p.payment_reference)) : '') +
      (p.reject_reason ? '<div class="alert a-error">' + Z.icon('info') + '<div><b>Reason:</b> ' + Z.esc(p.reject_reason) + '</div></div>' : '') +
      (p.status === 'pending' && !(opts && opts.readonly) ? '<button class="btn btn-danger-ghost btn-block" data-cancel>Cancel request</button>' : '') +
      '</div></div>';
  };

  Z.views.payout = async function (el, ctx) {
    var s = await Z.loadSummary(true);
    var st = Z.state.settings;
    if (ctx.stale()) return;

    var hist = [], histDone = false, histLoading = false, histExpanded = false;
    var method = null;
    var min = Number(st.min_payout);
    var pBlocked = Z.maint.active('payout');   // payout maintenance: history stays visible, new requests are closed
    var canRequest = st.payouts_enabled && s.status === 'active' && !pBlocked;

    el.innerHTML = '<section class="page">' +
      '<div class="card info-card"><div class="ic-line"><span>Available balance</span><b id="avail">' + Z.money(s.balance) + '</b></div>' +
      '<div class="ic-line small"><span>Minimum payout</span><b>' + Z.money(min) + '</b></div>' +
      ((Number(st.fee_percent) > 0 || Number(st.fee_fixed) > 0) ? '<div class="ic-line small"><span>Fee</span><b>' +
        [Number(st.fee_percent) > 0 ? Number(st.fee_percent) + '%' : '', Number(st.fee_fixed) > 0 ? Z.money(st.fee_fixed) : ''].filter(Boolean).join(' + ') + '</b></div>' : '') +
      '</div>' +
      Z.maint.notices(['payout']) +
      (!st.payouts_enabled ? '<div class="alert a-warn">' + Z.icon('alert') + '<div>Payouts are paused right now. Please check back later.</div></div>' : '') +
      (s.status !== 'active' ? '<div class="alert a-error">' + Z.icon('alert') + '<div>Your account is suspended, so payouts are unavailable.</div></div>' : '') +
      '<div class="section-head"' + (pBlocked ? ' hidden' : '') + '><h3>Request a payout</h3></div>' +
      '<form class="card form" id="pf" novalidate' + (pBlocked ? ' hidden' : '') + '>' +
      '<div class="field"><label>Payout method</label><div class="method-grid" id="methods">' +
      ['easypaisa', 'jazzcash'].map(function (k) {
        return '<button type="button" class="method" data-m="' + k + '" aria-pressed="false">' + Z.methodLogo(k, true) + '<span>' + Z.methods[k].name + '</span></button>';
      }).join('') + '</div></div>' +
      '<div id="fields" hidden>' +
      Z.field({ id: 'acc-name', label: 'Account holder\u2019s name', placeholder: 'Name on the account', attrs: 'autocomplete="off" maxlength="60"' }) +
      Z.field({ id: 'acc-no', label: 'Account number', placeholder: '03XXXXXXXXX', attrs: 'inputmode="tel" autocomplete="off" maxlength="16"' }) +
      Z.field({ id: 'amt', label: 'Amount', placeholder: '0.00', attrs: 'inputmode="decimal" autocomplete="off"', hint: '<span id="amt-hint"></span>' }) +
      '<button type="button" class="link-btn" id="max">Use full balance</button>' +
      '<div class="summary" id="sum"></div>' +
      '</div>' +
      '<div id="perr"></div>' +
      '<button class="btn btn-primary btn-block" type="submit" id="submit" disabled>Request payout</button>' +
      '</form>' +
      (st.payout_notice ? '<div class="alert a-info">' + Z.icon('info') + '<div>' + Z.esc(st.payout_notice) + '</div></div>' : '') +
      '<div class="section-head"><h3>Your requests</h3></div>' +
      '<div id="hist">' + Z.skel(2, 64) + '</div><div id="hmore"></div></section>';

    var form = Z.$('#pf', el), fields = Z.$('#fields', el), submit = Z.$('#submit', el);
    var nameEl = Z.$('#acc-name', el), numEl = Z.$('#acc-no', el), amtEl = Z.$('#amt', el);

    function state() {
      var amount = parseFloat(String(amtEl.value).replace(/,/g, ''));
      var num = normNumber(numEl.value), name = nameEl.value.trim();
      var fee = isFinite(amount) ? calcFee(amount, st) : 0;
      var problem = '';
      if (!isFinite(amount) || amount <= 0) problem = '';
      else if (amount < min) problem = 'Minimum payout is ' + Z.money(min) + '.';
      else if (amount > Number(s.balance)) problem = 'That is more than your available balance.';
      else if (fee >= amount) problem = 'Amount is too low to cover the fee.';
      var valid = !!method && canRequest && name.length >= 3 && /^03\d{9}$/.test(num) && isFinite(amount) && amount > 0 && !problem;
      return { amount: amount, num: num, name: name, fee: fee, problem: problem, valid: valid };
    }
    function refresh() {
      var x = state();
      Z.$('#amt-hint', el).textContent = x.problem;
      Z.$('#amt-hint', el).className = x.problem ? 'err-text' : '';
      var ok = isFinite(x.amount) && x.amount > 0;
      Z.$('#sum', el).innerHTML = ok && method ?
        line('Method', Z.methods[method].name) + line('Requested amount', Z.money(x.amount)) + line('Fee', Z.money(x.fee)) +
        '<div class="kv total"><span>You receive</span><b>' + Z.money(Math.max(0, x.amount - x.fee)) + '</b></div>' : '';
      submit.disabled = !x.valid;
    }
    [nameEl, numEl, amtEl].forEach(function (i) { i.addEventListener('input', refresh); });
    Z.$('#max', el).addEventListener('click', function () { amtEl.value = Number(s.balance).toFixed(2); refresh(); });

    Z.$('#methods', el).addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      method = b.getAttribute('data-m');
      Z.$$('.method', el).forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
      fields.hidden = false;
      var last = hist.filter(function (p) { return p.method === method; })[0];
      if (last) {
        if (!nameEl.value) nameEl.value = last.account_name;
        if (!numEl.value) numEl.value = last.account_number;
      }
      refresh();
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var x = state(); if (!x.valid) return;
      var ok = await Z.confirm({
        title: 'Confirm payout request',
        html: '<div class="summary">' + line('Method', Z.methods[method].name) + line('Account holder', Z.esc(x.name)) + line('Account number', Z.esc(x.num)) +
          line('Requested amount', Z.money(x.amount)) + line('Fee', Z.money(x.fee)) +
          '<div class="kv total"><span>You receive</span><b>' + Z.money(x.amount - x.fee) + '</b></div></div>' +
          '<p class="muted small">The amount is taken from your balance now. Our team sends the money manually. If the request is rejected or cancelled, it is returned.</p>',
        confirm: 'Submit request'
      });
      if (!ok) return;
      Z.run(submit, async function () {
        var r = await sb.rpc('request_payout', { p_method: method, p_account_name: x.name, p_account_number: x.num, p_amount: x.amount });
        if (r.error) throw r.error;
        Z.toast('Payout request submitted', 'ok');
        amtEl.value = '';
        Z.invalidateSummary();
        s = await Z.loadSummary(true);
        Z.$('#avail', el).textContent = Z.money(s.balance);
        refresh();
        loadHist(true);
      }, Z.$('#perr', el));
    });

    /* History */
    var histEl = Z.$('#hist', el), hmore = Z.$('#hmore', el);
    async function loadHist(reset) {
      if (histLoading) return; histLoading = true;
      if (reset) { hist = []; histDone = false; }
      var r = await sb.from('payout_requests').select('*').order('created_at', { ascending: false }).range(hist.length, hist.length + PAGE - 1);
      histLoading = false;
      if (ctx.stale()) return;
      if (r.error) { histEl.innerHTML = Z.errorState(); Z.$('[data-retry]', histEl).addEventListener('click', function () { loadHist(true); }); return; }
      hist = hist.concat(r.data || []);
      histDone = (r.data || []).length < PAGE;
      var open = Z.$$('.payout:not(.closed) .p-body:not([hidden])', histEl).map(function (b) { return b.parentNode.getAttribute('data-id'); });
      histEl.innerHTML = hist.length ? '<div class="card">' + Z.fold(hist.map(function (p) { return Z.payoutItem(p); }), { expanded: histExpanded }) + '</div>' :
        Z.empty({ icon: 'payout', title: 'No payout requests', text: 'Your requests and their status will appear here.' });
      open.forEach(function (id) { var b = Z.$('.payout[data-id="' + id + '"] .p-body', histEl); if (b) b.hidden = false; });
      renderHistMore();
    }
    // "Load more" (server paging) only appears once the folded list is expanded
    function renderHistMore() {
      hmore.innerHTML = histDone || !hist.length || !histExpanded ? '' : '<button class="btn btn-tonal btn-block" id="hm">Load more</button>';
      var hm = Z.$('#hm', hmore);
      if (hm) hm.addEventListener('click', function () { Z.busy(hm, true); loadHist(false); });
    }
    histEl.addEventListener('zfold', function (e) { histExpanded = e.detail.expanded; renderHistMore(); });
    histEl.addEventListener('click', async function (e) {
      var t = e.target.closest('[data-toggle]');
      if (t) { var b = t.parentNode.querySelector('.p-body'); b.hidden = !b.hidden; return; }
      var c = e.target.closest('[data-cancel]');
      if (c) {
        var id = c.closest('.payout').getAttribute('data-id');
        if (!await Z.confirm({ title: 'Cancel this request?', text: 'The amount will be returned to your balance.', confirm: 'Cancel request', cancel: 'Keep it', danger: true })) return;
        Z.run(c, async function () {
          var r = await sb.rpc('cancel_payout', { p_id: id });
          if (r.error) throw r.error;
          Z.toast('Request cancelled. Balance returned.', 'ok');
          Z.invalidateSummary();
          s = await Z.loadSummary(true);
          Z.$('#avail', el).textContent = Z.money(s.balance);
          refresh(); loadHist(true);
        });
      }
    });
    loadHist(true);
  };
})();
