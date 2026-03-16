/**
 * Bells Fork Truck & Auto — Financing Application Email w/ PDF Attachment
 *
 * Netlify event function: automatically triggered on every form submission.
 * Filters for "financing-application" form, generates a PDF of the submitted
 * application, and emails it to the dealership with the PDF attached.
 *
 * Required environment variables:
 *   SMTP_HOST        — SMTP server hostname (e.g. smtp.gmail.com)
 *   SMTP_PORT        — SMTP port (default: 587)
 *   SMTP_USER        — SMTP username / email
 *   SMTP_PASS        — SMTP password / app-password
 *   FINANCE_EMAIL_TO — Recipient email(s), comma-separated
 *   FINANCE_EMAIL_FROM — Sender "From" address (optional, defaults to SMTP_USER)
 */

const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Sanitize a value for safe rendering in the PDF */
function sanitize(val) {
  if (val == null) return '';
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

// ─── PDF Section Definitions ────────────────────────────────────────────────
// Groups form fields into logical sections for the PDF layout.
// Each section has a title and an ordered list of field keys.

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

// Fields to exclude from PDF (internal / honeypot)
const EXCLUDE_FIELDS = new Set([
  'bot-field', 'form-name', 'request_type',
]);

// ─── PDF Generation ─────────────────────────────────────────────────────────

/**
 * Generate a PDF buffer from the submitted form data.
 * Returns a Promise that resolves with a Buffer.
 */
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

      // ── Header ──
      doc.fontSize(18).font('Helvetica-Bold')
        .text('APPLICATION FOR FINANCING', { align: 'center' });
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

      for (const section of PDF_SECTIONS) {
        // Check if section has any non-empty values
        const sectionHasData = section.fields.some((key) => {
          const val = sanitize(data[key]);
          return val && val.length > 0;
        });
        if (!sectionHasData) continue;

        // Section header
        doc.fillColor('#FFFFFF').rect(doc.x, doc.y, pageWidth, 20).fill('#333333');
        doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
          .text(section.title.toUpperCase(), doc.page.margins.left + 6, doc.y - 15, { width: pageWidth - 12 });
        doc.moveDown(0.5);

        // Fields in two-column layout
        doc.fillColor('#000000').font('Helvetica');
        const colWidth = (pageWidth - 20) / 2;
        let col = 0;
        let rowY = doc.y;

        for (const key of section.fields) {
          const val = sanitize(data[key]);
          renderedFields.add(key);
          if (!val) continue;

          // Check if we need a new page
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

        // Reset position after section
        if (col !== 0) {
          doc.y = rowY + 20;
        }
        doc.moveDown(0.5);
      }

      // ── Catch-all: render any fields not in defined sections ──
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

      // ── Footer ──
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

// ─── Email Sending ──────────────────────────────────────────────────────────

async function sendEmailWithAttachment({ to, from, subject, html, pdfBuffer, filename }) {
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

  const mailOptions = {
    from: from || user,
    to,
    subject,
    html,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  };

  const info = await transporter.sendMail(mailOptions);
  console.log('[submission-created] Email sent:', info.messageId);
  return info;
}

// ─── Main Handler ───────────────────────────────────────────────────────────

exports.handler = async (event) => {
  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (err) {
    console.error('[submission-created] Failed to parse event body:', err.message);
    return { statusCode: 400, body: 'Invalid payload' };
  }

  const formName = (payload.form_name || '').trim();

  // Only process financing applications
  if (formName !== 'financing-application') {
    console.log(`[submission-created] Skipping form "${formName}" (not financing-application)`);
    return { statusCode: 200, body: 'Skipped — not a financing application' };
  }

  const data = payload.data || {};
  const submittedAt = new Date();

  // Build applicant name for filename and subject
  const firstName = sanitize(data.applicant_first_name || '');
  const lastName = sanitize(data.applicant_last_name || '');
  const applicantName = [firstName, lastName].filter(Boolean).join(' ') || 'Unknown Applicant';
  const nameSlug = slugify(applicantName) || 'applicant';
  const timestamp = formatTimestamp(submittedAt);
  const filename = `financing-application-${nameSlug}-${timestamp}.pdf`;

  console.log(`[submission-created] Processing financing application from "${applicantName}"`);

  // ── Step 1: Generate PDF ──
  let pdfBuffer;
  try {
    pdfBuffer = await generatePDF(data, submittedAt);
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

  // ── Step 2: Send email with attachment ──
  const recipientEmail = process.env.FINANCE_EMAIL_TO;
  if (!recipientEmail) {
    console.error('[submission-created] FINANCE_EMAIL_TO not configured — cannot send email');
    return { statusCode: 500, body: 'Email recipient not configured' };
  }

  const fromEmail = process.env.FINANCE_EMAIL_FROM || process.env.SMTP_USER;
  const vehicle = [
    sanitize(data.vehicle_year),
    sanitize(data.vehicle_make),
    sanitize(data.vehicle_model),
  ].filter(Boolean).join(' ');

  const subject = `New Financing Application — ${applicantName}${vehicle ? ` | ${vehicle}` : ''}`;

  // Build email body (summary + note about attachment)
  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333; border-bottom: 2px solid #dc3545; padding-bottom: 8px;">
        New Financing Application Received
      </h2>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555; width: 140px;">Applicant:</td>
          <td style="padding: 6px 12px;">${applicantName}</td>
        </tr>
        ${data.applicant_phone ? `<tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555;">Phone:</td>
          <td style="padding: 6px 12px;">${sanitize(data.applicant_phone)}</td>
        </tr>` : ''}
        ${data.applicant_email ? `<tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555;">Email:</td>
          <td style="padding: 6px 12px;">${sanitize(data.applicant_email)}</td>
        </tr>` : ''}
        ${vehicle ? `<tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555;">Vehicle:</td>
          <td style="padding: 6px 12px;">${vehicle}</td>
        </tr>` : ''}
        ${data.vehicle_price ? `<tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555;">Price:</td>
          <td style="padding: 6px 12px;">${sanitize(data.vehicle_price)}</td>
        </tr>` : ''}
        ${data.vehicle_downpayment ? `<tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555;">Down Payment:</td>
          <td style="padding: 6px 12px;">${sanitize(data.vehicle_downpayment)}</td>
        </tr>` : ''}
        <tr>
          <td style="padding: 6px 12px; font-weight: bold; color: #555;">Submitted:</td>
          <td style="padding: 6px 12px;">${submittedAt.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'long', timeStyle: 'short' })}</td>
        </tr>
      </table>
      <p style="background: #f8f9fa; padding: 12px; border-radius: 4px; border-left: 4px solid #dc3545; color: #333;">
        <strong>The complete financing application is attached as a PDF.</strong><br>
        <span style="font-size: 13px; color: #666;">Filename: ${filename}</span>
      </p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
      <p style="font-size: 12px; color: #999;">
        This email was sent automatically by the Bells Fork Truck &amp; Auto website
        when a financing application was submitted at bellsforktruckandauto.com.
      </p>
    </div>
  `;

  try {
    await sendEmailWithAttachment({
      to: recipientEmail,
      from: fromEmail,
      subject,
      html: emailHtml,
      pdfBuffer,
      filename,
    });
  } catch (err) {
    console.error('[submission-created] Email send failed:', err.message, err.stack);
    return { statusCode: 500, body: `Email send failed: ${err.message}` };
  }

  console.log(`[submission-created] Financing application email sent successfully to ${recipientEmail}`);
  return { statusCode: 200, body: 'Financing application email with PDF sent' };
};
