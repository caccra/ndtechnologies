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
-- PRODUCTS
-- ══════════════════════════════════════════
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders add column if not exists payment_provider text default 'flutterwave';
alter table orders add column if not exists email_verified boolean not null default false;
alter table orders add column if not exists customer_id uuid references auth.users(id) on delete set null;

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
  product_id uuid references products(id) on delete set null,
  product_name text not null,     -- snapshot, survives product edits/deletion
  unit_price numeric(12,0) not null,
  quantity integer not null check (quantity > 0),
  line_total numeric(12,0) not null
);

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

create index if not exists order_events_order_idx on order_events (order_id);

-- ══════════════════════════════════════════
-- ADDRESSES — a customer's saved delivery addresses
-- ══════════════════════════════════════════
create table if not exists addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  label text,                      -- e.g. "Home", "Office"
  address_text text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists addresses_customer_idx on addresses (customer_id);

-- ══════════════════════════════════════════
-- WISHLIST ITEMS
-- ══════════════════════════════════════════
create table if not exists wishlist_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

create index if not exists wishlist_customer_idx on wishlist_items (customer_id);

-- ══════════════════════════════════════════
-- REVIEWS — one per customer per product; publicly readable
-- ══════════════════════════════════════════
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text not null default 'Customer',  -- snapshot at submit time; reviews are public but profiles aren't, same reasoning as order_items.product_name
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now(),
  unique (product_id, customer_id)
);

create index if not exists reviews_product_idx on reviews (product_id);

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
drop policy if exists "admin manage products" on products;
create policy "admin manage products" on products
  for all using (is_admin())
  with check (is_admin());

-- Orders: anyone can create an order (checkout is public, guest or signed-in)
drop policy if exists "public create orders" on orders;
create policy "public create orders" on orders
  for insert with check (true);

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

-- The payment verification Edge Function uses the service_role key, which
-- bypasses RLS entirely — that's how it's allowed to flip a pending order to paid.

-- Order items: anyone can insert (as part of checkout)
drop policy if exists "public create order items" on order_items;
create policy "public create order items" on order_items
  for insert with check (true);

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

-- Reviews: anyone can read (they inform other shoppers, same as products)
drop policy if exists "public read reviews" on reviews;
create policy "public read reviews" on reviews
  for select using (true);

-- Reviews: a customer manages only their own
drop policy if exists "customer insert own reviews" on reviews;
create policy "customer insert own reviews" on reviews
  for insert with check (customer_id = auth.uid());
drop policy if exists "customer update own reviews" on reviews;
create policy "customer update own reviews" on reviews
  for update using (customer_id = auth.uid());
drop policy if exists "customer delete own reviews" on reviews;
create policy "customer delete own reviews" on reviews
  for delete using (customer_id = auth.uid());

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
