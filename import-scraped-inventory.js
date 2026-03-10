#!/usr/bin/env node
/**
 * One-time import script: Merge scraped inventory into inventory.json
 *
 * - Reads all 32 scraped vehicles from individual vehicle_info.json files
 * - Downloads photos from goxee S3 → assets/vehicles/VEHICLE-{VIN}-{NN}.jpg
 * - VIN decodes via NHTSA API for missing data
 * - For duplicates (VIN match): fills undefined fields + adds photos if empty
 * - For new vehicles: creates complete inventory entries
 * - Generates descriptions for vehicles missing them
 * - Saves updated inventory.json
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const SCRAPED_DIR = path.resolve('C:/Users/twild/OneDrive/Desktop/Bells Fork Truck and Auto/WebsiteScrape/BellsFork_Inventory');
const INVENTORY_PATH = path.join(__dirname, 'inventory.json');
const VEHICLE_ASSET_DIR = path.join(__dirname, 'assets', 'vehicles');

// ── Photo Download ──

async function downloadPhoto(url, destPath) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const fileStream = fs.createWriteStream(destPath);
    await pipeline(response.body, fileStream);
    return true;
  } catch (err) {
    console.error(`    Download failed: ${path.basename(destPath)} - ${err.message}`);
    return false;
  }
}

async function downloadVehiclePhotos(vin, imageUrls) {
  if (!imageUrls || imageUrls.length === 0) return [];

  const localNames = [];
  let photoIndex = 1;

  for (const url of imageUrls) {
    const paddedIndex = String(photoIndex).padStart(2, '0');
    const localName = `VEHICLE-${vin}-${paddedIndex}.jpg`;
    const destPath = path.join(VEHICLE_ASSET_DIR, localName);

    // Skip if already exists
    if (fs.existsSync(destPath)) {
      console.log(`    Photo ${paddedIndex}: already exists, skipping`);
      localNames.push(localName);
      photoIndex++;
      continue;
    }

    const ok = await downloadPhoto(url, destPath);
    if (ok) {
      localNames.push(localName);
      console.log(`    Photo ${paddedIndex}: downloaded`);
    }
    photoIndex++;

    // Small delay between downloads
    await new Promise(r => setTimeout(r, 100));
  }

  return localNames;
}

// ── NHTSA VIN Decode ──

async function decodeVin(vin) {
  try {
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${vin}?format=json`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || !data.Results) return {};

    const get = (name) => {
      const item = data.Results.find(r => r.Variable === name);
      return item && item.Value && item.Value !== 'Not Applicable' ? item.Value.trim() : '';
    };

    const displacement = get('Displacement (L)');
    const cylinders = get('Engine Number of Cylinders');
    const engineModel = get('Engine Model');
    const engineStr = displacement && cylinders
      ? `${parseFloat(displacement).toFixed(1)}L ${cylinders}-Cyl`
      : (engineModel || '');

    const transmissionRaw = get('Transmission Style');
    const driveRaw = get('Drive Type');
    const fuelRaw = get('Fuel Type - Primary');
    const bodyClass = get('Body Class');

    const driveMap = {
      'Four-Wheel Drive': '4WD', '4WD/4-Wheel Drive/4x4': '4WD',
      'All-Wheel Drive': 'AWD', 'AWD/All-Wheel Drive': 'AWD',
      'Front-Wheel Drive': 'FWD', 'FWD/Front-Wheel Drive': 'FWD',
      'Rear-Wheel Drive': 'RWD', 'RWD/Rear-Wheel Drive': 'RWD'
    };

    const fuelMap = {
      'Gasoline': 'Gasoline', 'Diesel': 'Diesel', 'Electric': 'Electric',
      'Flexible Fuel Vehicle': 'Flex Fuel', 'Hybrid': 'Hybrid'
    };

    return {
      year: parseInt(get('Model Year'), 10) || 0,
      make: toTitleCase(get('Make')),
      model: get('Model'),
      trim: get('Trim') || get('Trim2') || '',
      engine: engineStr,
      transmission: transmissionRaw || '',
      drivetrain: driveMap[driveRaw] || '',
      fuelType: fuelMap[fuelRaw] || '',
      bodyClass: bodyClass || ''
    };
  } catch (err) {
    console.error(`  VIN decode failed for ${vin}: ${err.message}`);
    return {};
  }
}

// ── Helpers ──

function toTitleCase(s) {
  if (!s) return '';
  return s.toLowerCase().split(' ').filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function parsePrice(priceStr) {
  if (!priceStr) return 0;
  const num = parseInt(priceStr.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

function parseMileage(mileageStr) {
  if (!mileageStr) return 0;
  const num = parseInt(mileageStr.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? 0 : num;
}

function parseTitle(title) {
  const parts = title.trim().split(/\s+/);
  const year = parseInt(parts[0], 10) || 0;
  const make = parts[1] || '';
  const rest = parts.slice(2).join(' ');
  return { year, make: toTitleCase(make), modelRaw: rest };
}

function inferType(model, fuelType) {
  const m = (model || '').toLowerCase();
  const f = (fuelType || '').toLowerCase();

  if (f.includes('diesel')) return 'diesel';
  if (/f[-\s]?150|f[-\s]?250|f[-\s]?350|silverado|sierra|ram|tundra|tacoma|colorado|frontier|ranger|titan|gladiator|ridgeline|canyon|2500|3500|1500/i.test(m)) return 'truck';
  if (/tahoe|suburban|expedition|explorer|cherokee|wrangler|4runner|highlander|escape|equinox|terrain|pathfinder|pilot|bronco|yukon|durango|traverse|blazer/i.test(m)) return 'suv';
  if (/camaro|corvette|mustang|challenger|charger|camry|corolla|accord|civic|wrx|impreza|jetta|malibu|fusion|xj|portfolio|s[\s-]?550/i.test(m)) return 'car';
  return 'car';
}

function generateDescription(v) {
  const yearMake = `${v.year} ${v.make} ${v.model}`;
  const trimStr = v.trim ? ` ${v.trim}` : '';
  const full = `${yearMake}${trimStr}`;

  const highlights = [];
  if (v.drivetrain) highlights.push(v.drivetrain);
  if (v.engine) highlights.push(v.engine);
  if (v.transmission) highlights.push(`${v.transmission} transmission`);

  const mileageStr = v.mileage ? `${v.mileage.toLocaleString()} miles` : '';
  const featureStr = v.features && v.features.length > 0
    ? `Equipped with ${v.features.slice(0, 5).join(', ')}`
    : '';

  let desc = `This ${full} is a well-maintained pre-owned vehicle`;
  if (highlights.length) desc += ` featuring ${highlights.join(', ')}`;
  desc += '.';

  if (mileageStr) desc += ` With ${mileageStr} on the odometer, this vehicle has plenty of life left.`;
  if (featureStr) desc += ` ${featureStr}.`;

  desc += ` Stop by Bells Fork Truck & Auto in Greenville, NC or call (252) 496-0005 for more information.`;

  return desc;
}

function generateStockNumber(vin) {
  const suffix = vin.slice(-6).toUpperCase();
  return `${suffix}BF`;
}

// ── Main import ──

async function main() {
  console.log('=== Bells Fork Inventory Import ===\n');

  // Ensure assets/vehicles directory exists
  if (!fs.existsSync(VEHICLE_ASSET_DIR)) {
    fs.mkdirSync(VEHICLE_ASSET_DIR, { recursive: true });
  }

  // 1. Read existing inventory
  const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
  const existingByVin = new Map();
  inventory.vehicles.forEach(v => existingByVin.set(v.vin, v));
  console.log(`Existing inventory: ${inventory.vehicles.length} vehicles`);

  // 2. Read all scraped vehicle folders
  const scrapedDir = fs.readdirSync(SCRAPED_DIR);
  const vehicleFolders = scrapedDir.filter(f => {
    const full = path.join(SCRAPED_DIR, f);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'vehicle_info.json'));
  });
  console.log(`Scraped vehicles: ${vehicleFolders.length}\n`);

  let added = 0, updated = 0, skipped = 0;
  let photosDownloaded = 0;

  for (const folder of vehicleFolders) {
    const infoPath = path.join(SCRAPED_DIR, folder, 'vehicle_info.json');
    const scraped = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    const vin = scraped.vin;

    console.log(`Processing: ${scraped.title} (${vin})`);

    // VIN decode via NHTSA
    console.log(`  VIN decoding...`);
    const decoded = await decodeVin(vin);
    await new Promise(r => setTimeout(r, 300));

    // Parse scraped data
    const { year: titleYear, make: titleMake, modelRaw } = parseTitle(scraped.title);
    const scrapedPrice = parsePrice(scraped.price);
    const scrapedMileage = parseMileage(scraped.mileage);
    const scrapedFeatures = scraped.features || [];
    const scrapedPhotoUrls = scraped.image_urls || [];

    // Build merged vehicle data
    const mergedYear = decoded.year || titleYear;
    const mergedMake = decoded.make || titleMake;
    const mergedModel = decoded.model || modelRaw.split(/\s+/).slice(0, -1).join(' ') || modelRaw;
    const mergedTrim = decoded.trim || modelRaw.split(/\s+/).slice(-1)[0] || '';
    const mergedDrivetrain = decoded.drivetrain || scraped.drivetrain || '';
    const mergedTransmission = decoded.transmission || scraped.transmission || 'Automatic';
    const mergedEngine = decoded.engine || '';
    const mergedFuelType = decoded.fuelType || 'Gasoline';

    if (existingByVin.has(vin)) {
      // ── DUPLICATE: Fill missing fields + add photos if empty ──
      const existing = existingByVin.get(vin);
      let changes = [];

      const fillField = (field, value) => {
        if (!existing[field] && value) {
          existing[field] = value;
          changes.push(field);
        }
      };

      fillField('year', mergedYear);
      fillField('make', mergedMake);
      fillField('model', mergedModel);
      fillField('trim', mergedTrim);
      fillField('engine', mergedEngine);
      fillField('transmission', mergedTransmission);
      fillField('drivetrain', mergedDrivetrain);
      fillField('fuelType', mergedFuelType);
      fillField('mileage', scrapedMileage);
      fillField('price', scrapedPrice);

      // Fill features if empty
      if ((!existing.features || existing.features.length === 0) && scrapedFeatures.length > 0) {
        existing.features = scrapedFeatures;
        changes.push('features');
      }

      // Fill type if generic
      if (!existing.type || ['used', 'other', ''].includes(existing.type.toLowerCase())) {
        const inferred = inferType(existing.model || mergedModel, existing.fuelType || mergedFuelType);
        existing.type = inferred;
        changes.push('type');
      }

      // Download and add photos if no images exist
      if (!existing.images || existing.images.length === 0) {
        if (scrapedPhotoUrls.length > 0) {
          console.log(`  Downloading ${scrapedPhotoUrls.length} photos...`);
          const localNames = await downloadVehiclePhotos(vin, scrapedPhotoUrls);
          if (localNames.length > 0) {
            existing.images = localNames;
            photosDownloaded += localNames.length;
            changes.push(`images (${localNames.length} photos downloaded)`);
          }
        }
      }

      // Generate description if empty
      if (!existing.description) {
        existing.description = generateDescription({
          ...existing,
          year: existing.year || mergedYear,
          make: existing.make || mergedMake,
          model: existing.model || mergedModel,
          trim: existing.trim || mergedTrim,
          features: existing.features || scrapedFeatures
        });
        changes.push('description');
      }

      if (changes.length > 0) {
        console.log(`  UPDATED (duplicate): filled ${changes.join(', ')}`);
        updated++;
      } else {
        console.log(`  SKIPPED (duplicate): no missing fields`);
        skipped++;
      }
    } else {
      // ── NEW VEHICLE: Download photos + create entry ──
      console.log(`  Downloading ${scrapedPhotoUrls.length} photos...`);
      const localPhotoNames = await downloadVehiclePhotos(vin, scrapedPhotoUrls);
      photosDownloaded += localPhotoNames.length;

      const vehicleType = inferType(mergedModel + ' ' + mergedTrim, mergedFuelType);

      const newVehicle = {
        vin: vin,
        stockNumber: generateStockNumber(vin),
        year: mergedYear,
        make: mergedMake,
        model: mergedModel,
        trim: mergedTrim,
        engine: mergedEngine,
        transmission: mergedTransmission,
        drivetrain: mergedDrivetrain,
        fuelType: mergedFuelType,
        mpgCity: null,
        mpgHighway: null,
        mileage: scrapedMileage,
        price: scrapedPrice,
        type: vehicleType,
        exteriorColor: '',
        interiorColor: '',
        description: '',
        features: scrapedFeatures,
        status: 'available',
        badge: '',
        featured: false,
        images: localPhotoNames,
        dateAdded: new Date().toISOString().split('T')[0]
      };

      newVehicle.description = generateDescription(newVehicle);

      inventory.vehicles.push(newVehicle);
      console.log(`  ADDED: ${newVehicle.year} ${newVehicle.make} ${newVehicle.model} (${vehicleType}) with ${localPhotoNames.length} photos`);
      added++;
    }
  }

  // 3. Update timestamp and save
  inventory.lastUpdated = new Date().toISOString();
  fs.writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2), 'utf8');

  console.log('\n=== Import Summary ===');
  console.log(`Added:   ${added} new vehicles`);
  console.log(`Updated: ${updated} existing vehicles (filled missing fields)`);
  console.log(`Skipped: ${skipped} existing vehicles (no changes needed)`);
  console.log(`Photos:  ${photosDownloaded} downloaded to assets/vehicles/`);
  console.log(`Total:   ${inventory.vehicles.length} vehicles in inventory`);
  console.log(`\nSaved to: ${INVENTORY_PATH}`);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
