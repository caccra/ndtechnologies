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
    <symbol id="ico-arrow-up" viewBox="0 0 24 24">
      <path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-gate" viewBox="0 0 24 24">
      <path d="M2 20V6M22 20V6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M2 9h20M2 14h20" fill="none" stroke="currentColor" stroke-width="1.5"/>
      <rect x="9" y="16.5" width="6" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>
    </symbol>
    <symbol id="ico-fence" viewBox="0 0 24 24">
      <path d="M4 5v15M12 5v15M20 5v15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M2 9h20M2 13h20M2 17h20" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="1 2.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-alarm" viewBox="0 0 24 24">
      <path d="M12 3a5 5 0 0 0-5 5v3.5c0 1-.4 2-1.1 2.7L4.5 15.7c-.6.6-.2 1.8.7 1.8h13.6c.9 0 1.3-1.2.7-1.8l-1.4-1.5A3.8 3.8 0 0 1 17 11.5V8a5 5 0 0 0-5-5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M9.5 19a2.5 2.5 0 0 0 5 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-access" viewBox="0 0 24 24">
      <rect x="2" y="7" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <circle cx="6.5" cy="12" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <path d="M10.5 9.5q1.5 2.5 0 5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M13 8q3 4 0 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M18 6q3 6 0 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-facebook" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M13.6 8.4h1.4V6.2h-1.7c-1.8 0-2.9 1.1-2.9 2.9v1.3H8.9v2.3h1.5v5.6h2.3v-5.6h1.7l.3-2.3h-2v-1c0-.6.2-1 .9-1Z" fill="currentColor"/>
    </symbol>
    <symbol id="ico-tiktok" viewBox="0 0 24 24">
      <path d="M14 3v10.6a3 3 0 1 1-2-2.83V3h2Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M14 3.3c.3 2.2 1.9 3.8 4 4.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-cash" viewBox="0 0 24 24">
      <rect x="2" y="6" width="20" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/>
      <path d="M5.5 6v12M18.5 6v12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="1.4 1.8"/>
    </symbol>
    <symbol id="ico-card" viewBox="0 0 24 24">
      <rect x="2" y="5" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M2 9.5h20" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M5 14.5h5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-shield" viewBox="0 0 24 24">
      <path d="M12 3.5 19 6v5.5c0 4.6-3 7.7-7 9-4-1.3-7-4.4-7-9V6l7-2.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
      <path d="M9 12.2 11.2 14.5 15.5 9.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-user" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/>
      <path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </symbol>
    <symbol id="ico-heart" viewBox="0 0 24 24">
      <path d="M12 20.2S3.5 15 3.5 9.1A4.6 4.6 0 0 1 12 6.5a4.6 4.6 0 0 1 8.5 2.6C20.5 15 12 20.2 12 20.2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
    </symbol>
    <symbol id="ico-star" viewBox="0 0 24 24">
      <path d="M12 3.5 14.7 9 20.8 9.9 16.4 14.1 17.5 20.2 12 17.3 6.5 20.2 7.6 14.1 3.2 9.9 9.3 9Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
    </symbol>
  </defs>`;

  const LOGO_IMG = '<img src="/assets/images/nd-logo-clean.jpg" alt="ND Electronic Technologies Ltd" />';

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
    if (navBrand) navBrand.innerHTML = LOGO_IMG;
    const footerBrand = document.getElementById('footerBrand');
    if (footerBrand) footerBrand.innerHTML = LOGO_IMG;

    // footer copyright year range (founded 2021 -> current year)
    const copyrightEl = document.getElementById('copyrightYears');
    if (copyrightEl) {
      const startYear = 2021;
      const currentYear = new Date().getFullYear();
      copyrightEl.textContent = currentYear > startYear ? `${startYear}–${currentYear}` : `${startYear}`;
    }

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

    // scroll-to-top button
    const scrollTopBtn = document.createElement('button');
    scrollTopBtn.className = 'scroll-top-btn';
    scrollTopBtn.setAttribute('aria-label', 'Scroll to top');
    scrollTopBtn.innerHTML = '<svg><use href="#ico-arrow-up"/></svg>';
    document.body.appendChild(scrollTopBtn);
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
    });
    scrollTopBtn.addEventListener('click', () => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
    });

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
