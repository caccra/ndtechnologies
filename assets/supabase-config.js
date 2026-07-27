/* ND Electronic Technologies Ltd — Supabase connection config
   Fill these in after creating your Supabase project (see SETUP.md).
   Project → Settings → API → "Project URL" and "anon public" key.
   The anon key is safe to expose in browser code — it only grants what
   the Row Level Security policies in supabase/schema.sql allow. */

const SUPABASE_URL = 'https://fkwsipsnyznbxanxlpai.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_fqhIdREpKPtSExc-iJpAXQ_r4tddHfe';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
