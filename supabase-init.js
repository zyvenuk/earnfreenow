/* Supabase connection. The anon key is public by design; all protection is done by RLS + database functions. */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://dkqqvcfditflzfxwexma.supabase.co';
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrcXF2Y2ZkaXRmbHpmeHdleG1hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAzMzAxNDEsImV4cCI6MjEwNTkwNjE0MX0.ZsY42vkBZVt5XylysdO3wv5UHKSBnKNzFbg4_N5P9Vg';

  window.Z = window.Z || {};
  // Email links come back as #access_token=... / #error=... : keep a copy before the SDK clears it.
  window.Z.SUPABASE_URL = SUPABASE_URL; window.Z.SUPABASE_KEY = SUPABASE_ANON_KEY;
  window.Z.bootHash = window.location.hash || '';

  window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
})();
