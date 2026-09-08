/* ND Electronic Technologies Ltd — cart page: cart table + guest checkout
   Guest checkout flow: delivery details -> email verification -> payment method
   (Cash on Delivery, Mobile Money, or Card). No customer accounts/passwords —
   the email OTP is a one-off contact check via Supabase Auth, and the session
   it creates is discarded immediately after verifying so it never gains the
   "authenticated" role used to gate the admin panel.

   Email verification is switched off below (REQUIRE_EMAIL_VERIFICATION = false)
   until Custom SMTP is connected in Supabase — see SETUP.md step 3. Flip it back
   to true once verification codes are actually being delivered. */

const REQUIRE_EMAIL_VERIFICATION = false;
const PAYMENT_STEP = REQUIRE_EMAIL_VERIFICATION ? 3 : 2;
const TOTAL_STEPS = REQUIRE_EMAIL_VERIFICATION ? 3 : 2;

const checkout = {
  step: 1,              // 1 = delivery details, then either 2 = verify email + 3 = payment, or straight to 2 = payment
  customer: null,        // { name, phone, email, address, notes }
  emailVerified: false,
  paymentMethod: 'cod',   // Cash on Delivery is the default/first option until Flutterwave or Cellulant is fully wired up
  loggedInUser: null,    // Supabase Auth user, set when checking out signed in — skips email OTP entirely
  savedAddresses: [],     // this customer's addresses from the Address Book, if any
  useNewAddress: false,   // true once they pick "Use a new address" over a saved one
  coupon: null,           // { code, discountType, discountValue, discountAmount } once a code is applied
};

function discountedTotal() {
  const raw = cartTotal() - (checkout.coupon ? checkout.coupon.discountAmount : 0);
  return Math.max(0, raw);
}

let resendTimer = null;
let pickedLocation = null;  // { lat, lng } from the map picker, cleared whenever the address text is edited by hand

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function normalizePhoneUG(raw) {
  let p = (raw || '').trim().replace(/[\s-]/g, '');
  if (p.startsWith('+256')) return p;
  if (p.startsWith('256')) return '+' + p;
  if (p.startsWith('0')) return '+256' + p.slice(1);
  if (/^7\d{8}$/.test(p)) return '+256' + p;
  return p.startsWith('+') ? p : '+256' + p;
}

/* ══════════════════ CART TABLE ══════════════════ */

// Live stock/availability for whatever's currently in the cart — fetched
// once on page load (see initCheckout) and re-fetched whenever the cart's
// set of product ids changes, so the qty stepper can't be pushed past what's
// actually in stock. Keyed by product id (string).
let CART_STOCK = {};
let cartStockLoadedFor = '';

async function loadCartStockInfo() {
  const cart = getCart();
  if (!cart.length) { CART_STOCK = {}; return; }
  const key = cart.map(i => i.id).sort().join(',');
  if (key === cartStockLoadedFor) return; // already have fresh data for exactly this set of items
  try {
    const { data, error } = await supabaseClient.from('products').select('id, stock, is_active').in('id', cart.map(i => i.id));
    if (error) return;
    CART_STOCK = {};
    (data || []).forEach(p => { CART_STOCK[String(p.id)] = p; });
    cartStockLoadedFor = key;
  } catch {
    // Best-effort — the stepper just won't cap this render if it fails.
  }
}

function cartToast(message) {
  let el = document.getElementById('cartToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cartToast';
    el.className = 'cart-toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

async function saveForLater(productId) {
  if (!checkout.loggedInUser) return;
  try {
    await supabaseClient.from('wishlist_items').upsert(
      { customer_id: checkout.loggedInUser.id, product_id: productId },
      { onConflict: 'customer_id,product_id' }
    );
  } catch {
    // Not fatal — worst case it's just removed from the cart, not saved.
  }
  removeFromCart(productId);
  renderCart();
  cartToast('Saved for later — find it in your Wishlist.');
}

function renderCart() {
  const cart = getCart();
  const wrap = document.getElementById('cartContent');

  if (!cart.length) {
    wrap.innerHTML = `
      <div class="cart-empty">
        <p>Your cart is empty.</p>
        <a href="/shop/" class="btn btn-primary">Browse the Shop →</a>
      </div>`;
    loadCrossSell([]);
    return;
  }

  const rows = cart.map(item => {
    const stockInfo = CART_STOCK[item.id];
    const unavailable = stockInfo && stockInfo.is_active === false;
    const overStock = stockInfo && !unavailable && stockInfo.stock < item.qty;
    const atCeiling = stockInfo && !unavailable && item.qty >= stockInfo.stock;
    let warning = '';
    if (unavailable) warning = `<div class="cart-stock-warn">No longer available — please remove.</div>`;
    else if (overStock) warning = `<div class="cart-stock-warn">Only ${stockInfo.stock} left in stock — reduce quantity.</div>`;

    return `
    <tr>
      <td>
        <div class="cart-item-info">
          <img class="cart-item-img" src="${esc(item.image_url || '')}" alt="">
          <div>
            <div class="cart-item-name">${esc(item.name)}</div>
            <div class="cart-item-actions">
              <button class="cart-remove" data-remove="${esc(item.id)}">Remove</button>
              ${checkout.loggedInUser ? `<button class="cart-remove" data-save-later="${esc(item.id)}">Save for later</button>` : ''}
            </div>
            ${warning}
          </div>
        </div>
      </td>
      <td>${formatUGX(item.price)}</td>
      <td>
        <div class="qty-stepper">
          <button type="button" data-minus="${esc(item.id)}">−</button>
          <span>${item.qty}</span>
          <button type="button" data-plus="${esc(item.id)}" ${atCeiling ? 'disabled' : ''}>+</button>
        </div>
      </td>
      <td style="font-weight:700;">${formatUGX(item.price * item.qty)}</td>
    </tr>
  `;
  }).join('');

  wrap.innerHTML = `
    <div class="detail-grid">
      <div>
        <table class="cart-table">
          <thead><tr>
            <th style="text-align:left;font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;padding-bottom:10px;">Product</th>
            <th style="text-align:left;font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;padding-bottom:10px;">Price</th>
            <th style="text-align:left;font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;padding-bottom:10px;">Qty</th>
            <th style="text-align:left;font-family:var(--font-mono);font-size:10.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;padding-bottom:10px;">Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <aside class="sidebar">
        <div class="cart-summary">
          <div class="cart-summary-row"><span>Subtotal</span><span>${formatUGX(cartTotal())}</span></div>
          ${checkout.coupon ? `<div class="cart-summary-row" style="color:var(--amber-dark);"><span>Discount (${esc(checkout.coupon.code)})</span><span>−${formatUGX(checkout.coupon.discountAmount)}</span></div>` : ''}
          <div class="cart-summary-row total"><span>Total</span><span>${formatUGX(discountedTotal())}</span></div>
          <div class="cart-delivery-note"><svg style="width:15px;height:15px;flex-shrink:0;"><use href="#ico-clock"/></svg>Delivery: 1–3 working days across Kampala, arranged once your order's confirmed.</div>
        </div>
        <div id="checkoutSidebar" style="margin-top:20px;"></div>
      </aside>
    </div>
    <div id="crossSellWrap"></div>
  `;

  wrap.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { removeFromCart(btn.dataset.remove); renderCart(); }));
  wrap.querySelectorAll('[data-save-later]').forEach(btn => btn.addEventListener('click', () => saveForLater(btn.dataset.saveLater)));
  wrap.querySelectorAll('[data-plus]').forEach(btn => btn.addEventListener('click', () => {
    const item = getCart().find(i => i.id === btn.dataset.plus);
    const stockInfo = CART_STOCK[btn.dataset.plus];
    if (stockInfo && item.qty >= stockInfo.stock) return;
    updateCartQty(btn.dataset.plus, item.qty + 1);
    renderCart();
  }));
  wrap.querySelectorAll('[data-minus]').forEach(btn => btn.addEventListener('click', () => {
    const item = getCart().find(i => i.id === btn.dataset.minus);
    updateCartQty(btn.dataset.minus, item.qty - 1);
    renderCart();
  }));

  renderCheckoutSidebar();
  loadCartStockInfo().then(() => renderCartWarningsOnly());
  loadCrossSell(cart);
}

// Re-paints just the per-row stock warnings/+-button state after
// loadCartStockInfo resolves, without re-running the whole renderCart (which
// would wipe out anything the shopper's mid-typing in the checkout sidebar).
function renderCartWarningsOnly() {
  const cart = getCart();
  cart.forEach(item => {
    const stockInfo = CART_STOCK[item.id];
    if (!stockInfo) return;
    const row = document.querySelector(`[data-plus="${CSS.escape(item.id)}"]`)?.closest('tr');
    if (!row) return;
    const plusBtn = row.querySelector('[data-plus]');
    const infoCell = row.querySelector('.cart-item-info > div');
    const unavailable = stockInfo.is_active === false;
    const overStock = !unavailable && stockInfo.stock < item.qty;
    plusBtn.disabled = !unavailable && item.qty >= stockInfo.stock;
    let existing = infoCell.querySelector('.cart-stock-warn');
    if (existing) existing.remove();
    if (unavailable || overStock) {
      const warn = document.createElement('div');
      warn.className = 'cart-stock-warn';
      warn.textContent = unavailable ? 'No longer available — please remove.' : `Only ${stockInfo.stock} left in stock — reduce quantity.`;
      infoCell.appendChild(warn);
    }
  });
}

/* ══════════════════ CROSS-SELL ("you might also need") ══════════════════ */
async function loadCrossSell(cart) {
  const host = document.getElementById('crossSellWrap');
  if (!host) return;
  try {
    let query = supabaseClient.from('products').select('*').eq('is_active', true).gt('stock', 0);
    if (cart.length) {
      const cartIds = cart.map(i => i.id);
      // Same categories as what's already in the cart — a rough but
      // reasonable stand-in for "frequently bought together" without needing
      // real order-history analysis.
      const { data: cartProducts } = await supabaseClient.from('products').select('category').in('id', cartIds);
      const categories = [...new Set((cartProducts || []).map(p => p.category).filter(Boolean))];
      if (categories.length) query = query.in('category', categories);
      query = query.not('id', 'in', `(${cartIds.join(',')})`);
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(4);
    if (error || !data || !data.length) { host.innerHTML = ''; return; }

    host.innerHTML = `
      <div class="cart-crosssell">
        <h3>You might also need</h3>
        <div class="cart-crosssell-grid">
          ${data.map(p => `
            <div class="cart-crosssell-card">
              <a href="/product/?id=${p.id}">${p.image_url ? `<img src="${esc(p.image_url)}" alt="">` : ''}</a>
              <a href="/product/?id=${p.id}"><h4>${esc(p.name)}</h4></a>
              <div class="price">${formatUGX(p.sale_price != null ? p.sale_price : p.price)}</div>
              <button type="button" class="btn btn-outline-navy" data-crosssell-add="${p.id}">Add to Cart</button>
            </div>`).join('')}
        </div>
      </div>`;

    host.querySelectorAll('[data-crosssell-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = data.find(x => String(x.id) === btn.dataset.crosssellAdd);
        if (p) addToCart({ ...p, id: String(p.id) }, 1);
        btn.textContent = 'Added ✓';
        setTimeout(() => { btn.textContent = 'Add to Cart'; }, 1200);
        renderCart();
      });
    });
  } catch {
    host.innerHTML = '';
  }
}

/* ══════════════════ CHECKOUT SIDEBAR (steps) ══════════════════ */
function renderCheckoutSidebar() {
  const sidebar = document.getElementById('checkoutSidebar');
  if (!sidebar) return;
  const total = cartTotal();
  let html = '<div class="checkout-steps">';

  if (checkout.loggedInUser) {
    html += `
      <div class="checkout-step done">
        <div class="checkout-step-head">
          <span class="checkout-step-num"><svg><use href="#ico-user"/></svg></span>
          <div><strong>Signed in</strong><span>${esc(checkout.loggedInUser.email)}</span></div>
          <button type="button" class="checkout-edit" id="checkoutSignOutBtn">Not you?</button>
        </div>
      </div>`;
  }

  if (checkout.step > 1 && checkout.customer) {
    html += `
      <div class="checkout-step done">
        <div class="checkout-step-head">
          <span class="checkout-step-num"><svg><use href="#ico-check"/></svg></span>
          <div><strong>${esc(checkout.customer.name)}</strong><span>${esc(checkout.customer.email)} · ${esc(checkout.customer.address)}</span></div>
          <button type="button" class="checkout-edit" data-edit-step="1">Edit</button>
        </div>
      </div>`;
  }

  if (checkout.step === 1) html += step1Html();
  if (REQUIRE_EMAIL_VERIFICATION && checkout.step === 2) html += step2Html();

  if (REQUIRE_EMAIL_VERIFICATION && checkout.step > 2 && checkout.emailVerified) {
    html += `
      <div class="checkout-step done">
        <div class="checkout-step-head">
          <span class="checkout-step-num"><svg><use href="#ico-check"/></svg></span>
          <div><strong>Email verified</strong><span>${esc(checkout.customer.email)}</span></div>
        </div>
      </div>`;
  }

  if (checkout.step === PAYMENT_STEP) html += step3Html(total);

  html += '</div>';
  sidebar.innerHTML = html;
  bindStepEvents();
}

function step1Html() {
  const c = checkout.customer || {};
  const loggedIn = !!checkout.loggedInUser;
  const hasSaved = loggedIn && checkout.savedAddresses.length > 0;
  // A registered customer already gave us their name/phone at signup — no
  // need to ask again at checkout, just where to deliver. Only fall back to
  // the full form if either is somehow still missing (e.g. an older account).
  const skipContactFields = loggedIn && c.name && c.phone;

  const addressFieldHtml = hasSaved && !checkout.useNewAddress
    ? `<div class="form-group">
        <label>Delivery Address *</label>
        <select id="custAddressSelect" required>
          ${checkout.savedAddresses.map(a => `<option value="${esc(a.address_text)}"${c.address === a.address_text ? ' selected' : ''}>${esc(a.label || 'Address')} — ${esc(a.address_text)}</option>`).join('')}
          <option value="__new__">+ Use a new address</option>
        </select>
      </div>`
    : `<div class="form-group">
        <label>Delivery Address *</label>
        <input type="text" id="custAddress" required placeholder="Search or type your address..." value="${esc(c.address || '')}" autocomplete="off" />
        <div class="address-map" id="addressMap"></div>
      </div>`;

  if (skipContactFields) {
    return `
      <div class="contact-form-wrap checkout-step">
        <div class="checkout-step-label">Step 1 of ${TOTAL_STEPS} — Delivery Address</div>
        <h3 style="font-size:16px;">Where should we deliver?</h3>
        <p style="margin-bottom:18px;">Deliver to <strong>${esc(c.name)}</strong></p>
        <div class="admin-error" id="checkoutError"></div>
        <form id="detailsForm">
          <div class="form-group"><label>Phone Number *</label><input type="tel" id="custPhone" required placeholder="+256 7__ ___ ___" value="${esc(c.phone || '')}" /></div>
          ${addressFieldHtml}
          <div class="form-group"><label>Notes</label><textarea id="custNotes" placeholder="Optional">${esc(c.notes || '')}</textarea></div>
          <button type="submit" class="btn btn-primary" id="detailsBtn" style="width:100%;justify-content:center;">Continue to Payment →</button>
        </form>
      </div>`;
  }

  const btnLabel = loggedIn || !REQUIRE_EMAIL_VERIFICATION ? 'Continue to Payment →' : 'Send Verification Code →';

  return `
    <div class="contact-form-wrap checkout-step">
      <div class="checkout-step-label">Step 1 of ${TOTAL_STEPS} — Delivery Details</div>
      <h3 style="font-size:16px;">Delivery Details</h3>
      <p style="margin-bottom:18px;">${loggedIn || !REQUIRE_EMAIL_VERIFICATION ? "We'll use this to arrange delivery and confirm your order." : "We'll use this to arrange delivery and send your verification code."}</p>
      <div class="admin-error" id="checkoutError"></div>
      <form id="detailsForm">
        <div class="form-group"><label>Full Name *</label><input type="text" id="custName" required value="${esc(c.name || '')}" /></div>
        <div class="form-group"><label>Email *</label><input type="email" id="custEmail" required value="${esc(c.email || '')}" ${loggedIn ? 'disabled style="opacity:.65;"' : ''} /></div>
        <div class="form-group"><label>Phone Number *</label><input type="tel" id="custPhone" required placeholder="+256 7__ ___ ___" value="${esc(c.phone || '')}" /></div>
        ${addressFieldHtml}
        <div class="form-group"><label>Notes</label><textarea id="custNotes" placeholder="Optional">${esc(c.notes || '')}</textarea></div>
        <button type="submit" class="btn btn-primary" id="detailsBtn" style="width:100%;justify-content:center;">${btnLabel}</button>
      </form>
      ${loggedIn ? '' : '<p style="text-align:center;margin-top:14px;font-size:13px;color:var(--text-muted);">Have an account? <a href="/account/login/?redirect=' + encodeURIComponent('/cart/') + '">Log in</a> to check out faster.</p>'}
    </div>`;
}

function step2Html() {
  return `
    <div class="contact-form-wrap checkout-step">
      <div class="checkout-step-label">Step 2 of ${TOTAL_STEPS} — Verify Your Email</div>
      <h3 style="font-size:16px;">Enter the code we sent</h3>
      <p style="margin-bottom:18px;">We sent a 6-digit code by email to <strong>${esc(checkout.customer.email)}</strong>.</p>
      <div class="admin-error" id="otpError"></div>
      <form id="otpForm">
        <div class="otp-boxes">
          ${[0, 1, 2, 3, 4, 5].map(i => `<input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="1" class="otp-box" data-otp-i="${i}" />`).join('')}
        </div>
        <button type="submit" class="btn btn-primary" id="otpBtn" style="width:100%;justify-content:center;margin-top:18px;">Verify Code</button>
      </form>
      <div class="checkout-otp-actions">
        <button type="button" id="resendBtn" class="checkout-link" disabled>Resend code (30s)</button>
        <button type="button" id="changeEmailBtn" class="checkout-link">Change email address</button>
      </div>
    </div>`;
}

async function applyCoupon() {
  const input = document.getElementById('couponInput');
  const errorBox = document.getElementById('couponError');
  errorBox.style.display = 'none';
  const code = (input.value || '').trim();
  if (!code) return;

  const btn = document.getElementById('applyCouponBtn');
  btn.disabled = true;
  btn.textContent = 'Checking...';

  try {
    // RLS only exposes active coupons — an inactive/nonexistent code just
    // comes back as no rows, which reads the same either way to a shopper.
    const { data: coupon, error } = await supabaseClient
      .from('coupons')
      .select('*')
      .ilike('code', code)
      .maybeSingle();

    if (error) throw error;
    if (!coupon) throw new Error('That code isn\'t valid.');
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) throw new Error('That code has expired.');
    if (coupon.usage_limit != null && coupon.times_used >= coupon.usage_limit) throw new Error('That code has already been fully redeemed.');

    const subtotal = cartTotal();
    const discountAmount = coupon.discount_type === 'percent'
      ? Math.round(subtotal * (Number(coupon.discount_value) / 100))
      : Math.min(subtotal, Math.round(Number(coupon.discount_value)));

    checkout.coupon = { code: coupon.code, discountType: coupon.discount_type, discountValue: coupon.discount_value, discountAmount };
    renderCheckoutSidebar();
  } catch (err) {
    errorBox.textContent = err.message || 'Could not apply that code.';
    errorBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Apply';
  }
}

function step3Html(total) {
  const m = checkout.paymentMethod;
  const discounted = discountedTotal();
  return `
    <div class="contact-form-wrap checkout-step">
      <div class="checkout-step-label">Step ${PAYMENT_STEP} of ${TOTAL_STEPS} — Payment Method</div>
      <h3 style="font-size:16px;">How would you like to pay?</h3>
      <div class="admin-error" id="paymentError"></div>
      <div class="admin-error" id="couponError" style="display:none;"></div>
      ${checkout.coupon
        ? `<div class="form-group" style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--amber-light);border-radius:var(--radius);padding:10px 14px;">
             <span style="font-size:13px;color:var(--amber-dark);">Code <strong>${esc(checkout.coupon.code)}</strong> applied — −${formatUGX(checkout.coupon.discountAmount)}</span>
             <button type="button" id="removeCouponBtn" class="checkout-link" style="font-size:12px;">Remove</button>
           </div>`
        : `<div class="form-group">
             <label>Discount Code</label>
             <div style="display:flex;gap:8px;">
               <input type="text" id="couponInput" placeholder="Enter a code" style="flex:1;text-transform:uppercase;" />
               <button type="button" id="applyCouponBtn" class="btn btn-outline-navy" style="padding:11px 18px;white-space:nowrap;">Apply</button>
             </div>
           </div>`}
      <div class="payment-methods">
        <label class="payment-method-card${m === 'cod' ? ' selected' : ''}">
          <input type="radio" name="paymentMethod" value="cod" ${m === 'cod' ? 'checked' : ''} />
          <svg><use href="#ico-cash"/></svg>
          <div><strong>Cash on Delivery</strong><span>Pay in cash when your order arrives</span></div>
        </label>
        <label class="payment-method-card${m === 'mobile_money' ? ' selected' : ''}">
          <input type="radio" name="paymentMethod" value="mobile_money" ${m === 'mobile_money' ? 'checked' : ''} />
          <svg><use href="#ico-phone"/></svg>
          <div><strong>Mobile Money</strong><span>MTN or Airtel Mobile Money</span></div>
        </label>
        <label class="payment-method-card${m === 'card' ? ' selected' : ''}">
          <input type="radio" name="paymentMethod" value="card" ${m === 'card' ? 'checked' : ''} />
          <svg><use href="#ico-card"/></svg>
          <div><strong>Card</strong><span>Visa / Mastercard</span></div>
        </label>
      </div>
      <button type="button" class="btn btn-primary" id="placeOrderBtn" style="width:100%;justify-content:center;margin-top:20px;">
        ${m === 'cod' ? 'Place Order — Pay on Delivery' : 'Pay ' + formatUGX(discounted)}
      </button>
      <div class="checkout-trust-note">
        <svg><use href="#ico-shield"/></svg>
        <span>${REQUIRE_EMAIL_VERIFICATION ? "Your email is verified. We'll only use your details to confirm and deliver this order." : "We'll only use your details to confirm and deliver this order."}</span>
      </div>
    </div>`;
}

function bindStepEvents() {
  const applyCouponBtn = document.getElementById('applyCouponBtn');
  if (applyCouponBtn) applyCouponBtn.addEventListener('click', applyCoupon);
  const couponInput = document.getElementById('couponInput');
  if (couponInput) couponInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyCoupon(); } });
  const removeCouponBtn = document.getElementById('removeCouponBtn');
  if (removeCouponBtn) removeCouponBtn.addEventListener('click', () => {
    checkout.coupon = null;
    renderCheckoutSidebar();
  });

  const signOutBtn = document.getElementById('checkoutSignOutBtn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      checkout.loggedInUser = null;
      checkout.customer = null;
      checkout.step = 1;
      renderCheckoutSidebar();
    });
  }

  document.querySelectorAll('[data-edit-step]').forEach(btn => {
    btn.addEventListener('click', () => {
      checkout.step = Number(btn.dataset.editStep);
      renderCheckoutSidebar();
    });
  });

  const detailsForm = document.getElementById('detailsForm');
  if (detailsForm) detailsForm.addEventListener('submit', handleDetailsSubmit);

  const addressSelect = document.getElementById('custAddressSelect');
  if (addressSelect) {
    addressSelect.addEventListener('change', () => {
      if (addressSelect.value === '__new__') {
        checkout.useNewAddress = true;
        renderCheckoutSidebar();
      }
    });
  }

  const addressInput = document.getElementById('custAddress');
  const addressMapEl = document.getElementById('addressMap');
  if (addressInput && addressMapEl) {
    const c = checkout.customer || {};
    pickedLocation = (c.lat != null && c.lng != null) ? { lat: c.lat, lng: c.lng } : null;
    addressInput.addEventListener('input', () => { pickedLocation = null; });
    initAddressMap({
      containerEl: addressMapEl,
      searchInputEl: addressInput,
      initialAddress: c.address,
      initialLat: c.lat,
      initialLng: c.lng,
      onChange: ({ lat, lng }) => { pickedLocation = { lat, lng }; },
    });
  }

  const otpForm = document.getElementById('otpForm');
  if (otpForm) {
    otpForm.addEventListener('submit', handleOtpSubmit);
    bindOtpBoxes();
    startResendCooldown();
    document.getElementById('changeEmailBtn').addEventListener('click', () => {
      checkout.step = 1;
      renderCheckoutSidebar();
    });
    document.getElementById('resendBtn').addEventListener('click', handleResendOtp);
  }

  document.querySelectorAll('input[name="paymentMethod"]').forEach(input => {
    input.addEventListener('change', () => {
      checkout.paymentMethod = input.value;
      renderCheckoutSidebar();
    });
  });

  const placeOrderBtn = document.getElementById('placeOrderBtn');
  if (placeOrderBtn) placeOrderBtn.addEventListener('click', handlePlaceOrder);
}

function bindOtpBoxes() {
  const boxes = Array.from(document.querySelectorAll('.otp-box'));
  boxes.forEach((box, i) => {
    box.addEventListener('input', () => {
      box.value = box.value.replace(/\D/g, '').slice(0, 1);
      if (box.value && boxes[i + 1]) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
    });
    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '').slice(0, 6);
      text.split('').forEach((ch, j) => { if (boxes[j]) boxes[j].value = ch; });
      (boxes[Math.min(text.length, 5)] || boxes[5]).focus();
    });
  });
  if (boxes[0]) boxes[0].focus();
}

/* ══════════════════ STEP HANDLERS ══════════════════ */
async function handleDetailsSubmit(e) {
  e.preventDefault();
  const errorBox = document.getElementById('checkoutError');
  errorBox.style.display = 'none';

  // The condensed logged-in flow (see step1Html) doesn't render name/email/phone
  // inputs at all — fall back to what we already have from their profile.
  const nameEl = document.getElementById('custName');
  const emailEl = document.getElementById('custEmail');
  const phoneEl = document.getElementById('custPhone');
  const prior = checkout.customer || {};

  const name = nameEl ? nameEl.value.trim() : (prior.name || '');
  const email = emailEl ? emailEl.value.trim() : (prior.email || '');
  const addressField = document.getElementById('custAddress') || document.getElementById('custAddressSelect');
  const address = addressField.value.trim();
  const notes = document.getElementById('custNotes').value.trim();
  const phone = normalizePhoneUG(phoneEl ? phoneEl.value : (prior.phone || ''));

  if (!/^\+256\d{9}$/.test(phone)) {
    errorBox.textContent = 'Enter a valid Uganda phone number, e.g. 0704 399 665.';
    errorBox.style.display = 'block';
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorBox.textContent = 'Enter a valid email address.';
    errorBox.style.display = 'block';
    return;
  }

  // lat/lng comes from whichever address source was used: a map pick/drag
  // on the free-text field, or a saved address that already has coordinates.
  let lat = null, lng = null;
  if (addressField.id === 'custAddress' && pickedLocation) {
    lat = pickedLocation.lat;
    lng = pickedLocation.lng;
  } else if (addressField.id === 'custAddressSelect') {
    const match = checkout.savedAddresses.find(a => a.address_text === address);
    if (match) { lat = match.lat; lng = match.lng; }
  }

  const emailChanged = checkout.customer && checkout.customer.email !== email;
  checkout.customer = { name, phone, email, address, notes, lat, lng };
  if (emailChanged) checkout.emailVerified = false;

  // A real account is stronger proof of contact than a one-off email code —
  // logged-in customers always skip straight to payment.
  if (checkout.loggedInUser || !REQUIRE_EMAIL_VERIFICATION) {
    checkout.step = PAYMENT_STEP;
    renderCheckoutSidebar();
    return;
  }

  if (checkout.emailVerified) {
    checkout.step = PAYMENT_STEP;
    renderCheckoutSidebar();
    return;
  }

  const btn = document.getElementById('detailsBtn');
  btn.disabled = true;
  btn.textContent = 'Sending code...';

  const { error } = await supabaseClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });

  btn.disabled = false;
  btn.textContent = 'Send Verification Code →';

  if (error) {
    errorBox.textContent = 'Could not send a verification code: ' + error.message;
    errorBox.style.display = 'block';
    return;
  }

  checkout.step = 2;
  renderCheckoutSidebar();
}

async function handleOtpSubmit(e) {
  e.preventDefault();
  const errorBox = document.getElementById('otpError');
  errorBox.style.display = 'none';

  const code = Array.from(document.querySelectorAll('.otp-box')).map(b => b.value).join('');
  if (code.length !== 6) {
    errorBox.textContent = 'Enter the full 6-digit code.';
    errorBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('otpBtn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  const { error } = await supabaseClient.auth.verifyOtp({ email: checkout.customer.email, token: code, type: 'email' });
  // Discard the session immediately — guest checkout only, and we don't want
  // a verified customer's browser treated as "authenticated" (that role is
  // what gates the admin panel's product/order access).
  await supabaseClient.auth.signOut().catch(() => {});

  btn.disabled = false;
  btn.textContent = 'Verify Code';

  if (error) {
    errorBox.textContent = 'That code is invalid or expired. Please try again.';
    errorBox.style.display = 'block';
    return;
  }

  if (resendTimer) clearInterval(resendTimer);
  checkout.emailVerified = true;
  checkout.step = PAYMENT_STEP;
  renderCheckoutSidebar();
}

async function handleResendOtp() {
  const btn = document.getElementById('resendBtn');
  btn.disabled = true;
  const { error } = await supabaseClient.auth.signInWithOtp({ email: checkout.customer.email, options: { shouldCreateUser: true } });
  if (error) {
    const errorBox = document.getElementById('otpError');
    errorBox.textContent = 'Could not resend code: ' + error.message;
    errorBox.style.display = 'block';
  }
  document.querySelectorAll('.otp-box').forEach(b => b.value = '');
  startResendCooldown();
}

function startResendCooldown() {
  const btn = document.getElementById('resendBtn');
  if (!btn) return;
  if (resendTimer) clearInterval(resendTimer);
  let secs = 30;
  btn.disabled = true;
  btn.textContent = `Resend code (${secs}s)`;
  resendTimer = setInterval(() => {
    secs -= 1;
    if (secs <= 0) {
      clearInterval(resendTimer);
      btn.disabled = false;
      btn.textContent = 'Resend code';
    } else {
      btn.textContent = `Resend code (${secs}s)`;
    }
  }, 1000);
}

async function handlePlaceOrder() {
  const errorBox = document.getElementById('paymentError');
  errorBox.style.display = 'none';

  const selected = document.querySelector('input[name="paymentMethod"]:checked');
  const method = selected ? selected.value : checkout.paymentMethod;
  checkout.paymentMethod = method;

  if (method !== 'cod' && (!FLW_PUBLIC_KEY || FLW_PUBLIC_KEY.includes('YOUR-PUBLIC-KEY-HERE'))) {
    errorBox.textContent = 'Online payment isn\'t set up yet. Please choose Cash on Delivery, or contact us directly to place this order.';
    errorBox.style.display = 'block';
    return;
  }

  const btn = document.getElementById('placeOrderBtn');
  const subtotal = cartTotal();
  const total = discountedTotal();
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Placing order...';

  const cart = getCart();
  const txRef = 'NDET-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const customer = checkout.customer;

  try {
    const { data: order, error: orderError } = await supabaseClient.from('orders').insert({
      customer_id: checkout.loggedInUser ? checkout.loggedInUser.id : null,
      customer_name: customer.name,
      customer_phone: customer.phone,
      customer_email: customer.email,
      delivery_address: customer.address,
      delivery_lat: customer.lat != null ? customer.lat : null,
      delivery_lng: customer.lng != null ? customer.lng : null,
      notes: customer.notes || null,
      subtotal: subtotal,
      total: total,
      coupon_code: checkout.coupon ? checkout.coupon.code : null,
      discount_amount: checkout.coupon ? checkout.coupon.discountAmount : 0,
      currency: 'UGX',
      status: 'pending',
      payment_provider: method === 'cod' ? 'cod' : 'flutterwave',
      payment_tx_ref: txRef,
      email_verified: checkout.emailVerified,
    }).select().single();
    if (orderError) throw orderError;

    const items = cart.map(item => ({
      order_id: order.id,
      product_id: item.id,
      product_name: item.name,
      unit_price: item.price,
      quantity: item.qty,
      line_total: item.price * item.qty,
    }));
    const { error: itemsError } = await supabaseClient.from('order_items').insert(items);
    if (itemsError) throw itemsError;

    // Hand the order details forward to the confirmation page. RLS blocks a
    // guest from reading their own order back (there's no "read by tx_ref"
    // policy, by design — see schema.sql), so this is the safe way to show
    // an itemized summary: pass along what we already have from this same
    // insert, rather than re-querying it.
    sessionStorage.setItem('ndet_last_order', JSON.stringify({
      ref: txRef,
      items: cart.map(i => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal: subtotal,
      total: total,
      couponCode: checkout.coupon ? checkout.coupon.code : null,
      discountAmount: checkout.coupon ? checkout.coupon.discountAmount : 0,
      currency: 'UGX',
      method: method,
      customerName: customer.name,
      customerEmail: customer.email,
      loggedIn: !!checkout.loggedInUser,
    }));

    // A guest (not signed in at checkout) gets the option to create an
    // account on the confirmation page — this is what lets that later signup
    // claim this exact order via the "customer claim own guest order" RLS
    // policy, so it shows up in their order history.
    if (!checkout.loggedInUser) {
      localStorage.setItem('ndet_pending_claim', JSON.stringify({ ref: txRef, email: customer.email }));
    }

    if (method === 'cod') {
      // Fallback trigger for order-confirmation/admin-alert emails — the
      // reliable path is a Database Webhook on `orders` (see SETUP.md), this
      // just means emails still go out even before that's configured. Fire
      // ­and-forget: never block the redirect on this.
      fetch(`${SUPABASE_URL}/functions/v1/send-order-notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id }),
      }).catch(() => {});
      clearCart(); checkout.coupon = null;
      window.location.href = '/order-confirmed/?ref=' + encodeURIComponent(txRef) + '&method=cod';
      return;
    }

    btn.disabled = false;
    btn.textContent = originalLabel;

    FlutterwaveCheckout({
      public_key: FLW_PUBLIC_KEY,
      tx_ref: txRef,
      amount: total,
      currency: 'UGX',
      payment_options: method === 'card' ? 'card' : 'mobilemoneyuganda',
      customer: { email: customer.email, phone_number: customer.phone, name: customer.name },
      customizations: {
        title: 'ND Electronic Technologies Ltd',
        description: 'Order ' + txRef,
      },
      callback: async function (payment) {
        await fetch(`${SUPABASE_URL}/functions/v1/verify-payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tx_ref: txRef, transaction_id: payment.transaction_id }),
        }).catch(() => {});
        // Fallback trigger for order emails, same reasoning as the COD path
        // above — verify-payment has already flipped status to "paid" by
        // the time this runs, so the customer gets the "confirmed" email
        // (not just an admin alert) as soon as this call lands.
        fetch(`${SUPABASE_URL}/functions/v1/send-order-notifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: order.id }),
        }).catch(() => {});
        clearCart(); checkout.coupon = null;
        window.location.href = '/order-confirmed/?ref=' + encodeURIComponent(txRef);
      },
      onclose: function () {
        // Order stays "pending" — visible in the admin Orders page if the customer wants to retry/be followed up on.
      },
    });
  } catch (err) {
    errorBox.textContent = err.message || 'Something went wrong placing your order.';
    errorBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function initCheckout() {
  try {
    // Before anything else: if this is a signed-in customer whose cart lives
    // on another device (or was empty locally), pull it down so the very
    // first render on this page already shows the right items.
    await hydrateCartFromServer();

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      checkout.loggedInUser = session.user;
      const meta = session.user.user_metadata || {};

      // maybeSingle (not single) — a profile row with no name/phone saved
      // yet must fall through to the signup metadata below, not throw and
      // skip prefilling entirely.
      let profile = null;
      try {
        const { data } = await supabaseClient.from('profiles').select('full_name, phone').eq('id', session.user.id).maybeSingle();
        profile = data;
      } catch {
        // fall through to signup metadata below
      }

      let addresses = [];
      try {
        const { data } = await supabaseClient.from('addresses').select('*').eq('customer_id', session.user.id).order('is_default', { ascending: false });
        addresses = data || [];
      } catch {
        // no saved addresses available — not fatal, checkout still works
      }
      checkout.savedAddresses = addresses;
      const defaultAddress = checkout.savedAddresses.find(a => a.is_default) || checkout.savedAddresses[0];

      checkout.customer = {
        name: (profile && profile.full_name) || meta.full_name || '',
        phone: (profile && profile.phone) || meta.phone || '',
        email: session.user.email,
        address: defaultAddress ? defaultAddress.address_text : '',
        notes: '',
      };
      checkout.emailVerified = true;
    }
  } catch {
    // Not critical — falls back to the guest checkout flow if this fails.
  }
  await loadCartStockInfo();
  renderCart();
}

initCheckout();
