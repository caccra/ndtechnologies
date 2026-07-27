// ND Electronic Technologies Ltd — payment verification Edge Function
//
// Why this exists: the browser tells us "payment succeeded" after the
// Flutterwave popup closes, but a browser can lie (or be tampered with).
// This function re-checks the transaction directly with Flutterwave's
// servers using the SECRET key (which never touches the browser), and
// only then marks the order as paid. Deploy with the Supabase CLI:
//   supabase functions deploy verify-payment
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
    const { tx_ref, transaction_id } = await req.json();
    if (!tx_ref || !transaction_id) {
      return json({ error: 'Missing tx_ref or transaction_id' }, 400);
    }

    const FLW_SECRET_KEY = Deno.env.get('FLW_SECRET_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!FLW_SECRET_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: 'Server not configured — missing secrets' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Look up the order we created at checkout time
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, total, currency, status')
      .eq('payment_tx_ref', tx_ref)
      .single();
    if (orderErr || !order) return json({ error: 'Order not found' }, 404);

    if (order.status === 'paid') {
      return json({ status: 'already_paid' }, 200);
    }

    // Verify directly with Flutterwave using the SECRET key (server-side only)
    const flwRes = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` } }
    );
    const flwJson = await flwRes.json();
    const tx = flwJson?.data;

    const isValid =
      flwJson?.status === 'success' &&
      tx?.status === 'successful' &&
      tx?.tx_ref === tx_ref &&
      tx?.currency === order.currency &&
      Number(tx?.amount) >= Number(order.total);

    if (!isValid) {
      await supabase.from('orders').update({ status: 'failed' }).eq('id', order.id);
      return json({ error: 'Payment could not be verified', flw: tx?.status }, 402);
    }

    await supabase
      .from('orders')
      .update({ status: 'paid', payment_flw_id: String(transaction_id) })
      .eq('id', order.id);

    return json({ status: 'paid' }, 200);
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
