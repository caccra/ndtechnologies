/* ND Electronic Technologies Ltd — public shop product grid */

let ALL_PRODUCTS = [];
let ACTIVE_CATEGORY = 'All';

async function loadShopProducts() {
  const grid = document.getElementById('shopGrid');
  const empty = document.getElementById('shopEmpty');
  const { data, error } = await supabaseClient
    .from('products')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    grid.innerHTML = `<p style="color:var(--text-muted);grid-column:1/-1;">Could not load products right now. Please try again shortly.</p>`;
    console.error(error);
    return;
  }

  ALL_PRODUCTS = data;
  buildCategoryTabs();
  renderGrid();
  injectProductListSchema();
}

function injectProductListSchema() {
  const existing = document.getElementById('shopItemListSchema');
  if (existing) existing.remove();
  if (!ALL_PRODUCTS.length) return;

  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.id = 'shopItemListSchema';
  script.textContent = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: ALL_PRODUCTS.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: 'https://ndelectronictechnologies.com/product/?id=' + p.id,
      item: {
        '@type': 'Product',
        name: p.name,
        image: p.image_url || undefined,
        category: p.category || undefined,
        url: 'https://ndelectronictechnologies.com/product/?id=' + p.id,
        offers: {
          '@type': 'Offer',
          priceCurrency: 'UGX',
          price: p.price,
          availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock'
        }
      }
    }))
  });
  document.head.appendChild(script);
}

function buildCategoryTabs() {
  const tabsWrap = document.getElementById('categoryTabs');
  if (!tabsWrap) return;
  const cats = ['All', ...new Set(ALL_PRODUCTS.map(p => p.category))];
  tabsWrap.innerHTML = cats.map(c =>
    `<button class="shop-tab${c === ACTIVE_CATEGORY ? ' active' : ''}" data-cat="${c}">${c}</button>`
  ).join('');
  tabsWrap.querySelectorAll('.shop-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      ACTIVE_CATEGORY = btn.dataset.cat;
      buildCategoryTabs();
      renderGrid();
    });
  });
}

function renderGrid() {
  const grid = document.getElementById('shopGrid');
  const empty = document.getElementById('shopEmpty');
  const items = ACTIVE_CATEGORY === 'All' ? ALL_PRODUCTS : ALL_PRODUCTS.filter(p => p.category === ACTIVE_CATEGORY);

  if (!items.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = items.map(p => `
    <div class="shop-card">
      <a href="/product/?id=${p.id}" class="shop-card-img">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" loading="lazy" />` : `<div class="shop-card-noimg">No image</div>`}
      </a>
      <div class="shop-card-body">
        <span class="shop-card-cat">${p.category}</span>
        <a href="/product/?id=${p.id}"><h3>${p.name}</h3></a>
        <p>${p.description}</p>
        <div class="shop-card-foot">
          <span class="shop-card-price">${formatUGX(p.price)}</span>
          <button class="btn btn-primary" style="padding:9px 16px;font-size:13px;" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>
            ${p.stock < 1 ? 'Out of stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = ALL_PRODUCTS.find(x => x.id === btn.dataset.add);
      addToCart(p, 1);
      btn.textContent = 'Added ✓';
      setTimeout(() => { btn.textContent = 'Add to Cart'; }, 1200);
    });
  });
}

document.addEventListener('DOMContentLoaded', loadShopProducts);
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
