// ND Electronic Technologies Ltd — order email notifications
//
// Sends two kinds of email through Resend:
//   1. A customer confirmation, once the order is actually confirmed
//      (Cash on Delivery orders: immediately; card/mobile money orders:
//      once payment status flips to "paid").
//   2. An admin "new order" alert, once per order, the first time this
//      function ever sees it — so staff know to start preparing it even
//      before an online payment clears.
//
// How it gets called (either path works, and both are safe to fire
// together — see the *_sent_at idempotency guards below):
//   - A Supabase Database Webhook on `orders` (INSERT and UPDATE) — the
//     reliable path, since it runs server-side regardless of what the
//     customer's browser does. Set this up in the Supabase dashboard,
//     see SETUP.md.
//   - A client-side fallback call from assets/checkout.js right after an
//     order is created (COD) or right after payment verification succeeds
//     (card/mobile money) — works immediately with no dashboard setup,
//     but is skipped if the customer closes the tab first.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy send-order-notifications
// and set its secrets (see SETUP.md) before going live.

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
    // plain manual call ({ order_id: '...' }) from the client fallback.
    const orderId = body?.record?.id || body?.order_id;
    if (!orderId) return json({ error: 'Missing order id' }, 400);

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const RESEND_FROM = Deno.env.get('RESEND_FROM'); // e.g. "ND Electronic Technologies <orders@ndelectronictechnologies.com>"
    const ADMIN_NOTIFY_EMAIL = Deno.env.get('ADMIN_NOTIFY_EMAIL'); // comma-separated list allowed
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!RESEND_API_KEY || !RESEND_FROM || !ADMIN_NOTIFY_EMAIL || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Server not configured — missing secrets' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (orderErr || !order) return json({ error: 'Order not found' }, 404);

    const { data: items } = await supabase
      .from('order_items')
      .select('product_name, quantity, unit_price, line_total')
      .eq('order_id', orderId);

    const isConfirmed = order.payment_provider === 'cod' || order.status === 'paid';
    const results = { admin_sent: false, customer_sent: false };

    // ── Admin "new order" alert — once per order, as soon as it exists ──
    if (!order.admin_email_sent_at) {
      await sendEmail(RESEND_API_KEY, {
        from: RESEND_FROM,
        to: ADMIN_NOTIFY_EMAIL.split(',').map((s) => s.trim()),
        subject: `New order — ${formatUGX(order.total)} (${order.payment_provider === 'cod' ? 'Cash on Delivery' : 'Online payment'})`,
        html: adminEmailHtml(order, items || []),
      });
      await supabase.from('orders').update({ admin_email_sent_at: new Date().toISOString() }).eq('id', orderId);
      results.admin_sent = true;
    }

    // ── Customer confirmation — once the order is actually confirmed ──
    if (isConfirmed && order.customer_email && !order.customer_email_sent_at) {
      await sendEmail(RESEND_API_KEY, {
        from: RESEND_FROM,
        to: [order.customer_email],
        subject: `Order confirmed — ${formatUGX(order.total)} — ND Electronic Technologies`,
        html: customerEmailHtml(order, items || []),
      });
      await supabase.from('orders').update({ customer_email_sent_at: new Date().toISOString() }).eq('id', orderId);
      results.customer_sent = true;
    }

    return json(results, 200);
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

function formatUGX(n: number) {
  return 'UGX ' + Number(n).toLocaleString('en-UG');
}

function esc(s: unknown) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]);
}

function itemsRowsHtml(items: { product_name: string; quantity: number; line_total: number }[]) {
  return items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;">${esc(i.product_name)} × ${i.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatUGX(i.line_total)}</td>
      </tr>`
    )
    .join('');
}

function customerEmailHtml(order: Record<string, any>, items: any[]) {
  const methodLabel = order.payment_provider === 'cod' ? 'Cash on Delivery' : 'Paid online';
  return `
  <div style="font-family:Arial,sans-serif;color:#1C2321;max-width:520px;margin:0 auto;">
    <h2 style="color:#0a1628;">Thanks, ${esc(order.customer_name)} — your order is confirmed.</h2>
    <p>Reference: <strong>${esc(order.payment_tx_ref)}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">${itemsRowsHtml(items)}</table>
    <p><strong>Total: ${formatUGX(order.total)}</strong> (${methodLabel})</p>
    <p>Delivering to: ${esc(order.delivery_address)}</p>
    ${order.payment_provider === 'cod' ? '<p>Please have the exact amount ready — we\'ll contact you on your phone number to arrange delivery.</p>' : '<p>We\'ll contact you on your phone number to arrange delivery.</p>'}
    <p style="margin-top:24px;color:#788492;font-size:13px;">ND Electronic Technologies Ltd · Lukuli–Nanganda Road, Kampala, Uganda · 0704 399665</p>
  </div>`;
}

function adminEmailHtml(order: Record<string, any>, items: any[]) {
  return `
  <div style="font-family:Arial,sans-serif;color:#1C2321;max-width:520px;margin:0 auto;">
    <h2 style="color:#0a1628;">New order received</h2>
    <p><strong>${esc(order.customer_name)}</strong> · ${esc(order.customer_phone)} · ${esc(order.customer_email || 'no email')}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">${itemsRowsHtml(items)}</table>
    <p><strong>Total: ${formatUGX(order.total)}</strong> (${order.payment_provider === 'cod' ? 'Cash on Delivery — not yet paid' : 'Online payment — status: ' + esc(order.status)})</p>
    <p>Deliver to: ${esc(order.delivery_address)}</p>
    ${order.notes ? `<p>Notes: ${esc(order.notes)}</p>` : ''}
    <p style="margin-top:20px;"><a href="https://ndelectronictechnologies.com/admin/orders/" style="color:#1565c0;">View in Admin Orders →</a></p>
  </div>`;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
