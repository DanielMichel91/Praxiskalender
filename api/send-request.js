// /pages/api/send-request.js  (ESM: package.json hat "type": "module")
import sgMail from '@sendgrid/mail';
import Busboy from 'busboy';

/* ---------- Next/Vercel ---------- */
export const config = {
  api: { bodyParser: false }, // wir parsen multipart selbst
  runtime: 'nodejs'           // NICHT Edge (Busboy + Buffer benötigt)
};

/* ---------- Helpers ---------- */
function sendJson(res, status, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (s = '') =>
  String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');

const ensureArray = (val) => {
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') return val.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  return [];
};

const ul = (items) => items.length
  ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p>–</p>';

const parseRecipients = (s) => {
  const list = ensureArray(s);
  return list.length ? list : null;
};

/* ---------- multipart Parser (Busboy) ---------- */
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 50 } // 10MB/Datei
    });

    const fields = {};
    const files = {};              // key -> { filename, mimeType, data: Buffer }
    const fileBuffers = {};        // key -> Buffer[]

    bb.on('field', (name, val) => { fields[name] = val; });

    bb.on('file', (name, file, info) => {
      const { filename, mimeType } = info;
      fileBuffers[name] = [];
      file.on('data', (chunk) => fileBuffers[name].push(chunk));
      file.on('limit', () => reject(Object.assign(new Error('Datei zu groß'), { status: 413 })));
      file.on('end', () => {
        const data = Buffer.concat(fileBuffers[name] || []);
        files[name] = { filename, mimeType, data };
      });
    });

    bb.on('error', reject);
    bb.on('finish', () => resolve({ fields, files }));
    req.pipe(bb);
  });
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  // Health check im Browser: /api/send-request
  if (req.method === 'GET') {
    return sendJson(res, 200, { ok: true, ping: 'send-request up' });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    const { fields, files } = await parseMultipart(req);

    // Honeypot: Bots füllen dieses Feld → still "ok", aber nichts senden
    if (fields.company && String(fields.company).trim() !== '') {
      return sendJson(res, 200, { ok: true });
    }

    /* ------ Felder normalisieren ------ */
    const anrede          = String(fields.anrede || '').trim();
    const vorname         = String(fields.vorname || '').trim();
    const nachname        = String(fields.nachname || '').trim();
    const email           = String(fields.email || '').trim();

    const company_name    = String(fields.company_name || '').trim();
    const company_address = String(fields.company_address || '').trim();

    const app_title       = String(fields.app_title || '').trim();
    const play_emails     = ensureArray(fields.play_emails);
    const behandlers      = ensureArray(fields.behhandlers || fields.behandlers); // tolerant bzgl. Name

    const nutzer_typ      = (fields.nutzer_typ === 'team' ? 'team' : 'single');
    const team_count      = nutzer_typ === 'team' ? (parseInt(fields.team_count, 10) || 0) : 1;

    // Checkbox akzeptiert true/on/1/yes
    const b2b = ['true', 'on', '1', 'yes'].includes(String(fields.b2b || '').toLowerCase());

    // Uploads (beide PFLICHT)
    const treatmentsFile  = files.treatments_file;
    const logoFile        = files.logo_file;

    /* ------ Validierung ------ */
    const missing = [];
    const invalid = [];

    if (!anrede)  missing.push('Anrede');
    if (!vorname) missing.push('Vorname');
    if (!nachname)missing.push('Nachname');
    if (!email)   missing.push('E-Mail');
    if (email && !EMAIL_RE.test(email)) invalid.push('E-Mail (Format)');

    if (!company_name)    missing.push('Unternehmensname');
    if (!company_address) missing.push('Anschrift');

    if (!app_title)       missing.push('Praxisname (App-Titel)');

    if (play_emails.length === 0) missing.push('Google-Mailadressen (Play-Store-Zugriff)');
    const badMails = play_emails.filter(e => !EMAIL_RE.test(e));
    if (badMails.length) invalid.push(`Google-Mailadressen ungültig: ${badMails.join(', ')}`);

    if (behandlers.length === 0) missing.push('Behandler:innen (Name/Kürzel)');

    if (!nutzer_typ) missing.push('Nutzeranzahl');
    if (nutzer_typ === 'team' && (!team_count || team_count < 2)) invalid.push('Teamgröße (mind. 2)');

    if (!treatmentsFile)  missing.push('Behandlungen – Datei');
    if (!logoFile)        missing.push('Logo – Datei');

    // Dateitypen prüfen
    const okTreatments = [
      'text/csv', 'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png', 'image/jpeg', 'image/webp'
    ];
    const okLogos = ['image/png', 'image/jpeg'];

    if (treatmentsFile && !okTreatments.includes(treatmentsFile.mimeType)) {
      invalid.push('Behandlungen – Dateityp (CSV/PDF/Excel/PNG/JPG/WebP)');
    }
    if (logoFile && !okLogos.includes(logoFile.mimeType)) {
      invalid.push('Logo – Dateityp (PNG/JPG)');
    }

    if (!b2b) invalid.push('B2B-Bestätigung (§14 BGB)');

    if (missing.length || invalid.length) {
      const message = [
        missing.length ? `Bitte ausfüllen: ${missing.join(', ')}.` : '',
        invalid.length ? `Bitte prüfen: ${invalid.join(', ')}.` : ''
      ].filter(Boolean).join(' ');
      return sendJson(res, 400, { ok: false, error: message || 'Validierung fehlgeschlagen.' });
    }

    /* ------ SendGrid vorbereiten ------ */
    const apiKey = process.env.SENDGRID_API_KEY;
    const from   = process.env.SENDGRID_FROM; // verifizierter Single Sender
    const toList = parseRecipients(process.env.SENDGRID_TO) || ['michel.daniel@gmx.net'];

    if (!apiKey || !from) {
      return sendJson(res, 500, { ok: false, error: 'Server nicht konfiguriert (SENDGRID_API_KEY oder SENDGRID_FROM fehlt).' });
    }
    sgMail.setApiKey(apiKey);

    /* ------ Mailinhalt ------ */
    const subject = 'Anfrage Vollversion – Praxiskalender';

    const text =
`Neue Anfrage zur Vollversion

[Kontakt]
Anrede: ${anrede}
Name:   ${vorname} ${nachname}
E-Mail: ${email}

[Unternehmen]
Name:     ${company_name}
Anschrift:${company_address}

[App-Konfiguration]
Praxisname (App-Titel): ${app_title}
Nutzeranzahl: ${nutzer_typ === 'team' ? `Team (${team_count})` : '1 Person'}

Behandler:innen:
${behandlers.map(b => `- ${b}`).join('\n') || '-'}

Play-Store-Zugriff (Google-Konten):
${play_emails.map(m => `- ${m}`).join('\n') || '-'}

[Anhänge]
Behandlungen: ${treatmentsFile?.filename || '-'}
Logo:         ${logoFile?.filename || '-'}

B2B bestätigt: ${b2b ? 'Ja' : 'Nein'}
`;

    const html =
`<div>
  <p><strong>Neue Anfrage zur Vollversion</strong></p>

  <h3>Kontakt</h3>
  <p>Anrede: ${esc(anrede)}<br>
  Name: ${esc(vorname)} ${esc(nachname)}<br>
  E-Mail: ${esc(email)}</p>

  <h3>Unternehmen</h3>
  <p>Name: ${esc(company_name)}<br>
  Anschrift:<br>${esc(company_address).replace(/\n/g,'<br>')}</p>

  <h3>App-Konfiguration</h3>
  <p>Praxisname (App-Titel): ${esc(app_title)}<br>
  Nutzeranzahl: ${nutzer_typ === 'team' ? `Team (${team_count})` : '1&nbsp;Person'}</p>

  <h4>Behandler:innen</h4>
  ${ul(behandlers)}

  <h4>Play-Store-Zugriff (Google-Konten)</h4>
  ${ul(play_emails)}

  <h4>Anhänge</h4>
  <ul>
    <li>Behandlungen: ${esc(treatmentsFile?.filename || '-')}</li>
    <li>Logo: ${esc(logoFile?.filename || '-')}</li>
  </ul>

  <p><strong>B2B bestätigt:</strong> ${b2b ? 'Ja' : 'Nein'}</p>
</div>`;

    // Anhänge → Base64
    const attachments = [];
    if (treatmentsFile) {
      attachments.push({
        content: treatmentsFile.data.toString('base64'),
        filename: treatmentsFile.filename || 'behandlungen',
        type: treatmentsFile.mimeType || 'application/octet-stream',
        disposition: 'attachment'
      });
    }
    if (logoFile) {
      attachments.push({
        content: logoFile.data.toString('base64'),
        filename: logoFile.filename || 'logo',
        type: logoFile.mimeType || 'application/octet-stream',
        disposition: 'attachment'
      });
    }

    const msg = {
      to: toList,
      from,
      replyTo: email,  // Antworten direkt an den/die Anfragende:n
      subject,
      text,
      html,
      attachments
    };

    await sgMail.send(msg);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    // SendGrid liefert oft detailierte response.body.errors
    const status = err?.status || 502;
    const sgErr  = err?.response?.body?.errors
      ? err.response.body.errors.map(e => e.message).join('; ')
      : null;
    const detail = sgErr || err?.response?.body || err?.message || String(err);
    console.error('send-request error:', detail);
    return sendJson(res, status, {
      ok: false,
      error: status === 413 ? 'Datei zu groß.' : 'Versand fehlgeschlagen.'
    });
  }
}
