/* Online users counter: Supabase Realtime Presence, one shared channel, nothing stored in the database.
   - Normal users join the channel after login and announce themselves ONCE. Their presence key is a hash of
     their user id, so several tabs/devices of one person are one key, and nobody else can read an account id.
   - The admin only listens, and only while the dashboard is open (the channel is removed when leaving it).
     The count is the number of distinct keys, updated by Presence events (no polling, no queries).
   - The admin widget never shows a made-up number: it says "connecting" until the first real Presence sync arrives,
     and "unavailable" if the channel cannot be joined.
   - If joining keeps failing, a user's app backs off (1, 2, 4 ... 10 minutes) instead of retrying every few seconds. */
(function () {
  'use strict';
  var Z = window.Z;
  var O = Z.online = { ch: null, mode: null, fails: 0, backoff: 60000, retryTimer: null };
  var CHANNEL = 'zyven-online';
  var MAX_FAILS = 3, MAX_BACKOFF = 600000, SYNC_WAIT = 10000;

  async function userKey(uid) {
    var h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('zyven-online:' + uid)));
    return Array.prototype.map.call(h, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('').slice(0, 32);
  }

  function drop() {
    if (O.ch) { try { sb.removeChannel(O.ch); } catch (e) { /* already closed */ } }   // leaving also removes our presence
    O.ch = null; O.mode = null;
  }
  function clearRetry() { if (O.retryTimer) { clearTimeout(O.retryTimer); O.retryTimer = null; } }

  // Users: join and announce once. On a reconnect the channel re-subscribes and we announce again (same key = still one user).
  O.start = async function () {
    if (O.ch || !Z.state.user || Z.state.isAdmin) return;
    var key;
    try { key = await userKey(Z.state.user.id); } catch (e) { return; }
    if (O.ch || !Z.state.user) return;                 // logged out / started twice while hashing
    var ch = sb.channel(CHANNEL, { config: { private: true, presence: { key: key } } });
    O.ch = ch; O.mode = 'track';
    ch.subscribe(function (status) {
      if (O.ch !== ch) return;                          // an old channel we already dropped
      if (status === 'SUBSCRIBED') { O.fails = 0; O.backoff = 60000; ch.track({ on: 1 }); return; }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (++O.fails < MAX_FAILS) return;              // the library retries on its own a couple of times
        drop();                                         // keeps failing: stop hammering the server, try again later
        var wait = O.backoff; O.backoff = Math.min(O.backoff * 2, MAX_BACKOFF);
        clearRetry();
        O.retryTimer = setTimeout(function () { O.retryTimer = null; O.fails = 0; O.start(); }, wait);
      }
    });
  };

  // Admin dashboard: listen only. onState(count, status) with status 'connecting' | 'live' | 'error'.
  // count is a number only when status is 'live'. Z.online.release() (called on every route change) cleans up.
  O.watch = function (onState) {
    drop(); clearRetry();
    var ch = sb.channel(CHANNEL, { config: { private: true } });
    var synced = false, dog = null;
    function emit(count, status) { if (O.ch === ch) onState(count, status); }
    O.ch = ch; O.mode = 'watch';
    onState(null, 'connecting');
    ch.on('presence', { event: 'sync' }, function () {
      synced = true; clearTimeout(dog);
      emit(Object.keys(ch.presenceState()).length, 'live');   // one entry per distinct user key
    });
    ch.subscribe(function (status) {
      if (O.ch !== ch) return;
      if (status === 'SUBSCRIBED') {
        clearTimeout(dog);
        if (!synced) dog = setTimeout(function () { if (!synced) emit(null, 'error'); }, SYNC_WAIT);   // joined but no answer
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        synced = false; clearTimeout(dog);
        emit(null, 'error');                                  // the library keeps retrying; a later SUBSCRIBED + sync turns it live again
      }
    });
  };

  // Drop the admin's listening channel as soon as the dashboard is left
  O.release = function () { if (O.mode === 'watch') drop(); };

  // Logout / session ended
  O.stop = function () { drop(); clearRetry(); O.fails = 0; O.backoff = 60000; };
})();
