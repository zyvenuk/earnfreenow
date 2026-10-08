/* One phone, one account.
   A web app cannot read a phone's hardware ID, so the app keeps a random device id on the phone
   (localStorage + cookie + IndexedDB, so clearing just one of them does not reset it).
   The database refuses a second account on the same device id. This is a strong deterrent, not a lock:
   clearing all site data, another browser or private mode gives the phone a new id. */
(function () {
  'use strict';
  var Z = window.Z;
  var D = Z.device = {};
  var KEY = 'zyven:did', COOKIE = 'zyven_did', ID_RE = /^[A-Za-z0-9-]{16,64}$/, cached = null;

  function readCookie() {
    var m = document.cookie.match(/(?:^|; )zyven_did=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function writeCookie(v) {
    document.cookie = COOKIE + '=' + encodeURIComponent(v) + '; max-age=315360000; path=/; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function idb(op, val) {
    return new Promise(function (resolve) {
      try {
        var rq = indexedDB.open('zyven', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
        rq.onerror = function () { resolve(null); };
        rq.onsuccess = function () {
          var db = rq.result;
          try {
            var st = db.transaction('kv', op === 'set' ? 'readwrite' : 'readonly').objectStore('kv');
            var q = op === 'set' ? st.put(val, 'did') : st.get('did');
            q.onsuccess = function () { resolve(q.result || null); db.close(); };
            q.onerror = function () { resolve(null); db.close(); };
          } catch (e) { resolve(null); }
        };
      } catch (e) { resolve(null); }
    });
  }
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16)), s = '';
    for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
    return s;
  }

  D.get = async function () {
    if (cached) return cached;
    var id = null;
    try { id = localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (!id || !ID_RE.test(id)) id = readCookie();
    if (!id || !ID_RE.test(id)) id = await idb('get');
    if (!id || !ID_RE.test(id)) id = newId();
    try { localStorage.setItem(KEY, id); } catch (e) { /* ignore */ }
    writeCookie(id); idb('set', id);       // restore every copy, so one surviving copy is enough
    cached = id;
    return id;
  };

  // Soft hint only: many phones of the same model look alike, so it is never used to block anyone
  D.fingerprint = async function () {
    var parts = [navigator.platform, navigator.hardwareConcurrency, navigator.deviceMemory, navigator.maxTouchPoints,
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth, window.devicePixelRatio,
      (Intl.DateTimeFormat().resolvedOptions() || {}).timeZone, (navigator.languages || [navigator.language]).join(',')];
    try {
      var c = document.createElement('canvas'); c.width = 200; c.height = 40;
      var x = c.getContext('2d'); x.textBaseline = 'top'; x.font = '14px Arial'; x.fillStyle = '#f60'; x.fillRect(10, 5, 80, 20);
      x.fillStyle = '#069'; x.fillText('Zyven fp 1.0 \u00e9\u00f1', 4, 12); parts.push(c.toDataURL().slice(-60));
    } catch (e) { /* ignore */ }
    try {
      var gl = document.createElement('canvas').getContext('webgl'), ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) parts.push(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch (e) { /* ignore */ }
    var h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|'))));
    return Array.prototype.map.call(h, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 40);
  };

  // Before signup: is this phone still free? (never blocks on a network problem; the check after login still applies)
  D.available = async function () {
    try {
      var r = await sb.rpc('device_available', { p_device_id: await D.get() });
      return r.error ? true : r.data !== false;
    } catch (e) { return true; }
  };

  // After login (once per browser session): attach this phone to the signed-in account
  D.register = async function () {
    var uid = Z.state.user && Z.state.user.id;
    if (!uid) return null;
    try { if (sessionStorage.getItem('zyven:devreg') === uid) return null; } catch (e) { /* ignore */ }
    try {
      var r = await sb.rpc('register_device', { p_device_id: await D.get(), p_fp: await D.fingerprint(), p_user_agent: navigator.userAgent.slice(0, 300) });
      if (r.error) return null;
      try { sessionStorage.setItem('zyven:devreg', uid); } catch (e) { /* ignore */ }
      return r.data;
    } catch (e) { console.warn('[Zyven] device', e); return null; }
  };
})();
