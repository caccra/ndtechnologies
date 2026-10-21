/* ND Electronic Technologies Ltd — shared wishlist helpers (shop grid + product page) */

let WISHLIST_IDS = null;   // Set of product id strings; empty Set when logged out
let WISHLIST_USER = null;  // { id, email, fullName } from getCurrentCustomer() (cart.js), or null when logged out

async function loadWishlistIds() {
  // Customer accounts run on Clerk (see SETUP.md section 10) — load it
  // before checking who's signed in, since getCurrentCustomer() only sees
  // a Clerk session once window.Clerk is actually loaded.
  try { await loadClerk(); } catch { /* falls back to logged-out state below */ }
  WISHLIST_USER = await getCurrentCustomer();

  if (!WISHLIST_USER) {
    WISHLIST_IDS = new Set();
    return WISHLIST_IDS;
  }

  const { data, error } = await supabaseClient
    .from('wishlist_items')
    .select('product_id')
    .eq('customer_id', WISHLIST_USER.id);

  WISHLIST_IDS = new Set(error ? [] : data.map(r => String(r.product_id)));
  return WISHLIST_IDS;
}

function wishlistButtonHtml(productId) {
  const active = !!(WISHLIST_IDS && WISHLIST_IDS.has(String(productId)));
  return `<button type="button" class="wishlist-btn${active ? ' active' : ''}" data-wishlist="${productId}" aria-label="${active ? 'Remove from wishlist' : 'Add to wishlist'}"><svg><use href="#ico-heart"/></svg></button>`;
}

async function toggleWishlist(productId, btn) {
  if (!WISHLIST_USER) {
    window.location.href = '/account/login/?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
    return;
  }

  const id = String(productId);
  const wasActive = WISHLIST_IDS.has(id);
  btn.disabled = true;

  if (wasActive) {
    await supabaseClient.from('wishlist_items').delete().eq('customer_id', WISHLIST_USER.id).eq('product_id', id);
    WISHLIST_IDS.delete(id);
  } else {
    await supabaseClient.from('wishlist_items').insert({ customer_id: WISHLIST_USER.id, product_id: id });
    WISHLIST_IDS.add(id);
  }

  btn.disabled = false;
  btn.classList.toggle('active', !wasActive);
  btn.setAttribute('aria-label', wasActive ? 'Add to wishlist' : 'Remove from wishlist');
}

function bindWishlistButtons(container) {
  container.querySelectorAll('[data-wishlist]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleWishlist(btn.dataset.wishlist, btn);
    });
  });
}
