/* ND Electronic Technologies Ltd — Clerk config (customer accounts only)
   Powers /account/login/, /account/register/, and any page that needs to
   know whether a customer is signed in (cart.js, checkout.js). The admin
   panel is unaffected — it stays on Supabase's own Auth, see SETUP.md
   section 10 for how these two auth systems coexist. */

const CLERK_PUBLISHABLE_KEY = 'pk_test_ZGl2ZXJzZS1jcmFuZS0zODU0LmNsZXJrLmFjY291bnRzLmRldiQ';
const CLERK_FRONTEND_API = 'diverse-crane-3854.clerk.accounts.dev';

/* Loads Clerk's script-tag SDK (no npm/build step — same pattern as the
   Supabase SDK, Google Maps and Flutterwave already used on this site) and
   resolves once `window.Clerk` is ready to use (`Clerk.load()` has run).
   Safe to call multiple times — later calls reuse the same promise. */
let _clerkReadyPromise = null;
function loadClerk() {
  if (_clerkReadyPromise) return _clerkReadyPromise;
  _clerkReadyPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.setAttribute('data-clerk-publishable-key', CLERK_PUBLISHABLE_KEY);
    script.src = `https://${CLERK_FRONTEND_API}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js`;
    script.addEventListener('load', async () => {
      try {
        await window.Clerk.load();
        resolve(window.Clerk);
      } catch (err) {
        reject(err);
      }
    });
    script.addEventListener('error', () => reject(new Error('Could not load Clerk')));
    document.head.appendChild(script);
  });
  return _clerkReadyPromise;
}
