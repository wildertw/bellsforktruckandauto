// color-lookup.js — OEM paint code reference and color resolution helpers
// Used by build scripts and admin dashboard to resolve paint codes to display names + swatches.
// This file is shared between server-side (Node) and client-side (browser) contexts.

// ── Generic color family → approximate web swatch hex ──
const COLOR_FAMILY_SWATCHES = {
  white:    '#FFFFFF',
  black:    '#1A1A1A',
  silver:   '#C0C0C0',
  gray:     '#808080',
  grey:     '#808080',
  red:      '#CC0000',
  blue:     '#1E3A8A',
  green:    '#1B5E20',
  brown:    '#5D4037',
  tan:      '#D2B48C',
  beige:    '#C8B88A',
  gold:     '#B8860B',
  orange:   '#E65100',
  yellow:   '#F9A825',
  purple:   '#6A1B9A',
  maroon:   '#800000',
  burgundy: '#6B0020',
  charcoal: '#333333',
  pearl:    '#F5F0E8',
  ivory:    '#FFFFF0',
  champagne:'#F7E7CE',
  bronze:   '#8C6B3D',
};

// ── OEM paint code database ──
// Format: { make: { paintCode: { name, hex, years? } } }
// years is optional: [startYear, endYear] range or null for "all years"
const OEM_PAINT_CODES = {
  chevrolet: {
    'GBA': { name: 'Black', hex: '#1A1A1A' },
    'G1W': { name: 'Summit White', hex: '#F0F0EF' },
    'GAZ': { name: 'Summit White', hex: '#F0F0EF' },
    'GAN': { name: 'Quicksilver Metallic', hex: '#919191' },
    'GJI': { name: 'Shadow Gray Metallic', hex: '#474B4E' },
    'G7Q': { name: 'Red Hot', hex: '#CC0000' },
    'GPJ': { name: 'Cherry Red Tintcoat', hex: '#7B0023' },
    'GNK': { name: 'Iridescent Pearl Tricoat', hex: '#F0EDE6' },
    'GXD': { name: 'Cajun Red Tintcoat', hex: '#6B1015' },
    'GA0': { name: 'Mosaic Black Metallic', hex: '#1D1E20' },
    'GED': { name: 'Silver Ice Metallic', hex: '#B5B7B9' },
    'G9K': { name: 'Satin Steel Metallic', hex: '#7A7D82' },
    'GKO': { name: 'Havana Brown Metallic', hex: '#524434' },
    'G1E': { name: 'Deepwood Green Metallic', hex: '#2E3830' },
    'G7C': { name: 'Riverside Blue Metallic', hex: '#1F3D6E' },
    'GS7': { name: 'Northsky Blue Metallic', hex: '#1E3F6E' },
    'GNO': { name: 'Pepperdust Metallic', hex: '#8A7E71' },
    'G8G': { name: 'Pacific Blue Metallic', hex: '#1B3A5C' },
    'GXH': { name: 'Oxford Brown Metallic', hex: '#4B3C2E' },
    'G1K': { name: 'Ash Gray Metallic', hex: '#9BA0A4' },
  },
  ford: {
    'YZ': { name: 'Oxford White', hex: '#F4F4F0' },
    'UX': { name: 'Magnetic Metallic', hex: '#555759' },
    'J7': { name: 'Shadow Black', hex: '#1A1A1A' },
    'UM': { name: 'Ingot Silver Metallic', hex: '#A8AAAD' },
    'RR': { name: 'Ruby Red Metallic Tinted Clearcoat', hex: '#6B0020' },
    'N6': { name: 'Guard Metallic', hex: '#546058' },
    'HN': { name: 'Lead Foot', hex: '#6D7373' },
    'HS': { name: 'Iconic Silver Metallic', hex: '#BBBFC2' },
    'JS': { name: 'Stone Gray Metallic', hex: '#697076' },
    'Z1': { name: 'Oxford White', hex: '#F4F4F0' },
    'AI': { name: 'Agate Black Metallic', hex: '#1F2022' },
    'DT': { name: 'Rapid Red Metallic Tinted Clearcoat', hex: '#6E1F23' },
    'G1': { name: 'Carbonized Gray Metallic', hex: '#4D5258' },
    'N1': { name: 'Antimatter Blue Metallic', hex: '#1C2740' },
    'LC': { name: 'Forged Green Metallic', hex: '#3A4A3F' },
    'DR': { name: 'Race Red', hex: '#CC0000' },
    'D1': { name: 'Velocity Blue Metallic', hex: '#183F70' },
    'E4': { name: 'Blue Jeans Metallic', hex: '#2A4970' },
    'AJ': { name: 'Area 51', hex: '#8A9B9B' },
    'HG': { name: 'Smoked Quartz Metallic Tinted Clearcoat', hex: '#6A5F58' },
    'PQ': { name: 'White Platinum Metallic Tri-Coat', hex: '#E8E3D8' },
    'LK': { name: 'Star White Metallic Tri-Coat', hex: '#F5F1EA' },
  },
  toyota: {
    '040': { name: 'Super White', hex: '#F5F5F3' },
    '070': { name: 'Blizzard Pearl', hex: '#F0EDE6' },
    '089': { name: 'Wind Chill Pearl', hex: '#F0EEE8' },
    '1D6': { name: 'Silver Sky Metallic', hex: '#AEB2B5' },
    '1F7': { name: 'Classic Silver Metallic', hex: '#BABABA' },
    '1G3': { name: 'Magnetic Gray Metallic', hex: '#5D636A' },
    '202': { name: 'Black', hex: '#1A1A1A' },
    '218': { name: 'Midnight Black Metallic', hex: '#1D1E20' },
    '3R3': { name: 'Barcelona Red Metallic', hex: '#6E1A21' },
    '4X7': { name: 'Cavalry Blue', hex: '#27466C' },
    '6X3': { name: 'Lunar Rock', hex: '#A0A195' },
    '776': { name: 'Cement', hex: '#9A9C98' },
    '8W6': { name: 'Blueprint', hex: '#1C2F52' },
    '8X8': { name: 'Electric Storm Blue', hex: '#263A5E' },
    'K1X': { name: 'Predator', hex: '#2D3930' },
  },
  gmc: {
    'GBA': { name: 'Onyx Black', hex: '#1A1A1A' },
    'G1W': { name: 'Summit White', hex: '#F0F0EF' },
    'GAZ': { name: 'Summit White', hex: '#F0F0EF' },
    'GAN': { name: 'Quicksilver Metallic', hex: '#919191' },
    'GJI': { name: 'Satin Steel Metallic', hex: '#7A7D82' },
    'G7Q': { name: 'Cardinal Red', hex: '#CC0000' },
    'GXD': { name: 'Cayenne Red Tintcoat', hex: '#6B1015' },
    'GNK': { name: 'White Frost Tricoat', hex: '#F0EDE6' },
    'GED': { name: 'Silver Ice Metallic', hex: '#B5B7B9' },
    'GA0': { name: 'Ebony Twilight Metallic', hex: '#1D1E20' },
    'G9K': { name: 'Satin Steel Metallic', hex: '#7A7D82' },
    'G1K': { name: 'Volcanic Red Tintcoat', hex: '#4E0E14' },
  },
  ram: {
    'PW7': { name: 'Bright White Clearcoat', hex: '#F4F4F0' },
    'PXJ': { name: 'Diamond Black Crystal Pearlcoat', hex: '#1D1E20' },
    'PAU': { name: 'Granite Crystal Metallic Clearcoat', hex: '#6B6E6F' },
    'PX8': { name: 'Maximum Steel Metallic Clearcoat', hex: '#474B4E' },
    'PRV': { name: 'Flame Red Clearcoat', hex: '#CC0000' },
    'PPX': { name: 'Patriot Blue Pearlcoat', hex: '#1D3461' },
    'PAR': { name: 'Billet Silver Metallic Clearcoat', hex: '#BBBFC2' },
    'PW1': { name: 'Ivory 3-Coat', hex: '#F5F1EA' },
    'PBF': { name: 'Hydro Blue Pearlcoat', hex: '#336B82' },
    'PSC': { name: 'Olive Green Pearlcoat', hex: '#586B52' },
    'PDN': { name: 'Destroyer Gray Clearcoat', hex: '#555759' },
    'PAE': { name: 'Delmonico Red Pearlcoat', hex: '#5A1820' },
    'PGG': { name: 'Blue Streak Pearlcoat', hex: '#1E3A6E' },
    'PRC': { name: 'Anvil Clearcoat', hex: '#8A8D8F' },
  },
  jeep: {
    'PW7': { name: 'Bright White Clearcoat', hex: '#F4F4F0' },
    'PXJ': { name: 'Diamond Black Crystal Pearlcoat', hex: '#1D1E20' },
    'PAU': { name: 'Granite Crystal Metallic Clearcoat', hex: '#6B6E6F' },
    'PX8': { name: 'Sting-Gray Clearcoat', hex: '#7A7D7E' },
    'PBF': { name: 'Hydro Blue Pearlcoat', hex: '#336B82' },
    'PGG': { name: 'Ocean Blue Metallic', hex: '#1E3A6E' },
    'PRV': { name: 'Firecracker Red Clearcoat', hex: '#CC0000' },
    'PLB': { name: 'Sarge Green Clearcoat', hex: '#5A6E4B' },
    'PAE': { name: 'Velvet Red Pearlcoat', hex: '#5A1820' },
    'PRP': { name: 'Punk\'n Metallic Clearcoat', hex: '#D77030' },
    'PWD': { name: 'Gobi Clearcoat', hex: '#C4B898' },
    'PGE': { name: 'Snazzberry Pearlcoat', hex: '#5B2040' },
  },
  dodge: {
    'PW7': { name: 'White Knuckle Clearcoat', hex: '#F4F4F0' },
    'PXJ': { name: 'Pitch Black Clearcoat', hex: '#1D1E20' },
    'PAU': { name: 'Granite Pearlcoat', hex: '#6B6E6F' },
    'PDN': { name: 'Destroyer Gray Clearcoat', hex: '#555759' },
    'PRV': { name: 'TorRed Clearcoat', hex: '#CC0000' },
    'PBF': { name: 'IndiGo Blue', hex: '#1D3461' },
    'PGG': { name: 'B5 Blue Pearlcoat', hex: '#1E3A6E' },
    'PFQ': { name: 'Go Mango', hex: '#E65100' },
    'PYB': { name: 'Yellow Jacket Clearcoat', hex: '#F5CC00' },
    'PHR': { name: 'Plum Crazy Pearlcoat', hex: '#6A1B9A' },
    'PJC': { name: 'F8 Green Metallic', hex: '#2E5435' },
    'PW3': { name: 'Triple Nickel Clearcoat', hex: '#A0A3A5' },
  },
  nissan: {
    'QAB': { name: 'Brilliant Silver Metallic', hex: '#BABABA' },
    'KH3': { name: 'Super Black', hex: '#1A1A1A' },
    'QM1': { name: 'Fresh Powder', hex: '#F5F5F3' },
    'RAY': { name: 'Glacier White', hex: '#F0F0EF' },
    'K23': { name: 'Gun Metallic', hex: '#5D636A' },
    'NAH': { name: 'Cayenne Red Metallic', hex: '#6B1015' },
    'RBD': { name: 'Caspian Blue Metallic', hex: '#1C3F6E' },
    'KAD': { name: 'Magnetic Black Pearl', hex: '#1D1E20' },
  },
  honda: {
    'NH731P':  { name: 'Crystal Black Pearl', hex: '#1D1E20' },
    'NH788P':  { name: 'White Diamond Pearl', hex: '#F0EDE6' },
    'NH883P':  { name: 'Platinum White Pearl', hex: '#F5F1EA' },
    'R569M':   { name: 'Molten Lava Pearl', hex: '#6E1A21' },
    'NH797M':  { name: 'Modern Steel Metallic', hex: '#5D636A' },
    'B600M':   { name: 'Aegean Blue Metallic', hex: '#1E3A5C' },
    'NH830M':  { name: 'Lunar Silver Metallic', hex: '#BABABA' },
    'G548M':   { name: 'Sonic Gray Pearl', hex: '#7A7D82' },
  },
};

// ── Resolve paint code to display info ──
function lookupPaintCode(make, paintCode, year) {
  if (!make || !paintCode) return null;
  const normalizedMake = String(make).toLowerCase().trim();
  const normalizedCode = String(paintCode).toUpperCase().trim();

  const makeCodes = OEM_PAINT_CODES[normalizedMake];
  if (!makeCodes) return null;

  const entry = makeCodes[normalizedCode];
  if (!entry) return null;

  // If entry has year range and year is provided, check match
  if (entry.years && year) {
    const y = Number(year);
    if (y && (y < entry.years[0] || y > entry.years[1])) return null;
  }

  return {
    colorName: entry.name,
    hex: entry.hex,
    paintCode: normalizedCode,
    source: 'lookup',
  };
}

// ── Guess color family from a color name string ──
function guessColorFamily(colorName) {
  if (!colorName) return null;
  const lower = String(colorName).toLowerCase().trim();

  // Direct family match
  for (const [family, hex] of Object.entries(COLOR_FAMILY_SWATCHES)) {
    if (lower === family || lower.startsWith(family + ' ') || lower.includes(family)) {
      return { family, hex };
    }
  }

  // Common OEM color name patterns
  const patterns = [
    [/\b(oxford\s*white|summit\s*white|super\s*white|bright\s*white|star\s*white|pearl\s*white|blizzard|fresh\s*powder|snow|frost|ivory|glacier\s*white|platinum\s*white)\b/i, 'white'],
    [/\b(onyx|shadow\s*black|midnight|pitch\s*black|jet\s*black|agate|ebony|tuxedo|mosaic\s*black|crystal\s*black)\b/i, 'black'],
    [/\b(silver|quicksilver|billet|ice|sterling|lunar\s*silver|satin\s*steel|brilliant\s*silver|iconic\s*silver)\b/i, 'silver'],
    [/\b(magnetic|shadow\s*gray|granite|guard|charcoal|destroyer|cement|carbonized|modern\s*steel|gun\s*metal|satin\s*steel|lead\s*foot|sonic\s*gray|sting-gray|anvil|stone\s*gray)\b/i, 'gray'],
    [/\b(ruby|cajun|cayenne|barcelona|race\s*red|rapid\s*red|cardinal|firecracker|torred|flame|molten\s*lava|hot\s*pepper|volcanic)\b/i, 'red'],
    [/\b(velocity\s*blue|blue\s*jeans|patriot|ocean|caspian|pacific|riverside|northsky|blueprint|aegean|indigo|electric\s*storm|b5\s*blue|hydro)\b/i, 'blue'],
    [/\b(forged\s*green|sarge|olive|f8\s*green|lunar\s*rock|predator|deepwood|nori)\b/i, 'green'],
    [/\b(havana|oxford\s*brown|canyon|saddle|espresso|kodiak|java|walnut)\b/i, 'brown'],
    [/\b(pepperdust|sand|mojave|gobi|dune|desert)\b/i, 'tan'],
    [/\b(go\s*mango|punk.?n|orange|inferno|crush)\b/i, 'orange'],
    [/\b(yellow\s*jacket|nitro|solar|speed|blazing)\b/i, 'yellow'],
    [/\b(plum|crazy|snazzberry|purple|violet|magenta)\b/i, 'purple'],
    [/\b(delmonico|velvet|burgundy|maroon|dark\s*red|sangria)\b/i, 'burgundy'],
    [/\b(area\s*51|cactus|eruption|antimatter)\b/i, 'gray'], // unusual but grayish
    [/\b(champagne|cashmere|almond)\b/i, 'champagne'],
    [/\b(bronze|copper|burnished)\b/i, 'bronze'],
    [/\b(gold|amber)\b/i, 'gold'],
  ];

  for (const [pattern, family] of patterns) {
    if (pattern.test(lower)) {
      return { family, hex: COLOR_FAMILY_SWATCHES[family] || '#808080' };
    }
  }

  return null;
}

// ── Reverse-lookup: match a color name string to an OEM DB entry ──
// Searches the OEM paint code database for a color name that matches
// the user-entered string. This lets manually-entered names like
// "Bright White Clearcoat" resolve to the exact OEM hex + paint code
// without needing an OEM label scan.
function reverseLookupColorName(make, colorName, year) {
  if (!make || !colorName) return null;
  const normalizedMake = String(make).toLowerCase().trim();
  const normalizedName = String(colorName).toLowerCase().trim();
  if (!normalizedName) return null;

  const makeCodes = OEM_PAINT_CODES[normalizedMake];
  if (!makeCodes) return null;

  // Try exact match first, then substring/fuzzy
  let bestMatch = null;
  let bestScore = 0;

  for (const [code, entry] of Object.entries(makeCodes)) {
    const entryName = entry.name.toLowerCase();

    // Check year range if applicable
    if (entry.years && year) {
      const y = Number(year);
      if (y && (y < entry.years[0] || y > entry.years[1])) continue;
    }

    // Exact match (case-insensitive)
    if (entryName === normalizedName) {
      return { colorName: entry.name, hex: entry.hex, paintCode: code, source: 'name_match', score: 100 };
    }

    // Score partial matches
    let score = 0;

    // One contains the other
    if (normalizedName.includes(entryName)) {
      score = 90; // user typed the OEM name (possibly with extra words)
    } else if (entryName.includes(normalizedName) && normalizedName.length >= 6 && !COLOR_FAMILY_SWATCHES[normalizedName]) {
      score = 85; // user typed a shorter version of the OEM name (skip vague/generic words)
    } else {
      // Compare significant words (strip common suffixes like "clearcoat", "metallic", "pearlcoat", "tintcoat")
      const stripSuffixes = (s) => s.replace(/\b(clearcoat|metallic|pearlcoat|tintcoat|tinted|tri-?coat)\b/gi, '').trim().replace(/\s+/g, ' ');
      const strippedInput = stripSuffixes(normalizedName);
      const strippedEntry = stripSuffixes(entryName);
      if (strippedInput && strippedEntry) {
        if (strippedInput === strippedEntry) {
          score = 88;
        } else if (strippedInput.includes(strippedEntry) || (strippedEntry.includes(strippedInput) && strippedInput.length >= 6)) {
          score = 75;
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = { colorName: entry.name, hex: entry.hex, paintCode: code, source: 'name_match', score };
    }
  }

  // Only return matches with reasonable confidence
  return bestScore >= 75 ? bestMatch : null;
}

// ── Main resolution function ──
// Resolves final display color from all available sources.
// Returns a color_display object.
// If vehicle.swatchHex is set (manual override), it takes precedence for the swatch hex value.
function resolveVehicleColorDisplay(vehicle) {
  const v = vehicle || {};
  const result = _resolveVehicleColorCore(v);

  // Manual swatchHex override: if set, it wins for web_swatch_hex display
  const manualSwatch = (v.swatchHex || '').trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(manualSwatch)) {
    result.web_swatch_hex = manualSwatch;
    result.web_swatch_label = result.web_swatch_label || 'Manual swatch';
    result.is_approximate_swatch = true;
  }

  return result;
}

function _resolveVehicleColorCore(v) {
  const result = {
    exterior_color_name: null,
    paint_code: null,
    web_swatch_hex: null,
    web_swatch_label: null,
    resolution_source: null,
    resolution_confidence: null,
    is_approximate_swatch: true,
  };

  const existingColor = (v.exteriorColor || '').trim();
  const existingPaintCode = (v.paintCode || '').trim();
  const oemScan = v.oem_scan || {};
  const extractedPaintCode = (oemScan.extracted_paint_code || '').trim();
  const extractedColorName = (oemScan.extracted_color_name || '').trim();

  // Priority 1: Existing stored paint code + lookup
  if (existingPaintCode) {
    const lookup = lookupPaintCode(v.make, existingPaintCode, v.year);
    if (lookup) {
      result.exterior_color_name = lookup.colorName;
      result.paint_code = lookup.paintCode;
      result.web_swatch_hex = lookup.hex;
      result.web_swatch_label = lookup.colorName;
      result.resolution_source = 'inventory';
      result.resolution_confidence = 'high';
      return result;
    }
  }

  // Priority 2: Extracted paint code from OEM label AI
  if (extractedPaintCode) {
    const lookup = lookupPaintCode(v.make, extractedPaintCode, v.year);
    if (lookup) {
      result.exterior_color_name = lookup.colorName;
      result.paint_code = lookup.paintCode;
      result.web_swatch_hex = lookup.hex;
      result.web_swatch_label = lookup.colorName;
      result.resolution_source = 'oem_label_ai';
      result.resolution_confidence = (oemScan.extraction_confidence || 0) >= 0.7 ? 'high' : 'medium';
      return result;
    }
    // Code exists but not in our DB — store it anyway
    result.paint_code = extractedPaintCode;
  }

  // Priority 3: Existing stored exterior color name
  if (existingColor) {
    // Try to match the manually-entered name against OEM DB for exact hex
    const nameMatch = reverseLookupColorName(v.make, existingColor, v.year);
    if (nameMatch) {
      result.exterior_color_name = existingColor; // keep user's original text
      result.paint_code = result.paint_code || nameMatch.paintCode;
      result.web_swatch_hex = nameMatch.hex;
      result.web_swatch_label = nameMatch.colorName;
      result.resolution_source = 'inventory_name_match';
      result.resolution_confidence = nameMatch.score >= 88 ? 'high' : 'medium';
      result.is_approximate_swatch = false;
      return result;
    }
    // Fall back to generic color family guess
    result.exterior_color_name = existingColor;
    result.resolution_source = 'inventory';
    const family = guessColorFamily(existingColor);
    if (family) {
      result.web_swatch_hex = family.hex;
      result.web_swatch_label = existingColor;
      result.resolution_confidence = 'medium';
    } else {
      result.resolution_confidence = 'low';
    }
    return result;
  }

  // Priority 4: Extracted color name from OEM label AI
  if (extractedColorName) {
    // Try reverse lookup against OEM DB first
    const nameMatch = reverseLookupColorName(v.make, extractedColorName, v.year);
    if (nameMatch) {
      result.exterior_color_name = extractedColorName;
      result.paint_code = result.paint_code || nameMatch.paintCode;
      result.web_swatch_hex = nameMatch.hex;
      result.web_swatch_label = nameMatch.colorName;
      result.resolution_source = 'oem_label_name_match';
      result.resolution_confidence = nameMatch.score >= 88 ? 'high' : 'medium';
      result.is_approximate_swatch = false;
      return result;
    }
    result.exterior_color_name = extractedColorName;
    result.resolution_source = 'oem_label_ai';
    const family = guessColorFamily(extractedColorName);
    if (family) {
      result.web_swatch_hex = family.hex;
      result.web_swatch_label = extractedColorName;
      result.resolution_confidence = 'medium';
    } else {
      result.resolution_confidence = 'low';
    }
    return result;
  }

  // Priority 5: Fallback — no color info available
  result.resolution_source = 'fallback';
  result.resolution_confidence = null;
  return result;
}

// ── Filter public-facing images (exclude OEM label photos) ──
function filterPublicImages(images, photoRoles) {
  if (!images || !images.length) return [];
  if (!photoRoles || !photoRoles.length) return images.slice();

  // Build a set of processing-only filenames
  const excludeSet = new Set();
  photoRoles.forEach(function (pr) {
    if (pr.role === 'oem_label_processing_only') {
      excludeSet.add(pr.filename);
    }
  });

  if (excludeSet.size === 0) return images.slice();

  return images.filter(function (img) {
    return !excludeSet.has(img);
  });
}

// ── Exports (Node.js) or global (browser) ──
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLOR_FAMILY_SWATCHES,
    OEM_PAINT_CODES,
    lookupPaintCode,
    reverseLookupColorName,
    guessColorFamily,
    resolveVehicleColorDisplay,
    filterPublicImages,
  };
} else if (typeof window !== 'undefined') {
  window.ColorLookup = {
    COLOR_FAMILY_SWATCHES,
    OEM_PAINT_CODES,
    lookupPaintCode,
    reverseLookupColorName,
    guessColorFamily,
    resolveVehicleColorDisplay,
    filterPublicImages,
  };
}
