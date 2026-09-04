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
  paymentMethod: 'mobile_money',
  loggedInUser: null,    // Supabase Auth user, set when checking out signed in — skips email OTP entirely
  savedAddresses: [],     // this customer's addresses from the Address Book, if any
  useNewAddress: false,   // true once they pick "Use a new address" over a saved one
};

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
function renderCart() {
  const cart = getCart();
  const wrap = document.getElementById('cartContent');

  if (!cart.length) {
    wrap.innerHTML = `
      <div class="cart-empty">
        <p>Your cart is empty.</p>
        <a href="/shop/" class="btn btn-primary">Browse the Shop →</a>
      </div>`;
    return;
  }

  const rows = cart.map(item => `
    <tr>
      <td>
        <div class="cart-item-info">
          <img class="cart-item-img" src="${esc(item.image_url || '')}" alt="">
          <div>
            <div class="cart-item-name">${esc(item.name)}</div>
            <button class="cart-remove" data-remove="${esc(item.id)}">Remove</button>
          </div>
        </div>
      </td>
      <td>${formatUGX(item.price)}</td>
      <td>
        <div class="qty-stepper">
          <button type="button" data-minus="${esc(item.id)}">−</button>
          <span>${item.qty}</span>
          <button type="button" data-plus="${esc(item.id)}">+</button>
        </div>
      </td>
      <td style="font-weight:700;">${formatUGX(item.price * item.qty)}</td>
    </tr>
  `).join('');

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
          <div class="cart-summary-row total"><span>Total</span><span>${formatUGX(cartTotal())}</span></div>
        </div>
        <div id="checkoutSidebar" style="margin-top:20px;"></div>
      </aside>
    </div>
  `;

  wrap.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { removeFromCart(btn.dataset.remove); renderCart(); }));
  wrap.querySelectorAll('[data-plus]').forEach(btn => btn.addEventListener('click', () => {
    const item = getCart().find(i => i.id === btn.dataset.plus);
    updateCartQty(btn.dataset.plus, item.qty + 1);
    renderCart();
  }));
  wrap.querySelectorAll('[data-minus]').forEach(btn => btn.addEventListener('click', () => {
    const item = getCart().find(i => i.id === btn.dataset.minus);
    updateCartQty(btn.dataset.minus, item.qty - 1);
    renderCart();
  }));

  renderCheckoutSidebar();
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
        <p style="margin-bottom:18px;">Deliver to <strong>${esc(c.name)}</strong> · ${esc(c.phone)}</p>
        <div class="admin-error" id="checkoutError"></div>
        <form id="detailsForm">
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

function step3Html(total) {
  const m = checkout.paymentMethod;
  return `
    <div class="contact-form-wrap checkout-step">
      <div class="checkout-step-label">Step ${PAYMENT_STEP} of ${TOTAL_STEPS} — Payment Method</div>
      <h3 style="font-size:16px;">How would you like to pay?</h3>
      <div class="admin-error" id="paymentError"></div>
      <div class="payment-methods">
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
        <label class="payment-method-card${m === 'cod' ? ' selected' : ''}">
          <input type="radio" name="paymentMethod" value="cod" ${m === 'cod' ? 'checked' : ''} />
          <svg><use href="#ico-cash"/></svg>
          <div><strong>Cash on Delivery</strong><span>Pay in cash when your order arrives</span></div>
        </label>
      </div>
      <button type="button" class="btn btn-primary" id="placeOrderBtn" style="width:100%;justify-content:center;margin-top:20px;">
        ${m === 'cod' ? 'Place Order — Pay on Delivery' : 'Pay ' + formatUGX(total)}
      </button>
      <div class="checkout-trust-note">
        <svg><use href="#ico-shield"/></svg>
        <span>${REQUIRE_EMAIL_VERIFICATION ? "Your email is verified. We'll only use your details to confirm and deliver this order." : "We'll only use your details to confirm and deliver this order."}</span>
      </div>
    </div>`;
}

function bindStepEvents() {
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
  const total = cartTotal();
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
      subtotal: total,
      total: total,
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
      subtotal: total,
      total: total,
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
      clearCart();
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
        clearCart();
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
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    checkout.loggedInUser = session.user;
    const { data: profile } = await supabaseClient.from('profiles').select('full_name, phone').eq('id', session.user.id).single();
    const { data: addresses } = await supabaseClient.from('addresses').select('*').eq('customer_id', session.user.id).order('is_default', { ascending: false });
    checkout.savedAddresses = addresses || [];
    const defaultAddress = checkout.savedAddresses.find(a => a.is_default) || checkout.savedAddresses[0];
    checkout.customer = {
      name: (profile && profile.full_name) || '',
      phone: (profile && profile.phone) || '',
      email: session.user.email,
      address: defaultAddress ? defaultAddress.address_text : '',
      notes: '',
    };
    checkout.emailVerified = true;
  }
  renderCart();
}

initCheckout();
