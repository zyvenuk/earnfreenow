/* Centralised ad placements.
   Screens only render <div class="adslot" data-slot="KEY">; the code comes from the ad_placements table
   (managed in Admin > Adsterra). Slots with no enabled code render nothing. */
(function () {
  'use strict';
  var Z = window.Z;
  var S = Z.slots = { map: {}, loadedAt: 0, inflight: null, pageInjected: false };

  S.load = function (force) {
    if (!force && Date.now() - S.loadedAt < 5 * 60 * 1000) return Promise.resolve();
    if (S.inflight) return S.inflight;
    S.inflight = sb.from('ad_placements').select('key,kind,code,frame_height,is_enabled').eq('is_enabled', true)
      .then(function (r) {
        if (r.error) { console.warn('[Zyven] placements', r.error); return; }
        var m = {};
        (r.data || []).forEach(function (p) { if (p.code && p.code.trim()) m[p.key] = p; });
        S.map = m; S.loadedAt = Date.now();
        S.injectPage();
      })
      .catch(function (e) { console.warn('[Zyven] placements', e); })
      .then(function () { S.inflight = null; });
    return S.inflight;
  };

  S.html = function (key) { return '<div class="adslot" data-slot="' + key + '"></div>'; };

  // Adsterra snippets often use protocol-relative URLs (//host/...). Force https so they load inside srcdoc frames.
  S.fixCode = function (code) {
    return String(code || '').replace(/(["'])\/\/(?=[\w-])/g, '$1https://');
  };

  S.doc = function (code) {
    code = S.fixCode(code);
    return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<base target="_blank"><style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}body{display:flex;justify-content:center}</style>' +
      '</head><body>' + code + '</body></html>';
  };

  // Renders ad code inside its own iframe (keeps multiple Adsterra banners from clashing on the shared atOptions variable).
  // allow-same-origin is required: Adsterra scripts use cookies/localStorage and render blank without it.
  S.frame = function (host, code, fallbackH, avail) {
    var w = parseInt((/['"]?width['"]?\s*:\s*(\d+)/.exec(code) || [])[1], 10) || 0;
    var h = parseInt((/['"]?height['"]?\s*:\s*(\d+)/.exec(code) || [])[1], 10) || fallbackH || 250;
    var box = document.createElement('div');
    box.className = 'adslot-box';
    var f = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    f.setAttribute('title', 'Advertisement');
    f.setAttribute('loading', 'lazy');
    f.srcdoc = S.doc(code);
    var room = avail || host.clientWidth || window.innerWidth;
    if (w) {
      var sc = Math.min(1, room / w);
      f.style.width = w + 'px'; f.style.height = h + 'px';
      f.style.transform = 'scale(' + sc + ')'; f.style.transformOrigin = 'top left';
      box.style.width = Math.round(w * sc) + 'px'; box.style.height = Math.round(h * sc) + 'px';
    } else {
      f.style.width = '100%'; f.style.height = h + 'px'; box.style.height = h + 'px';
    }
    box.appendChild(f);
    host.appendChild(box);
  };

  S.mount = function (root) {
    Z.$$('.adslot[data-slot]', root || document).forEach(function (el) {
      if (el.dataset.mounted) return;
      var p = S.map[el.dataset.slot];
      if (!p || p.kind !== 'frame') { el.remove(); return; }
      el.dataset.mounted = '1';
      el.innerHTML = '<span class="adslot-label">Advertisement</span>';
      S.frame(el, p.code, p.frame_height);
    });
  };

  // Page-wide formats (Social Bar / Popunder) must run in the main page. Admin account is excluded.
  S.injectPage = function () {
    if (S.pageInjected || Z.state.isAdmin) return;
    var p = S.map.page_script;
    if (!p || p.kind !== 'page') return;
    S.pageInjected = true;
    var tpl = document.createElement('template');
    tpl.innerHTML = p.code;
    var host = document.createElement('div');
    host.id = 'page-script-host';
    document.body.appendChild(host);
    Array.prototype.slice.call(tpl.content.childNodes).forEach(function (node) {
      if (node.nodeName === 'SCRIPT') {
        var s = document.createElement('script');
        Array.prototype.slice.call(node.attributes).forEach(function (a) { s.setAttribute(a.name, a.value); });
        s.text = node.textContent;
        host.appendChild(s);
      } else host.appendChild(node);
    });
  };

  // Convenience for views: load config (cached) then fill any slots in the rendered view.
  S.attach = function (root, ctx) {
    S.load().then(function () { if (!ctx || !ctx.stale()) S.mount(root); });
  };
})();
