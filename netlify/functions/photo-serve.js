/**
 * Bells Fork Truck & Auto — Photo Serve Function
 * GET /.netlify/functions/photo-serve/{key}
 *
 * Reads a vehicle photo from Netlify Blobs and returns it with
 * aggressive cache headers for edge caching by Image CDN.
 * No auth required — photos are public.
 *
 * Accessed via redirect: /photos/* → /.netlify/functions/photo-serve/:splat
 */

const { getStore } = require('@netlify/blobs');

// V1 function blob config
function blobStore(nameOrOpts) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error('Blob config missing');
  }
  const cfg = { siteID, token, apiURL: 'https://api.netlify.com' };
  if (typeof nameOrOpts === 'string') return getStore({ name: nameOrOpts, ...cfg });
  return getStore({ ...nameOrOpts, ...cfg });
}

const MIME_TYPES = {
  png:  'image/png',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif:  'image/gif',
  avif: 'image/avif',
};

exports.handler = async (event) => {
  // Extract key from path — handles both direct and redirect-proxied calls:
  //   /.netlify/functions/photo-serve/02881BF-01.png → 02881BF-01.png
  //   /photos/02881BF-01.png → 02881BF-01.png  (via netlify.toml rewrite)
  const raw = event.path
    .replace(/^\/\.netlify\/functions\/photo-serve\/?/, '')
    .replace(/^\/photos\/?/, '');
  const key = decodeURIComponent(raw).replace(/^\/+/, '');

  if (!key) {
    return { statusCode: 400, body: 'Missing photo key' };
  }

  try {
    const store = blobStore('vehicle-photos');
    const data = await store.get(key, { type: 'arrayBuffer' });

    if (!data) {
      return { statusCode: 404, body: 'Photo not found' };
    }

    // Determine content type from extension
    const ext = (key.split('.').pop() || 'png').toLowerCase();
    const contentType = MIME_TYPES[ext] || 'image/png';

    const base64Body = Buffer.from(data).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: base64Body,
      isBase64Encoded: true,
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: 'Failed to serve photo: ' + err.message,
    };
  }
};
