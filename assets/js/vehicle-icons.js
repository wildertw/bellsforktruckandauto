// vehicle-icons.js — Inline SVG silhouettes for vehicle body types
// All icons face RIGHT by default

window.getVehicleIconSVG = function(type, size, color) {
  size = size || 32;
  color = color || 'currentColor';
  const t = String(type || '').toLowerCase();

  // Pickup Truck — right-facing silhouette
  const truck = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50" width="${size}" height="${Math.round(size*50/120)}" aria-hidden="true" style="display:inline-block;vertical-align:middle;">
    <path d="M2 38 L2 22 L42 22 L42 10 Q42 8 44 8 L72 8 L82 22 L110 22 Q114 22 114 26 L114 38 L100 38 Q100 30 92 30 Q84 30 84 38 L36 38 Q36 30 28 30 Q20 30 20 38 Z" fill="${color}"/>
    <circle cx="28" cy="39" r="7" fill="${color}"/><circle cx="28" cy="39" r="4" fill="#fff"/>
    <circle cx="92" cy="39" r="7" fill="${color}"/><circle cx="92" cy="39" r="4" fill="#fff"/>
  </svg>`;

  // Sedan / Car — right-facing silhouette
  const sedan = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50" width="${size}" height="${Math.round(size*50/120)}" aria-hidden="true" style="display:inline-block;vertical-align:middle;">
    <path d="M4 36 L4 26 Q4 24 6 24 L28 24 L38 12 Q40 10 42 10 L78 10 Q80 10 82 12 L96 24 L112 24 Q116 24 116 28 L116 36 L102 36 Q102 28 94 28 Q86 28 86 36 L36 36 Q36 28 28 28 Q20 28 20 36 Z" fill="${color}"/>
    <circle cx="28" cy="37" r="7" fill="${color}"/><circle cx="28" cy="37" r="4" fill="#fff"/>
    <circle cx="94" cy="37" r="7" fill="${color}"/><circle cx="94" cy="37" r="4" fill="#fff"/>
  </svg>`;

  // SUV — right-facing silhouette
  const suv = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 50" width="${size}" height="${Math.round(size*50/120)}" aria-hidden="true" style="display:inline-block;vertical-align:middle;">
    <path d="M4 38 L4 24 Q4 22 6 22 L24 22 L34 8 Q36 6 38 6 L88 6 Q90 6 90 8 L90 22 L112 22 Q116 22 116 26 L116 38 L102 38 Q102 30 94 30 Q86 30 86 38 L36 38 Q36 30 28 30 Q20 30 20 38 Z" fill="${color}"/>
    <circle cx="28" cy="39" r="7" fill="${color}"/><circle cx="28" cy="39" r="4" fill="#fff"/>
    <circle cx="94" cy="39" r="7" fill="${color}"/><circle cx="94" cy="39" r="4" fill="#fff"/>
  </svg>`;

  // Diesel — use truck icon
  const diesel = truck;

  if (t === 'truck' || t.includes('pickup')) return truck;
  if (t === 'suv' || t.includes('crossover') || t.includes('suv')) return suv;
  if (t === 'car' || t.includes('sedan') || t.includes('coupe')) return sedan;
  if (t === 'diesel') return diesel;

  // Fallback: sedan
  return sedan;
};
