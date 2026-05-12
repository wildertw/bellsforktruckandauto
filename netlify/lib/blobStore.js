const { getStore } = require('@netlify/blobs');

// When running on Netlify, NETLIFY_BLOBS_CONTEXT is auto-injected and the
// SDK uses it transparently — no PAT required. Locally that var is absent,
// so fall back to SITE_ID + NF_API_TOKEN.
function blobStore(nameOrOpts) {
  const opts = typeof nameOrOpts === 'string' ? { name: nameOrOpts } : { ...nameOrOpts };

  if (process.env.NETLIFY_BLOBS_CONTEXT) {
    return getStore(opts);
  }

  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) {
    throw new Error(
      'Blob config missing: SITE_ID=' + (siteID ? 'set' : 'UNSET') +
      ', NF_API_TOKEN=' + (token ? 'set' : 'UNSET')
    );
  }
  return getStore({ ...opts, siteID, token, apiURL: 'https://api.netlify.com' });
}

module.exports = { blobStore };
