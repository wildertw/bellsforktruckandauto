#!/usr/bin/env node
// optimize-images.js — Compress hero + vehicle images for mobile performance
// Generates WebP + optimized JPEG at multiple sizes
// Usage: node optimize-images.js

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const VEHICLE_DIR = path.join(__dirname, 'assets', 'vehicles');
const HERO_DIR = path.join(__dirname, 'assets');
const OUT_DIR = path.join(__dirname, 'assets', 'vehicles', 'optimized');

// Sizes for vehicle images
const VEHICLE_SIZES = [
  { suffix: '400w', width: 400, quality: 72 },
  { suffix: '800w', width: 800, quality: 78 },
  { suffix: '1200w', width: 1200, quality: 82 },
];

// Hero image sizes
const HERO_SIZES = [
  { suffix: 'mobile', width: 768, quality: 75 },
  { suffix: 'tablet', width: 1024, quality: 78 },
  { suffix: 'desktop', width: 1920, quality: 80 },
];

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function optimizeHeroImages() {
  const heroFiles = ['shop-front.jpeg', 'shop-front.jpg'];
  const heroOutDir = path.join(__dirname, 'assets', 'hero');
  await ensureDir(heroOutDir);

  for (const file of heroFiles) {
    const src = path.join(HERO_DIR, file);
    if (!fs.existsSync(src)) continue;

    const baseName = 'shop-front';
    console.log(`  Processing hero: ${file}`);

    for (const size of HERO_SIZES) {
      const jpgOut = path.join(heroOutDir, `${baseName}-${size.suffix}.jpg`);
      const webpOut = path.join(heroOutDir, `${baseName}-${size.suffix}.webp`);

      // Skip if already optimized
      if (fs.existsSync(jpgOut) && fs.existsSync(webpOut)) {
        console.log(`    Skipping ${size.suffix} (already exists)`);
        continue;
      }

      try {
        await sharp(src)
          .resize(size.width, null, { withoutEnlargement: true })
          .jpeg({ quality: size.quality, mozjpeg: true })
          .toFile(jpgOut);

        await sharp(src)
          .resize(size.width, null, { withoutEnlargement: true })
          .webp({ quality: size.quality - 5, effort: 5 })
          .toFile(webpOut);

        const jpgSize = (fs.statSync(jpgOut).size / 1024).toFixed(0);
        const webpSize = (fs.statSync(webpOut).size / 1024).toFixed(0);
        console.log(`    ${size.suffix}: JPG=${jpgSize}KB, WebP=${webpSize}KB`);
      } catch (err) {
        console.error(`    Error processing ${file} at ${size.suffix}:`, err.message);
      }
    }

    // Also create OG image (1200x630 for social sharing)
    const ogOut = path.join(heroOutDir, `${baseName}-og.jpg`);
    if (!fs.existsSync(ogOut)) {
      try {
        await sharp(src)
          .resize(1200, 630, { fit: 'cover' })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(ogOut);
        const ogSize = (fs.statSync(ogOut).size / 1024).toFixed(0);
        console.log(`    OG image: ${ogSize}KB`);
      } catch (err) {
        console.error(`    Error creating OG image:`, err.message);
      }
    }

    break; // Only process one hero source (jpeg is preferred)
  }
}

async function optimizeVehicleImages() {
  await ensureDir(OUT_DIR);

  if (!fs.existsSync(VEHICLE_DIR)) {
    console.log('  No vehicles directory found, skipping.');
    return;
  }

  const files = fs.readdirSync(VEHICLE_DIR).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) && !f.startsWith('.');
  });

  console.log(`  Found ${files.length} vehicle images to optimize`);
  let processed = 0;
  let skipped = 0;

  for (const file of files) {
    const src = path.join(VEHICLE_DIR, file);
    const baseName = path.parse(file).name;

    // Check if already optimized
    const checkFile = path.join(OUT_DIR, `${baseName}-400w.webp`);
    if (fs.existsSync(checkFile)) {
      skipped++;
      continue;
    }

    try {
      for (const size of VEHICLE_SIZES) {
        const webpOut = path.join(OUT_DIR, `${baseName}-${size.suffix}.webp`);
        const jpgOut = path.join(OUT_DIR, `${baseName}-${size.suffix}.jpg`);

        await sharp(src)
          .resize(size.width, null, { withoutEnlargement: true })
          .webp({ quality: size.quality - 5, effort: 4 })
          .toFile(webpOut);

        await sharp(src)
          .resize(size.width, null, { withoutEnlargement: true })
          .jpeg({ quality: size.quality, mozjpeg: true })
          .toFile(jpgOut);
      }
      processed++;
    } catch (err) {
      console.error(`    Error processing ${file}:`, err.message);
    }
  }

  console.log(`  Optimized: ${processed}, Skipped (already done): ${skipped}`);
}

async function main() {
  console.log('=== Image Optimization ===\n');

  console.log('1. Hero images:');
  await optimizeHeroImages();

  console.log('\n2. Vehicle images:');
  await optimizeVehicleImages();

  // Print summary
  console.log('\n=== Summary ===');
  const heroDir = path.join(__dirname, 'assets', 'hero');
  if (fs.existsSync(heroDir)) {
    const heroFiles = fs.readdirSync(heroDir).filter(f => !f.startsWith('.') && f !== 'manifest.json');
    let totalHero = 0;
    heroFiles.forEach((f) => {
      totalHero += fs.statSync(path.join(heroDir, f)).size;
    });
    console.log(`Hero images total: ${(totalHero / 1024).toFixed(0)} KB (${heroFiles.length} files)`);
  }

  if (fs.existsSync(OUT_DIR)) {
    const optFiles = fs.readdirSync(OUT_DIR);
    let totalOpt = 0;
    optFiles.forEach((f) => {
      totalOpt += fs.statSync(path.join(OUT_DIR, f)).size;
    });
    console.log(`Vehicle optimized total: ${(totalOpt / 1024 / 1024).toFixed(1)} MB (${optFiles.length} files)`);
  }
}

main().catch(console.error);
