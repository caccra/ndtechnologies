# Shop Setup Guide

This site now has a shop: customers can browse products, optionally register an
account or check out as a guest, verify their email address, pay online or choose
Cash on Delivery, and you manage everything from an admin panel at `/admin/`. None
of it works yet — it needs two free accounts connected first. This takes about
20–30 minutes.

## What you're connecting

- **Supabase** — the database that stores your products and orders, the admin login, and the customer email-verification codes sent at checkout (Supabase sends these itself — no separate email service needed to get started).
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

Customers can now register their own accounts too (see section 2 below), so
admin access is a deliberate flag, not just "anyone who can sign in" —
**this step is required**, or the account you create in step 2 will be able
to log into `/admin/` but see an empty, permission-denied dashboard.

1. In Supabase, go to **Authentication → Users → Add user**.
2. Enter the email/password you want to use to log into `/admin/`.
3. Go to **SQL Editor → New query**, and run this (replace the email):
   ```sql
   update profiles set is_admin = true
   where id = (select id from auth.users where email = 'your-admin-email@example.com');
   ```
4. Only run this for people you trust with the shop — anyone with `is_admin = true` can see every order and every customer, and can add/edit/delete products.

You can now open `admin/login.html`, sign in, and add products. Product photos you upload go into the `product-images` storage bucket automatically.

---

## 2. Customer accounts — works out of the box

Customers can register at `/account/register/` and log into a dashboard at
`/account/` to see their order history and account details — no extra setup
needed, it uses the same Supabase project as everything else. Guest checkout
(no account) still works too; registering is optional for customers.

A few things worth knowing:
- Password reset emails go through the same Supabase email sender as the checkout verification codes in section 4 — the same Custom SMTP setup covers both.
- A customer's account and a guest checkout are kept separate on purpose: an order only shows up in a customer's dashboard if they were logged in when they placed it.
- Admin access is controlled separately (the `is_admin` flag above) — registering an account never grants access to `/admin/`.

---

## 3. Create your Flutterwave account (for payments)

1. Go to [flutterwave.com](https://flutterwave.com) → sign up as a business in Uganda.
2. Complete their verification (KYC) — required before you can accept **live** payments. You can build/test everything before this finishes using **Test Mode**.
3. Go to **Settings → API Keys**. In Test Mode you'll see a `FLWPUBK_TEST-...` public key and a `FLWSECK_TEST-...` secret key. Once verified for live payments, you'll get live equivalents (`FLWPUBK-...` / `FLWSECK-...`).
4. Open `assets/flutterwave-config.js` and paste in the **public** key:
   ```js
   const FLW_PUBLIC_KEY = 'FLWPUBK_TEST-xxxxxxxx';
   ```
5. **Never** put the secret key in any file in this project — it goes only into the Supabase Edge Function's secrets (next step), which runs on Supabase's servers, not in the browser.

---

## 4. Email verification at checkout — works out of the box

Before paying, customers verify their email with a 6-digit code — this catches
typos/fake addresses before you commit to delivering an order. It's built on
Supabase's built-in email OTP (`assets/checkout.js`), which needs no extra setup:
Supabase's default email sender starts working the moment your project exists.

That default sender is rate-limited (a handful of emails per hour) and meant for
testing, not real customer traffic. Before going live, connect a real email
provider so codes actually reach every customer:

1. In Supabase: **Project Settings → Authentication → SMTP Settings** → enable **Custom SMTP**.
2. Fill in credentials from an email-sending service — [Resend](https://resend.com), [Brevo](https://www.brevo.com), or [SendGrid](https://sendgrid.com) all have free tiers that comfortably cover a small shop's order volume.
3. Save, then send yourself a test checkout to confirm the code arrives.

Notes:
- While testing with the default sender, verification codes only land reliably in the inbox you signed up to Supabase with — some providers also rate-limit or delay mail to other addresses.
- The verification code is a one-off contact check, not a customer login — no passwords, no account dashboard. The session it briefly creates is discarded right after verifying, so it never gains admin-level access to your Supabase data.

---

## 5. Deploy the payment verification function

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

## 6. Test it end-to-end

1. Add a product in `admin/products.html`.
2. Open `shop.html`, add it to your cart, go to `cart.html`, and fill in the delivery details (optionally register/log in first at `/account/register/` to have the order linked to your account).
3. Enter the 6-digit code sent to your email (while on the default Supabase sender, check the inbox you signed up to Supabase with).
4. Pick a payment method:
   - **Cash on Delivery** — skips online payment entirely; the order is created and shows up in `admin/orders.html` as pending, ready to mark **Fulfilled** once delivered and paid.
   - **Mobile Money / Card** — the Flutterwave popup opens. Use one of their [test cards/test Mobile Money numbers](https://developer.flutterwave.com/docs/integration-guides/testing-helpers) (only works while your keys are in Test Mode).
5. After a successful test payment, check `admin/orders.html` — the order should show status **paid** within a few seconds.

Once you're happy, switch `assets/flutterwave-config.js` and the Edge Function's
`FLW_SECRET_KEY` secret to your **live** keys (after Flutterwave finishes verifying
your business) and you're accepting real payments.

---

## Where things live

| What | Where |
|---|---|
| Product/order database, admin login | Supabase (cloud, free tier) |
| Product photos | Supabase Storage (`product-images` bucket) |
| Admin panel | `/admin/login.html`, `/admin/products.html`, `/admin/orders.html`, `/admin/customers.html` |
| Customer accounts | `/account/register.html`, `/account/login.html`, `/account/` (dashboard) |
| Public shop & checkout | `/shop.html`, `/product.html`, `/cart.html` (`assets/checkout.js`) |
| Email verification (OTP) | Supabase Auth (built-in, or Custom SMTP for production) |
| Payment | Flutterwave (Mobile Money + cards) or Cash on Delivery |
| Payment verification | Supabase Edge Function, `supabase/functions/verify-payment` |

## Costs

- Supabase free tier: enough for a small shop (500MB database, 1GB file storage, 50k monthly active users). No card required to start.
- Flutterwave: no monthly fee, they take a percentage per successful transaction (check their current Uganda pricing on their site — it changes).
- Email sending (Resend/Brevo/SendGrid): free tiers cover thousands of emails a month, comfortably enough for verification codes at small-shop volume. Cash on Delivery orders don't need Flutterwave at all, just email verification.
