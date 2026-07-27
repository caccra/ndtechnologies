/* ND Electronic Technologies Ltd — shared site script
   Injects the icon sprite + logo, wires up nav/menu/reveal, handles the contact form. */

(function () {
  const ICON_SPRITE = `
  <defs>
    <symbol id="ico-cam" viewBox="0 0 24 24">
      <rect x="2" y="8.5" width="12.5" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="16" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M6 15.5V18M3.5 18h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M18.5 6.5q2.2 2.2 0 4.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M20.7 4.3q3.6 3.6 0 7.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-sun" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M12 1.5v1.8M5.6 4.4l1.3 1.3M18.4 4.4l-1.3 1.3M2.5 8h1.8M21.5 8h-1.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      <rect x="4.5" y="15" width="15" height="5.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M8.5 15v5.5M12 15v5.5M15.5 15v5.5M4.5 17.7h15" fill="none" stroke="currentColor" stroke-width="1.3"/>
    </symbol>
    <symbol id="ico-carport" viewBox="0 0 24 24">
      <path d="M2 8.6L21.5 6.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M5 8.3v11M19 6.7v11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="6.5" y="14.5" width="12" height="4.3" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <circle cx="9.2" cy="19.6" r="1.3" fill="currentColor"/>
      <circle cx="15.8" cy="19.6" r="1.3" fill="currentColor"/>
    </symbol>
    <symbol id="ico-fire" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.9" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M12 1.6v1M8.6 3.3l.7.7M15.4 3.3l-.7.7M7.3 6h1M16.7 6h-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M12 7.4v3.4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M12 11c-2.6 3-2.6 6 0 9 2.6-3 2.6-6 0-9Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-net" viewBox="0 0 24 24">
      <circle cx="12" cy="5.5" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="5.5" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="18.5" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M10.6 7.1L7 16.2M13.4 7.1L17 16.2M7.5 18h9" fill="none" stroke="currentColor" stroke-width="1.6"/>
    </symbol>
    <symbol id="ico-dish" viewBox="0 0 24 24">
      <ellipse cx="9" cy="10" rx="7" ry="4" transform="rotate(-25 9 10)" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <circle cx="9" cy="10" r="1.5" fill="currentColor"/>
      <path d="M9 10 17 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M17 17v4M15 21h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M14 5q3 1 3 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M16.5 2.7q4.5 1.5 4.3 6.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-ac" viewBox="0 0 24 24">
      <rect x="2" y="5.5" width="20" height="7.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>
      <path d="M5 9h14M5 11.3h14" fill="none" stroke="currentColor" stroke-width="1.3"/>
      <path d="M6 15.5q2 3 4 0M11 15.5q2 3 4 0M16 15.5q2 3 4 0" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-bolt" viewBox="0 0 24 24">
      <path d="M13 2 5 14h6l-2 8 9-13h-6l1-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-pin" viewBox="0 0 24 24">
      <path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="12" cy="9.5" r="2.4" fill="none" stroke="currentColor" stroke-width="1.8"/>
    </symbol>
    <symbol id="ico-phone" viewBox="0 0 24 24">
      <path d="M4.5 4.2 8 3.5c.6-.1 1.1.2 1.3.8l1 2.7c.2.5 0 1.1-.4 1.4L8.4 9.8c1 2.6 3 4.7 5.6 5.7l1.4-1.5c.4-.4 1-.5 1.4-.3l2.7 1c.6.2.9.8.8 1.3l-.7 3.5c-.1.6-.7 1-1.3.9-7.2-1-13-6.8-14-14-.1-.6.3-1.2.9-1.3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-mail" viewBox="0 0 24 24">
      <rect x="2.5" y="5" width="19" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M3.5 6.5 12 13l8.5-6.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-whatsapp" viewBox="0 0 24 24">
      <path d="M4 20l1.3-4A8 8 0 1 1 8.7 19L4 20Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M8.3 8.8c.3-1 1.3-.9 1.6-.2.3.6.7 1.5.8 1.8.2.4 0 .7-.2 1-.3.3-.5.5-.2 1 .3.6 1.5 2 3 2.5.4.2.6 0 .9-.3.3-.3.6-.6 1-.4.3.1 1.4.7 1.7.9.3.2.5.3.5.6 0 .8-.9 1.6-1.7 1.6-1.5 0-4.6-1.4-6.1-4.4-.4-.8-.6-1.5-.6-2.1 0-1 .1-1.7.3-2Z" fill="currentColor"/>
    </symbol>
    <symbol id="ico-check" viewBox="0 0 24 24">
      <path d="M4 12.5 9.5 18 20 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-facebook" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M13.6 8.4h1.4V6.2h-1.7c-1.8 0-2.9 1.1-2.9 2.9v1.3H8.9v2.3h1.5v5.6h2.3v-5.6h1.7l.3-2.3h-2v-1c0-.6.2-1 .9-1Z" fill="currentColor"/>
    </symbol>
    <symbol id="ico-tiktok" viewBox="0 0 24 24">
      <path d="M14 3v10.6a3 3 0 1 1-2-2.83V3h2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M14 3.3c.3 2.2 1.9 3.8 4 4.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
  </defs>`;

  const LOGO_LIGHT = `
  <svg viewBox="0 0 195 46" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="ndGradA" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#8fa8be"/><stop offset="35%" stop-color="#1565c0"/>
        <stop offset="70%" stop-color="#0a1628"/><stop offset="100%" stop-color="#00b4d8"/>
      </linearGradient>
      <linearGradient id="swooshGradA" x1="0%" y1="50%" x2="100%" y2="50%">
        <stop offset="0%" stop-color="#00b4d8" stop-opacity="0"/><stop offset="50%" stop-color="#00b4d8"/>
        <stop offset="100%" stop-color="#1565c0" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <text x="2" y="34" font-family="Space Grotesk,Arial" font-weight="700" font-size="34" fill="url(#ndGradA)" letter-spacing="-2">N</text>
    <text x="28" y="34" font-family="Space Grotesk,Arial" font-weight="700" font-size="34" fill="url(#ndGradA)" letter-spacing="-2">D</text>
    <path d="M2 38 Q40 47 78 35" stroke="url(#swooshGradA)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="30" cy="40" r="1.6" fill="#00b4d8"/><circle cx="50" cy="42" r="1.6" fill="#00b4d8"/>
    <text x="84" y="20" font-family="Space Grotesk,Arial" font-weight="700" font-size="12.5" fill="#1565c0" letter-spacing="1">ELECTRONIC</text>
    <text x="84" y="34" font-family="IBM Plex Mono,monospace" font-weight="600" font-size="9" fill="#8fa8be" letter-spacing="2.5">— TECHNOLOGIES —</text>
  </svg>`;

  function footerLogoVariant(svg) {
    return svg
      .replace(/#1565c0/g, '#00b4d8')
      .replace(/#8fa8be/g, '#c7d3de')
      .replace(/#0a1628/g, '#c7d3de')
      .replace(/ndGradA/g, 'ndGradB')
      .replace(/swooshGradA/g, 'swooshGradB');
  }

  function init() {
    // icon sprite (hidden, reused via <use>)
    const spriteHost = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    spriteHost.setAttribute('width', '0');
    spriteHost.setAttribute('height', '0');
    spriteHost.setAttribute('style', 'position:absolute');
    spriteHost.setAttribute('aria-hidden', 'true');
    spriteHost.innerHTML = ICON_SPRITE;
    document.body.insertBefore(spriteHost, document.body.firstChild);

    // logo injection
    const navBrand = document.getElementById('navBrand');
    if (navBrand) navBrand.innerHTML = LOGO_LIGHT;
    const footerBrand = document.getElementById('footerBrand');
    if (footerBrand) footerBrand.innerHTML = footerLogoVariant(LOGO_LIGHT);

    // active nav link (set data-page="home|services|about|contact" on <body>)
    const page = document.body.getAttribute('data-page');
    if (page) {
      document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(a => {
        if (a.getAttribute('data-nav') === page) a.classList.add('active');
      });
    }

    // nav scroll shadow
    const navbar = document.getElementById('navbar');
    if (navbar) window.addEventListener('scroll', () => navbar.classList.toggle('scrolled', window.scrollY > 20));

    // hamburger
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', () => {
        const open = mobileMenu.classList.toggle('open');
        hamburger.setAttribute('aria-expanded', open);
      });
      mobileMenu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', false);
      }));
    }

    // scroll reveal
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('visible'), i * 70);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

    // contact form: prefill "system" select from ?service= query param, then demo-submit
    const form = document.getElementById('contactForm');
    if (form) {
      const params = new URLSearchParams(window.location.search);
      const service = params.get('service');
      const select = form.querySelector('select[name="service"]');
      if (service && select) {
        [...select.options].forEach(opt => { if (opt.value === service) select.value = service; });
      }
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        const btn = form.querySelector('.form-submit');
        btn.textContent = 'Sending...';
        btn.disabled = true;
        setTimeout(() => {
          document.getElementById('formSuccess').style.display = 'block';
          btn.style.display = 'none';
        }, 1000);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
