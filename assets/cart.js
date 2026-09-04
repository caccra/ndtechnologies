/* ND Electronic Technologies Ltd — shared shopping cart (localStorage-backed) */

const CART_KEY = 'ndet_cart';

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(product, qty) {
  qty = qty || 1;
  const cart = getCart();
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.qty += qty;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      image_url: product.image_url,
      qty: qty,
    });
  }
  saveCart(cart);
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

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session || session.user.email !== pending.email) return;

    const { error } = await supabaseClient
      .from('orders')
      .update({ customer_id: session.user.id })
      .eq('payment_tx_ref', pending.ref)
      .eq('customer_email', pending.email);

    if (!error) localStorage.removeItem('ndet_pending_claim');
  } catch {
    // Not critical — the order stays visible to admin either way, and this
    // is retried on every future page load until it succeeds.
  }
}

document.addEventListener('DOMContentLoaded', () => {
  updateCartBadge();
  claimPendingOrder();
});

