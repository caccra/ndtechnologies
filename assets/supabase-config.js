/* ND Electronic Technologies Ltd — Supabase connection config
   Fill these in after creating your Supabase project (see SETUP.md).
   Project → Settings → API → "Project URL" and "anon public" key.
   The anon key is safe to expose in browser code — it only grants what
   the Row Level Security policies in supabase/schema.sql allow. */

const SUPABASE_URL = 'https://fkwsipsnyznbxanxlpai.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fqhIdREpKPtSExc-iJpAXQ_r4tddHfe';

/* Customer accounts run on Clerk (see SETUP.md section 10); the admin panel
   stays on Supabase's own Auth, unchanged. Two clients, one job each:

   - supabaseAuthClient: a plain client, no accessToken override. Used ONLY
     for native Supabase Auth itself — admin login/session/sign-out, and
     checkout's guest email-verification codes. supabase-js hard-blocks
     EVERY `.auth.*` method (not just getSession — getSession, getUser,
     signInWithPassword, signOut, all of it) on a client configured with a
     custom accessToken option, replacing `.auth` with a proxy that throws
     on any property access at all. So native auth needs its own client.
   - supabaseClient: used for every actual data call (.from/.storage/
     .functions) everywhere, admin and customer pages alike. accessToken is
     asked for on every request, and it tries Clerk's session token first
     (present only on pages that loaded assets/clerk-config.js and where a
     customer is actually signed in), falling back to supabaseAuthClient's
     native session otherwise — which is what admin pages, and any
     signed-out visitor, always used and still get. */
const supabaseAuthClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  accessToken: async () => {
    try {
      if (window.Clerk && window.Clerk.session) {
        const token = await window.Clerk.session.getToken();
        if (token) return token;
      }
    } catch {
      // fall through to the native Supabase session below
    }
    const { data: { session } } = await supabaseAuthClient.auth.getSession();
    return session ? session.access_token : null;
  },
});
