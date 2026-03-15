#!/usr/bin/env node
// generate-category-pages.js — Generate static category landing pages
// Creates: /used-trucks-greenville-nc/, /used-suvs-greenville-nc/,
//          /used-cars-greenville-nc/, /used-diesel-trucks-greenville-nc/

const fs = require('fs');
const path = require('path');
const {
  SITE_URL, DEALER_NAME, DEALER_PHONE, DEALER_PHONE_TEL, DEALER_SMS_TEL,
  DEALER_ADDRESS, DEALER_STREET, DEALER_CITY, DEALER_STATE, DEALER_ZIP,
  DEALER_LAT, DEALER_LNG, DEALER_EMAIL, DEALER_FB,
  escapeHtml, escapeAttr, titleCase, formatMoney, todayISO,
  buildVDPPath, resolveImg, loadAvailableVehicles,
} = require('./build-utils');

const ASSET_PREFIX = '/';

// ── Category definitions ──

const CATEGORIES = [
  {
    slug: 'used-trucks-greenville-nc',
    filterType: 'truck',
    title: 'Used Trucks for Sale in Greenville, NC',
    metaTitle: 'Used Trucks for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Browse our selection of used trucks for sale at Bells Fork Truck & Auto in Greenville, NC. F-150, Silverado, RAM, Tundra and more. Fair prices, no pressure.',
    h1: 'Used Trucks for Sale in Greenville, NC',
    intro: 'Looking for a dependable used truck in the Greenville, NC area? Bells Fork Truck & Auto carries a wide selection of pre-owned pickup trucks from Ford, Chevrolet, RAM, Toyota, and more. Every truck on our lot is inspected, fairly priced, and ready to work. Browse our current inventory below or call us to schedule a test drive.',
    whyBuyH2: 'Why Buy a Used Truck from Bells Fork?',
    whyBuyContent: `<p>Bells Fork Truck & Auto is one of the most trusted used truck dealers in the Greenville, NC area. Whether you need a heavy-duty work truck for hauling and towing, a reliable half-ton pickup for daily driving, or a diesel-powered rig built for Pitt County farms and job sites, our lot has options that fit your needs and your budget.</p>
<p>Every truck we sell goes through a multi-point inspection before it reaches the lot. We check the engine, transmission, frame, brakes, and drivetrain so you can drive away with confidence. Our pricing is based on current market data\u2014no hidden fees, no last-minute add-ons.</p>
<p>We carry popular models including Ford F-150, F-250, and F-350 Super Duty trucks, Chevrolet Silverado 1500 and 2500HD, RAM 1500 and 2500, Toyota Tundra and Tacoma, and GMC Sierra. Many of our trucks are 4x4 and ready for off-road or work conditions common across Eastern North Carolina.</p>
<p>We also offer in-house financing options for all credit situations, trade-in appraisals, and a straightforward buying process. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a> to schedule a test drive.</p>`,
    faqs: [
      { q: 'What brands of used trucks do you carry?', a: 'We regularly stock Ford F-150, F-250, and F-350 trucks, Chevrolet Silverado 1500 and 2500, RAM 1500 and 2500, Toyota Tundra and Tacoma, and other popular models.' },
      { q: 'Do you offer financing on used trucks?', a: 'Yes. We work with multiple lenders to get you approved regardless of credit history. Apply online or visit us at 3840 Charles Blvd, Greenville, NC 27858.' },
      { q: 'Can I trade in my current vehicle?', a: 'Absolutely. We accept trade-ins on all purchases and offer fair market appraisals. Bring your vehicle in for a free evaluation.' },
      { q: 'Do your trucks come with a warranty?', a: 'Many of our trucks still carry remaining manufacturer warranty. Ask about extended warranty options available at the time of purchase.' },
    ],
  },
  {
    slug: 'used-suvs-greenville-nc',
    filterType: 'suv',
    title: 'Used SUVs for Sale in Greenville, NC',
    metaTitle: 'Used SUVs for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used SUVs at Bells Fork Truck & Auto in Greenville, NC. Tahoe, Explorer, 4Runner, Wrangler and more. Family-friendly, inspected, and priced right.',
    h1: 'Used SUVs for Sale in Greenville, NC',
    intro: 'Need a spacious, family-friendly SUV? Bells Fork Truck & Auto in Greenville, NC has a great selection of pre-owned SUVs including Chevrolet Tahoe, Ford Explorer, Toyota 4Runner, Jeep Wrangler, and more. All vehicles are inspected and priced competitively. Browse below or give us a call.',
    whyBuyH2: 'Why Buy a Used SUV from Bells Fork?',
    whyBuyContent: `<p>If you are looking for a versatile, family-friendly vehicle in Eastern North Carolina, a used SUV from Bells Fork Truck & Auto is a smart choice. SUVs offer the cargo space, passenger room, and capability that Pitt County drivers need\u2014whether it is school drop-offs in Winterville, weekend trips to the coast, or navigating unpaved roads around Farmville and Ayden.</p>
<p>Our SUV inventory includes popular models like the Chevrolet Tahoe, Suburban, and Equinox, Ford Explorer and Expedition, Toyota 4Runner and Highlander, Jeep Wrangler and Grand Cherokee, and GMC Yukon. We stock both two-wheel drive and four-wheel drive options to match your lifestyle.</p>
<p>Every SUV is inspected before listing. We verify the engine, transmission, suspension, brakes, and safety systems so you know exactly what you are getting. Our transparent pricing means no surprises at the register.</p>
<p>Financing is available for all credit profiles. Stop by our lot at 3840 Charles Blvd, Greenville, NC 27858, browse online, or call <a href="tel:+12524960005">(252) 496-0005</a> to learn more.</p>`,
    faqs: [
      { q: 'What SUV models do you have available?', a: 'Our inventory frequently includes Chevrolet Tahoe, Suburban, Equinox, Ford Explorer, Expedition, Toyota 4Runner, Highlander, Jeep Wrangler, Cherokee, and more.' },
      { q: 'Are your SUVs inspected before sale?', a: 'Yes. Every vehicle goes through a thorough inspection before it hits our lot. We want you to drive away with confidence.' },
      { q: 'Do you offer 4WD and AWD SUVs?', a: 'We carry both 4-wheel drive and all-wheel drive models. Use our inventory filters to find the drivetrain that fits your needs.' },
      { q: 'Can I schedule a test drive online?', a: 'Yes. Use our online scheduling form or call us at (252) 496-0005 to book a test drive at your convenience.' },
    ],
  },
  {
    slug: 'used-cars-greenville-nc',
    filterType: 'car',
    title: 'Used Cars for Sale in Greenville, NC',
    metaTitle: 'Used Cars for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Find quality used cars for sale at Bells Fork Truck & Auto in Greenville, NC. Sedans, coupes, and more. Honest pricing, no hidden fees. Call (252) 496-0005.',
    h1: 'Used Cars for Sale in Greenville, NC',
    intro: 'Searching for a reliable used car in Greenville, NC? Bells Fork Truck & Auto offers a hand-picked selection of pre-owned sedans, coupes, and other passenger cars. From fuel-efficient commuters to sporty performers, every car we sell is inspected and priced transparently. Take a look at our inventory below.',
    whyBuyH2: 'Why Buy a Used Car from Bells Fork?',
    whyBuyContent: `<p>Bells Fork Truck & Auto offers a curated selection of pre-owned cars in Greenville, NC. Whether you need an affordable daily commuter, a fuel-efficient sedan for highway miles, or a sporty coupe, our inventory has vehicles to match your driving needs and budget.</p>
<p>We stock cars from manufacturers including Chevrolet, Ford, Toyota, Honda, Hyundai, Nissan, Subaru, and more. From practical sedans to performance-oriented models like the Chevrolet Camaro and Dodge Challenger, our selection covers a wide range of styles and price points.</p>
<p>Every car on our lot is inspected before sale. We check the engine, brakes, tires, fluid levels, and electronics to make sure it is road-ready. Our pricing is based on current market values with no hidden fees or last-minute charges.</p>
<p>We also offer financing for buyers in all credit situations, plus trade-in appraisals for your current vehicle. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a> to get started.</p>`,
    faqs: [
      { q: 'What types of used cars do you sell?', a: 'We carry a variety of sedans, coupes, and sports cars from brands like Chevrolet, Ford, Toyota, Honda, Nissan, Hyundai, and more.' },
      { q: 'Are your prices negotiable?', a: 'Our vehicles are priced competitively from the start based on market data. We believe in transparent, fair pricing with no hidden fees.' },
      { q: 'Do you offer financing for used cars?', a: 'Yes. We work with a network of lenders to help you get approved. Fill out our online financing application to get started.' },
      { q: 'Where are you located?', a: 'We are located at 3840 Charles Blvd, Greenville, NC 27858. Open Monday through Friday 8 AM to 6 PM, Saturday 9 AM to 2 PM.' },
    ],
  },
  {
    slug: 'used-diesel-trucks-greenville-nc',
    filterType: 'diesel',
    title: 'Used Diesel Trucks for Sale in Greenville, NC',
    metaTitle: 'Used Diesel Trucks for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used diesel trucks at Bells Fork Truck & Auto in Greenville, NC. Powerstroke, Duramax, Cummins diesels. Built for towing and work. Call (252) 496-0005.',
    h1: 'Used Diesel Trucks for Sale in Greenville, NC',
    intro: 'Need a diesel truck that can handle heavy towing and hard work? Bells Fork Truck & Auto in Greenville, NC stocks pre-owned diesel pickups including Ford Powerstroke, Chevy Duramax, and RAM Cummins models. Our diesels are inspected, competitively priced, and ready for the job site or the farm.',
    whyBuyH2: 'Why Buy a Used Diesel Truck from Bells Fork?',
    whyBuyContent: `<p>Diesel trucks are built for serious work, and Bells Fork Truck & Auto in Greenville, NC is the place to find them. Our diesel inventory includes heavy-duty pickups from Ford, Chevrolet, RAM, and GMC\u2014trucks designed for towing, hauling, and commercial applications across Pitt County and Eastern North Carolina.</p>
<p>We carry popular diesel powertrains including the Ford Power Stroke, Chevrolet/GMC Duramax, and RAM Cummins. These engines are known for their torque, durability, and long service life\u2014making a used diesel truck an excellent investment for farmers, contractors, and business owners in the Greenville area.</p>
<p>Every diesel truck on our lot is inspected with special attention to the engine, turbo system, exhaust after-treatment, transmission, and drivetrain. We look for trucks that still have plenty of working life ahead of them so you can put them to use right away.</p>
<p>We offer financing options for all credit situations. Whether you are a first-time diesel buyer or adding to a fleet, we can help. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a>.</p>`,
    faqs: [
      { q: 'What diesel truck brands do you carry?', a: 'We stock Ford Super Duty with Powerstroke, Chevrolet Silverado with Duramax, RAM with Cummins, and other diesel models as they become available.' },
      { q: 'Are your diesel trucks inspected?', a: 'Every diesel goes through a comprehensive inspection. We check the engine, turbo system, emissions equipment, and drivetrain before listing.' },
      { q: 'Do you offer financing on diesel trucks?', a: 'Yes. Diesel trucks are a bigger investment, and we work with lenders who understand that. Apply online or visit us to discuss your options.' },
      { q: 'Can I use my diesel truck for commercial work?', a: 'Many of our diesel trucks are well-suited for commercial and agricultural use. Ask us about specific towing capacities and work-ready options.' },
    ],
  },
  // ── Model-specific pages ──
  {
    slug: 'used-ford-f150-greenville-nc',
    filterFn: v => v.make && v.make.toLowerCase() === 'ford' && v.model && v.model.toLowerCase().includes('f-150'),
    title: 'Used Ford F-150 for Sale in Greenville, NC',
    metaTitle: 'Used Ford F-150 for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used Ford F-150 trucks at Bells Fork Truck & Auto in Greenville, NC. XLT, Lariat, King Ranch and more. Inspected, fairly priced. Call (252) 496-0005.',
    h1: 'Used Ford F-150 Trucks for Sale in Greenville, NC',
    intro: 'The Ford F-150 is America\u2019s best-selling truck for good reason. At Bells Fork Truck & Auto in Greenville, NC, we regularly stock pre-owned F-150 pickups in a range of trims including XL, XLT, Lariat, and King Ranch. Every F-150 on our lot is inspected and priced competitively. Browse our current selection below.',
    whyBuyH2: 'Why Buy a Used Ford F-150 from Bells Fork?',
    whyBuyContent: `<p>The Ford F-150 combines towing capability, payload capacity, and everyday drivability in a package that works for both job sites and family hauling. Whether you need a work truck for Pitt County farms and construction, or a comfortable daily driver with 4x4 capability for Eastern North Carolina roads, the F-150 delivers.</p>
<p>We carry F-150s with popular engine options including the 2.7L and 3.5L EcoBoost V6, the 5.0L Coyote V8, and the Power Stroke diesel. Many of our F-150s are equipped with 4WD, tow packages, and crew cab configurations.</p>
<p>Every truck is inspected before it reaches our lot. We check the engine, transmission, frame, brakes, and drivetrain. Our pricing is based on current market data with no hidden fees.</p>
<p>Financing is available for all credit situations. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a> to schedule a test drive.</p>`,
    faqs: [
      { q: 'What Ford F-150 trims do you carry?', a: 'We regularly stock XL, XLT, Lariat, King Ranch, and Platinum trims depending on availability. Check our current inventory for the latest selection.' },
      { q: 'Do your F-150s come with 4WD?', a: 'Many of our F-150s are 4x4 equipped. Use our inventory filters or call us to find a 4WD model that fits your needs.' },
      { q: 'What engine options are available?', a: 'We carry F-150s with EcoBoost V6, 5.0L V8, and diesel engine options depending on current stock.' },
      { q: 'Do you offer financing on F-150 trucks?', a: 'Yes. We work with multiple lenders to help buyers in all credit situations. Apply online or visit us at 3840 Charles Blvd, Greenville, NC 27858.' },
    ],
  },
  {
    slug: 'used-chevrolet-silverado-greenville-nc',
    filterFn: v => v.make && v.make.toLowerCase() === 'chevrolet' && v.model && v.model.toLowerCase().includes('silverado'),
    title: 'Used Chevrolet Silverado for Sale in Greenville, NC',
    metaTitle: 'Used Chevrolet Silverado for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Browse used Chevrolet Silverado 1500 and 2500 trucks at Bells Fork Truck & Auto in Greenville, NC. Inspected, fair prices. Call (252) 496-0005.',
    h1: 'Used Chevrolet Silverado Trucks for Sale in Greenville, NC',
    intro: 'Looking for a used Chevy Silverado in the Greenville, NC area? Bells Fork Truck & Auto carries Silverado 1500 and 2500 models in a variety of trims. Each truck is inspected and priced based on current market values. Browse below or call us to schedule a test drive.',
    whyBuyH2: 'Why Buy a Used Silverado from Bells Fork?',
    whyBuyContent: `<p>The Chevrolet Silverado is a proven workhorse built for towing, hauling, and daily driving. Whether you need a half-ton 1500 for commuting and weekend projects or a heavy-duty 2500HD for serious work across Pitt County, our Silverado inventory has options to match.</p>
<p>We stock Silverados with popular powertrains including the 5.3L V8, 6.2L V8, and Duramax diesel. Many are equipped with 4WD, Z71 off-road packages, and tow-ready configurations.</p>
<p>Every Silverado is inspected before listing. We verify the engine, transmission, frame, brakes, and electrical systems. Our transparent pricing means no surprises.</p>
<p>Financing is available for all credit profiles. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a>.</p>`,
    faqs: [
      { q: 'Do you carry Silverado 1500 and 2500 models?', a: 'Yes. We stock both Silverado 1500 half-ton and 2500HD heavy-duty models as they become available.' },
      { q: 'What Silverado trims do you have?', a: 'Our inventory includes WT, Custom, LT, LTZ, and High Country trims depending on current stock.' },
      { q: 'Are your Silverados 4WD?', a: 'Many of our Silverados are 4x4 equipped. Contact us or browse our inventory to find the drivetrain you need.' },
      { q: 'Do you offer financing?', a: 'Yes. We work with multiple lenders for all credit situations. Apply online or visit our dealership.' },
    ],
  },
  {
    slug: 'used-gmc-sierra-greenville-nc',
    filterFn: v => v.make && v.make.toLowerCase() === 'gmc' && v.model && v.model.toLowerCase().includes('sierra'),
    title: 'Used GMC Sierra for Sale in Greenville, NC',
    metaTitle: 'Used GMC Sierra for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used GMC Sierra 1500 and 2500 trucks at Bells Fork Truck & Auto in Greenville, NC. Quality trucks, fair prices. Call (252) 496-0005.',
    h1: 'Used GMC Sierra Trucks for Sale in Greenville, NC',
    intro: 'The GMC Sierra combines professional-grade capability with refined comfort. At Bells Fork Truck & Auto in Greenville, NC, we carry pre-owned Sierra 1500 and 2500 models ready for work or daily driving. Every truck is inspected and competitively priced.',
    whyBuyH2: 'Why Buy a Used GMC Sierra from Bells Fork?',
    whyBuyContent: `<p>The GMC Sierra delivers the towing and payload performance you expect from a full-size pickup with an upscale interior and feature set. Whether you need a Sierra 1500 for versatile daily use or a 2500HD for heavy-duty towing and hauling across Eastern North Carolina, we have options on our lot.</p>
<p>We carry Sierras with V8 and Duramax diesel powertrains, 4WD and 2WD configurations, and trims ranging from SLE to Denali. Many come with tow packages, bed liners, and crew cab layouts.</p>
<p>Each Sierra is inspected before sale. We check the engine, transmission, frame, suspension, and electronics. Our pricing is market-based with no hidden fees.</p>
<p>Financing is available for all credit situations. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a>.</p>`,
    faqs: [
      { q: 'What GMC Sierra models do you carry?', a: 'We stock Sierra 1500 and 2500HD models in various trims including SLE, SLT, AT4, and Denali as available.' },
      { q: 'Do your Sierras have the Duramax diesel?', a: 'Some of our Sierra inventory includes Duramax diesel powertrains. Check our current listings or call us for availability.' },
      { q: 'Are your Sierras inspected?', a: 'Every Sierra goes through a multi-point inspection covering the engine, transmission, frame, brakes, and drivetrain before listing.' },
      { q: 'Do you offer financing on GMC trucks?', a: 'Yes. We offer financing for all credit situations. Apply online or visit us at 3840 Charles Blvd, Greenville, NC 27858.' },
    ],
  },
  {
    slug: 'used-toyota-tacoma-greenville-nc',
    filterFn: v => v.make && v.make.toLowerCase() === 'toyota' && v.model && v.model.toLowerCase().includes('tacoma'),
    title: 'Used Toyota Tacoma for Sale in Greenville, NC',
    metaTitle: 'Used Toyota Tacoma for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Browse used Toyota Tacoma trucks at Bells Fork Truck & Auto in Greenville, NC. TRD Sport, TRD Off-Road, and more. Call (252) 496-0005.',
    h1: 'Used Toyota Tacoma Trucks for Sale in Greenville, NC',
    intro: 'The Toyota Tacoma is one of the most reliable midsize trucks on the road. At Bells Fork Truck & Auto in Greenville, NC, we stock pre-owned Tacomas in SR5, TRD Sport, TRD Off-Road, and other trims. Every Tacoma on our lot is inspected and fairly priced.',
    whyBuyH2: 'Why Buy a Used Toyota Tacoma from Bells Fork?',
    whyBuyContent: `<p>The Toyota Tacoma is known for its durability, resale value, and off-road capability. Whether you need a dependable work truck, a weekend trail runner, or a fuel-efficient pickup for daily commuting around Greenville and Pitt County, the Tacoma fits the bill.</p>
<p>We carry Tacomas with both the 2.7L four-cylinder and 3.5L V6 engines, in 4x2 and 4x4 configurations. Popular trims in our inventory include SR5, TRD Sport, and TRD Off-Road with features like crawl control, locking rear differential, and multi-terrain select.</p>
<p>Every Tacoma is inspected before listing. We check the frame, engine, transmission, and undercarriage. Our pricing reflects current market values with no hidden fees.</p>
<p>Financing is available for all credit profiles. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a> to schedule a test drive.</p>`,
    faqs: [
      { q: 'What Tacoma trims do you carry?', a: 'We regularly stock SR5, TRD Sport, TRD Off-Road, and Limited trims depending on current inventory.' },
      { q: 'Do your Tacomas have 4WD?', a: 'Many of our Tacomas are 4x4. Use our inventory filters or call us to find the right drivetrain for you.' },
      { q: 'Why do Tacomas hold their value so well?', a: 'Toyota Tacomas are known for reliability and durability, which keeps demand and resale values high. A used Tacoma is a smart investment.' },
      { q: 'Do you offer financing?', a: 'Yes. We work with multiple lenders to get you approved regardless of credit history. Apply online or visit us.' },
    ],
  },
  {
    slug: 'used-chevrolet-camaro-greenville-nc',
    filterFn: v => v.make && v.make.toLowerCase() === 'chevrolet' && v.model && v.model.toLowerCase().includes('camaro'),
    title: 'Used Chevrolet Camaro for Sale in Greenville, NC',
    metaTitle: 'Used Chevrolet Camaro for Sale in Greenville, NC | Bells Fork Truck & Auto',
    metaDesc: 'Shop used Chevrolet Camaro coupes at Bells Fork Truck & Auto in Greenville, NC. LT, SS, ZL1 trims available. Fair prices. Call (252) 496-0005.',
    h1: 'Used Chevrolet Camaro for Sale in Greenville, NC',
    intro: 'Looking for a used Chevy Camaro in the Greenville, NC area? Bells Fork Truck & Auto carries pre-owned Camaros in LT, SS, and performance trims. Every Camaro is inspected and priced to move. Browse our current inventory below.',
    whyBuyH2: 'Why Buy a Used Camaro from Bells Fork?',
    whyBuyContent: `<p>The Chevrolet Camaro delivers sports car performance at a price point that makes sense. Whether you want a turbocharged four-cylinder for fuel-efficient fun, a 6.2L V8 SS for straight-line power, or a track-ready Z/28 or ZL1, the Camaro lineup has something for every enthusiast.</p>
<p>We carry Camaros in coupe and convertible configurations with both automatic and manual transmissions. Popular trims in our inventory include the 1LT, 2LT, 1SS, and 2SS.</p>
<p>Every Camaro is inspected before sale. We check the engine, brakes, suspension, tires, and electronics. Our transparent pricing is based on current market data.</p>
<p>Financing is available for all credit situations. Visit us at 3840 Charles Blvd, Greenville, NC 27858 or call <a href="tel:+12524960005">(252) 496-0005</a>.</p>`,
    faqs: [
      { q: 'What Camaro trims do you carry?', a: 'We stock LT, SS, and other performance trims as they become available. Check our inventory for current selection.' },
      { q: 'Do you have V8 Camaros?', a: 'Yes. We carry Camaros with both the turbocharged four-cylinder and the 6.2L V8 depending on current inventory.' },
      { q: 'Are your Camaros inspected?', a: 'Every Camaro goes through a multi-point inspection before listing. We check the engine, brakes, suspension, and all major systems.' },
      { q: 'Do you offer financing on sports cars?', a: 'Yes. We offer financing for all vehicle types and credit situations. Apply online or visit us at our Greenville location.' },
    ],
  },
];

// ── Build a vehicle card (matches inventory page card format) ──

function buildCard(v) {
  const title = `${v.year} ${v.make} ${v.model}`;
  const trim = v.trim || '';
  const vehicleLabel = `${title}${trim ? ' ' + trim : ''}`.trim();
  const price = v.price ? `$${Number(v.price).toLocaleString('en-US')}` : 'Call for Price';
  const vdpUrl = buildVDPPath(v);
  const mainImage = v.images && v.images.length > 0 ? String(v.images[0]).trim() : '';
  const resolvedSrc = resolveImg(mainImage, ASSET_PREFIX);

  const applyHref = `${ASSET_PREFIX}financing.html?tab=financing&vehicle=${encodeURIComponent(vehicleLabel)}&stock=${encodeURIComponent(v.stockNumber || '')}&price=${encodeURIComponent(String(v.price ?? ''))}#applications`;
  const inquireHref = `${ASSET_PREFIX}contact.html?vehicle=${encodeURIComponent(vehicleLabel)}&stock=${encodeURIComponent(v.stockNumber || '')}#appointment`;

  const mpgDisplay = v.mpgCity && v.mpgHighway
    ? `<p class="text-muted small mb-2">\u26fd ${v.mpgCity}/${v.mpgHighway} MPG${v.fuelType ? ' &middot; ' + escapeHtml(v.fuelType) : ''}</p>`
    : (v.fuelType ? `<p class="text-muted small mb-2">${escapeHtml(v.fuelType)}</p>` : '');

  const stockDisplay = v.stockNumber
    ? `<span class="badge bg-secondary mb-2">Stock #${escapeHtml(v.stockNumber)}</span> `
    : '';

  const badgeClass = (v.badge || '').toLowerCase().includes('new') ? 'bg-success' :
    (v.badge || '').toLowerCase().includes('sale') ? 'bg-danger' :
    (v.badge || '').toLowerCase().includes('sold') ? 'bg-dark' : 'bg-warning text-dark';

  const imgHtml = mainImage
    ? `<a href="${vdpUrl}" aria-label="View ${escapeAttr(vehicleLabel)} details">
        <img src="${escapeAttr(resolvedSrc)}"
             alt="${escapeAttr(vehicleLabel)}"
             class="card-img-top"
             width="400" height="220"
             style="height:220px; object-fit:cover;"
             loading="lazy" decoding="async">
      </a>`
    : `<div class="inventory-placeholder d-flex align-items-center justify-content-center bg-light" style="height:220px;">
        <svg width="64" height="64" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="3" width="15" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1"/>
          <circle cx="5.5" cy="14.5" r="1.5" fill="currentColor"/>
          <circle cx="12.5" cy="14.5" r="1.5" fill="currentColor"/>
        </svg>
      </div>`;

  return `<div class="col-md-6 col-lg-4">
  <article class="card shadow-soft h-100 inventory-card">
    <div class="inventory-img-wrap">
      ${v.badge ? `<span class="inventory-badge ${badgeClass}">${escapeHtml(v.badge)}</span>` : ''}
      ${imgHtml}
    </div>
    <div class="card-body d-flex flex-column">
      <div class="d-flex justify-content-between align-items-start mb-1">
        <h3 class="h6 fw-bold mb-0"><a href="${vdpUrl}" class="text-dark text-decoration-none">${escapeHtml(vehicleLabel)}</a></h3>
        <span class="badge bg-danger ms-2 flex-shrink-0">${price}</span>
      </div>
      <p class="text-muted small mb-2">${escapeHtml(v.description || '')}</p>
      ${v.mileage ? `<p class="text-muted small mb-2"><strong>${Number(v.mileage).toLocaleString()} miles</strong></p>` : ''}
      ${mpgDisplay}
      ${stockDisplay}
      <div class="d-grid gap-2 mt-auto">
        <a href="${vdpUrl}" class="btn btn-sm btn-danger w-100">View Details</a>
        <div class="d-flex gap-2">
          <a href="${applyHref}" class="btn btn-sm btn-outline-secondary w-50">Apply</a>
          <a href="${inquireHref}" class="btn btn-sm btn-outline-secondary w-50">Inquire</a>
        </div>
      </div>
    </div>
  </article>
</div>`;
}

// ── Build FAQ schema ──

function buildFAQSchema(faqs) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }, null, 2);
}

// ── Build ItemList schema ──

function buildItemListSchema(vehicles, category) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: category.title,
    numberOfItems: vehicles.length,
    itemListElement: vehicles.slice(0, 20).map((v, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}${buildVDPPath(v)}`,
      name: `${v.year} ${titleCase(v.make)} ${titleCase(v.model)}${v.trim ? ' ' + v.trim : ''}`,
    })),
  }, null, 2);
}

// ── Generate full page HTML ──

function generateCategoryPage(cat, vehicles, allCategories) {
  const filtered = cat.filterFn
    ? vehicles.filter(cat.filterFn)
    : vehicles.filter(v => v._inferredType === cat.filterType);
  filtered.sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));

  const cardsHTML = filtered.map(v => buildCard(v)).join('\n');
  const crossLinks = allCategories
    .filter(c => c.slug !== cat.slug)
    .map(c => `<a href="/${c.slug}/" class="cross-link-btn">${c.title.replace(' in Greenville, NC', '')}</a>`)
    .join('');

  const faqHTML = cat.faqs.map((f, i) =>
    `<div class="accordion-item">
      <h3 class="accordion-header"><button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#catfaq${i}">${escapeHtml(f.q)}</button></h3>
      <div id="catfaq${i}" class="accordion-collapse collapse" data-bs-parent="#categoryFAQ"><div class="accordion-body">${escapeHtml(f.a)}</div></div>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(cat.metaTitle)}</title>
  <meta name="description" content="${escapeAttr(cat.metaDesc)}">
  <link rel="canonical" href="${SITE_URL}/${cat.slug}/">
  <link rel="sitemap" type="application/xml" href="/sitemap.xml">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="geo.region" content="US-NC">
  <meta name="geo.placename" content="${DEALER_CITY}, North Carolina">
  <meta name="geo.position" content="${DEALER_LAT};${DEALER_LNG}">
  <meta name="ICBM" content="${DEALER_LAT}, ${DEALER_LNG}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeAttr(cat.metaTitle)}">
  <meta property="og:description" content="${escapeAttr(cat.metaDesc)}">
  <meta property="og:url" content="${SITE_URL}/${cat.slug}/">
  <meta property="og:image" content="${SITE_URL}/assets/hero/shop-front-og.jpg">
  <meta property="og:site_name" content="${DEALER_NAME}">
  <link rel="icon" type="image/png" href="${ASSET_PREFIX}assets/favicon.png">
  <link href="${ASSET_PREFIX}assets/vendor/bootstrap.min.css" rel="stylesheet">
  <link href="${ASSET_PREFIX}style.min.css" rel="stylesheet">
  <script type="application/ld+json">
${buildItemListSchema(filtered, cat)}
  </script>
  <script type="application/ld+json">
${buildFAQSchema(cat.faqs)}
  </script>
</head>
<body>

  <!-- IDENTITY BAR -->
  <div class="site-identity-bar" style="background:#f8f8f8;border-bottom:1px solid #eee;">
    <div class="container">
      <div class="d-flex align-items-center justify-content-between flex-wrap py-2">
        <a href="${ASSET_PREFIX}index.html" style="min-width:160px;">
          <span class="fw-bold" style="font-size:1.15rem;color:#111;">${DEALER_NAME}</span>
        </a>
        <a href="${ASSET_PREFIX}index.html" class="d-none d-md-block"
           style="position:absolute;left:50%;transform:translateX(-50%);">
          <img src="${ASSET_PREFIX}assets/logo.png" height="68" alt="${DEALER_NAME} Logo">
        </a>
        <div class="text-end ms-auto" style="min-width:160px;">
          <a href="tel:${DEALER_PHONE_TEL}" class="text-decoration-none fw-bold d-flex align-items-center justify-content-end gap-2" style="font-size:1.2rem;color:#111;">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
            ${DEALER_PHONE}
          </a>
          <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank"
             class="text-decoration-none text-muted d-flex align-items-start justify-content-end gap-1 mt-1" style="font-size:.82rem;line-height:1.5;">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" class="flex-shrink-0 mt-1" viewBox="0 0 16 16"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
            <span>${DEALER_STREET}<br>${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP}</span>
          </a>
        </div>
      </div>
    </div>
  </div>

  <!-- NAV BAR -->
  <header class="sticky-top" role="banner" style="z-index:1030;">
    <nav class="navbar navbar-expand-lg navbar-dark py-0" style="background:#111111;">
      <div class="container-fluid">
        <button class="navbar-toggler border-0 ms-auto py-3" type="button" data-bs-toggle="collapse" data-bs-target="#navMain"
                aria-controls="navMain" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse justify-content-center" id="navMain">
          <ul class="navbar-nav align-items-lg-center">
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink active" href="/inventory">Inventory</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}about.html">About</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}reviews.html">Reviews</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}financing.html">Financing</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}contact.html#visit">Contact</a></li>
            <li class="nav-item"><a class="nav-link px-4 py-3 fw-semibold text-uppercase bfat-navlink" href="${ASSET_PREFIX}blog.html">Blog</a></li>
          </ul>
        </div>
      </div>
    </nav>
  </header>

  <main>
    <!-- Breadcrumb -->
    <nav class="vdp-breadcrumb" aria-label="Breadcrumb" style="background:#f9f9f9;border-bottom:1px solid #eee;padding:.6rem 0;font-size:.85rem;">
      <div class="container">
        <a href="${ASSET_PREFIX}index.html">Home</a>
        <span class="sep">&rsaquo;</span>
        <a href="/inventory">Inventory</a>
        <span class="sep">&rsaquo;</span>
        <span>${escapeHtml(cat.title.replace(' in Greenville, NC', ''))}</span>
      </div>
    </nav>

    <!-- Hero / Intro -->
    <section class="page-intro">
      <div class="container">
        <div class="category-count-badge">${filtered.length} Vehicle${filtered.length !== 1 ? 's' : ''} Available</div>
        <h1 class="display-6 fw-bold mb-3">${escapeHtml(cat.h1)}</h1>
        <p class="lead text-muted mb-0" style="max-width:700px;">${escapeHtml(cat.intro)}</p>
      </div>
    </section>

    <!-- Vehicle Listings -->
    <section class="py-4" style="background:#f1f1f1;">
      <div class="container">
        <div class="row g-4">
        ${cardsHTML || '<div class="col-12"><p class="text-center text-muted py-5">No vehicles currently available in this category. Check back soon or <a href="/inventory">browse all inventory</a>.</p></div>'}
        </div>
      </div>
    </section>

    <!-- Why Buy Content (SEO depth) -->
    ${cat.whyBuyContent ? `<section class="py-5 bg-white">
      <div class="container" style="max-width:800px;">
        <h2 class="h4 fw-bold mb-4">${escapeHtml(cat.whyBuyH2 || 'Why Buy from Bells Fork?')}</h2>
        ${cat.whyBuyContent}
      </div>
    </section>` : ''}

    <!-- Cross-links to other categories -->
    <section class="cross-links-section">
      <div class="container">
        <h2 class="h5 fw-bold mb-3">Browse Other Categories</h2>
        <div>${crossLinks}</div>
        <a href="/inventory" class="cross-link-btn" style="border-color:var(--brand-primary);color:var(--brand-primary);">View All Inventory</a>
      </div>
    </section>

    <!-- FAQ -->
    <section class="py-5" style="background:#f9f9f9;">
      <div class="container" style="max-width:800px;">
        <h2 class="h4 fw-bold mb-4 text-center">Frequently Asked Questions</h2>
        <div class="accordion" id="categoryFAQ">
          ${faqHTML}
        </div>
      </div>
    </section>

    <!-- Financing CTA -->
    <section class="py-5 bg-brand-dark text-white text-center">
      <div class="container">
        <h2 class="h4 fw-bold mb-2">Ready to Finance Your Next Vehicle?</h2>
        <p class="text-white-50 mb-4">All credit situations welcome. Quick online application with same-day response.</p>
        <a href="${ASSET_PREFIX}financing/" class="btn btn-accent btn-lg">Apply for Financing</a>
      </div>
    </section>

    <!-- Areas Served -->
    <section class="py-4 bg-light">
      <div class="container">
        <h2 class="h6 fw-bold mb-2">Serving Eastern North Carolina</h2>
        <p class="small text-muted mb-0">${DEALER_NAME} proudly serves Greenville, Winterville, Ayden, Farmville, Washington, Kinston, New Bern, Jacksonville, and all of Pitt County. Visit us at ${DEALER_STREET}, ${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP} or call <a href="tel:${DEALER_PHONE_TEL}">${DEALER_PHONE}</a>.</p>
      </div>
    </section>
  </main>

  <!-- FOOTER -->
  <footer style="background:#1a1a1a;color:#ccc;">
    <div class="container py-5">
      <div class="row g-5">
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Contact Information</h5>
          <div class="d-flex gap-3 align-items-start mb-3">
            <div style="width:38px;height:38px;border-radius:50%;background:#dc3545;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#fff" viewBox="0 0 16 16"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
            </div>
            <div>
              <div class="text-white-50 small mb-1">Address</div>
              <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank"
                 class="text-white text-decoration-none fw-semibold">${DEALER_STREET}<br>${DEALER_CITY}, ${DEALER_STATE} ${DEALER_ZIP}</a>
            </div>
          </div>
          <div class="d-flex gap-3 align-items-start mb-4">
            <div style="width:38px;height:38px;border-radius:50%;background:#dc3545;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="#fff" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
            </div>
            <div>
              <div class="text-white-50 small mb-1">Phone</div>
              <a href="tel:${DEALER_PHONE_TEL}" class="text-white text-decoration-none fw-bold" style="font-size:1.15rem;">${DEALER_PHONE}</a>
            </div>
          </div>
        </div>
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Store Hours</h5>
          <table class="w-100" style="font-size:.92rem;border-collapse:separate;border-spacing:0 6px;">
            <tr><td class="text-white-50" style="width:45%;">Monday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Tuesday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Wednesday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Thursday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Friday:</td><td class="text-white fw-semibold">8:00 AM \u2013 6:00 PM</td></tr>
            <tr><td class="text-white-50">Saturday:</td><td class="text-white fw-semibold">9:00 AM \u2013 2:00 PM</td></tr>
            <tr><td class="text-white-50">Sunday:</td><td class="text-white fw-semibold">Appointment Only</td></tr>
          </table>
        </div>
        <div class="col-lg-4 col-md-12">
          <h5 class="fw-bold text-white mb-3 pb-2" style="border-bottom:1px solid #444;">Browse Inventory</h5>
          <ul class="list-unstyled mb-0" style="font-size:.95rem;">
            <li class="mb-2"><a href="/used-trucks-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Used Trucks</a></li>
            <li class="mb-2"><a href="/used-suvs-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Used SUVs</a></li>
            <li class="mb-2"><a href="/used-cars-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Used Cars</a></li>
            <li class="mb-2"><a href="/used-diesel-trucks-greenville-nc/" class="text-white-50 text-decoration-none footer-link">Diesel Trucks</a></li>
            <li class="mb-2"><a href="/inventory" class="text-white-50 text-decoration-none footer-link">All Inventory</a></li>
            <li class="mb-2"><a href="${ASSET_PREFIX}financing.html" class="text-white-50 text-decoration-none footer-link">Financing</a></li>
          </ul>
        </div>
      </div>
    </div>
    <div style="background:#111;border-top:1px solid #333;padding:1rem 0;">
      <div class="container text-center" style="font-size:.82rem;color:#666;">
        &copy; <span id="year"></span> ${DEALER_NAME} &bull; ${DEALER_ADDRESS} &bull; ${DEALER_PHONE} &bull; Built by <a href="https://workflowefficiency.ai/" target="_blank" rel="noopener" style="color:#aaa;text-decoration:none;">Workflow Efficiency</a>
      </div>
    </div>
  </footer>

  <!-- Mobile Action Bar -->
  <div class="mobile-action-bar d-lg-none">
    <a href="tel:${DEALER_PHONE_TEL}" class="mobile-action" aria-label="Call us">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path fill-rule="evenodd" d="M1.885.511a1.745 1.745 0 0 1 2.61.163L6.29 2.98c.329.423.445.974.315 1.494l-.547 2.19a.678.678 0 0 0 .178.643l2.457 2.457a.678.678 0 0 0 .644.178l2.189-.547a1.745 1.745 0 0 1 1.494.315l2.306 1.794c.829.645.905 1.87.163 2.611l-1.034 1.034c-.74.74-1.846 1.065-2.877.702a18.634 18.634 0 0 1-7.01-4.42 18.634 18.634 0 0 1-4.42-7.009c-.362-1.03-.037-2.137.703-2.877L1.885.511z"/></svg>
      Call
    </a>
    <a href="sms:${DEALER_SMS_TEL}" class="mobile-action sms-limited" aria-label="Text us">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path d="M2.678 11.894a1 1 0 0 1 .287.801 10.97 10.97 0 0 1-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 0 1 .71-.074A8.06 8.06 0 0 0 8 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 0 1-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 0 0 .244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 0 1-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/></svg>
      Text
    </a>
    <a href="https://maps.google.com/?q=3840+Charles+Blvd+Greenville+NC" target="_blank" class="mobile-action" aria-label="Get directions">
      <svg width="18" height="18" fill="currentColor" viewBox="0 0 16 16" class="me-1"><path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/></svg>
      Directions
    </a>
  </div>

  <script src="${ASSET_PREFIX}assets/vendor/bootstrap.bundle.min.js" defer></script>
  <script>document.getElementById('year').textContent=new Date().getFullYear();</script>
  <script src="/assets/js/sms-limiter.js" defer></script>
  <script src="/assets/js/tracker.js" defer></script>
  <script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js');</script>
</body>
</html>`;
}

// ── Main ──

function main() {
  const vehicles = loadAvailableVehicles();
  console.log(`Generating category pages for ${vehicles.length} vehicles...`);

  for (const cat of CATEGORIES) {
    const dirPath = path.join(__dirname, cat.slug);
    fs.mkdirSync(dirPath, { recursive: true });

    const html = generateCategoryPage(cat, vehicles, CATEGORIES);
    const filePath = path.join(dirPath, 'index.html');
    fs.writeFileSync(filePath, html, 'utf-8');

    const count = cat.filterFn
      ? vehicles.filter(cat.filterFn).length
      : vehicles.filter(v => v._inferredType === cat.filterType).length;
    console.log(`  ${cat.slug}/index.html — ${count} vehicles`);
  }

  console.log(`Done! Generated ${CATEGORIES.length} category pages.`);
}

main();
