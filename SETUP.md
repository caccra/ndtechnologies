# Shop Setup Guide

This site now has a shop: customers can browse products, pay online, and you manage
everything from an admin panel at `/admin/`. None of it works yet — it needs two free
accounts connected first. This takes about 20–30 minutes.

## What you're connecting

- **Supabase** — the database that stores your products and orders, plus the admin login.
- **Flutterwave** — the payment processor that accepts Mobile Money (MTN/Airtel) and cards.

Both have free tiers that comfortably cover a small business shop.

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → sign up → **New Project**.
2. Pick any name/region, set a database password (save it somewhere safe), wait ~2 minutes for it to spin up.
3. In the left sidebar, go to **SQL Editor** → **New query**.
4. Open `supabase/schema.sql` from this project, paste its entire contents in, and click **Run**.
   This creates the `products`, `orders`, and `order_items` tables, sets up security rules, and creates a storage bucket for product photos.
5. Go to **Settings → API**. Copy two values:
   - **Project URL**
   - **anon public** key
6. Open `assets/supabase-config.js` in this project and paste them in:
   ```js
   const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```

### Create your admin login

1. In Supabase, go to **Authentication → Users → Add user**.
2. Enter the email/password you want to use to log into `/admin/`.
3. That's it — no separate "admin" flag needed. Anyone who can sign in through Supabase Auth is treated as an admin (that's what the `authenticated` role check in `schema.sql` means). Only create accounts for people you trust with the shop.

You can now open `admin/login.html`, sign in, and add products. Product photos you upload go into the `product-images` storage bucket automatically.

---

## 2. Create your Flutterwave account (for payments)

1. Go to [flutterwave.com](https://flutterwave.com) → sign up as a business in Uganda.
2. Complete their verification (KYC) — required before you can accept **live** payments. You can build/test everything before this finishes using **Test Mode**.
3. Go to **Settings → API Keys**. In Test Mode you'll see a `FLWPUBK_TEST-...` public key and a `FLWSECK_TEST-...` secret key. Once verified for live payments, you'll get live equivalents (`FLWPUBK-...` / `FLWSECK-...`).
4. Open `assets/flutterwave-config.js` and paste in the **public** key:
   ```js
   const FLW_PUBLIC_KEY = 'FLWPUBK_TEST-xxxxxxxx';
   ```
5. **Never** put the secret key in any file in this project — it goes only into the Supabase Edge Function's secrets (next step), which runs on Supabase's servers, not in the browser.

---

## 3. Deploy the payment verification function

Why this step exists: when Flutterwave's payment popup closes, the browser says
"payment succeeded" — but a browser can be tampered with, so we don't trust that
alone. A small server-side function (an "Edge Function") re-checks the payment
directly with Flutterwave using your secret key, and only then marks the order
as paid. This function lives in `supabase/functions/verify-payment/`.

1. Install the Supabase CLI (one-time): see [supabase.com/docs/guides/cli](https://supabase.com/docs/guides/cli) for your OS.
2. In a terminal, from this project folder:
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF     (find this in your Supabase project URL)
   supabase functions deploy verify-payment
   ```
3. Set its secrets (it needs your Flutterwave **secret** key, plus the service role key so it's allowed to update orders regardless of security rules):
   ```
   supabase secrets set FLW_SECRET_KEY=FLWSECK_TEST-xxxxxxxx
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   ```
   Find the service role key in Supabase under **Settings → API → service_role** (keep this one especially private — it bypasses all security rules).
4. `SUPABASE_URL` is provided automatically by Supabase, no need to set it yourself.

---

## 4. Test it end-to-end

1. Add a product in `admin/products.html`.
2. Open `shop.html`, add it to your cart, go to `cart.html`, fill in the checkout form.
3. In the Flutterwave popup, use one of their [test cards/test Mobile Money numbers](https://developer.flutterwave.com/docs/integration-guides/testing-helpers) (only works while your keys are in Test Mode).
4. After a successful test payment, check `admin/orders.html` — the order should show status **paid** within a few seconds.

Once you're happy, switch `assets/flutterwave-config.js` and the Edge Function's
`FLW_SECRET_KEY` secret to your **live** keys (after Flutterwave finishes verifying
your business) and you're accepting real payments.

---

## Where things live

| What | Where |
|---|---|
| Product/order database, admin login | Supabase (cloud, free tier) |
| Product photos | Supabase Storage (`product-images` bucket) |
| Admin panel | `/admin/login.html`, `/admin/products.html`, `/admin/orders.html` |
| Public shop | `/shop.html`, `/product.html`, `/cart.html` |
| Payment | Flutterwave (Mobile Money + cards) |
| Payment verification | Supabase Edge Function, `supabase/functions/verify-payment` |

## Costs

- Supabase free tier: enough for a small shop (500MB database, 1GB file storage, 50k monthly active users). No card required to start.
- Flutterwave: no monthly fee, they take a percentage per successful transaction (check their current Uganda pricing on their site — it changes).
