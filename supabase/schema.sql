-- ND Electronic Technologies Ltd — Shop database schema
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query → paste → Run).

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
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  delivery_address text not null,
  notes text,
  subtotal numeric(12,0) not null,
  total numeric(12,0) not null,
  currency text not null default 'UGX',
  status text not null default 'pending'               -- pending | paid | failed | fulfilled | cancelled
    check (status in ('pending','paid','failed','fulfilled','cancelled')),
  payment_provider text default 'flutterwave',           -- 'flutterwave' (card/mobile money) or 'cod' (cash on delivery)
  payment_tx_ref text unique,                            -- our generated reference, sent to Flutterwave
  payment_flw_id text,                                   -- Flutterwave's transaction id, filled in after verification
  email_verified boolean not null default false,          -- customer completed email OTP verification at checkout
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table orders add column if not exists payment_provider text default 'flutterwave';
alter table orders add column if not exists email_verified boolean not null default false;

create index if not exists orders_status_idx on orders (status);
create index if not exists orders_tx_ref_idx on orders (payment_tx_ref);

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
-- Public (anonymous) visitors: read active products, create orders/order_items, read only their own order by id.
-- Signed-in users (you, via Supabase Auth): full read/write on products and orders — this is your admin account.
-- ══════════════════════════════════════════
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

-- Products: anyone can read active products
create policy "public read active products" on products
  for select using (is_active = true);

-- Products: only authenticated users (admin) can insert/update/delete
create policy "admin manage products" on products
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Orders: anyone can create an order (checkout is public)
create policy "public create orders" on orders
  for insert with check (true);

-- Orders: only authenticated users (admin) can read/update/delete orders
create policy "admin manage orders" on orders
  for select using (auth.role() = 'authenticated');
create policy "admin update orders" on orders
  for update using (auth.role() = 'authenticated');

-- The payment verification Edge Function uses the service_role key, which
-- bypasses RLS entirely — that's how it's allowed to flip a pending order to paid.

-- Order items: anyone can insert (as part of checkout), only admin can read
create policy "public create order items" on order_items
  for insert with check (true);
create policy "admin read order items" on order_items
  for select using (auth.role() = 'authenticated');

-- ══════════════════════════════════════════
-- STORAGE — product images
-- Run this too; it creates a public bucket for product photos uploaded from the admin panel.
-- ══════════════════════════════════════════
insert into storage.buckets (id, name, public)
  values ('product-images', 'product-images', true)
  on conflict (id) do nothing;

create policy "public read product images" on storage.objects
  for select using (bucket_id = 'product-images');

create policy "admin upload product images" on storage.objects
  for insert with check (bucket_id = 'product-images' and auth.role() = 'authenticated');

create policy "admin delete product images" on storage.objects
  for delete using (bucket_id = 'product-images' and auth.role() = 'authenticated');
