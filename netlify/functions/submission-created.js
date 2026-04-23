/**
 * Bells Fork Truck & Auto — Universal Form Submission Handler
 *
 * Netlify event function: automatically triggered on every form submission.
 * For EVERY recognized form type:
 *   1. Creates a lead record in the Leads pipeline (leads-db)
 *   2. Generates a professional PDF of the submission
 *   3. Emails the PDF to the admin team for offline review / printing
 *
 * Supported forms:
 *   - financing-application
 *   - offer-request
 *   - test-drive-request
 *   - trade-in-request
 *   - consignment-request
 *   - contact-request
 *
 * Required environment variables:
 *   SMTP_HOST        — SMTP server hostname (e.g. smtp.gmail.com)
 *   SMTP_PORT        — SMTP port (default: 587)
 *   SMTP_USER        — SMTP username / email
 *   SMTP_PASS        — SMTP password / app-password
 *   FINANCE_EMAIL_TO — Recipient email(s), comma-separated
 *   FINANCE_EMAIL_FROM — Sender "From" address (optional, defaults to SMTP_USER)
 *   SITE_ID          — Netlify site ID (for Blobs / lead storage)
 *   NF_API_TOKEN     — Netlify API token (for Blobs / lead storage)
 */

const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { getStore } = require('@netlify/blobs');

// Defensive import: dealership PDF generation must never crash the main handler
let generateDealershipPDF = null;
try {
  generateDealershipPDF = require('./generate-dealership-pdf').generateDealershipPDF;
} catch (err) {
  console.error('[submission-created] Failed to load dealership PDF generator (non-fatal):', err.message);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Sanitize a value for safe rendering in the PDF */
function sanitize(val) {
  if (val == null) return '';
  // eslint-disable-next-line no-control-regex
  return String(val).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

/** Build a filename-safe slug from a name */
function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Format a Date to YYYY-MM-DD-HHmm */
function formatTimestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Human-readable label from form field name: applicant_first_name → Applicant First Name */
function fieldLabel(key) {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get a Netlify Blob store */
function blobStore(name) {
  const siteID = process.env.SITE_ID;
  const token = process.env.NF_API_TOKEN;
  if (!siteID || !token) return null;
  return getStore({ name, siteID, token, apiURL: 'https://api.netlify.com', consistency: 'strong' });
}

// ─── Form Configuration ─────────────────────────────────────────────────────
// Each form type maps to: display title, PDF heading, file prefix, accent color,
// and ordered section definitions for the PDF layout.

const FORM_CONFIGS = {
  'financing-application': {
    displayName: 'Financing Application',
    pdfTitle: 'APPLICATION FOR FINANCING',
    filePrefix: 'financing-application',
    accentColor: '#dc3545',
    leadSource: 'form',
    // Extract contact name from financing-specific fields
    getContactName: (d) => [sanitize(d.applicant_first_name), sanitize(d.applicant_last_name)].filter(Boolean).join(' '),
    getContactPhone: (d) => sanitize(d.applicant_phone || ''),
    getContactEmail: (d) => sanitize(d.applicant_email || ''),
    getVehicle: (d) => [sanitize(d.vehicle_year), sanitize(d.vehicle_make), sanitize(d.vehicle_model)].filter(Boolean).join(' '),
    sections: [
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
    ],
  },

  'offer-request': {
    displayName: 'Vehicle Offer',
    pdfTitle: 'VEHICLE PURCHASE OFFER',
    filePrefix: 'offer-request',
    accentColor: '#0d6efd',
    leadSource: 'form',
    getContactName: (d) => [sanitize(d.first_name), sanitize(d.last_name)].filter(Boolean).join(' '),
    getContactPhone: (d) => sanitize(d.phone || ''),
    getContactEmail: (d) => sanitize(d.email || ''),
    getVehicle: (d) => sanitize(d.interest_vehicle || ''),
    sections: [
      {
        title: 'Contact Information',
        fields: [
          'first_name', 'last_name', 'email', 'phone',
          'preferred_contact', 'best_time',
        ],
      },
      {
        title: 'Address',
        fields: ['street', 'city', 'state', 'zip'],
      },
      {
        title: 'Vehicle of Interest',
        fields: ['interest_vehicle', 'stock_vin', 'preferred_date', 'preferred_time'],
      },
      {
        title: 'Financial Information',
        fields: [
          'monthly_budget', 'down_payment', 'credit_range',
          'employment_status', 'monthly_income',
        ],
      },
      {
        title: 'Current Vehicle / Trade-In',
        fields: [
          'current_vehicle', 'current_vin', 'mileage',
          'condition', 'payoff_amount',
        ],
      },
      {
        title: 'Additional Notes',
        fields: ['notes'],
      },
      {
        title: 'Authorization',
        fields: ['confirm_accuracy', 'contact_consent'],
      },
    ],
  },

  'test-drive-request': {
    displayName: 'Test Drive Request',
    pdfTitle: 'TEST DRIVE REQUEST',
    filePrefix: 'test-drive-request',
    accentColor: '#198754',
    leadSource: 'form',
    getContactName: (d) => [sanitize(d.first_name), sanitize(d.last_name)].filter(Boolean).join(' '),
    getContactPhone: (d) => sanitize(d.phone || ''),
    getContactEmail: (d) => sanitize(d.email || ''),
    getVehicle: (d) => sanitize(d.interest_vehicle || ''),
    sections: [
      {
        title: 'Contact Information',
        fields: [
          'first_name', 'last_name', 'email', 'phone',
          'preferred_contact', 'best_time',
        ],
      },
      {
        title: 'Address',
        fields: ['street', 'city', 'state', 'zip'],
      },
      {
        title: 'Vehicle of Interest',
        fields: ['interest_vehicle', 'stock_vin', 'preferred_date', 'preferred_time'],
      },
      {
        title: 'Financial Information',
        fields: [
          'monthly_budget', 'down_payment', 'credit_range',
          'employment_status', 'monthly_income',
        ],
      },
      {
        title: 'Current Vehicle / Trade-In',
        fields: [
          'current_vehicle', 'current_vin', 'mileage',
          'condition', 'payoff_amount',
        ],
      },
      {
        title: 'Additional Notes',
        fields: ['notes'],
      },
      {
        title: 'Authorization',
        fields: ['confirm_accuracy', 'contact_consent'],
      },
    ],
  },

  'trade-in-request': {
    displayName: 'Trade-In Valuation',
    pdfTitle: 'TRADE-IN VALUATION REQUEST',
    filePrefix: 'trade-in-request',
    accentColor: '#fd7e14',
    leadSource: 'form',
    getContactName: (d) => [sanitize(d.first_name), sanitize(d.last_name)].filter(Boolean).join(' '),
    getContactPhone: (d) => sanitize(d.phone || ''),
    getContactEmail: (d) => sanitize(d.email || ''),
    getVehicle: (d) => sanitize(d.interest_vehicle || ''),
    sections: [
      {
        title: 'Contact Information',
        fields: [
          'first_name', 'last_name', 'email', 'phone',
          'preferred_contact', 'best_time',
        ],
      },
      {
        title: 'Address',
        fields: ['street', 'city', 'state', 'zip'],
      },
      {
        title: 'Vehicle of Interest',
        fields: ['interest_vehicle', 'stock_vin', 'preferred_date', 'preferred_time'],
      },
      {
        title: 'Financial Information',
        fields: [
          'monthly_budget', 'down_payment', 'credit_range',
          'employment_status', 'monthly_income',
        ],
      },
      {
        title: 'Current Vehicle / Trade-In',
        fields: [
          'current_vehicle', 'current_vin', 'mileage',
          'condition', 'payoff_amount',
        ],
      },
      {
        title: 'Additional Notes',
        fields: ['notes'],
      },
      {
        title: 'Authorization',
        fields: ['confirm_accuracy', 'contact_consent'],
      },
    ],
  },

  'consignment-request': {
    displayName: 'Consignment Request',
    pdfTitle: 'VEHICLE CONSIGNMENT REQUEST',
    filePrefix: 'consignment-request',
    accentColor: '#6f42c1',
    leadSource: 'form',
    getContactName: (d) => [sanitize(d.first_name), sanitize(d.last_name)].filter(Boolean).join(' '),
    getContactPhone: (d) => sanitize(d.phone || ''),
    getContactEmail: (d) => sanitize(d.email || ''),
    getVehicle: (d) => sanitize(d.current_vehicle || d.interest_vehicle || ''),
    sections: [
      {
        title: 'Contact Information',
        fields: [
          'first_name', 'last_name', 'email', 'phone',
          'preferred_contact', 'best_time',
        ],
      },
      {
        title: 'Address',
        fields: ['street', 'city', 'state', 'zip'],
      },
      {
        title: 'Vehicle of Interest',
        fields: ['interest_vehicle', 'stock_vin', 'preferred_date', 'preferred_time'],
      },
      {
        title: 'Financial Information',
        fields: [
          'monthly_budget', 'down_payment', 'credit_range',
          'employment_status', 'monthly_income',
        ],
      },
      {
        title: 'Vehicle for Consignment',
        fields: [
          'current_vehicle', 'current_vin', 'mileage',
          'condition', 'payoff_amount',
        ],
      },
      {
        title: 'Additional Notes',
        fields: ['notes'],
      },
      {
        title: 'Authorization',
        fields: ['confirm_accuracy', 'contact_consent'],
      },
    ],
  },

  'contact-request': {
    displayName: 'Contact Request',
    pdfTitle: 'CONTACT REQUEST',
    filePrefix: 'contact-request',
    accentColor: '#20c997',
    leadSource: 'form',
    getContactName: (d) => sanitize(d.name || [d.first_name, d.last_name].filter(Boolean).join(' ') || ''),
    getContactPhone: (d) => sanitize(d.phone || ''),
    getContactEmail: (d) => sanitize(d.email || ''),
    getVehicle: (d) => sanitize(d.interest_vehicle || d.vehicle || d.service || ''),
    sections: [
      {
        title: 'Contact Information',
        fields: ['name', 'first_name', 'last_name', 'email', 'phone'],
      },
      {
        title: 'Inquiry Details',
        fields: ['service', 'details', 'message', 'notes', 'interest_vehicle', 'vehicle'],
      },
    ],
  },
};

// Fields to exclude from PDF (internal / honeypot)
const EXCLUDE_FIELDS = new Set([
  'bot-field', 'form-name', 'request_type',
]);

// ─── Lead Creation ──────────────────────────────────────────────────────────

/**
 * Create a lead record in the leads-db Blob store.
 * Returns the created lead object, or null if storage is unavailable.
 */
async function createLead({ contactName, contactPhone, contactEmail, vehicle, formName, displayName, source, stockNumber, message, sourcePage, vehiclePrice, vehicleVin, dealershipPdfKey }) {
  const store = blobStore('leads-db');
  if (!store) {
    console.warn('[submission-created] Blob store unavailable — skipping lead creation');
    return null;
  }

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let leads;
    try {
      leads = await store.get('all', { type: 'json' });
    } catch (e) {
      // Key might not exist yet
    }
    if (!Array.isArray(leads)) leads = [];

    // Deduplicate: skip if identical lead exists within last 60 seconds
    // Also check phone/email for stronger dedup (name + form + contact match)
    const now = Date.now();
    const DEDUP_WINDOW = 60 * 1000;
    const isDupe = leads.some((l) =>
      l.formType === formName &&
      (now - (l.createdAt || 0)) < DEDUP_WINDOW &&
      (l.contactName === (contactName || '') ||
       (contactEmail && l.contactEmail === contactEmail) ||
       (contactPhone && l.contactPhone === contactPhone))
    );
    if (isDupe) {
      console.log(`[submission-created] Duplicate lead suppressed for "${contactName}" (${formName})`);
      return null;
    }

    const snapshot = JSON.stringify(leads);

    const lead = {
      id: 'lead-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      stockNumber: String(stockNumber || '').trim().slice(0, 30),
      vehicleName: String(vehicle || '').trim().slice(0, 200),
      vehiclePrice: String(vehiclePrice || '').trim().slice(0, 30) || null,
      vehicleVin: String(vehicleVin || '').trim().slice(0, 17),
      vehicleUrl: '',
      source: String(source || 'form').slice(0, 50),
      sourcePage: String(sourcePage || '').slice(0, 500),
      formType: String(formName || '').slice(0, 80),
      formDisplayName: String(displayName || formName || '').slice(0, 100),
      status: 'hot',  // Form submissions are always high-intent
      outcome: 'active',
      contactName: String(contactName || '').trim().slice(0, 200),
      contactPhone: String(contactPhone || '').trim().slice(0, 30),
      contactEmail: String(contactEmail || '').trim().slice(0, 254),
      visitorId: '',
      notes: String(message || `Auto-created from ${displayName || formName} submission`).slice(0, 2000),
      dealershipPdfKey: dealershipPdfKey || null,
      createdAt: now,
      statusChangedAt: now,
      convertedAt: null,
      lostAt: null,
      updatedBy: 'submission-handler',
    };

    // Re-read to detect concurrent modification
    let check;
    try { check = await store.get('all', { type: 'json' }); } catch { /* ok */ }
    if (!Array.isArray(check)) check = [];
    if (JSON.stringify(check) !== snapshot) {
      console.warn(`[submission-created] Concurrent modification detected (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
      continue;
    }

    leads.push(lead);
    await store.setJSON('all', leads);

    console.log(`[submission-created] Lead created: ${lead.id} (${contactName || 'unknown'})`);
    return lead;
  }

  // Fallback: force-append if all retries failed (never lose a lead)
  console.warn('[submission-created] All retries exhausted — force-appending lead');
  let leads;
  try { leads = await store.get('all', { type: 'json' }); } catch { /* ok */ }
  if (!Array.isArray(leads)) leads = [];
  const now = Date.now();
  const lead = {
    id: 'lead-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    stockNumber: String(stockNumber || '').trim().slice(0, 30),
    vehicleName: String(vehicle || '').trim().slice(0, 200),
    vehiclePrice: String(vehiclePrice || '').trim().slice(0, 30) || null,
    vehicleVin: String(vehicleVin || '').trim().slice(0, 17),
    vehicleUrl: '',
    source: String(source || 'form').slice(0, 50),
    sourcePage: String(sourcePage || '').slice(0, 500),
    formType: String(formName || '').slice(0, 80),
    formDisplayName: String(displayName || formName || '').slice(0, 100),
    status: 'hot', outcome: 'active',
    contactName: String(contactName || '').trim().slice(0, 200),
    contactPhone: String(contactPhone || '').trim().slice(0, 30),
    contactEmail: String(contactEmail || '').trim().slice(0, 254),
    visitorId: '',
    notes: String(message || `Auto-created from ${displayName || formName} submission`).slice(0, 2000),
    createdAt: now, statusChangedAt: now,
    convertedAt: null, lostAt: null, updatedBy: 'submission-handler',
  };
  leads.push(lead);
  await store.setJSON('all', leads);
  console.log(`[submission-created] Lead force-created: ${lead.id}`);
  return lead;
}

// ─── PDF Generation ─────────────────────────────────────────────────────────

/**
 * Generate a PDF buffer from the submitted form data.
 * Accepts a form config to customize the title, sections, and accent color.
 * Returns a Promise that resolves with a Buffer.
 */
function generatePDF(data, submittedAt, config) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 50, bottom: 50, left: 50, right: 50 },
        info: {
          Title: `${config.displayName} - Bells Fork Truck & Auto`,
          Author: 'Bells Fork Truck & Auto',
          Subject: `${config.displayName} Submission`,
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // ── Header ──
      doc.fontSize(18).font('Helvetica-Bold')
        .text(config.pdfTitle, { align: 'center' });
      doc.fontSize(10).font('Helvetica')
        .text('Bells Fork Truck & Auto', { align: 'center' })
        .text('3840 Charles Blvd, Greenville, NC 27858', { align: 'center' })
        .text('(252) 496-0005 | bellsforktruckandauto.com', { align: 'center' });
      doc.moveDown(0.5);

      // Submission timestamp
      doc.fontSize(9).fillColor('#555')
        .text(`Submitted: ${submittedAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' })}`, { align: 'center' });
      doc.moveDown(1);

      // ── Sections ──
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const renderedFields = new Set();

      for (const section of config.sections) {
        // Check if section has any non-empty values
        const sectionHasData = section.fields.some((key) => {
          const val = sanitize(data[key]);
          return val && val.length > 0;
        });
        if (!sectionHasData) continue;

        // Section header — light gray background with dark text
        const headerY = doc.y;
        doc.save();
        doc.rect(doc.page.margins.left, headerY, pageWidth, 22).fill('#E8E8E8');
        doc.restore();
        doc.fillColor('#222222').fontSize(11).font('Helvetica-Bold')
          .text(section.title.toUpperCase(), doc.page.margins.left + 6, headerY + 5, { width: pageWidth - 12 });
        doc.y = headerY + 28; // Move below header with padding

        // Fields in two-column layout
        doc.fillColor('#000000').font('Helvetica');
        const colWidth = (pageWidth - 20) / 2;
        let col = 0;
        let rowY = doc.y;
        const ROW_HEIGHT = 28;

        for (const key of section.fields) {
          const val = sanitize(data[key]);
          renderedFields.add(key);
          if (!val) continue;

          // Check if we need a new page
          if (rowY + ROW_HEIGHT > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            rowY = doc.y;
            col = 0;
          }

          const xPos = doc.page.margins.left + (col * (colWidth + 20));

          doc.fontSize(7).fillColor('#888888').font('Helvetica-Bold')
            .text(fieldLabel(key), xPos, rowY, { width: colWidth, lineBreak: false });
          doc.fontSize(10).fillColor('#000000').font('Helvetica')
            .text(val, xPos, rowY + 10, { width: colWidth });

          col++;
          if (col >= 2) {
            col = 0;
            rowY += ROW_HEIGHT;
          }
        }

        // Reset position after section — ensure proper gap before next header
        if (col !== 0) {
          rowY += ROW_HEIGHT;
        }
        doc.y = rowY + 10;
      }

      // ── Catch-all: render any fields not in defined sections ──
      const extraFields = Object.keys(data).filter(
        (key) => !renderedFields.has(key) && !EXCLUDE_FIELDS.has(key) && sanitize(data[key])
      );

      if (extraFields.length > 0) {
        const extraHeaderY = doc.y;
        doc.save();
        doc.rect(doc.page.margins.left, extraHeaderY, pageWidth, 22).fill('#E8E8E8');
        doc.restore();
        doc.fillColor('#222222').fontSize(11).font('Helvetica-Bold')
          .text('ADDITIONAL INFORMATION', doc.page.margins.left + 6, extraHeaderY + 5, { width: pageWidth - 12 });
        doc.y = extraHeaderY + 28;
        doc.fillColor('#000000').font('Helvetica');

        for (const key of extraFields) {
          if (doc.y + 30 > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
          }
          doc.fontSize(7).fillColor('#888888').font('Helvetica-Bold')
            .text(fieldLabel(key), doc.page.margins.left);
          doc.fontSize(10).fillColor('#000000').font('Helvetica')
            .text(sanitize(data[key]), doc.page.margins.left);
          doc.moveDown(0.4);
        }
      }

      // ── Footer ──
      doc.moveDown(1);
      doc.fontSize(8).fillColor('#999999').font('Helvetica')
        .text(`This document was auto-generated from an online ${config.displayName.toLowerCase()} submission.`, { align: 'center' })
        .text('Bells Fork Truck & Auto — Confidential', { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ─── Email Sending ──────────────────────────────────────────────────────────

async function sendEmailWithAttachment({ to, from, subject, html, pdfBuffer, filename, extraAttachments }) {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP configuration incomplete: SMTP_HOST, SMTP_USER, and SMTP_PASS are required');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  const attachments = [
    {
      filename,
      content: pdfBuffer,
      contentType: 'application/pdf',
    },
  ];

  // Append any extra attachments (e.g. filled dealership PDF)
  if (Array.isArray(extraAttachments)) {
    for (const att of extraAttachments) {
      if (att && att.content && att.filename) {
        attachments.push({
          filename: att.filename,
          content: att.content,
          contentType: att.contentType || 'application/pdf',
        });
      }
    }
  }

  const mailOptions = {
    from: from || user,
    to,
    subject,
    html,
    attachments,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('[submission-created] Email sent:', info.messageId);
  return info;
}

// ─── Email HTML Builder ─────────────────────────────────────────────────────

/** Escape HTML entities to prevent injection in email templates */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmailHtml({ config, contactName, data, vehicle, filename, submittedAt, leadId }) {
  const accent = config.accentColor;

  /**
   * Render a table row if the value is non-empty.
   * Returns empty string for blank/undefined/null values so they never appear.
   */
  function row(label, val) {
    const clean = sanitize(val);
    if (!clean) return '';
    return `<tr>
      <td style="padding: 5px 12px; font-weight: bold; color: #555; width: 180px; vertical-align: top; white-space: nowrap;">${escapeHtml(label)}</td>
      <td style="padding: 5px 12px;">${escapeHtml(clean)}</td>
    </tr>`;
  }

  /**
   * Render a section with a header and rows. Omits the entire section
   * if every row is empty (no data to show).
   */
  function section(title, rowsHtml) {
    const filtered = rowsHtml.filter(Boolean);
    if (filtered.length === 0) return '';
    return `
      <tr><td colspan="2" style="padding: 12px 0 4px 0;">
        <h3 style="margin: 0; font-size: 14px; color: #fff; background: #333; padding: 6px 12px; border-left: 4px solid ${accent};">${escapeHtml(title)}</h3>
      </td></tr>
      ${filtered.join('\n')}`;
  }

  // ── Customer Information ──
  const customerRows = [
    row('Name', contactName),
    row('Email', config.getContactEmail(data)),
    row('Phone', config.getContactPhone(data)),
    row('Date of Birth', data.applicant_dob),
    row('Driver\'s License', data.applicant_drivers_license),
    row('DL State', data.applicant_dl_state),
    row('SSN Provided', data.applicant_ssn ? 'Yes (on file)' : ''),
    // Generic form fields (offer, test-drive, etc.)
    row('Preferred Contact', data.preferred_contact),
    row('Best Time to Call', data.best_time),
  ];

  // ── Applicant Address & Housing ──
  const addressParts = [data.applicant_address, data.applicant_apt, data.applicant_city, data.applicant_state, data.applicant_zip].map(v => sanitize(v)).filter(Boolean);
  const housingRows = [
    row('Address', addressParts.join(', ') || ''),
    row('Time at Address', data.applicant_time_at_address),
    row('Residence Type', data.applicant_residence_type),
    row('Monthly Payment', data.applicant_monthly_payment),
    row('Mortgage Company', data.applicant_mortgage_company),
    // Generic address fields
    row('Street', data.street),
    row('City', data.city),
    row('State', data.state),
    row('ZIP', data.zip),
  ];

  // ── Vehicle Information ──
  const vehicleRows = [
    row('Vehicle', vehicle),
    row('Year', data.vehicle_year),
    row('Make', data.vehicle_make),
    row('Model', data.vehicle_model),
    row('VIN', data.vehicle_vin),
    row('Stock / VIN', data.stock_vin),
    row('Mileage', data.vehicle_mileage),
    row('Color', data.vehicle_color),
    row('Price', data.vehicle_price),
    row('Down Payment', data.vehicle_downpayment || data.down_payment),
    row('Loan Term', data.vehicle_term),
    // Generic form
    row('Vehicle of Interest', data.interest_vehicle),
    row('Preferred Date', data.preferred_date),
    row('Preferred Time', data.preferred_time),
  ];

  // ── Financial Information ──
  const financeRows = [
    row('Gross Monthly Income', data.applicant_gross_monthly_income),
    row('Additional Income', data.applicant_additional_income),
    row('Additional Income Source', data.applicant_additional_income_source),
    row('Monthly Budget', data.monthly_budget),
    row('Credit Range', data.credit_range),
    // Generic form
    row('Employment Status', data.employment_status || data.applicant_employment_type),
    row('Monthly Income', data.monthly_income),
  ];

  // ── Employment ──
  const employmentRows = [
    row('Employer', data.applicant_employer),
    row('Title', data.applicant_title),
    row('Employment Type', data.applicant_employment_type),
    row('Time at Company', data.applicant_time_at_company),
    row('Work Phone', data.applicant_work_phone),
  ];

  // ── Trade-In Information ──
  const tradeinVehicle = [data.tradein_year, data.tradein_make, data.tradein_model].map(v => sanitize(v)).filter(Boolean).join(' ');
  const tradeinRows = [
    row('Trade-In Vehicle', tradeinVehicle),
    row('Trade-In VIN', data.tradein_vin),
    row('Mileage', data.tradein_mileage),
    row('Color', data.tradein_color),
    row('Lien on Vehicle', data.tradein_lien),
    row('Payoff Amount', data.tradein_payoff_amount || data.payoff_amount),
    row('Title Status', data.tradein_title_status),
    // Generic form trade-in
    row('Current Vehicle', data.current_vehicle),
    row('Current VIN', data.current_vin),
    row('Current Mileage', data.mileage),
    row('Condition', data.condition),
  ];

  // ── Co-Applicant Information ──
  const coName = [data.co_applicant_first_name, data.co_applicant_middle_name, data.co_applicant_last_name, data.co_applicant_suffix].map(v => sanitize(v)).filter(Boolean).join(' ');
  const coAddressParts = [data.co_applicant_address, data.co_applicant_apt, data.co_applicant_city, data.co_applicant_state, data.co_applicant_zip].map(v => sanitize(v)).filter(Boolean);
  const coApplicantRows = [
    row('Co-Applicant Name', coName),
    row('Date of Birth', data.co_applicant_dob),
    row('Phone', data.co_applicant_phone),
    row('Email', data.co_applicant_email),
    row('Driver\'s License', data.co_applicant_drivers_license),
    row('DL State', data.co_applicant_dl_state),
    row('Address', coAddressParts.join(', ') || ''),
    row('Time at Address', data.co_applicant_time_at_address),
    row('Residence Type', data.co_applicant_residence_type),
    row('Monthly Payment', data.co_applicant_monthly_payment),
    row('Mortgage Company', data.co_applicant_mortgage_company),
    row('Employer', data.co_applicant_employer),
    row('Title', data.co_applicant_title),
    row('Employment Type', data.co_applicant_employment_type),
    row('Gross Monthly Income', data.co_applicant_gross_monthly_income),
    row('Time at Company', data.co_applicant_time_at_company),
    row('Work Phone', data.co_applicant_work_phone),
    row('Additional Income', data.co_applicant_additional_income),
    row('Additional Income Source', data.co_applicant_additional_income_source),
  ];

  // ── Additional Notes ──
  const notesRows = [
    row('Notes', data.notes),
    row('Message', data.message),
    row('Details', data.details),
    row('Service Inquiry', data.service),
  ];

  // ── Authorization ──
  const authRows = [
    row('Accuracy Confirmed', data.confirm_accuracy === 'on' || data.confirm_accuracy === 'true' || data.confirm_accuracy === true ? 'Yes' : data.confirm_accuracy),
    row('Contact Consent', data.contact_consent === 'on' || data.contact_consent === 'true' || data.contact_consent === true ? 'Yes' : data.contact_consent),
    row('Applicant Signature', data.applicant_signature),
    row('Signature Date', data.applicant_signature_date),
    row('Co-Applicant Signature', data.co_applicant_signature),
    row('Co-Applicant Sig. Date', data.co_applicant_signature_date),
  ];

  // ── Submission Metadata ──
  const submittedStr = submittedAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' });
  const metaRows = [
    row('Submitted', submittedStr),
    row('Form Type', config.displayName),
    row('Lead ID', leadId || ''),
    row('PDF Attachment', filename),
  ];

  // Assemble all sections — empty sections are auto-omitted
  const allSections = [
    section('Customer Information', customerRows),
    section('Address & Housing', housingRows),
    section('Vehicle Information', vehicleRows),
    section('Financial Information', financeRows),
    section('Employment', employmentRows),
    section('Trade-In Information', tradeinRows),
    section('Co-Applicant', coApplicantRows),
    section('Additional Notes', notesRows),
    section('Authorization', authRows),
    section('Submission Metadata', metaRows),
  ].filter(Boolean);

  return `
    <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
      <h2 style="color: #333; border-bottom: 3px solid ${accent}; padding-bottom: 8px; margin-bottom: 4px;">
        New ${escapeHtml(config.displayName)} Received
      </h2>
      <p style="color: #666; font-size: 13px; margin-top: 0;">
        ${escapeHtml(sanitize(contactName))}${vehicle ? ` &mdash; ${escapeHtml(sanitize(vehicle))}` : ''} &mdash; ${submittedStr}
      </p>
      <table style="width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px;">
        ${allSections.join('\n')}
      </table>
      <p style="background: #f8f9fa; padding: 12px; border-radius: 4px; border-left: 4px solid ${accent}; color: #333; font-size: 13px;">
        <strong>The complete ${escapeHtml(config.displayName.toLowerCase())} is also attached as a PDF.</strong><br>
        <span style="font-size: 12px; color: #666;">Filename: ${escapeHtml(filename)}</span>
      </p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 11px; color: #999;">
        This email was sent automatically by the Bells Fork Truck &amp; Auto website
        when a ${escapeHtml(config.displayName.toLowerCase())} was submitted at bellsforktruckandauto.com.
      </p>
    </div>
  `;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  console.log('[submission-created] ===== HANDLER START =====', new Date().toISOString());
  try {
  return await _handleSubmission(event);
  } catch (topLevelErr) {
    console.error('[submission-created] ===== TOP-LEVEL CRASH =====', topLevelErr.message, topLevelErr.stack);
    return { statusCode: 500, body: `Handler crashed: ${topLevelErr.message}` };
  }
};

async function _handleSubmission(event) {
  console.log('[submission-created] Event body length:', event.body?.length || 0);

  let payload;
  try {
    const parsed = JSON.parse(event.body);
    // Netlify wraps the form submission inside a "payload" property
    payload = parsed.payload || parsed;
    console.log('[submission-created] Parsed OK, form_name:', payload.form_name, 'data keys:', Object.keys(payload.data || {}).length);
  } catch (err) {
    console.error('[submission-created] Failed to parse event body:', err.message);
    console.error('[submission-created] Raw body (first 200):', String(event.body).slice(0, 200));
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const formName = (payload.form_name || '').trim();

  // Look up the form configuration
  const config = FORM_CONFIGS[formName];
  if (!config) {
    console.log(`[submission-created] Skipping unrecognized form "${formName}"`);
    return { statusCode: 200, body: `Skipped — unrecognized form "${formName}"` };
  }

  const data = payload.data || {};
  const submittedAt = new Date();

  // Extract contact info using form-specific extractors
  const contactName = config.getContactName(data) || 'Unknown';
  const contactPhone = config.getContactPhone(data);
  const contactEmail = config.getContactEmail(data);
  const vehicle = config.getVehicle(data);

  const nameSlug = slugify(contactName) || 'submission';
  const timestamp = formatTimestamp(submittedAt);
  const filename = `${config.filePrefix}-${nameSlug}-${timestamp}.pdf`;

  console.log(`[submission-created] Processing ${config.displayName} from "${contactName}"`);

  // ── Step 1: Create Lead Record ──
  // Build a short notes summary from the form data
  const leadMessage = sanitize(data.details || data.notes || data.message || '');
  const stockNum = sanitize(data.stock_vin || data.vehicle_vin || '');
  const vehiclePrice = sanitize(data.vehicle_price || data.monthly_budget || '');
  const vehicleVin = sanitize(data.vehicle_vin || data.stock_vin || '');
  // Netlify includes the referring page in the payload when available
  const sourcePage = sanitize(payload.site_url || payload.form_url || '');
  let leadId = null;
  try {
    const lead = await createLead({
      contactName,
      contactPhone,
      contactEmail,
      vehicle,
      formName,
      displayName: config.displayName,
      source: config.leadSource,
      stockNumber: stockNum,
      message: leadMessage,
      sourcePage,
      vehiclePrice,
      vehicleVin,
    });
    if (lead) leadId = lead.id;
  } catch (err) {
    // Lead creation failure should not block PDF/email — log and continue
    console.error('[submission-created] Lead creation failed (non-fatal):', err.message);
  }

  // ── Step 2: Generate PDF ──
  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(data, submittedAt, config);
  } catch (err) {
    console.error('[submission-created] PDF generation failed:', err.message, err.stack);
    return { statusCode: 500, body: `PDF generation failed: ${err.message}` };
  }

  // Validate PDF buffer
  if (!pdfBuffer || pdfBuffer.length === 0) {
    console.error('[submission-created] PDF buffer is empty — aborting email send');
    return { statusCode: 500, body: 'PDF generation produced empty file' };
  }

  // Verify PDF header signature
  const pdfHeader = pdfBuffer.slice(0, 5).toString('ascii');
  if (pdfHeader !== '%PDF-') {
    console.error('[submission-created] Generated file is not a valid PDF (header:', pdfHeader, ')');
    return { statusCode: 500, body: 'Generated file is not a valid PDF' };
  }

  console.log(`[submission-created] PDF generated: ${filename} (${pdfBuffer.length} bytes)`);

  // ── Step 2b: Generate filled dealership PDF (financing-application only) ──
  let dealershipPdfBuffer = null;
  let dealershipPdfFilename = null;
  let dealershipPdfKey = null;

  if (formName === 'financing-application' && generateDealershipPDF) {
    try {
      dealershipPdfBuffer = await generateDealershipPDF(data);
      dealershipPdfFilename = `bellsfork-financing-${nameSlug}-${timestamp}.pdf`;

      // Validate the generated dealership PDF
      if (dealershipPdfBuffer && dealershipPdfBuffer.length > 0) {
        const header = dealershipPdfBuffer.slice(0, 5).toString('ascii');
        if (header !== '%PDF-') {
          console.error('[submission-created] Dealership PDF has invalid header:', header);
          dealershipPdfBuffer = null;
        } else {
          console.log(`[submission-created] Dealership PDF generated: ${dealershipPdfFilename} (${dealershipPdfBuffer.length} bytes)`);

          // Store in Netlify Blobs for admin dashboard access
          const pdfStore = blobStore('lead-pdfs');
          if (pdfStore && leadId) {
            dealershipPdfKey = `dealership-pdf:${leadId}`;
            await pdfStore.set(dealershipPdfKey, dealershipPdfBuffer, { metadata: {
              filename: dealershipPdfFilename,
              leadId,
              formName,
              contactName,
              createdAt: submittedAt.toISOString(),
            }});
            console.log(`[submission-created] Dealership PDF stored in blobs: ${dealershipPdfKey}`);

            // Update the lead record with the PDF key
            try {
              const leadsStore = blobStore('leads-db');
              if (leadsStore) {
                let leads = await leadsStore.get('all', { type: 'json' }).catch(() => []);
                if (Array.isArray(leads)) {
                  const idx = leads.findIndex(l => l.id === leadId);
                  if (idx !== -1) {
                    leads[idx].dealershipPdfKey = dealershipPdfKey;
                    await leadsStore.setJSON('all', leads);
                  }
                }
              }
            } catch (updateErr) {
              console.error('[submission-created] Failed to update lead with PDF key (non-fatal):', updateErr.message);
            }
          }
        }
      }
    } catch (err) {
      // Dealership PDF failure should NOT block the existing workflow
      console.error('[submission-created] Dealership PDF generation failed (non-fatal):', err.message, err.stack);
    }
  }

  // ── Step 3: Send email with attachment ──
  const recipientEmail = (process.env.FINANCE_EMAIL_TO || '').split(',').map(e => e.trim()).filter(Boolean).join(',');
  if (!recipientEmail) {
    console.error('[submission-created] FINANCE_EMAIL_TO not configured — cannot send email');
    return { statusCode: 500, body: 'Email recipient not configured' };
  }

  const fromEmail = process.env.FINANCE_EMAIL_FROM || process.env.SMTP_USER;
  const subject = `New ${config.displayName} — ${contactName}${vehicle ? ` | ${vehicle}` : ''}`;
  const emailHtml = buildEmailHtml({ config, contactName, data, vehicle, filename, submittedAt, leadId });

  // Build extra attachments list (dealership PDF if available)
  const extraAttachments = [];
  if (dealershipPdfBuffer && dealershipPdfFilename) {
    extraAttachments.push({
      filename: dealershipPdfFilename,
      content: dealershipPdfBuffer,
      contentType: 'application/pdf',
    });
  }

  try {
    await sendEmailWithAttachment({
      to: recipientEmail,
      from: fromEmail,
      subject,
      html: emailHtml,
      pdfBuffer,
      filename,
      extraAttachments,
    });
  } catch (err) {
    console.error('[submission-created] Email send failed:', err.message, err.stack);
    return { statusCode: 500, body: `Email send failed: ${err.message}` };
  }

  console.log(`[submission-created] ${config.displayName} email sent successfully to ${recipientEmail}`);

  // ── Step 4: Increment formSubmits in site-analytics ──
  // This ensures the dashboard "Forms Submitted" KPI is accurate even when
  // the client-side tracker fails (ad blockers, JS errors, race conditions).
  try {
    const analyticsStore = blobStore('site-analytics');
    if (analyticsStore) {
      const now = new Date();
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      const dayKey = 'daily:' + yyyy + '-' + mm + '-' + dd;

      let daily = await analyticsStore.get(dayKey, { type: 'json' }).catch(() => null);
      if (!daily) {
        daily = {
          pageViews: 0,
          uniqueVisitors: [],
          phoneClicks: 0,
          formSubmits: 0,
          prequalifySubmits: 0,
          pages: {},
          devices: { mobile: 0, desktop: 0, tablet: 0 },
          referrers: { direct: 0, google: 0, facebook: 0, social: 0, other: 0 },
          newVisitors: [],
          returningVisitors: [],
          bounces: 0,
          totalSessions: 0,
          totalSessionDuration: 0,
          vehicleViews: {},
        };
      }
      daily.formSubmits = (daily.formSubmits || 0) + 1;
      await analyticsStore.setJSON(dayKey, daily);
      console.log(`[submission-created] Analytics formSubmits incremented for ${dayKey}`);
    }
  } catch (err) {
    // Analytics increment failure should not affect the response
    console.error('[submission-created] Analytics increment failed (non-fatal):', err.message);
  }

  return { statusCode: 200, body: `${config.displayName} processed: lead created, PDF emailed` };
}
