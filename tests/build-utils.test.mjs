import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  escapeHtml,
  escapeAttr,
  normalizeVehicleText,
  normalizeVehicleTitle,
  formatMoney,
  slugify,
  buildVDPSlug,
  buildVDPId,
  buildVDPPath,
  versioned,
  buildLocalImageCandidates,
  resolveImg,
  inferVehicleType,
} = require('../build-utils');

describe('escapeHtml', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes ampersands and single quotes', () => {
    expect(escapeHtml('Tom & Jerry\'s')).toBe('Tom &amp; Jerry&#39;s');
  });

  it('handles null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('escapeAttr', () => {
  it('also escapes backticks', () => {
    expect(escapeAttr('`test`')).toBe('&#96;test&#96;');
  });
});

describe('normalizeVehicleText', () => {
  it('capitalizes words properly', () => {
    expect(normalizeVehicleText('ford f-150')).toBe('Ford F-150');
  });

  it('keeps uppercase brand words intact', () => {
    expect(normalizeVehicleText('bmw')).toBe('BMW');
    expect(normalizeVehicleText('gmc')).toBe('GMC');
    expect(normalizeVehicleText('ram')).toBe('RAM');
  });

  it('keeps automotive acronyms uppercase', () => {
    expect(normalizeVehicleText('awd')).toBe('AWD');
    expect(normalizeVehicleText('srt')).toBe('SRT');
    expect(normalizeVehicleText('trd')).toBe('TRD');
  });

  it('handles empty and null input', () => {
    expect(normalizeVehicleText('')).toBe('');
    expect(normalizeVehicleText(null)).toBe('');
    expect(normalizeVehicleText(undefined)).toBe('');
  });

  it('collapses extra whitespace', () => {
    expect(normalizeVehicleText('  ford   f-150  ')).toBe('Ford F-150');
  });
});

describe('normalizeVehicleTitle', () => {
  it('combines year, make, and model', () => {
    expect(normalizeVehicleTitle({ year: 2020, make: 'ford', model: 'f-150' })).toBe(
      '2020 Ford F-150'
    );
  });

  it('handles missing fields', () => {
    expect(normalizeVehicleTitle({ year: 2020, make: 'ford' })).toBe('2020 Ford');
  });
});

describe('formatMoney', () => {
  it('formats numbers as USD', () => {
    expect(formatMoney(48990)).toBe('$48,990');
  });

  it('returns fallback for non-numbers', () => {
    expect(formatMoney('not-a-number')).toBe('Call for Price');
  });

  it('treats null as $0', () => {
    // Number(null) === 0 which is finite
    expect(formatMoney(null)).toBe('$0');
  });

  it('handles zero', () => {
    expect(formatMoney(0)).toBe('$0');
  });
});

describe('slugify', () => {
  it('converts text to URL-safe slug', () => {
    expect(slugify('Hello World!')).toBe('Hello-World');
  });

  it('replaces multiple special chars with single hyphen', () => {
    expect(slugify('foo & bar @ baz')).toBe('foo-bar-baz');
  });

  it('handles empty input', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
  });
});

describe('buildVDPSlug', () => {
  it('builds correct VDP slug', () => {
    const v = { year: 2020, make: 'ford', model: 'f-150', trim: 'Lariat' };
    const slug = buildVDPSlug(v);
    expect(slug).toContain('Used');
    expect(slug).toContain('2020');
    expect(slug).toContain('Ford');
    expect(slug).toContain('Greenville-NC-27858');
  });
});

describe('buildVDPId', () => {
  it('uses stock number when available', () => {
    expect(buildVDPId({ stockNumber: 'D2601' })).toBe('D2601');
  });

  it('strips non-alphanumeric characters', () => {
    expect(buildVDPId({ stockNumber: 'D-26/01' })).toBe('D2601');
  });

  it('falls back to VIN, then id', () => {
    expect(buildVDPId({ vin: 'ABC123' })).toBe('ABC123');
    expect(buildVDPId({ id: '99' })).toBe('99');
    expect(buildVDPId({})).toBe('NA');
  });
});

describe('buildVDPPath', () => {
  it('builds correct VDP path', () => {
    const v = { stockNumber: 'D2601', year: 2020, make: 'ford', model: 'f-150' };
    const p = buildVDPPath(v);
    expect(p).toMatch(/^\/vdp\/D2601\/.+\/$/);
  });
});

describe('versioned', () => {
  it('appends version query param', () => {
    const result = versioned('/style.css');
    expect(result).toMatch(/\/style\.css\?v=.+/);
  });

  it('uses & for paths that already have query params', () => {
    const result = versioned('/style.css?foo=bar');
    expect(result).toMatch(/\/style\.css\?foo=bar&v=.+/);
  });

  it('returns external URLs unchanged', () => {
    expect(versioned('https://cdn.example.com/lib.js')).toBe('https://cdn.example.com/lib.js');
  });

  it('returns data URIs unchanged', () => {
    expect(versioned('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
  });
});

describe('resolveImg', () => {
  it('returns http URLs unchanged', () => {
    expect(resolveImg('https://example.com/img.jpg')).toBe('https://example.com/img.jpg');
  });

  it('resolves blob: keys to photo serve path', () => {
    expect(resolveImg('blob:abc123', '/')).toBe('/photos/abc123');
  });

  it('resolves local images to assets/vehicles path', () => {
    expect(resolveImg('truck.jpg', '/')).toBe('/assets/vehicles/truck.jpg');
  });

  it('returns empty string for falsy input', () => {
    expect(resolveImg('')).toBe('');
    expect(resolveImg(null)).toBe('');
  });
});

describe('inferVehicleType', () => {
  it('identifies trucks by model', () => {
    expect(inferVehicleType({ model: 'F-150' })).toBe('truck');
    expect(inferVehicleType({ model: 'Silverado' })).toBe('truck');
    expect(inferVehicleType({ model: 'Tacoma' })).toBe('truck');
  });

  it('identifies SUVs by model', () => {
    expect(inferVehicleType({ model: 'Tahoe' })).toBe('suv');
    expect(inferVehicleType({ model: 'Explorer' })).toBe('suv');
    expect(inferVehicleType({ model: '4Runner' })).toBe('suv');
  });

  it('identifies cars by model', () => {
    expect(inferVehicleType({ model: 'Camaro' })).toBe('car');
    expect(inferVehicleType({ model: 'Civic' })).toBe('car');
  });

  it('identifies diesel by fuel type', () => {
    expect(inferVehicleType({ model: 'F-250', fuelType: 'Diesel' })).toBe('diesel');
  });

  it('preserves explicit non-used type', () => {
    expect(inferVehicleType({ type: 'truck', model: 'Civic' })).toBe('truck');
  });

  it('falls back to car for unknown models', () => {
    expect(inferVehicleType({ model: 'UnknownCar123' })).toBe('car');
  });
});

describe('buildLocalImageCandidates', () => {
  it('generates extension variants', () => {
    const candidates = buildLocalImageCandidates('truck.jpg');
    expect(candidates).toContain('truck.jpg');
    expect(candidates).toContain('truck.png');
    expect(candidates).toContain('truck.webp');
  });

  it('returns empty for http URLs', () => {
    expect(buildLocalImageCandidates('https://example.com/img.jpg')).toEqual([]);
  });

  it('returns empty for empty input', () => {
    expect(buildLocalImageCandidates('')).toEqual([]);
    expect(buildLocalImageCandidates(null)).toEqual([]);
  });
});
