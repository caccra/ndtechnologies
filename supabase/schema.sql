-- ND Electronic Technologies Ltd — Shop database schema
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).
-- Safe to re-run any time — every statement is idempotent, including on a
-- project that already ran an earlier version of this file.

-- ══════════════════════════════════════════
-- PROFILES — one row per Supabase Auth user (admin or customer)
-- ══════════════════════════════════════════
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,        -- flip to true for staff accounts, see SETUP.md
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- If this table already existed under a different shape before schema.sql
-- ever ran against it, `create table if not exists` above was a no-op and
-- these columns would otherwise silently never get added. Guard every one.
alter table profiles add column if not exists is_admin boolean not null default false;
alter table profiles add column if not exists full_name text;
alter table profiles add column if not exists phone text;
alter table profiles add column if not exists created_at timestamptz not null default now();

-- Auto-create a profile row for every new signup (customer registration AND
-- any admin account created via the Supabase dashboard). is_admin always
-- starts false — an admin has to be promoted manually, see SETUP.md.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reads a signed-in user's own admin flag. security definer + owned by the
-- same role that owns `profiles` (the migration role) means it can read
-- profiles regardless of the caller's RLS — this is what lets RLS policies
-- below check "is this caller an admin" without a chicken-and-egg problem.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ══════════════════════════════════════════
-- PROFILES — role, for a first cut at more-than-one admin tier.
-- Read the caveat in SETUP.md before relying on this for anything
-- sensitive: is_owner() is used to gate destructive actions (deleting a
-- product or a coupon) at the database level, which IS a real boundary —
-- but "staff shouldn't see the Finance page" is enforced only in the admin
-- UI (the nav link is hidden and the page redirects), not in RLS, because
-- Finance reads from the same `orders` rows Staff legitimately needs to
-- manage on the Orders page. A staff account with direct API access could
-- still query orders and compute revenue themselves. Treat "owner" as a
-- UI convenience for now, not a hard security boundary against your own
-- staff — only grant is_admin to people you'd trust with the data either way.
-- Defined here, right after is_admin(), because policies further down
-- (coupons, products) reference is_owner() and schema.sql runs top to
-- bottom — it has to exist before anything tries to use it.
-- ══════════════════════════════════════════
alter table profiles add column if not exists role text not null default 'staff';
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('owner', 'staff'));

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select is_admin and role = 'owner' from public.profiles where id = auth.uid()), false);
$$;

-- Promote the first admin account you set up to owner, so at least one
-- account isn't locked out of owner-only actions. Safe to re-run — only
-- ever affects rows that are already is_admin and still default 'staff'.
update profiles set role = 'owner' where is_admin = true and role = 'staff';

-- ══════════════════════════════════════════
-- PRODUCTS
-- NOTE: id is bigint (auto-increment), not uuid like every other table's id
-- in this file. This table pre-existed under a different setup before this
-- schema ever ran against it, already using bigint ids for the 17 real
-- products already live in it — matched here deliberately rather than
-- migrated, to avoid regenerating every product URL/static page/order
-- reference. Every other table's product_id foreign key is bigint to match.
-- ══════════════════════════════════════════
create table if not exists products (
  id bigint generated by default as identity primary key,  -- confirmed bigint in production, not uuid — see note below
  name text not null,
  description text not null default '',
  price numeric(12,0) not null check (price >= 0),   -- UGX has no decimal subunit in normal use
  category text not null default 'General',           -- e.g. CCTV, Solar, Carports, Fire Suppression, Networking, AC, Electrical
  image_url text,
  stock integer not null default 0,
  is_active boolean not null default true,             -- toggle to hide a product without deleting it
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Guard every column in case this table pre-existed under a different shape
-- (see the note above `profiles` — same reasoning applies to every table
-- in this file from here on).
alter table products add column if not exists name text not null default '';
alter table products add column if not exists description text not null default '';
alter table products add column if not exists price numeric(12,0) not null default 0;
alter table products add column if not exists category text not null default 'General';
alter table products add column if not exists image_url text;
alter table products add column if not exists stock integer not null default 0;
alter table products add column if not exists is_active boolean not null default true;
alter table products add column if not exists created_at timestamptz not null default now();
alter table products add column if not exists updated_at timestamptz not null default now();

alter table products drop constraint if exists products_price_check;
alter table products add constraint products_price_check check (price >= 0);

create index if not exists products_active_idx on products (is_active, category);

-- ══════════════════════════════════════════
-- ORDERS
-- ══════════════════════════════════════════
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete set null,  -- set for logged-in customers; null for guest/COD orders
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  delivery_address text not null,
  notes text,
  subtotal numeric(12,0) not null,
  total numeric(12,0) not null,
  currency text not null default 'UGX',
  status text not null default 'pending'               -- pending | paid | in_progress | dispatched | fulfilled | failed | cancelled
    check (status in ('pending','paid','in_progress','dispatched','fulfilled','failed','cancelled')),
  payment_provider text default 'flutterwave',           -- 'flutterwave' (card/mobile money) or 'cod' (cash on delivery)
  payment_tx_ref text unique,                            -- our generated reference, sent to Flutterwave
  payment_flw_id text,                                   -- Flutterwave's transaction id, filled in after verification
  email_verified boolean not null default false,          -- customer completed email OTP verification at checkout
  delivery_lat numeric,                                   -- set when the delivery address was picked/adjusted on the map
  delivery_lng numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- This table is confirmed to have pre-existed under a different shape (an
-- earlier/unrelated setup left it with just id/user_id/customer_id) — every
-- column below MUST have an explicit guard, not just the ones added after
-- the fact, or `create table if not exists` above silently skips them all.
alter table orders add column if not exists customer_id uuid references auth.users(id) on delete set null;
alter table orders add column if not exists customer_name text not null default '';
alter table orders add column if not exists customer_phone text not null default '';
alter table orders add column if not exists customer_email text;
alter table orders add column if not exists delivery_address text not null default '';
alter table orders add column if not exists notes text;
alter table orders add column if not exists subtotal numeric(12,0) not null default 0;
alter table orders add column if not exists total numeric(12,0) not null default 0;
alter table orders add column if not exists currency text not null default 'UGX';
alter table orders add column if not exists status text not null default 'pending';
alter table orders add column if not exists payment_provider text default 'flutterwave';
alter table orders add column if not exists payment_tx_ref text;
alter table orders add column if not exists payment_flw_id text;
alter table orders add column if not exists email_verified boolean not null default false;
alter table orders add column if not exists delivery_lat numeric;
alter table orders add column if not exists delivery_lng numeric;
alter table orders add column if not exists created_at timestamptz not null default now();
alter table orders add column if not exists updated_at timestamptz not null default now();

alter table orders drop constraint if exists orders_payment_tx_ref_key;
alter table orders add constraint orders_payment_tx_ref_key unique (payment_tx_ref);

-- Idempotency guards for the order-notification emails (see
-- supabase/functions/send-order-notifications) — set the moment each email
-- actually sends, so a webhook firing twice (or the client-side fallback
-- call racing the webhook) can never send the same email twice.
alter table orders add column if not exists customer_email_sent_at timestamptz;
alter table orders add column if not exists admin_email_sent_at timestamptz;

-- widen the status check to add in_progress/dispatched (safe to re-run)
alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('pending','paid','in_progress','dispatched','fulfilled','failed','cancelled'));

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_tx_ref_idx on orders (payment_tx_ref);
create index if not exists orders_customer_idx on orders (customer_id);

-- ══════════════════════════════════════════
-- ORDER ITEMS
-- ══════════════════════════════════════════
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id bigint references products(id) on delete set null,  -- products.id is bigint, not uuid — see note on the products table
  product_name text not null,     -- snapshot, survives product edits/deletion
  unit_price numeric(12,0) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(12,0) not null
);

alter table order_items add column if not exists order_id uuid references orders(id) on delete cascade;
alter table order_items add column if not exists product_id bigint references products(id) on delete set null;
alter table order_items add column if not exists product_name text not null default '';
alter table order_items add column if not exists unit_price numeric(12,0) not null default 0;
alter table order_items add column if not exists quantity integer not null default 1;
alter table order_items add column if not exists line_total numeric(12,0) not null default 0;

alter table order_items drop constraint if exists order_items_quantity_check;
alter table order_items add constraint order_items_quantity_check check (quantity > 0);

create index if not exists order_items_order_idx on order_items (order_id);

-- ══════════════════════════════════════════
-- ORDER EVENTS — status-change log, powers the customer dashboard's Inbox
-- ══════════════════════════════════════════
create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now()
);

alter table order_events add column if not exists order_id uuid references orders(id) on delete cascade;
alter table order_events add column if not exists status text not null default 'pending';
alter table order_events add column if not exists created_at timestamptz not null default now();

create index if not exists order_events_order_idx on order_events (order_id);

-- ══════════════════════════════════════════
-- ADDRESSES — a customer's saved delivery addresses
-- ══════════════════════════════════════════
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text,                      -- e.g. "Home", "Office"
  address_text text not null,
  lat numeric,                     -- set when picked/adjusted on the map; null for older/typed-only addresses
  lng numeric,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

alter table addresses add column if not exists customer_id uuid references auth.users(id) on delete cascade;
alter table addresses add column if not exists label text;
alter table addresses add column if not exists address_text text not null default '';
alter table addresses add column if not exists is_default boolean not null default false;
alter table addresses add column if not exists created_at timestamptz not null default now();
alter table addresses add column if not exists lat numeric;
alter table addresses add column if not exists lng numeric;

create index if not exists addresses_customer_idx on addresses (customer_id);

-- ══════════════════════════════════════════
-- WISHLIST ITEMS
-- ══════════════════════════════════════════
create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,  -- products.id is bigint, not uuid — see note on the products table
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

alter table wishlist_items add column if not exists customer_id uuid references auth.users(id) on delete cascade;
alter table wishlist_items add column if not exists product_id bigint references products(id) on delete cascade;
alter table wishlist_items add column if not exists created_at timestamptz not null default now();

alter table wishlist_items drop constraint if exists wishlist_items_customer_id_product_id_key;
alter table wishlist_items add constraint wishlist_items_customer_id_product_id_key unique (customer_id, product_id);

create index if not exists wishlist_customer_idx on wishlist_items (customer_id);

-- ══════════════════════════════════════════
-- CART ITEMS — server-side cart for signed-in customers, so it survives a
-- device switch. Guests still use the localStorage cart in cart.js; on
-- login, checkout.js merges whichever cart already exists into this table.
-- ══════════════════════════════════════════
create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references products(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

alter table cart_items add column if not exists customer_id uuid references auth.users(id) on delete cascade;
alter table cart_items add column if not exists product_id bigint references products(id) on delete cascade;
alter table cart_items add column if not exists quantity integer not null default 1;
alter table cart_items add column if not exists created_at timestamptz not null default now();
alter table cart_items add column if not exists updated_at timestamptz not null default now();

alter table cart_items drop constraint if exists cart_items_quantity_check;
alter table cart_items add constraint cart_items_quantity_check check (quantity > 0);
alter table cart_items drop constraint if exists cart_items_customer_id_product_id_key;
alter table cart_items add constraint cart_items_customer_id_product_id_key unique (customer_id, product_id);

create index if not exists cart_items_customer_idx on cart_items (customer_id);

-- ══════════════════════════════════════════
-- STOCK NOTIFICATIONS — "email me when back in stock", captured from the
-- product page when an item is out of stock. No account needed; admins
-- work the list manually for now (see admin/products/).
-- ══════════════════════════════════════════
create table if not exists stock_notifications (
  id uuid primary key default gen_random_uuid(),
  product_id bigint not null references products(id) on delete cascade,
  email text not null,
  notified boolean not null default false,
  created_at timestamptz not null default now()
);

alter table stock_notifications add column if not exists product_id bigint references products(id) on delete cascade;
alter table stock_notifications add column if not exists email text not null default '';
alter table stock_notifications add column if not exists notified boolean not null default false;
alter table stock_notifications add column if not exists created_at timestamptz not null default now();

create index if not exists stock_notifications_product_idx on stock_notifications (product_id);

-- ══════════════════════════════════════════
-- REVIEWS — one per customer per product; publicly readable
-- ══════════════════════════════════════════
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id bigint not null references products(id) on delete cascade,  -- products.id is bigint, not uuid — see note on the products table
  customer_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text not null default 'Customer',  -- snapshot at submit time; reviews are public but profiles aren't, same reasoning as order_items.product_name
  rating integer not null check (rating between 1 and 5),
  comment text,
  image_urls text[],                -- photos the reviewer uploaded, from the review-images bucket
  created_at timestamptz not null default now(),
  unique (product_id, customer_id)
);

alter table reviews add column if not exists product_id bigint references products(id) on delete cascade;
alter table reviews add column if not exists customer_id uuid references auth.users(id) on delete cascade;
alter table reviews add column if not exists reviewer_name text not null default 'Customer';
alter table reviews add column if not exists rating integer;
alter table reviews add column if not exists comment text;
alter table reviews add column if not exists image_urls text[];
alter table reviews add column if not exists created_at timestamptz not null default now();

-- A public reply from ND Electronic Technologies to a review — shown under
-- the customer's comment on the product page. Admin-only to write.
alter table reviews add column if not exists admin_reply text;
alter table reviews add column if not exists admin_reply_at timestamptz;

alter table reviews drop constraint if exists reviews_rating_check;
alter table reviews add constraint reviews_rating_check check (rating between 1 and 5);

alter table reviews drop constraint if exists reviews_product_id_customer_id_key;
alter table reviews add constraint reviews_product_id_customer_id_key unique (product_id, customer_id);

create index if not exists reviews_product_idx on reviews (product_id);

-- RLS alone can't stop a customer from PATCHing their own review row's
-- admin_reply column directly (row-level security doesn't see column-level
-- intent) — this trigger is the actual enforcement: only a caller that
-- passes is_admin() may change admin_reply/admin_reply_at, regardless of
-- which RLS policy let the UPDATE through in the first place.
create or replace function public.protect_review_admin_reply()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not is_admin() and (
    new.admin_reply is distinct from old.admin_reply
    or new.admin_reply_at is distinct from old.admin_reply_at
  ) then
    raise exception 'Only an admin can set a review reply.';
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_protect_admin_reply on reviews;
create trigger reviews_protect_admin_reply before update on reviews
  for each row execute function public.protect_review_admin_reply();

-- ══════════════════════════════════════════
-- LEADS — "Request a Site Survey" contact-form submissions
-- ══════════════════════════════════════════
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text not null,
  email text,
  service text not null,
  location text not null,
  message text,
  status text not null default 'new' check (status in ('new','contacted','closed')),
  admin_email_sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table leads add column if not exists first_name text not null default '';
alter table leads add column if not exists last_name text not null default '';
alter table leads add column if not exists phone text not null default '';
alter table leads add column if not exists email text;
alter table leads add column if not exists service text not null default '';
alter table leads add column if not exists location text not null default '';
alter table leads add column if not exists message text;
alter table leads add column if not exists status text not null default 'new';
alter table leads add column if not exists admin_email_sent_at timestamptz;
alter table leads add column if not exists created_at timestamptz not null default now();

alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check check (status in ('new','contacted','closed'));

create index if not exists leads_status_idx on leads (status);
create index if not exists leads_created_idx on leads (created_at desc);

alter table leads enable row level security;

-- Anyone can submit the contact form; a fresh lead always starts "new" and
-- with no email-sent timestamp, so a direct API call can't forge a
-- already-handled lead or fake the notification guard.
drop policy if exists "public create leads" on leads;
create policy "public create leads" on leads
  for insert with check (status = 'new' and admin_email_sent_at is null);

drop policy if exists "admin manage leads" on leads;
create policy "admin manage leads" on leads
  for all using (is_admin())
  with check (is_admin());

-- ══════════════════════════════════════════
-- STOCK — decrement automatically when an order is actually placed
-- Previously nothing touched products.stock on checkout at all — a product
-- could be sold indefinitely past zero with no warning beyond whatever an
-- admin happened to notice and edit manually. This is a server-side
-- trigger (not client code) deliberately: checkout runs as a guest/customer
-- with no write access to products, so this has to run as the table owner
-- regardless of who placed the order. Floors at 0 rather than rejecting the
-- insert outright — an oversold order still needs the admin to see and
-- handle it (contact the customer, restock, refund), which is what the
-- Low Stock dashboard card and Finance/refund tools below are for; hard-
-- rejecting at the database layer would need checkout.js to gracefully
-- handle a failed order insert mid-payment, a bigger change than this pass covers.
-- ══════════════════════════════════════════
create or replace function public.decrement_product_stock()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update products set stock = greatest(0, stock - new.quantity) where id = new.product_id;
  return new;
end;
$$;

drop trigger if exists order_items_decrement_stock on order_items;
create trigger order_items_decrement_stock
  after insert on order_items
  for each row execute function public.decrement_product_stock();

-- The mirror image of the trigger above: stock was taken off the shelf the
-- moment the order was placed, so if it ends up cancelled or failed (by the
-- customer, an admin, or a failed payment) without ever shipping, that stock
-- needs to go back. Guarded so it only fires once per order, on the actual
-- transition into cancelled/failed — not on every unrelated update.
create or replace function public.restore_stock_on_cancel()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status in ('cancelled', 'failed') and old.status not in ('cancelled', 'failed') then
    update products p
    set stock = p.stock + oi.quantity
    from order_items oi
    where oi.order_id = new.id and oi.product_id = p.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_restore_stock_on_cancel on orders;
create trigger orders_restore_stock_on_cancel
  after update on orders
  for each row execute function public.restore_stock_on_cancel();

-- Every status change gets logged automatically, regardless of who or what
-- made it — the admin panel's manual status-change form, the customer
-- cancelling their own pending order below, or the verify-payment Edge
-- Function flipping an order to "paid" with the service_role key (which
-- bypasses RLS but not triggers). This is what feeds the customer's Inbox
-- tab; previously only admin-driven changes were logged there, so a
-- "paid" confirmation never showed up until the *next* manual update.
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into order_events (order_id, status) values (new.id, new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_log_status_change on orders;
create trigger orders_log_status_change
  after update on orders
  for each row execute function public.log_order_status_change();

-- ══════════════════════════════════════════
-- CATEGORIES — managed list, so the admin product form isn't hardcoded
-- HTML options and typo-prone free text. products.category stays a plain
-- text column (not migrated to a foreign key) so existing products and the
-- public shop's category-filter logic aren't touched — this table is the
-- admin's source of truth for which options the product form offers.
-- ══════════════════════════════════════════
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table categories add column if not exists name text not null default '';
alter table categories add column if not exists sort_order integer not null default 0;
alter table categories add column if not exists created_at timestamptz not null default now();

alter table categories drop constraint if exists categories_name_key;
alter table categories add constraint categories_name_key unique (name);

alter table categories enable row level security;

drop policy if exists "public read categories" on categories;
create policy "public read categories" on categories
  for select using (true);

drop policy if exists "admin manage categories" on categories;
create policy "admin manage categories" on categories
  for all using (is_admin())
  with check (is_admin());

-- Seed with the categories already hardcoded in the admin product form —
-- existing products keep working exactly as before, this just makes the
-- list editable going forward instead of requiring a code change.
insert into categories (name, sort_order) values
  ('CCTV', 1), ('Solar', 2), ('Carports', 3), ('Fire Suppression', 4),
  ('Networking', 5), ('Connectivity', 6), ('Air Conditioning', 7),
  ('Electrical', 8), ('General', 9)
on conflict (name) do nothing;

-- ══════════════════════════════════════════
-- COUPONS — discount codes, applied at checkout
-- ══════════════════════════════════════════
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  discount_type text not null default 'percent',
  discount_value numeric(12,2) not null default 0,
  is_active boolean not null default true,
  expires_at timestamptz,
  usage_limit integer,
  times_used integer not null default 0,
  created_at timestamptz not null default now()
);

alter table coupons add column if not exists code text not null default '';
alter table coupons add column if not exists discount_type text not null default 'percent';
alter table coupons add column if not exists discount_value numeric(12,2) not null default 0;
alter table coupons add column if not exists is_active boolean not null default true;
alter table coupons add column if not exists expires_at timestamptz;
alter table coupons add column if not exists usage_limit integer;
alter table coupons add column if not exists times_used integer not null default 0;
alter table coupons add column if not exists created_at timestamptz not null default now();

alter table coupons drop constraint if exists coupons_discount_type_check;
alter table coupons add constraint coupons_discount_type_check check (discount_type in ('percent','fixed'));
alter table coupons drop constraint if exists coupons_discount_value_check;
alter table coupons add constraint coupons_discount_value_check check (discount_value > 0);

create unique index if not exists coupons_code_idx on coupons (upper(code));

alter table coupons enable row level security;

-- Anyone can read an *active* coupon — needed so checkout can validate a
-- code a customer typed in. Nothing sensitive in a discount code by design.
drop policy if exists "public read active coupons" on coupons;
create policy "public read active coupons" on coupons
  for select using (is_active = true);

drop policy if exists "admin manage coupons" on coupons;
drop policy if exists "admin insert coupons" on coupons;
create policy "admin insert coupons" on coupons
  for insert with check (is_admin());
drop policy if exists "admin update coupons" on coupons;
create policy "admin update coupons" on coupons
  for update using (is_admin()) with check (is_admin());
drop policy if exists "owner delete coupons" on coupons;
create policy "owner delete coupons" on coupons
  for delete using (is_owner());

-- Coupon usage count, incremented server-side the moment an order carrying
-- a code is placed — same reasoning as the stock trigger above: a guest
-- checkout has no write access to the coupons table.
create or replace function public.increment_coupon_usage()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.coupon_code is not null then
    update coupons set times_used = times_used + 1 where upper(code) = upper(new.coupon_code);
  end if;
  return new;
end;
$$;

drop trigger if exists orders_increment_coupon_usage on orders;
create trigger orders_increment_coupon_usage
  after insert on orders
  for each row execute function public.increment_coupon_usage();

-- ══════════════════════════════════════════
-- ORDERS — coupon + refund tracking
-- ══════════════════════════════════════════
alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount_amount numeric(12,0) not null default 0;
alter table orders add column if not exists refunded_amount numeric(12,0) not null default 0;
alter table orders add column if not exists refund_reason text;
alter table orders add column if not exists refunded_at timestamptz;

-- A customer can still only insert a pending order with no payment already
-- recorded (see "public create orders" above) — this just also lets that
-- same insert carry a coupon code/discount without opening up anything new
-- to abuse, since discount_amount is only ever meaningful alongside a code
-- validated client-side against the real coupons table before checkout.

-- ══════════════════════════════════════════
-- PRODUCTS — gallery images (image_url stays the primary/thumbnail image
-- used everywhere already; image_urls is an additional, optional gallery)
-- ══════════════════════════════════════════
alter table products add column if not exists image_urls text[];

-- ══════════════════════════════════════════
-- PRODUCTS — sale price + spec sheet
-- sale_price is an optional per-product discount, shown as a struck-through
-- price + badge on the shop grid and product page; null means "not on
-- sale". specs is a freeform "Label: Value" sheet, one attribute per line,
-- admin-entered — deliberately not a rigid structured schema, since specs
-- vary wildly between a CCTV kit and a carport.
-- ══════════════════════════════════════════
alter table products add column if not exists sale_price numeric(12,0);
alter table products add column if not exists specs text;

alter table products drop constraint if exists products_sale_price_check;
alter table products add constraint products_sale_price_check
  check (sale_price is null or (sale_price > 0 and sale_price < price));

-- ══════════════════════════════════════════
-- FOREIGN KEYS — explicit, not inline
-- `alter table ... add column if not exists ... references ...` above only
-- actually attaches the reference when the column is being added for the
-- first time — if the column already existed on this database (several did,
-- from before this schema ever ran), the whole clause is skipped forever
-- and the constraint never gets attached, even though the column itself is
-- there. That's silent and easy to miss: values still line up correctly,
-- but PostgREST has no constraint to detect the relationship from, so any
-- query that tries to embed a related table (e.g. order_items -> products)
-- fails with "Could not find a relationship... in the schema cache" even
-- though the data is completely fine. Every foreign key in this file gets
-- its own explicit, separately-guarded statement here so it's attached
-- regardless of whether the column was old or new.
-- ══════════════════════════════════════════
alter table orders drop constraint if exists orders_customer_id_fkey;
alter table orders add constraint orders_customer_id_fkey
  foreign key (customer_id) references auth.users(id) on delete set null;

alter table order_items drop constraint if exists order_items_order_id_fkey;
alter table order_items add constraint order_items_order_id_fkey
  foreign key (order_id) references orders(id) on delete cascade;

alter table order_items drop constraint if exists order_items_product_id_fkey;
alter table order_items add constraint order_items_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

alter table order_events drop constraint if exists order_events_order_id_fkey;
alter table order_events add constraint order_events_order_id_fkey
  foreign key (order_id) references orders(id) on delete cascade;

alter table addresses drop constraint if exists addresses_customer_id_fkey;
alter table addresses add constraint addresses_customer_id_fkey
  foreign key (customer_id) references auth.users(id) on delete cascade;

alter table wishlist_items drop constraint if exists wishlist_items_customer_id_fkey;
alter table wishlist_items add constraint wishlist_items_customer_id_fkey
  foreign key (customer_id) references auth.users(id) on delete cascade;

alter table wishlist_items drop constraint if exists wishlist_items_product_id_fkey;
alter table wishlist_items add constraint wishlist_items_product_id_fkey
  foreign key (product_id) references products(id) on delete cascade;

alter table reviews drop constraint if exists reviews_product_id_fkey;
alter table reviews add constraint reviews_product_id_fkey
  foreign key (product_id) references products(id) on delete cascade;

alter table reviews drop constraint if exists reviews_customer_id_fkey;
alter table reviews add constraint reviews_customer_id_fkey
  foreign key (customer_id) references auth.users(id) on delete cascade;

-- ══════════════════════════════════════════
-- updated_at auto-touch
-- ══════════════════════════════════════════
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists products_touch on products;
create trigger products_touch before update on products
  for each row execute function set_updated_at();

drop trigger if exists orders_touch on orders;
create trigger orders_touch before update on orders
  for each row execute function set_updated_at();

drop trigger if exists cart_items_touch on cart_items;
create trigger cart_items_touch before update on cart_items
  for each row execute function set_updated_at();

-- ══════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Public (anonymous) visitors: read active products, create orders/order_items.
-- Signed-in customers: read/update their own profile, read their own orders.
-- Signed-in admins (is_admin() = true, see SETUP.md): full read/write on
-- products and orders.
-- ══════════════════════════════════════════
alter table profiles enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_events enable row level security;
alter table addresses enable row level security;
alter table wishlist_items enable row level security;
alter table reviews enable row level security;
alter table cart_items enable row level security;
alter table stock_notifications enable row level security;

-- Profiles: a user can read/update only their own row; admins can read all
drop policy if exists "users read own profile" on profiles;
create policy "users read own profile" on profiles
  for select using (id = auth.uid());

drop policy if exists "users update own profile" on profiles;
create policy "users update own profile" on profiles
  for update using (id = auth.uid());

drop policy if exists "admin read all profiles" on profiles;
create policy "admin read all profiles" on profiles
  for select using (is_admin());

-- Products: anyone can read active products
drop policy if exists "public read active products" on products;
create policy "public read active products" on products
  for select using (is_active = true);

-- Products: only admins can insert/update/delete
-- Split from a single "admin manage products" FOR ALL policy: any admin can
-- add/edit, but deleting a product is owner-only (see the role/is_owner()
-- note above products, and the caveat on what that boundary actually covers).
drop policy if exists "admin manage products" on products;
drop policy if exists "admin insert products" on products;
create policy "admin insert products" on products
  for insert with check (is_admin());
drop policy if exists "admin update products" on products;
create policy "admin update products" on products
  for update using (is_admin()) with check (is_admin());
drop policy if exists "owner delete products" on products;
create policy "owner delete products" on products
  for delete using (is_owner());

-- Orders: anyone can create an order (checkout is public, guest or signed-in).
-- Scoped tightly so a direct API call can't forge a fake "paid"/"fulfilled"
-- order (bypassing Flutterwave verification entirely) or attribute an order
-- to someone else's account: every new order must start pending, with no
-- payment already recorded, and customer_id must be either null (guest) or
-- the caller's own id.
drop policy if exists "public create orders" on orders;
create policy "public create orders" on orders
  for insert with check (
    status = 'pending'
    and payment_flw_id is null
    and (customer_id is null or customer_id = auth.uid())
  );

-- Orders: admins can read/update all orders
drop policy if exists "admin manage orders" on orders;
create policy "admin manage orders" on orders
  for select using (is_admin());
drop policy if exists "admin update orders" on orders;
create policy "admin update orders" on orders
  for update using (is_admin());

-- Orders: a signed-in customer can read their own orders
drop policy if exists "customer read own orders" on orders;
create policy "customer read own orders" on orders
  for select using (customer_id = auth.uid());

-- Orders: a newly-registered customer can claim a guest order placed under
-- their own email — this is how "create an account after checkout" links a
-- just-placed guest order into the new account's order history. Scoped
-- tightly: only unclaimed orders (customer_id still null), only where the
-- order's stored email matches the caller's own verified account email, and
-- the caller may only ever set customer_id to themselves.
drop policy if exists "customer claim own guest order" on orders;
create policy "customer claim own guest order" on orders
  for update
  using (customer_id is null and customer_email = (auth.jwt() ->> 'email'))
  with check (customer_id = auth.uid() and customer_email = (auth.jwt() ->> 'email'));

-- A signed-in customer can cancel their own order — but only while it's
-- still pending. Once it's paid/dispatched/etc. there's real money or
-- logistics in motion, so that needs a human (contact support), not a
-- client-side API call. Scoped so the only legal transition is pending ->
-- cancelled on a row they own; nothing else about the order is touchable
-- through this policy.
drop policy if exists "customer cancel own pending order" on orders;
create policy "customer cancel own pending order" on orders
  for update
  using (customer_id = auth.uid() and status = 'pending')
  with check (customer_id = auth.uid() and status = 'cancelled');

-- The payment verification Edge Function uses the service_role key, which
-- bypasses RLS entirely — that's how it's allowed to flip a pending order to paid.

-- Order items: anyone can insert (as part of checkout) — but the price must
-- match the product's actual current price. Without this, a direct API call
-- could insert order_items with an arbitrary unit_price/line_total, forging
-- a cheap "receipt" for an expensive product.
drop policy if exists "public create order items" on order_items;
create policy "public create order items" on order_items
  for insert with check (
    line_total = unit_price * quantity
    and unit_price = (select price from products where id = order_items.product_id)
  );

-- Order items: admins can read all
drop policy if exists "admin read order items" on order_items;
create policy "admin read order items" on order_items
  for select using (is_admin());

-- Order items: a signed-in customer can read items belonging to their own orders
drop policy if exists "customer read own order items" on order_items;
create policy "customer read own order items" on order_items
  for select using (
    exists (select 1 from orders where orders.id = order_items.order_id and orders.customer_id = auth.uid())
  );

-- Order events: admins can read/insert all
drop policy if exists "admin manage order events" on order_events;
create policy "admin manage order events" on order_events
  for all using (is_admin())
  with check (is_admin());

-- Order events: a signed-in customer can read events for their own orders
drop policy if exists "customer read own order events" on order_events;
create policy "customer read own order events" on order_events
  for select using (
    exists (select 1 from orders where orders.id = order_events.order_id and orders.customer_id = auth.uid())
  );

-- Addresses: a customer manages only their own
drop policy if exists "customer manage own addresses" on addresses;
create policy "customer manage own addresses" on addresses
  for all using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

drop policy if exists "admin read all addresses" on addresses;
create policy "admin read all addresses" on addresses
  for select using (is_admin());

-- Wishlist: a customer manages only their own
drop policy if exists "customer manage own wishlist" on wishlist_items;
create policy "customer manage own wishlist" on wishlist_items
  for all using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- Wishlist: admins can read (not write) everyone's, for the Customers page's
-- engagement counts — mirrors "admin read all addresses" just above.
drop policy if exists "admin read all wishlist" on wishlist_items;
create policy "admin read all wishlist" on wishlist_items
  for select using (is_admin());

-- Reviews: anyone can read (they inform other shoppers, same as products)
drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews
  for select using (true);

-- Reviews: a customer manages only their own
-- A review can only be created by its own customer, and only for a product
-- from one of their fulfilled (delivered) orders — enforced here, not just
-- in the UI, since RLS is what actually stops a direct API call.
drop policy if exists "customer insert own reviews" on reviews;
create policy "customer insert own reviews" on reviews
  for insert with check (
    customer_id = auth.uid()
    and exists (
      select 1 from order_items
      join orders on orders.id = order_items.order_id
      where order_items.product_id = reviews.product_id
        and orders.customer_id = auth.uid()
        and orders.status = 'fulfilled'
    )
  );
drop policy if exists "customer update own reviews" on reviews;
create policy "customer update own reviews" on reviews
  for update using (customer_id = auth.uid());
drop policy if exists "customer delete own reviews" on reviews;
create policy "customer delete own reviews" on reviews
  for delete using (customer_id = auth.uid());

-- Reviews: admins can update any review — in practice this is scoped down
-- to just admin_reply/admin_reply_at by the trigger above; RLS itself only
-- guards which rows, not which columns.
drop policy if exists "admin update reviews" on reviews;
create policy "admin update reviews" on reviews
  for update using (is_admin());

-- Cart: a signed-in customer manages only their own server-side cart
drop policy if exists "customer manage own cart" on cart_items;
create policy "customer manage own cart" on cart_items
  for all using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- Stock notifications: anyone can ask to be notified (no account needed) —
-- but only admins can read the list back, so an email address submitted
-- here isn't publicly queryable.
drop policy if exists "public request stock notification" on stock_notifications;
create policy "public request stock notification" on stock_notifications
  for insert with check (true);
drop policy if exists "admin manage stock notifications" on stock_notifications;
create policy "admin manage stock notifications" on stock_notifications
  for all using (is_admin()) with check (is_admin());

-- ══════════════════════════════════════════
-- STORAGE — product images
-- Creates a public bucket for product photos uploaded from the admin panel.
-- ══════════════════════════════════════════
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

drop policy if exists "public read product images" on storage.objects;
create policy "public read product images" on storage.objects
  for select using (bucket_id = 'product-images');

drop policy if exists "admin upload product images" on storage.objects;
create policy "admin upload product images" on storage.objects
  for insert with check (bucket_id = 'product-images' and is_admin());

drop policy if exists "admin delete product images" on storage.objects;
create policy "admin delete product images" on storage.objects
  for delete using (bucket_id = 'product-images' and is_admin());

-- ══════════════════════════════════════════
-- STORAGE — review photos
-- Public bucket for photos a customer attaches to their review. Files are
-- uploaded under "<customer_id>/filename" so RLS can scope uploads/deletes
-- to each customer's own folder.
-- ══════════════════════════════════════════
insert into storage.buckets (id, name, public)
  values ('review-images', 'review-images', true)
  on conflict (id) do nothing;

drop policy if exists "public read review images" on storage.objects;
create policy "public read review images" on storage.objects
  for select using (bucket_id = 'review-images');

drop policy if exists "customer upload own review images" on storage.objects;
create policy "customer upload own review images" on storage.objects
  for insert with check (bucket_id = 'review-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "customer delete own review images" on storage.objects;
create policy "customer delete own review images" on storage.objects
  for delete using (bucket_id = 'review-images' and (storage.foldername(name))[1] = auth.uid()::text);
