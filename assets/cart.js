/* ND Electronic Technologies Ltd — shared shopping cart (localStorage-backed) */

const CART_KEY = 'ndet_cart';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
  syncCartToServer(cart);
}

function addToCart(product, qty) {
  qty = qty || 1;
  const cart = getCart();
  // A sale price, when set, IS the price for every purpose downstream
  // (cart totals, checkout, order_items) — store it once here rather than
  // re-deriving "which price is active" at every call site.
  const effectivePrice = product.sale_price != null ? product.sale_price : product.price;
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: effectivePrice,
      image_url: product.image_url,
      qty: qty,
    });
  }
  saveCart(cart);
}

/* ══════════════════ CURRENT CUSTOMER (Clerk or native Supabase) ══════════════════
   Customer accounts run on Clerk (see SETUP.md section 10); the admin panel
   stays on Supabase's own Auth, but this helper is never loaded on admin
   pages (they don't include cart.js), so it has no reason to look at a
   Supabase session at all — doing so previously meant a leftover native
   Supabase session in the browser (e.g. from testing before this migration)
   made a customer page think someone was signed in when Clerk had no
   session, out of sync with the Clerk-only login/register pages. Clerk is
   the only source of truth for "is a customer signed in, and who" now. */
async function getCurrentCustomer() {
  try {
    if (window.Clerk && window.Clerk.user) {
      const u = window.Clerk.user;
      return {
        id: u.id,
        email: u.primaryEmailAddress ? u.primaryEmailAddress.emailAddress : '',
        fullName: u.fullName || '',
      };
    }
  } catch {
    // not signed in via Clerk
  }
  return null;
}

/* ══════════════════ SERVER-SIDE CART (signed-in customers) ══════════════════
   localStorage stays the synchronous source of truth every page reads from —
   nothing above changes. This is a best-effort mirror on top: whenever the
   local cart changes, push it to `cart_items` if signed in, so a customer
   who adds items on their phone still has them when they check out on a
   laptop. Guests (no session) are untouched — every call below is a no-op
   for them. */
async function syncCartToServer(cart) {
  try {
    if (typeof supabaseClient === 'undefined') return;
    const customer = await getCurrentCustomer();
    if (!customer) return;
    const customerId = customer.id;

    const { data: existing } = await supabaseClient.from('cart_items').select('id, product_id').eq('customer_id', customerId);
    const cartIds = new Set(cart.map(i => String(i.id)));
    const toDelete = (existing || []).filter(row => !cartIds.has(String(row.product_id))).map(row => row.id);
    if (toDelete.length) await supabaseClient.from('cart_items').delete().in('id', toDelete);

    if (cart.length) {
      const rows = cart.map(item => ({ customer_id: customerId, product_id: item.id, quantity: item.qty }));
      await supabaseClient.from('cart_items').upsert(rows, { onConflict: 'customer_id,product_id' });
    }
  } catch {
    // Best-effort — localStorage is still correct for this session either way.
  }
}

// Runs once per page load (see DOMContentLoaded below). If there's no local
// cart yet, pulls the server one down. If there IS a local cart already
// (items added before logging in, or on a fresh device), local wins and gets
// pushed up — so the two never silently disagree.
async function hydrateCartFromServer() {
  try {
    if (typeof supabaseClient === 'undefined') return;
    const customer = await getCurrentCustomer();
    if (!customer) return;

    const localCart = getCart();
    if (localCart.length) {
      syncCartToServer(localCart);
      return;
    }

    const { data: serverItems, error } = await supabaseClient
      .from('cart_items')
      .select('quantity, products(id, name, price, sale_price, image_url)')
      .eq('customer_id', customer.id);
    if (error || !serverItems || !serverItems.length) return;

    const hydrated = serverItems.filter(r => r.products).map(r => ({
      id: String(r.products.id),
      name: r.products.name,
      price: r.products.sale_price != null ? r.products.sale_price : r.products.price,
      image_url: r.products.image_url,
      qty: r.quantity,
    }));
    localStorage.setItem(CART_KEY, JSON.stringify(hydrated));
    updateCartBadge();
  } catch {
    // Best-effort — worst case the cart just stays empty until they add something.
  }
}

function updateCartQty(id, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter(item => item.id !== id);
  } else {
    const item = cart.find(i => i.id === id);
    if (item) item.qty = qty;
  }
  saveCart(cart);
}

function removeFromCart(id) {
  const cart = getCart().filter(item => item.id !== id);
  saveCart(cart);
}

function clearCart() {
  saveCart([]);
}

function cartCount() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}

function cartTotal() {
  return getCart().reduce((sum, item) => sum + item.qty * item.price, 0);
}

function formatUGX(n) {
  return 'UGX ' + Number(n).toLocaleString('en-UG');
}

function updateCartBadge() {
  const count = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach(el => {
    el.textContent = count;
    if (el.classList.contains('cart-badge')) {
      el.style.display = count > 0 ? 'inline-flex' : 'none';
    }
  });
}

/* ══════════════════ CLAIM A GUEST ORDER AFTER REGISTRATION ══════════════════
   When a guest checks out then creates an account (either right away on the
   order-confirmed page, or later by logging in), the just-placed order needs
   linking into their new account so it shows up in their order history. The
   guest checkout flow stashes { ref, email } here; this runs on every page
   that loads cart.js + is signed in, and is a no-op the rest of the time. */
async function claimPendingOrder() {
  try {
    const pending = JSON.parse(localStorage.getItem('ndet_pending_claim') || 'null');
    if (!pending || !pending.ref || !pending.email) return;
    if (typeof supabaseClient === 'undefined') return;

    const customer = await getCurrentCustomer();
    if (!customer || customer.email !== pending.email) return;

    const { error } = await supabaseClient
      .from('orders')
      .update({ customer_id: customer.id })
      .eq('payment_tx_ref', pending.ref)
      .eq('customer_email', pending.email);

    if (!error) localStorage.removeItem('ndet_pending_claim');
  } catch {
    // Not critical — the order stays visible to admin either way, and this
    // is retried on every future page load until it succeeds.
  }
}

/* ══════════════════ SHOW LOGGED-IN NAME ON THE ACCOUNT ICON ══════════════════
   Runs on every page that loads cart.js + supabase-config.js. No-op while
   signed out (the icon just stays a plain icon, same as today). */
async function updateAccountNavName() {
  try {
    if (typeof supabaseClient === 'undefined') return;
    const customer = await getCurrentCustomer();
    if (!customer) return;

    let name = customer.fullName;
    if (!name) {
      // maybeSingle (not single) — a missing/RLS-blocked profile row must
      // fall through to the email below, not throw and skip it entirely.
      try {
        const { data: profile } = await supabaseClient
          .from('profiles')
          .select('full_name')
          .eq('id', customer.id)
          .maybeSingle();
        name = profile && profile.full_name;
      } catch {
        // fall through to the email-based name below
      }
    }
    const firstName = (name || customer.email.split('@')[0]).trim().split(' ')[0];

    document.querySelectorAll('.account-icon-link .account-name').forEach(el => {
      el.textContent = firstName;
    });
  } catch {
    // Not critical — the icon just stays generic if this fails.
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  updateCartBadge();
  // Customer accounts run on Clerk (see SETUP.md section 10) — load it here
  // (if this page includes clerk-config.js) so getCurrentCustomer() below
  // can see a Clerk session without every page having to remember to do so.
  if (typeof loadClerk === 'function') {
    try { await loadClerk(); } catch { /* falls back to guest/Supabase state below */ }
  }
  claimPendingOrder();
  updateAccountNavName();
  hydrateCartFromServer();
});

