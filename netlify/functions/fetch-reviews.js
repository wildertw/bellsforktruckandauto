/**
 * Bells Fork Truck & Auto — Fetch Reviews Function
 * GET /.netlify/functions/fetch-reviews
 *
 * Fetches 5-star reviews from Google Places API, masks full names for privacy,
 * and caches results in Netlify Blobs (refreshes every 24 hours).
 *
 * Required env vars:
 *   GOOGLE_PLACES_API_KEY — Google Cloud API key with Places API enabled
 *   GOOGLE_PLACE_ID       — Google Place ID for the business
 *
 * Optional env var:
 *   REVIEW_CACHE_HOURS — Cache duration in hours (default: 24)
 */

const { getStore } = require('@netlify/blobs');

function blobStore(name) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) return null;
  return getStore({ name, siteID, token, apiURL: 'https://api.netlify.com' });
}

const ALLOWED_ORIGINS = new Set([
  'https://bellsforktruckandauto.com',
  'https://www.bellsforktruckandauto.com',
  'https://bellsforktruckandauto.netlify.app',
]);

function corsHeaders(event) {
  const origin = ((event && event.headers) || {}).origin || '';
  const matched = ALLOWED_ORIGINS.has(origin) ? origin : 'https://bellsforktruckandauto.com';
  return {
    'Access-Control-Allow-Origin': matched,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

const CACHE_KEY = 'google-reviews';
const DEFAULT_CACHE_HOURS = 24;

/**
 * Mask a full name for privacy: "Trey Wilder" → "Trey W."
 * If only one name, return as-is with period: "Trey" → "Trey"
 */
function maskName(fullName) {
  if (!fullName) return 'Anonymous';
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1].charAt(0).toUpperCase();
  return firstName + ' ' + lastInitial + '.';
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(event), body: '' };
  }
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: corsHeaders(event), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const cacheHours = parseInt(process.env.REVIEW_CACHE_HOURS, 10) || DEFAULT_CACHE_HOURS;

  // Try loading from cache first
  const store = blobStore('review-cache');
  if (store) {
    try {
      const raw = await store.get(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        const age = Date.now() - (cached.fetchedAt || 0);
        if (age < cacheHours * 60 * 60 * 1000) {
          return {
            statusCode: 200,
            headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
            body: JSON.stringify({ ok: true, reviews: cached.reviews, source: 'cache', fetchedAt: cached.fetchedAt }),
          };
        }
      }
    } catch { /* cache miss, fetch fresh */ }
  }

  // Fetch from Google Places API
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.GOOGLE_PLACE_ID;

  if (!apiKey || !placeId) {
    // No Google config — return any manually added reviews from blobs
    let manualReviews = [];
    if (store) {
      try {
        const raw = await store.get('manual-reviews');
        if (raw) manualReviews = JSON.parse(raw);
      } catch { /* no manual reviews */ }
    }
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        reviews: manualReviews,
        source: 'manual',
        message: !apiKey ? 'GOOGLE_PLACES_API_KEY not set' : 'GOOGLE_PLACE_ID not set',
      }),
    };
  }

  try {
    const url = 'https://maps.googleapis.com/maps/api/place/details/json' +
      '?place_id=' + encodeURIComponent(placeId) +
      '&fields=reviews,rating,user_ratings_total,name' +
      '&reviews_sort=newest' +
      '&key=' + apiKey;

    const res = await fetch(url);
    if (!res.ok) {
      return {
        statusCode: 502,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Google API returned ' + res.status }),
      };
    }

    const data = await res.json();
    if (data.status !== 'OK') {
      return {
        statusCode: 502,
        headers: corsHeaders(event),
        body: JSON.stringify({ error: 'Google API error: ' + data.status, detail: data.error_message }),
      };
    }

    const allReviews = (data.result && data.result.reviews) || [];
    const businessName = (data.result && data.result.name) || '';
    const overallRating = (data.result && data.result.rating) || 0;
    const totalRatings = (data.result && data.result.user_ratings_total) || 0;

    // Filter to 5-star only, mask names
    const fiveStarReviews = allReviews
      .filter(function (r) { return r.rating === 5; })
      .map(function (r) {
        return {
          author: maskName(r.author_name),
          rating: r.rating,
          text: r.text || '',
          time: r.time,
          relativeTime: r.relative_time_description || '',
          source: 'google',
        };
      });

    // Also load any manual reviews and merge
    let manualReviews = [];
    if (store) {
      try {
        const raw = await store.get('manual-reviews');
        if (raw) manualReviews = JSON.parse(raw);
      } catch { /* no manual reviews */ }
    }

    const combined = fiveStarReviews.concat(manualReviews);

    // Sort by time descending (newest first)
    combined.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });

    // Cache the result
    if (store) {
      try {
        await store.set(CACHE_KEY, JSON.stringify({
          reviews: combined,
          fetchedAt: Date.now(),
          overallRating: overallRating,
          totalRatings: totalRatings,
          businessName: businessName,
        }));
      } catch { /* cache write failed, non-fatal */ }
    }

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
      body: JSON.stringify({
        ok: true,
        reviews: combined,
        overallRating: overallRating,
        totalRatings: totalRatings,
        source: 'google',
        fetchedAt: Date.now(),
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: corsHeaders(event),
      body: JSON.stringify({ error: 'Failed to fetch reviews: ' + err.message }),
    };
  }
};
