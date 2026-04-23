/**
 * Bells Fork Truck & Auto — Dealership Financing PDF Generator
 *
 * Generates a filled "APPLICATION FOR FINANCING" PDF by overlaying
 * submitted form data onto the dealership's blank template PDF.
 *
 * The template is a single-page image-based PDF (no AcroForm fields),
 * so this module uses coordinate-based text placement via pdf-lib.
 *
 * Page size: 1775.763 × 2354.079 points  (≈ 24.66″ × 32.70″)
 * Coordinate system: origin at bottom-left, y increases upward.
 *
 * Exports:
 *   generateDealershipPDF(data) → Promise<Buffer>
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('fs');
const path = require('path');

// ─── Formatting Helpers ──────────────────────────────────────────────────────

function clean(val) {
  if (val == null) return '';
  // Strip non-printable control characters before stamping into the PDF.
  // eslint-disable-next-line no-control-regex
  return String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

function fmtDate(val) {
  if (!val) return '';
  const s = clean(val);
  // Already MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  // ISO YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  return s;
}

function fmtPhone(val) {
  if (!val) return '';
  const digits = clean(val).replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return clean(val);
}

function fmtCurrency(val) {
  if (!val) return '';
  const s = clean(val);
  // Already has $ prefix
  if (/^\$/.test(s)) {
    const num = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!isNaN(num)) return '$ ' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return s;
  }
  const num = parseFloat(s.replace(/[^0-9.]/g, ''));
  if (!isNaN(num)) return '$ ' + num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return s;
}

function fmtMileage(val) {
  if (!val) return '';
  const num = parseInt(clean(val).replace(/[^0-9]/g, ''), 10);
  if (!isNaN(num)) return num.toLocaleString('en-US');
  return clean(val);
}

/** Truncate text to fit within a given width at a given font size */
function truncate(text, font, fontSize, maxWidth) {
  if (!text) return '';
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t, fontSize) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t;
}

// ─── Field Coordinate Map ────────────────────────────────────────────────────
//
// Each entry: { x, y, maxW, formKey, format? }
//   x, y    = PDF points from bottom-left
//   maxW    = maximum text width in points before truncation
//   formKey = key in the submission data object
//   format  = optional formatter name: 'date', 'phone', 'currency', 'mileage'
//
// Coordinates were calibrated by overlaying a grid + test markers on the
// template PDF and visually aligning with the printed field boxes.

// Column landmarks (approximate x positions of field left edges).
// COL2-COL8 are kept as calibration reference for the PDF template even
// though only COL1 is currently used; deleting them loses the layout map.
/* eslint-disable no-unused-vars */
const COL1 = 168;   // First column (leftmost field)
const COL2 = 360;   // Second column
const COL3 = 460;   // Third column
const COL4 = 550;   // Fourth column
const COL5 = 640;   // Fifth column
const COL6 = 710;   // Sixth column
const COL7 = 790;   // Seventh column
const COL8 = 880;   // Eighth column (rightmost fields)
/* eslint-enable no-unused-vars */

// Y-offset: fields in the template image have a label row then a value row below.
// The value box baseline sits ~24pt below the label baseline.
const V = -24; // vertical offset to drop from label line into value box

const FIELDS = [
  // ── STOCK NUMBER (header — no label offset needed, text sits inline) ──
  { x: 260, y: 2192, maxW: 200, formKey: 'stock_number' },

  // ── VEHICLE SECTION ──
  { x: COL1, y: 2055 + V, maxW: 120, formKey: 'vehicle_year' },
  { x: 330, y: 2055 + V, maxW: 200, formKey: 'vehicle_make' },
  { x: 580, y: 2055 + V, maxW: 350, formKey: 'vehicle_model' },
  { x: COL1, y: 1993 + V, maxW: 270, formKey: 'vehicle_vin' },
  { x: 430, y: 1993 + V, maxW: 150, formKey: 'vehicle_mileage', format: 'mileage' },
  { x: 580, y: 1993 + V, maxW: 200, formKey: 'vehicle_color' },
  { x: COL1, y: 1931 + V, maxW: 200, formKey: 'vehicle_price', format: 'currency' },
  { x: 430, y: 1931 + V, maxW: 200, formKey: 'vehicle_downpayment', format: 'currency' },
  { x: 670, y: 1931 + V, maxW: 250, formKey: 'vehicle_term' },

  // ── APPLICANT SECTION ──
  { x: COL1, y: 1866 + V, maxW: 190, formKey: 'applicant_first_name' },
  { x: 390, y: 1866 + V, maxW: 175, formKey: 'applicant_middle_name' },
  { x: 580, y: 1866 + V, maxW: 195, formKey: 'applicant_last_name' },
  { x: 790, y: 1866 + V, maxW: 100, formKey: 'applicant_suffix' },
  { x: COL1, y: 1804 + V, maxW: 370, formKey: 'applicant_address' },
  { x: 660, y: 1804 + V, maxW: 80, formKey: 'applicant_apt' },
  { x: 770, y: 1804 + V, maxW: 180, formKey: 'applicant_time_at_address' },
  { x: COL1, y: 1742 + V, maxW: 320, formKey: 'applicant_city' },
  { x: 550, y: 1742 + V, maxW: 80, formKey: 'applicant_state' },
  { x: 660, y: 1742 + V, maxW: 120, formKey: 'applicant_zip' },
  { x: COL1, y: 1680 + V, maxW: 150, formKey: 'applicant_dob', format: 'date' },
  { x: 340, y: 1680 + V, maxW: 160, formKey: 'applicant_ssn' },
  { x: 520, y: 1680 + V, maxW: 170, formKey: 'applicant_phone', format: 'phone' },
  { x: 700, y: 1680 + V, maxW: 140, formKey: 'applicant_drivers_license' },
  { x: 870, y: 1680 + V, maxW: 80, formKey: 'applicant_dl_state' },
  { x: COL1, y: 1618 + V, maxW: 150, formKey: 'applicant_monthly_payment', format: 'currency' },
  { x: 340, y: 1618 + V, maxW: 220, formKey: 'applicant_mortgage_company' },
  { x: 570, y: 1618 + V, maxW: 140, formKey: 'applicant_residence_type' },
  { x: 720, y: 1618 + V, maxW: 240, formKey: 'applicant_email' },

  // ── APPLICANT OCCUPATION SECTION ──
  { x: COL1, y: 1548 + V, maxW: 240, formKey: 'applicant_employer' },
  { x: 430, y: 1548 + V, maxW: 190, formKey: 'applicant_title' },
  { x: 660, y: 1548 + V, maxW: 260, formKey: 'applicant_employment_type' },
  { x: COL1, y: 1486 + V, maxW: 200, formKey: 'applicant_gross_monthly_income', format: 'currency' },
  { x: 430, y: 1486 + V, maxW: 180, formKey: 'applicant_time_at_company' },
  { x: 660, y: 1486 + V, maxW: 240, formKey: 'applicant_work_phone', format: 'phone' },
  { x: COL1, y: 1424 + V, maxW: 300, formKey: 'applicant_additional_income', format: 'currency' },
  { x: 490, y: 1424 + V, maxW: 400, formKey: 'applicant_additional_income_source' },

  // ── CO-APPLICANT SECTION ──
  { x: COL1, y: 1352 + V, maxW: 190, formKey: 'co_applicant_first_name' },
  { x: 390, y: 1352 + V, maxW: 175, formKey: 'co_applicant_middle_name' },
  { x: 580, y: 1352 + V, maxW: 195, formKey: 'co_applicant_last_name' },
  { x: 790, y: 1352 + V, maxW: 100, formKey: 'co_applicant_suffix' },
  { x: COL1, y: 1290 + V, maxW: 370, formKey: 'co_applicant_address' },
  { x: 660, y: 1290 + V, maxW: 80, formKey: 'co_applicant_apt' },
  { x: 770, y: 1290 + V, maxW: 180, formKey: 'co_applicant_time_at_address' },
  { x: COL1, y: 1228 + V, maxW: 320, formKey: 'co_applicant_city' },
  { x: 550, y: 1228 + V, maxW: 80, formKey: 'co_applicant_state' },
  { x: 660, y: 1228 + V, maxW: 120, formKey: 'co_applicant_zip' },
  { x: COL1, y: 1166 + V, maxW: 150, formKey: 'co_applicant_dob', format: 'date' },
  { x: 340, y: 1166 + V, maxW: 160, formKey: 'co_applicant_ssn' },
  { x: 520, y: 1166 + V, maxW: 170, formKey: 'co_applicant_phone', format: 'phone' },
  { x: 700, y: 1166 + V, maxW: 140, formKey: 'co_applicant_drivers_license' },
  { x: 870, y: 1166 + V, maxW: 80, formKey: 'co_applicant_dl_state' },
  { x: COL1, y: 1104 + V, maxW: 150, formKey: 'co_applicant_monthly_payment', format: 'currency' },
  { x: 340, y: 1104 + V, maxW: 220, formKey: 'co_applicant_mortgage_company' },
  { x: 570, y: 1104 + V, maxW: 140, formKey: 'co_applicant_residence_type' },
  { x: 720, y: 1104 + V, maxW: 240, formKey: 'co_applicant_email' },

  // ── CO-APPLICANT OCCUPATION SECTION ──
  { x: COL1, y: 1034 + V, maxW: 240, formKey: 'co_applicant_employer' },
  { x: 430, y: 1034 + V, maxW: 190, formKey: 'co_applicant_title' },
  { x: 660, y: 1034 + V, maxW: 260, formKey: 'co_applicant_employment_type' },
  { x: COL1, y: 972 + V, maxW: 200, formKey: 'co_applicant_gross_monthly_income', format: 'currency' },
  { x: 430, y: 972 + V, maxW: 180, formKey: 'co_applicant_time_at_company' },
  { x: 660, y: 972 + V, maxW: 240, formKey: 'co_applicant_work_phone', format: 'phone' },
  { x: COL1, y: 910 + V, maxW: 300, formKey: 'co_applicant_additional_income', format: 'currency' },
  { x: 490, y: 910 + V, maxW: 400, formKey: 'co_applicant_additional_income_source' },

  // ── TRADE-IN SECTION ──
  { x: COL1, y: 838 + V, maxW: 120, formKey: 'tradein_year' },
  { x: 330, y: 838 + V, maxW: 200, formKey: 'tradein_make' },
  { x: 580, y: 838 + V, maxW: 350, formKey: 'tradein_model' },
  { x: COL1, y: 776 + V, maxW: 270, formKey: 'tradein_vin' },
  { x: 430, y: 776 + V, maxW: 150, formKey: 'tradein_mileage', format: 'mileage' },
  { x: 580, y: 776 + V, maxW: 200, formKey: 'tradein_color' },
  { x: COL1, y: 714 + V, maxW: 200, formKey: 'tradein_lien' },
  { x: 430, y: 714 + V, maxW: 200, formKey: 'tradein_payoff_amount', format: 'currency' },
  { x: 660, y: 714 + V, maxW: 260, formKey: 'tradein_title_status' },

  // ── INITIALS & DATE (bottom of form) ──
  { x: COL1, y: 610, maxW: 120, formKey: '_applicant_initials' },
  { x: 430, y: 610, maxW: 120, formKey: '_co_applicant_initials' },
  { x: 660, y: 610, maxW: 200, formKey: '_signature_date', format: 'date' },
];

// ─── Main Generator ──────────────────────────────────────────────────────────

/**
 * Generate a filled dealership financing PDF.
 *
 * @param {object} data  - Form submission data (keyed by field names above)
 * @returns {Promise<Buffer>}  - The filled PDF as a Node.js Buffer
 */
async function generateDealershipPDF(data) {
  // Load template
  const templatePath = path.join(__dirname, 'templates', 'financing-application-template.pdf');
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  // Embed font
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const page = pdfDoc.getPage(0);
  const fontSize = 14;
  const textColor = rgb(0.05, 0.05, 0.15); // near-black

  // Compute derived/virtual fields
  const merged = Object.assign({}, data);

  // Stock number: may come from stock_vin or be derived from vehicle_vin
  if (!merged.stock_number) {
    merged.stock_number = clean(merged.stock_vin || '');
  }

  // Applicant initials: derive from first + last name
  if (!merged._applicant_initials) {
    const first = clean(merged.applicant_first_name);
    const last = clean(merged.applicant_last_name);
    if (first || last) {
      merged._applicant_initials = (first.charAt(0) + last.charAt(0)).toUpperCase();
    }
  }

  // Co-applicant initials
  if (!merged._co_applicant_initials) {
    const first = clean(merged.co_applicant_first_name);
    const last = clean(merged.co_applicant_last_name);
    if (first || last) {
      merged._co_applicant_initials = (first.charAt(0) + last.charAt(0)).toUpperCase();
    }
  }

  // Signature date: use submission date or applicant_signature_date
  if (!merged._signature_date) {
    merged._signature_date = merged.applicant_signature_date || new Date().toISOString().slice(0, 10);
  }

  // Draw each field
  for (const field of FIELDS) {
    let value = clean(merged[field.formKey]);
    if (!value) continue; // leave blank if empty

    // Apply formatters
    switch (field.format) {
      case 'date':     value = fmtDate(value); break;
      case 'phone':    value = fmtPhone(value); break;
      case 'currency': value = fmtCurrency(value); break;
      case 'mileage':  value = fmtMileage(value); break;
    }

    if (!value) continue;

    // Truncate to fit
    const text = truncate(value, font, fontSize, field.maxW);

    page.drawText(text, {
      x: field.x,
      y: field.y,
      size: fontSize,
      font,
      color: textColor,
    });
  }

  // Save
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateDealershipPDF };
