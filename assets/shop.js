/* ND Electronic Technologies Ltd — public shop product grid */

let ALL_PRODUCTS = [];
let ACTIVE_CATEGORY = 'All';
let PRODUCT_RATINGS = {}; // product id (string) -> { avg, count }
let shopPage = 1;
const SHOP_PAGE_SIZE = 12;

function effectivePrice(p) { return p.sale_price != null ? Number(p.sale_price) : Number(p.price); }

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

  // Normalize id to a string: it round-trips through HTML data- attributes
  // (always strings) and localStorage cart entries, so every comparison
  // downstream needs a consistent type regardless of whether the products
  // table uses uuid or integer ids.
  ALL_PRODUCTS = data.map(p => ({ ...p, id: String(p.id) }));
  await loadWishlistIds();
  await loadProductRatings();
  buildCategoryTabs();
  bindToolbar();
  renderGrid();
  injectProductListSchema();

  // The static, crawler-facing grid (scripts/generate-product-pages.py) has
  // done its job the moment this real, live grid renders — hide it so a
  // JS-capable visitor only ever sees the interactive version.
  const staticGrid = document.getElementById('staticProductGrid');
  if (staticGrid) staticGrid.style.display = 'none';
}

async function loadProductRatings() {
  PRODUCT_RATINGS = {};
  if (!ALL_PRODUCTS.length) return;
  try {
    const { data } = await supabaseClient.from('reviews').select('product_id, rating').in('product_id', ALL_PRODUCTS.map(p => p.id));
    const sums = {};
    (data || []).forEach(r => {
      const key = String(r.product_id);
      if (!sums[key]) sums[key] = { total: 0, count: 0 };
      sums[key].total += r.rating;
      sums[key].count += 1;
    });
    Object.keys(sums).forEach(key => { PRODUCT_RATINGS[key] = { avg: sums[key].total / sums[key].count, count: sums[key].count }; });
  } catch {
    // Ratings are a nice-to-have on the grid — a failed fetch just means no stars show, not a broken page.
  }
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
      url: 'https://ndelectronictechnologies.com/product/' + p.id + '/',
      item: {
        '@type': 'Product',
        name: p.name,
        image: p.image_url || undefined,
        category: p.category || undefined,
        url: 'https://ndelectronictechnologies.com/product/' + p.id + '/',
        offers: {
          '@type': 'Offer',
          priceCurrency: 'UGX',
          price: effectivePrice(p),
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
      shopPage = 1;
      buildCategoryTabs();
      renderGrid();
    });
  });
}

function bindToolbar() {
  const search = document.getElementById('shopSearch');
  const min = document.getElementById('priceMin');
  const max = document.getElementById('priceMax');
  const sort = document.getElementById('shopSort');
  if (!search) return;

  let debounceTimer = null;
  search.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { shopPage = 1; renderGrid(); }, 250);
  });
  [min, max].forEach(el => el.addEventListener('input', () => { shopPage = 1; renderGrid(); }));
  sort.addEventListener('change', () => { shopPage = 1; renderGrid(); });
}

function filteredSortedProducts() {
  const q = (document.getElementById('shopSearch')?.value || '').trim().toLowerCase();
  const min = document.getElementById('priceMin')?.value;
  const max = document.getElementById('priceMax')?.value;
  const sort = document.getElementById('shopSort')?.value || 'newest';

  let items = ACTIVE_CATEGORY === 'All' ? ALL_PRODUCTS.slice() : ALL_PRODUCTS.filter(p => p.category === ACTIVE_CATEGORY);

  if (q) {
    items = items.filter(p => `${p.name} ${p.description || ''} ${p.category || ''}`.toLowerCase().includes(q));
  }
  if (min) items = items.filter(p => effectivePrice(p) >= Number(min));
  if (max) items = items.filter(p => effectivePrice(p) <= Number(max));

  if (sort === 'price_asc') items.sort((a, b) => effectivePrice(a) - effectivePrice(b));
  else if (sort === 'price_desc') items.sort((a, b) => effectivePrice(b) - effectivePrice(a));
  else if (sort === 'rating') items.sort((a, b) => ((PRODUCT_RATINGS[b.id] && PRODUCT_RATINGS[b.id].avg) || 0) - ((PRODUCT_RATINGS[a.id] && PRODUCT_RATINGS[a.id].avg) || 0));
  // 'newest' needs no re-sort — ALL_PRODUCTS already arrived ordered that way.

  return items;
}

function starsSmallHtml(avg) {
  const rounded = Math.round(avg);
  let html = '<span class="shop-card-stars">';
  for (let i = 1; i <= 5; i++) html += `<svg class="${i <= rounded ? 'filled' : ''}"><use href="#ico-star"/></svg>`;
  return html + '</span>';
}

function renderGrid() {
  const grid = document.getElementById('shopGrid');
  const empty = document.getElementById('shopEmpty');
  const all = filteredSortedProducts();

  if (!all.length) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('shopPagination').innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  const totalPages = Math.max(1, Math.ceil(all.length / SHOP_PAGE_SIZE));
  shopPage = Math.min(shopPage, totalPages);
  const items = all.slice((shopPage - 1) * SHOP_PAGE_SIZE, shopPage * SHOP_PAGE_SIZE);

  grid.innerHTML = items.map(p => {
    const rating = PRODUCT_RATINGS[p.id];
    const onSale = p.sale_price != null && Number(p.sale_price) < Number(p.price);
    return `
    <div class="shop-card">
      <div class="shop-card-media">
        <a href="/product/${p.id}/" class="shop-card-img">
          ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" loading="lazy" />` : `<div class="shop-card-noimg">No image</div>`}
        </a>
        ${onSale ? '<span class="shop-card-sale-badge">Sale</span>' : ''}
        ${wishlistButtonHtml(p.id)}
      </div>
      <div class="shop-card-body">
        <span class="shop-card-cat">${p.category}</span>
        <a href="/product/${p.id}/"><h3>${p.name}</h3></a>
        ${rating ? `<div class="shop-card-rating">${starsSmallHtml(rating.avg)}<span>(${rating.count})</span></div>` : ''}
        <p>${p.description}</p>
        <div class="shop-card-foot">
          <span class="shop-card-price">
            ${onSale ? `<span class="was">${formatUGX(p.price)}</span> ${formatUGX(p.sale_price)}` : formatUGX(p.price)}
          </span>
          <button class="btn btn-primary" style="padding:9px 16px;font-size:13px;" data-add="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>
            ${p.stock < 1 ? 'Out of stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    </div>
  `;
  }).join('');

  grid.querySelectorAll('button[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = ALL_PRODUCTS.find(x => x.id === btn.dataset.add);
      addToCart(p, 1);
      btn.textContent = 'Added ✓';
      setTimeout(() => { btn.textContent = 'Add to Cart'; }, 1200);
    });
  });

  bindWishlistButtons(grid);
  renderShopPagination(all.length, totalPages);
}

function renderShopPagination(totalCount, totalPages) {
  const host = document.getElementById('shopPagination');
  if (!host) return;
  if (totalPages <= 1) { host.innerHTML = ''; return; }
  host.innerHTML = `
    <button type="button" id="shopPagePrev" ${shopPage === 1 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${shopPage} of ${totalPages} (${totalCount} product${totalCount === 1 ? '' : 's'})</span>
    <button type="button" id="shopPageNext" ${shopPage === totalPages ? 'disabled' : ''}>Next →</button>`;
  document.getElementById('shopPagePrev').addEventListener('click', () => { shopPage--; renderGrid(); window.scrollTo({ top: document.getElementById('shopGrid').offsetTop - 100, behavior: 'smooth' }); });
  document.getElementById('shopPageNext').addEventListener('click', () => { shopPage++; renderGrid(); window.scrollTo({ top: document.getElementById('shopGrid').offsetTop - 100, behavior: 'smooth' }); });
}

document.addEventListener('DOMContentLoaded', loadShopProducts);
