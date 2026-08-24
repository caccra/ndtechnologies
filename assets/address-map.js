/* ND Electronic Technologies Ltd — shared Google Maps address picker
   Used by checkout (assets/checkout.js) and the Address Book
   (account/index.html). If the API key isn't configured yet or fails to
   load, initAddressMap() rejects quietly and the plain address text input
   it was attached to keeps working on its own — a map failure must never
   block checkout or saving an address. */

let mapsLoadPromise = null;

function loadGoogleMapsApi() {
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) { resolve(); return; }
    if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.includes('YOUR-GOOGLE-MAPS-API-KEY-HERE')) {
      reject(new Error('Google Maps API key not configured'));
      return;
    }

    const timeout = setTimeout(() => reject(new Error('Google Maps took too long to load')), 8000);
    window.__ndetOnGoogleMapsLoaded = () => { clearTimeout(timeout); resolve(); };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}&libraries=places&callback=__ndetOnGoogleMapsLoaded`;
    script.async = true;
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(script);
  });

  return mapsLoadPromise;
}

const KAMPALA_CENTER = { lat: 0.3476, lng: 32.5825 };

/**
 * containerEl: element to render the map into
 * searchInputEl: existing text input to attach Places Autocomplete to
 * initialAddress/initialLat/initialLng: optional starting point
 * onChange({ lat, lng, address }): called whenever the pin moves or a place is picked
 */
async function initAddressMap({ containerEl, searchInputEl, initialAddress, initialLat, initialLng, onChange }) {
  try {
    await loadGoogleMapsApi();
  } catch (err) {
    console.warn('Address map unavailable:', err.message);
    return;
  }

  const hasInitial = initialLat != null && initialLng != null;
  const center = hasInitial ? { lat: Number(initialLat), lng: Number(initialLng) } : KAMPALA_CENTER;

  containerEl.classList.add('ready');
  const map = new google.maps.Map(containerEl, { center, zoom: hasInitial ? 16 : 12 });
  const marker = new google.maps.Marker({ position: center, map, draggable: true });
  const geocoder = new google.maps.Geocoder();

  if (initialAddress && searchInputEl && !searchInputEl.value) {
    searchInputEl.value = initialAddress;
  }

  const autocomplete = new google.maps.places.Autocomplete(searchInputEl, {
    componentRestrictions: { country: 'ug' },
    fields: ['geometry', 'formatted_address'],
  });
  autocomplete.bindTo('bounds', map);

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry || !place.geometry.location) return;
    const loc = place.geometry.location;
    map.setCenter(loc);
    map.setZoom(16);
    marker.setPosition(loc);
    onChange({ lat: loc.lat(), lng: loc.lng(), address: place.formatted_address || searchInputEl.value });
  });

  marker.addListener('dragend', () => {
    const pos = marker.getPosition();
    geocoder.geocode({ location: pos }, (results, status) => {
      const address = (status === 'OK' && results[0]) ? results[0].formatted_address : `${pos.lat().toFixed(6)}, ${pos.lng().toFixed(6)}`;
      searchInputEl.value = address;
      onChange({ lat: pos.lat(), lng: pos.lng(), address });
    });
  });
}
