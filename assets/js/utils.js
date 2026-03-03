/* Shared utilities for client scripts */
(function (global) {
  'use strict';

  // Minimal synchronous SHA-1 returning hex string (browser-friendly)
  function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
  function toHex(i) { return (i >>> 0).toString(16).padStart(8, '0'); }

  function sha1Hex(msg) {
    // UTF-8 encode
    msg = unescape(encodeURIComponent(msg || ''));
    const ml = msg.length * 8;

    const words = [];
    for (let i = 0; i < msg.length; i++) {
      words[i >> 2] |= msg.charCodeAt(i) << (24 - (i % 4) * 8);
    }
    words[ml >> 5] |= 0x80 << (24 - (ml % 32));
    words[(((ml + 64) >> 9) << 4) + 15] = ml;

    let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

    for (let i = 0; i < words.length; i += 16) {
      const w = new Array(80);
      for (let t = 0; t < 16; t++) w[t] = words[i + t] | 0;
      for (let t = 16; t < 80; t++) w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);

      let a = h0, b = h1, c = h2, d = h3, e = h4;

      for (let t = 0; t < 80; t++) {
        let f, k;
        if (t < 20)      { f = (b & c) | (~b & d); k = 0x5A827999; }
        else if (t < 40) { f = b ^ c ^ d;          k = 0x6ED9EBA1; }
        else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
        else             { f = b ^ c ^ d;          k = 0xCA62C1D6; }

        const temp = (rotl(a, 5) + f + e + k + w[t]) | 0;
        e = d; d = c; c = rotl(b, 30) | 0; b = a; a = temp;
      }

      h0 = (h0 + a) | 0;
      h1 = (h1 + b) | 0;
      h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0;
    }

    return (toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4));
  }

  global.sha1Hex = sha1Hex;
})(window);
