// ND Electronic Technologies Ltd — "Request a Site Survey" lead notification
//
// Sends an admin alert through Resend the moment someone submits the
// contact-page form, so staff follow up quickly instead of the lead sitting
// unseen. Same idempotency pattern as send-order-notifications: guarded by
// admin_email_sent_at so a webhook firing twice (or racing the client-side
// fallback call) can never send the same alert twice.
//
// How it gets called (either path works, both safe together):
//   - A Supabase Database Webhook on `leads` (INSERT) — the reliable path,
//     runs server-side regardless of what the visitor's browser does after
//     submitting. Set this up in the Supabase dashboard, see SETUP.md.
//   - A client-side fallback call from assets/script.js right after the
//     lead is inserted — works immediately with no dashboard setup, but is
//     skipped if the visitor closes the tab first.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-lead-notification
// and set its secrets (see SETUP.md): RESEND_API_KEY / RESEND_FROM are
// shared with send-order-notifications, but LEADS_NOTIFY_EMAIL is its own
// setting — set it to sales@ndelectronictechnologies.com so site-survey
// requests always land there, independent of wherever order alerts go.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    // Accept either a Database Webhook payload ({ record: {...} }) or a
    // plain manual call ({ lead_id: '...' }) from the client fallback.
    const leadId = body?.record?.id || body?.lead_id;
    if (!leadId) return json({ error: 'Missing lead id' }, 400);

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const RESEND_FROM = Deno.env.get('RESEND_FROM');
    // Deliberately separate from ADMIN_NOTIFY_EMAIL (used by
    // send-order-notifications) — site-survey leads always go to sales,
    // independent of whatever order alerts are configured to use. Falls
    // back to ADMIN_NOTIFY_EMAIL only if LEADS_NOTIFY_EMAIL was never set,
    // so this doesn't hard-break for anyone who deployed before this split.
    const LEADS_NOTIFY_EMAIL = Deno.env.get('LEADS_NOTIFY_EMAIL') || Deno.env.get('ADMIN_NOTIFY_EMAIL');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!RESEND_API_KEY || !RESEND_FROM || !LEADS_NOTIFY_EMAIL || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Server not configured — missing secrets' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();
    if (leadErr || !lead) return json({ error: 'Lead not found' }, 404);

    if (lead.admin_email_sent_at) {
      return json({ status: 'already_sent' }, 200);
    }

    await sendEmail(RESEND_API_KEY, {
      from: RESEND_FROM,
      to: LEADS_NOTIFY_EMAIL.split(',').map((s) => s.trim()),
      subject: `New site survey request — ${esc(lead.first_name)} ${esc(lead.last_name)} (${esc(lead.service)})`,
      html: adminEmailHtml(lead),
    });
    await supabase.from('leads').update({ admin_email_sent_at: new Date().toISOString() }).eq('id', leadId);

    return json({ status: 'sent' }, 200);
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500);
  }
});

async function sendEmail(apiKey: string, payload: Record<string, unknown>) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${text}`);
  }
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

function adminEmailHtml(lead: Record<string, any>) {
  return `
  <div style="font-family:Arial,sans-serif;color:#1C2321;max-width:520px;margin:0 auto;">
    <h2 style="color:#0a1628;">New site survey request</h2>
    <p><strong>${esc(lead.first_name)} ${esc(lead.last_name)}</strong></p>
    <p>Phone: <a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>${lead.email ? ` · Email: <a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : ''}</p>
    <p>Interested in: <strong>${esc(lead.service)}</strong></p>
    <p>Property location: ${esc(lead.location)}</p>
    ${lead.message ? `<p>Message: ${esc(lead.message)}</p>` : ''}
    <p style="margin-top:20px;color:#788492;font-size:13px;">Submitted via the website contact form.</p>
  </div>`;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
