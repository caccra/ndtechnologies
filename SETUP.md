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

## 6. Order confirmation & admin notification emails

Once an order is placed, two emails go out automatically: a confirmation to
the customer (once it's actually confirmed — immediately for Cash on
Delivery, or once payment clears for Mobile Money/card), and a "new order"
alert to you, so you know to start preparing it. This is separate from the
checkout verification code in section 4 — that's Supabase's own auth email
sender; these are proper order emails sent through Resend, a dedicated
transactional email service.

1. Go to [resend.com](https://resend.com) → sign up (free tier: 3,000 emails/month, comfortably enough for a small shop).
2. **Domains → Add Domain** → add `ndelectronictechnologies.com` and follow their DNS verification steps (adds a couple of DNS records at wherever your domain is registered). Until this is verified, you can still test using Resend's shared `onboarding@resend.dev` sender address.
3. **API Keys → Create API Key** → copy it (starts with `re_`).
4. Deploy the function and set its secrets:
   ```
   supabase functions deploy send-order-notifications
   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
   supabase secrets set RESEND_FROM="ND Electronic Technologies <orders@ndelectronictechnologies.com>"
   supabase secrets set ADMIN_NOTIFY_EMAIL=info@ndelectronictechnologies.com,sales@ndelectronictechnologies.com
   ```
   (`RESEND_FROM` must use your verified domain from step 2 — use `onboarding@resend.dev` there instead if you're still testing before DNS verification finishes. `ADMIN_NOTIFY_EMAIL` accepts one address or several, comma-separated.)
5. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are the same ones you already set for `verify-payment` in step 5 — no need to set them again for this function.

This already works via a fallback call built into `assets/checkout.js` — no
further setup required to start receiving emails. For a more reliable setup
that doesn't depend on the customer's browser staying open (recommended
before relying on this for real orders):

6. In Supabase: **Database → Webhooks → Create a new webhook**.
7. Create one for **INSERT** on the `orders` table, and another for **UPDATE** on the `orders` table — both calling the `send-order-notifications` Edge Function. (The function figures out on its own what's changed and whether an email is actually due — see the comments at the top of `supabase/functions/send-order-notifications/index.ts`.)

---

## 7. Test it end-to-end

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

## 8. Google Maps address picker (optional)

At checkout and in the Address Book, customers can search for their address
and drag a pin to fine-tune the exact delivery spot. Without this step the
address field still works as a plain text box — it just won't show a map.

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project (or use an existing one).
2. **APIs & Services → Library** → enable **Maps JavaScript API** and **Places API**.
3. **APIs & Services → Credentials → Create Credentials → API Key**.
4. Click the new key → under **Application restrictions**, choose **Websites** and add your domain (e.g. `ndelectronictechnologies.com/*`). Under **API restrictions**, limit it to the two APIs above.
5. Open `assets/maps-config.js` and paste in the key:
   ```js
   const GOOGLE_MAPS_API_KEY = 'AIzaSy...';
   ```
6. Google requires a billing card on file to create the key, even though a small shop's map usage stays well within the free monthly credit (Google currently gives $200/month free, and each map load/search is a fraction of a cent).

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
| Order confirmation &amp; admin alert emails | Resend, via Supabase Edge Function `supabase/functions/send-order-notifications` |
| Address map picker | Google Maps JavaScript API + Places API (`assets/maps-config.js`, `assets/address-map.js`) |

## Costs

- Supabase free tier: enough for a small shop (500MB database, 1GB file storage, 50k monthly active users). No card required to start.
- Flutterwave: no monthly fee, they take a percentage per successful transaction (check their current Uganda pricing on their site — it changes).
- Email sending (Resend for order/admin emails, or Resend/Brevo/SendGrid for the Custom SMTP verification codes): free tiers cover thousands of emails a month, comfortably enough for a small shop's order and verification volume combined. Cash on Delivery orders don't need Flutterwave at all, just the order-confirmation email.
- Google Maps: requires a billing card, but the $200/month free credit comfortably covers a small shop's checkout/address-book map usage.
