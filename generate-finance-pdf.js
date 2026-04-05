#!/usr/bin/env node
/**
 * Generate PDF for a past financing application submission.
 *
 * Usage:
 *   node generate-finance-pdf.js submission.json
 *   node generate-finance-pdf.js submission1.json submission2.json
 *
 * Input: JSON file(s) exported from Netlify Forms dashboard.
 *        Each file should contain the form field key/value pairs, e.g.:
 *        {
 *          "applicant_first_name": "John",
 *          "applicant_last_name": "Doe",
 *          "applicant_phone": "(252) 555-0123",
 *          ...
 *        }
 *
 * Output: PDF file(s) saved to ./finance-pdfs/ directory.
 *
 * You can also paste raw Netlify CSV export data — just save each row as JSON.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// ─── Reuse the same helpers & layout from submission-created.js ─────────────

function sanitize(val) {
  if (val == null) return '';
  // eslint-disable-next-line no-control-regex
  return String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function fieldLabel(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const PDF_SECTIONS = [
  {
    title: 'Vehicle of Interest',
    fields: [
      'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin',
      'vehicle_mileage', 'vehicle_color', 'vehicle_price',
      'vehicle_downpayment', 'vehicle_term',
    ],
  },
  {
    title: 'Applicant Information',
    fields: [
      'applicant_first_name', 'applicant_middle_name', 'applicant_last_name',
      'applicant_suffix', 'applicant_dob', 'applicant_phone', 'applicant_email',
      'applicant_drivers_license', 'applicant_dl_state',
    ],
  },
  {
    title: 'Applicant Address & Housing',
    fields: [
      'applicant_address', 'applicant_apt', 'applicant_city',
      'applicant_state', 'applicant_zip', 'applicant_time_at_address',
      'applicant_monthly_payment', 'applicant_mortgage_company',
      'applicant_residence_type',
    ],
  },
  {
    title: 'Applicant Employment & Income',
    fields: [
      'applicant_employer', 'applicant_title', 'applicant_employment_type',
      'applicant_gross_monthly_income', 'applicant_time_at_company',
      'applicant_work_phone', 'applicant_additional_income',
      'applicant_additional_income_source',
    ],
  },
  {
    title: 'Co-Applicant Information',
    fields: [
      'co_applicant_first_name', 'co_applicant_middle_name',
      'co_applicant_last_name', 'co_applicant_suffix',
      'co_applicant_dob', 'co_applicant_phone', 'co_applicant_email',
      'co_applicant_drivers_license', 'co_applicant_dl_state',
    ],
  },
  {
    title: 'Co-Applicant Address & Housing',
    fields: [
      'co_applicant_address', 'co_applicant_apt', 'co_applicant_city',
      'co_applicant_state', 'co_applicant_zip',
      'co_applicant_time_at_address', 'co_applicant_monthly_payment',
      'co_applicant_mortgage_company', 'co_applicant_residence_type',
    ],
  },
  {
    title: 'Co-Applicant Employment & Income',
    fields: [
      'co_applicant_employer', 'co_applicant_title',
      'co_applicant_employment_type', 'co_applicant_gross_monthly_income',
      'co_applicant_time_at_company', 'co_applicant_work_phone',
      'co_applicant_additional_income', 'co_applicant_additional_income_source',
    ],
  },
  {
    title: 'Trade-In Vehicle',
    fields: [
      'tradein_year', 'tradein_make', 'tradein_model', 'tradein_vin',
      'tradein_mileage', 'tradein_color', 'tradein_lien',
      'tradein_payoff_amount', 'tradein_title_status',
    ],
  },
  {
    title: 'Authorization & Signatures',
    fields: [
      'confirm_accuracy', 'contact_consent',
      'applicant_signature', 'applicant_signature_date',
      'co_applicant_signature', 'co_applicant_signature_date',
    ],
  },
];

const EXCLUDE_FIELDS = new Set([
  'bot-field', 'form-name', 'request_type',
]);

// ─── PDF Generation (identical to submission-created.js) ────────────────────

function generatePDF(data, submittedAt) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: 'Financing Application - Bells Fork Truck & Auto',
          Author: 'Bells Fork Truck & Auto',
          Subject: 'Financing Application Submission',
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      doc.fontSize(18).font('Helvetica-Bold')
        .text('APPLICATION FOR FINANCING', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
        .text('Bells Fork Truck & Auto', { align: 'center' })
        .text('3840 Charles Blvd, Greenville, NC 27858', { align: 'center' })
        .text('(252) 496-0005 | bellsforktruckandauto.com', { align: 'center' });
      doc.moveDown(0.5);

      doc.fontSize(9).fillColor('#555')
        .text(`Submitted: ${submittedAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' })}`, { align: 'center' });
      doc.moveDown(1);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const renderedFields = new Set();

      for (const section of PDF_SECTIONS) {
        const sectionHasData = section.fields.some((key) => {
          const val = sanitize(data[key]);
          return val && val.length > 0;
        });
        if (!sectionHasData) continue;

        doc.fillColor('#FFFFFF').rect(doc.x, doc.y, pageWidth, 20).fill('#333333');
        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
          .text(section.title.toUpperCase(), doc.page.margins.left + 6, doc.y - 15, { width: pageWidth - 12 });
        doc.moveDown(0.5);

        doc.fillColor('#000000').font('Helvetica');
        const colWidth = (pageWidth - 20) / 2;
        let col = 0;
        let rowY = doc.y;

        for (const key of section.fields) {
          const val = sanitize(data[key]);
          renderedFields.add(key);
          if (!val) continue;

          if (rowY + 30 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            rowY = doc.y;
            col = 0;
          }

          const xPos = doc.page.margins.left + (col * (colWidth + 20));

          doc.fontSize(7).fillColor('#666666').font('Helvetica-Bold')
            .text(fieldLabel(key), xPos, rowY, { width: colWidth, lineBreak: false });
          doc.fontSize(10).fillColor('#000000').font('Helvetica')
            .text(val, xPos, rowY + 9, { width: colWidth });

          col++;
          if (col >= 2) {
            col = 0;
            rowY = doc.y + 6;
          }
        }

        if (col !== 0) {
          doc.y = rowY + 20;
        }
        doc.moveDown(0.5);
      }

      const extraFields = Object.keys(data).filter(
        (key) => !renderedFields.has(key) && !EXCLUDE_FIELDS.has(key) && sanitize(data[key])
      );

      if (extraFields.length > 0) {
        doc.fillColor('#FFFFFF').rect(doc.x, doc.y, pageWidth, 20).fill('#333333');
        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
          .text('ADDITIONAL INFORMATION', doc.page.margins.left + 6, doc.y - 15, { width: pageWidth - 12 });
        doc.moveDown(0.5);
        doc.fillColor('#000000').font('Helvetica');

        for (const key of extraFields) {
          if (doc.y + 30 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
          }
          doc.fontSize(7).fillColor('#666666').font('Helvetica-Bold')
            .text(fieldLabel(key), doc.page.margins.left);
          doc.fontSize(10).fillColor('#000000').font('Helvetica')
            .text(sanitize(data[key]), doc.page.margins.left);
          doc.moveDown(0.3);
        }
      }

      doc.moveDown(1);
      doc.fontSize(8).fillColor('#999999').font('Helvetica')
        .text('This document was auto-generated from an online financing application submission.', { align: 'center' })
        .text('Bells Fork Truck & Auto — Confidential', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── CLI ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.warn('Usage: node generate-finance-pdf.js <submission.json> [submission2.json ...]');
    console.warn('');
    console.warn('Each JSON file should contain the form field data, e.g.:');
    console.warn('  {');
    console.warn('    "applicant_first_name": "John",');
    console.warn('    "applicant_last_name": "Doe",');
    console.warn('    "applicant_phone": "(252) 555-0123",');
    console.warn('    ...');
    console.warn('  }');
    console.warn('');
    console.warn('Optionally include a "submitted_at" field (ISO date string) for the timestamp.');
    console.warn('PDFs will be saved to ./finance-pdfs/');
    process.exit(1);
  }

  const outDir = path.join(process.cwd(), 'finance-pdfs');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const file of args) {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      continue;
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`Invalid JSON in ${file}: ${err.message}`);
      continue;
    }

    // Use submitted_at from data if present, otherwise use file modification time
    let submittedAt;
    if (data.submitted_at || data.created_at || data.date) {
      submittedAt = new Date(data.submitted_at || data.created_at || data.date);
    } else {
      const stat = fs.statSync(filePath);
      submittedAt = stat.mtime;
    }

    // Remove meta fields that aren't form data
    const cleanData = { ...data };
    delete cleanData.submitted_at;
    delete cleanData.created_at;
    delete cleanData.date;
    delete cleanData.id;
    delete cleanData.number;
    delete cleanData.form_id;
    delete cleanData.form_name;
    delete cleanData.site_url;
    delete cleanData.human_fields;

    const firstName = sanitize(cleanData.applicant_first_name || '');
    const lastName = sanitize(cleanData.applicant_last_name || '');
    const applicantName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown';
    const nameSlug = slugify(applicantName) || 'applicant';
    const timestamp = formatTimestamp(submittedAt);
    const filename = `financing-application-${nameSlug}-${timestamp}.pdf`;
    const outPath = path.join(outDir, filename);

    try {
      const pdfBuffer = await generatePDF(cleanData, submittedAt);

      if (!pdfBuffer || pdfBuffer.length === 0) {
        console.error(`Empty PDF generated for ${file} — skipping`);
        continue;
      }

      fs.writeFileSync(outPath, pdfBuffer);
      console.warn(`  ${filename}  (${pdfBuffer.length} bytes)`);
    } catch (err) {
      console.error(`Failed to generate PDF for ${file}: ${err.message}`);
    }
  }

  console.warn(`\nDone. PDFs saved to ${outDir}`);
}

main();
