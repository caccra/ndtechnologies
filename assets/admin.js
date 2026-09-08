/* ND Electronic Technologies Ltd — shared admin dashboard helpers
   Loaded on every /admin/* page (except login, which needs none of this).
   Toasts replace alert(), confirmDialog() replaces confirm(), exportCsv()
   downloads whatever rows/columns a page currently has filtered/visible. */

function showToast(message, type) {
  type = type || 'success';
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 250);
  }, 3800);
}

// Promise<boolean> — resolves true if the user confirms, false on cancel/backdrop click.
function confirmDialog(message, confirmLabel) {
  confirmLabel = confirmLabel || 'Delete';
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal">
        <p>${String(message)}</p>
        <div class="admin-modal-actions">
          <button type="button" class="btn btn-outline-navy" data-choice="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-choice="confirm" style="background:#B0301A;border-color:#B0301A;">${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const close = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
      const choice = e.target.closest('[data-choice]');
      if (choice) close(choice.dataset.choice === 'confirm');
    });
  });
}

// Sidebar search box federating across Products / Orders / Leads, one query
// each on every keystroke (debounced). Orders double as the customer lookup,
// since the Customers page is itself just orders grouped by phone — there's
// no separate customers table to query. Selecting a result deep-links to the
// owning list page with ?q=<value>, which that page reads on load and drops
// straight into its own existing search box (see wireDeepLinkSearch below).
function initGlobalSearch(supabaseClient) {
  const box = document.getElementById('globalSearchBox');
  const input = document.getElementById('globalSearchInput');
  const results = document.getElementById('globalSearchResults');
  if (!box || !input || !results) return;

  let debounceTimer = null;
  let requestSeq = 0;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function renderGroup(title, items, hrefFor) {
    if (!items.length) return '';
    return `<div class="gsearch-group"><div class="gsearch-group-label">${title}</div>${items.map(hrefFor).join('')}</div>`;
  }

  async function runSearch(q) {
    const seq = ++requestSeq;
    const like = `%${q}%`;
    const [{ data: products }, { data: orders }, { data: leads }] = await Promise.all([
      supabaseClient.from('products').select('id, name').ilike('name', like).limit(5),
      supabaseClient.from('orders').select('id, customer_name, customer_phone').or(`customer_name.ilike.${like},customer_phone.ilike.${like}`).limit(5),
      supabaseClient.from('leads').select('id, name, phone, email').or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).limit(5),
    ]);
    if (seq !== requestSeq) return; // a newer keystroke already superseded this

    const html =
      renderGroup('Products', products || [], p => `<a href="/admin/products/?q=${encodeURIComponent(p.name)}">${esc(p.name)}</a>`) +
      renderGroup('Orders / Customers', orders || [], o => `<a href="/admin/orders/?q=${encodeURIComponent(o.customer_name || o.customer_phone)}">${esc(o.customer_name)} <span>${esc(o.customer_phone)}</span></a>`) +
      renderGroup('Leads', leads || [], l => `<a href="/admin/leads/?q=${encodeURIComponent(l.name || l.phone || l.email)}">${esc(l.name || l.email)} <span>${esc(l.phone || '')}</span></a>`);

    results.innerHTML = html || '<div class="gsearch-empty">No matches.</div>';
    results.classList.add('show');
  }

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 2) { results.classList.remove('show'); results.innerHTML = ''; return; }
    debounceTimer = setTimeout(() => runSearch(q), 300);
  });

  input.addEventListener('focus', () => { if (results.innerHTML) results.classList.add('show'); });
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) results.classList.remove('show'); });
}

// Called on Products/Orders/Leads/Customers pages: if the URL carries ?q=,
// drop it into that page's own search input and re-run its existing filter —
// this is what makes a global search result click actually land on something.
function wireDeepLinkSearch(inputId, onApplied) {
  const q = new URLSearchParams(window.location.search).get('q');
  if (!q) return;
  const input = document.getElementById(inputId);
  if (!input) return;
  input.value = q;
  input.dispatchEvent(new Event('input'));
  if (onApplied) onApplied();
}

// headers: [{ label: 'Date', value: row => '...' }, ...]. Downloads immediately.
function exportCsv(filename, rows, headers) {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map(h => esc(h.label)).join(',')];
  rows.forEach(row => lines.push(headers.map(h => esc(h.value(row))).join(',')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
