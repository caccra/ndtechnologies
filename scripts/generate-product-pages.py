#!/usr/bin/env python3
"""
ND Electronic Technologies Ltd — static product page generator.

WHY THIS EXISTS
----------------
/product/index.html renders everything (name, price, description, image,
Product schema) client-side via JavaScript after fetching from Supabase.
That's fine for a human visitor's browser, but most AI answer-engine
crawlers (GPTBot, ClaudeBot, PerplexityBot, and others) fetch raw HTML and
do NOT execute JavaScript — to them, every product page looks identical
and empty. This script closes that gap the only way possible on a plain
static-file site with no build/server process: it queries Supabase directly
(the same public, read-only data any shop visitor's browser already sees —
see the "public read active products" policy in supabase/schema.sql) and
writes one real, fully-rendered static HTML page per product, each with
its actual name/price/description/image and a static (not JS-injected)
Product JSON-LD block baked directly into the file.

It also regenerates a static, crawlable product grid section inside
shop/index.html, appended after the existing JS-driven grid (which stays
exactly as-is for real visitors — this only adds a fallback for crawlers
that never run the JS in the first place).

WHEN TO RUN THIS
-----------------
Manually, whenever products change — after adding, editing, hiding, or
deleting a product in the admin panel. It is not wired to run
automatically (that would need a build/deploy pipeline this project
doesn't have); see SETUP.md for how to wire it into one if you deploy
somewhere that supports build hooks (Netlify, Vercel, etc.).

USAGE
------
    python scripts/generate-product-pages.py

Reads SUPABASE_URL / SUPABASE_ANON_KEY straight out of
assets/supabase-config.js (no separate config needed) and writes into
product/<id>/index.html for every active product, plus updates the
<!-- STATIC_PRODUCT_GRID --> block in shop/index.html.
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read_supabase_config():
    """Pull SUPABASE_URL / SUPABASE_ANON_KEY out of assets/supabase-config.js
    so this script never needs its own separate copy of them to go stale."""
    path = os.path.join(ROOT, 'assets', 'supabase-config.js')
    text = open(path, encoding='utf-8').read()
    url_m = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", text)
    key_m = re.search(r"SUPABASE_ANON_KEY\s*=\s*'([^']+)'", text)
    if not url_m or not key_m:
        sys.exit('Could not find SUPABASE_URL / SUPABASE_ANON_KEY in assets/supabase-config.js')
    url, key = url_m.group(1), key_m.group(1)
    if 'YOUR-PROJECT-REF' in url or 'YOUR-ANON-PUBLIC-KEY' in key:
        sys.exit('assets/supabase-config.js still has placeholder values — connect Supabase first (see SETUP.md).')
    return url, key


def fetch_active_products(supabase_url, anon_key):
    api_url = f'{supabase_url}/rest/v1/products?is_active=eq.true&select=*&order=created_at.desc'
    req = urllib.request.Request(api_url, headers={
        'apikey': anon_key,
        'Authorization': f'Bearer {anon_key}',
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.URLError as e:
        sys.exit(f'Could not reach Supabase: {e}')


def esc(s):
    if s is None:
        return ''
    return (str(s)
            .replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;').replace("'", '&#39;'))


def ugx(n):
    return 'UGX ' + format(int(n), ',')


PRODUCT_PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>{title}</title>
<meta name="description" content="{description}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="{page_url}" />
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" href="/assets/images/favicon-32x32.png" sizes="32x32" />
<link rel="icon" type="image/png" href="/assets/images/favicon-192x192.png" sizes="192x192" />
<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png" />
<meta name="theme-color" content="#0a1628" />
<meta property="og:type" content="product" />
<meta property="og:site_name" content="ND Electronic Technologies Ltd" />
<meta property="og:title" content="{title}" />
<meta property="og:description" content="{description}" />
<meta property="og:url" content="{page_url}" />
<meta property="og:image" content="{image}" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600;700&family=Poppins:wght@500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/assets/styles.css" />
<script type="application/ld+json">
{product_ld}
</script>
</head>
<body data-page="shop">

<nav id="navbar">
  <a href="/" class="brand" id="navBrand"></a>
  <ul class="nav-links">
    <li><a href="/" data-nav="home">Home</a></li>
    <li><a href="/services/" data-nav="services">Services</a></li>
    <li><a href="/shop/" data-nav="shop">Shop</a></li>
    <li><a href="/about/" data-nav="about">About</a></li>
    <li><a href="/contact/" data-nav="contact">Contact</a></li>
  </ul>
  <div class="nav-right">
    <a href="/account/" class="account-icon-link" aria-label="Account"><svg><use href="#ico-user"/></svg></a>
    <a href="/cart/" class="cart-icon-link" aria-label="Cart">
      <svg viewBox="0 0 24 24" fill="none"><path d="M3 4h2l2.4 12.2a2 2 0 0 0 2 1.8h7.6a2 2 0 0 0 2-1.6L21 8H6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="21" r="1.4" fill="currentColor"/><circle cx="17" cy="21" r="1.4" fill="currentColor"/></svg>
      <span class="cart-badge" data-cart-count>0</span>
    </a>
    <a href="/account/" class="btn btn-primary" style="padding:11px 20px;font-size:13.5px;">My Account</a>
  </div>
  <button class="hamburger" id="hamburger" aria-label="Toggle menu" aria-expanded="false">
    <span></span><span></span><span></span>
  </button>
</nav>

<div class="mobile-menu" id="mobileMenu">
  <a href="/" data-nav="home">Home</a>
  <a href="/services/" data-nav="services">Services</a>
  <a href="/shop/" data-nav="shop">Shop</a>
  <a href="/about/" data-nav="about">About</a>
  <a href="/contact/" data-nav="contact">Contact</a>
  <a href="/account/">My Account</a>
  <a href="/cart/">Cart (<span data-cart-count style="display:inline">0</span>)</a>
  <a href="/account/" class="btn btn-primary">My Account</a>
</div>

<!--
  This page is a real static render of this product (see
  scripts/generate-product-pages.py) so search/AI crawlers that don't run
  JavaScript can actually read it. A visitor's browser immediately
  redirects to the live, interactive version at /product/?id={product_id}
  (cart, quantity picker, reviews, wishlist) — everything below this point
  is what a crawler sees; a human never does.
-->
<noscript></noscript>
<meta http-equiv="refresh" content="0; url=/product/?id={product_id}" />

<section style="padding-top:116px;padding-bottom:80px;">
  <div class="container">
    <div class="breadcrumb" style="color:var(--text-muted);margin-bottom:30px;">
      <a href="/shop/" style="color:var(--text-muted);text-decoration:none;">Shop</a><span class="sep"> / </span><span>{name}</span>
    </div>
    <div class="product-detail-grid">
      <div class="product-detail-img">
        {image_tag}
      </div>
      <div class="product-detail-info">
        <div class="product-detail-cat">{category}</div>
        <h1>{name}</h1>
        <div class="product-detail-price">{price}</div>
        <p class="desc">{description}</p>
        <p class="stock-note">{stock_note}</p>
        <a href="/product/?id={product_id}" class="btn btn-primary" style="margin-top:14px;">View &amp; Order This Product →</a>
      </div>
    </div>
  </div>
</section>

<footer style="margin-top:0;">
  <div class="footer-bottom" style="border-top:none;padding-top:0;">
    <span>© 2021–2026 ND Electronic Technologies Ltd. All rights reserved.</span>
    <span>Lukuli, Nanganda — Kampala, Uganda</span>
  </div>
</footer>

</body>
</html>
"""


def render_product_page(p, supabase_url):
    page_url = f'https://ndelectronictechnologies.com/product/{p["id"]}/'
    name = p.get('name') or 'Product'
    description = (p.get('description') or '').strip() or f'{name} — available from ND Electronic Technologies Ltd, delivered in Kampala, Uganda.'
    price = p.get('price') or 0
    stock = p.get('stock') or 0
    image = p.get('image_url') or ''
    category = p.get('category') or 'General'

    product_ld = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        'name': name,
        'description': description,
        'category': category,
        'url': page_url,
        'brand': {'@type': 'Brand', 'name': 'ND Electronic Technologies Ltd'},
        'offers': {
            '@type': 'Offer',
            'priceCurrency': 'UGX',
            'price': price,
            'availability': 'https://schema.org/InStock' if stock > 0 else 'https://schema.org/OutOfStock',
            'url': page_url,
            'seller': {'@type': 'Organization', 'name': 'ND Electronic Technologies Ltd'},
        },
    }
    if image:
        product_ld['image'] = image

    return PRODUCT_PAGE_TEMPLATE.format(
        title=esc(f'{name} — ND Electronic Technologies Ltd'),
        description=esc(description[:200]),
        page_url=page_url,
        image=esc(image),
        product_ld=json.dumps(product_ld, ensure_ascii=False, indent=2),
        product_id=p['id'],
        name=esc(name),
        category=esc(category),
        price=esc(ugx(price)),
        description_full=esc(description),
        stock_note=f'{stock} in stock' if stock > 0 else 'Out of stock',
        image_tag=(f'<img src="{esc(image)}" alt="{esc(name)}" />' if image else ''),
    )


STATIC_GRID_START = '<!-- STATIC_PRODUCT_GRID:START — regenerated by scripts/generate-product-pages.py, do not hand-edit -->'
STATIC_GRID_END = '<!-- STATIC_PRODUCT_GRID:END -->'


def render_static_grid_item(p):
    name = esc(p.get('name') or 'Product')
    price = esc(ugx(p.get('price') or 0))
    category = esc(p.get('category') or 'General')
    desc = esc((p.get('description') or '')[:140])
    image = p.get('image_url') or ''
    img_html = f'<img src="{esc(image)}" alt="{name}" loading="lazy" />' if image else ''
    return f'''      <div class="shop-card">
        <a href="/product/{p['id']}/" class="shop-card-img">{img_html}</a>
        <div class="shop-card-body">
          <span class="shop-card-cat">{category}</span>
          <a href="/product/{p['id']}/"><h3>{name}</h3></a>
          <p>{desc}</p>
          <div class="shop-card-foot"><span class="shop-card-price">{price}</span></div>
        </div>
      </div>'''


def update_shop_static_grid(products):
    path = os.path.join(ROOT, 'shop', 'index.html')
    text = open(path, encoding='utf-8').read()

    if STATIC_GRID_START not in text:
        # First run — insert the block right after #shopGrid's closing div,
        # inside the same <section>, so it lives alongside the live JS grid.
        anchor = '<div class="shop-empty" id="shopEmpty" style="display:none;">'
        if anchor not in text:
            print('WARNING: could not find insertion point in shop/index.html — skipping static grid update.')
            return
        block = (
            f'    <noscript>\n{STATIC_GRID_START}\n'
            f'      <div class="shop-grid">\n{{items}}\n      </div>\n'
            f'{STATIC_GRID_END}\n    </noscript>\n    ' + anchor
        )
        text = text.replace('    ' + anchor, block)

    items_html = '\n'.join(render_static_grid_item(p) for p in products) if products else '      <p>Check back soon — new products are added regularly.</p>'
    pattern = re.compile(
        re.escape(STATIC_GRID_START) + r'.*?' + re.escape(STATIC_GRID_END), re.S
    )
    replacement = f'{STATIC_GRID_START}\n      <div class="shop-grid">\n{items_html}\n      </div>\n{STATIC_GRID_END}'
    text, n = pattern.subn(replacement, text)
    if n:
        open(path, 'w', encoding='utf-8').write(text)


def main():
    supabase_url, anon_key = read_supabase_config()
    print(f'Fetching active products from {supabase_url} ...')
    products = fetch_active_products(supabase_url, anon_key)
    print(f'Found {len(products)} active product(s).')

    product_dir = os.path.join(ROOT, 'product')
    written = 0
    for p in products:
        if not p.get('id'):
            continue
        out_dir = os.path.join(product_dir, str(p['id']))
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, 'index.html')
        html = render_product_page(p, supabase_url)
        open(out_path, 'w', encoding='utf-8').write(html)
        written += 1
        print(f'  wrote product/{p["id"]}/index.html — {p.get("name")}')

    update_shop_static_grid(products)
    print(f'Done — {written} static product page(s) written, shop grid updated.')
    print('Remember to also add these URLs to sitemap.xml (or re-run your sitemap generator) and redeploy.')


if __name__ == '__main__':
    main()
