/* Online users counter: Supabase Realtime Presence, one shared channel, nothing stored in the database.
   - Normal users join the channel after login and announce themselves ONCE. Their presence key is a hash of
     their user id, so several tabs/devices of one person are one key, and nobody else can read an account id.
   - The admin only listens, and only while the dashboard is open (the channel is removed when leaving it).
     The count is the number of distinct keys, updated by Presence events (no polling, no queries). */
(function () {
  'use strict';
  var Z = window.Z;
  var O = Z.online = { ch: null, mode: null };
  var CHANNEL = 'zyven-online';

  async function userKey(uid) {
    var h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('zyven-online:' + uid)));
    return Array.prototype.map.call(h, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 32);
  }

  function drop() {
    if (O.ch) { try { sb.removeChannel(O.ch); } catch (e) { /* already closed */ } }   // leaving also removes our presence
    O.ch = null; O.mode = null;
  }

  // Users: join and announce once. On a reconnect the channel re-subscribes and we announce again (same key = still one user).
  O.start = async function () {
    if (O.ch || !Z.state.user || Z.state.isAdmin) return;
    var key;
    try { key = await userKey(Z.state.user.id); } catch (e) { return; }
    if (O.ch || !Z.state.user) return;                 // logged out / started twice while hashing
    var ch = sb.channel(CHANNEL, { config: { private: true, presence: { key: key } } });
    O.ch = ch; O.mode = 'track';
    ch.subscribe(function (status) {
      if (status === 'SUBSCRIBED') ch.track({ on: 1 });
    });
  };

  // Admin dashboard: listen only. Returns nothing to clean up by hand; Z.online.release() (called on every route change) does it.
  O.watch = function (onCount) {
    drop();
    var ch = sb.channel(CHANNEL, { config: { private: true } });
    ch.on('presence', { event: 'sync' }, function () {
      onCount(Object.keys(ch.presenceState()).length);   // one entry per distinct user key
    });
    ch.subscribe();
    O.ch = ch; O.mode = 'watch';
  };

  // Drop the admin's listening channel as soon as the dashboard is left
  O.release = function () { if (O.mode === 'watch') drop(); };

  // Logout / session ended
  O.stop = function () { drop(); };
})();
