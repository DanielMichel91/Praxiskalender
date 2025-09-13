// /api/send-request.js  (ESM: package.json hat "type": "module")
import sgMail from '@sendgrid/mail';

/* ---------- Helpers ---------- */
function sendJson(res, status, payload) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const ensureArray = (val) => {
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') {
    return val.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
};

const ul = (items) => items.length
  ? `<ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`
  : '<p>–</p>';

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { ok: false, error: 'Ungültiges JSON.' });

    // Honeypot (Bots füllen das i.d.R. aus) → stillschweigend „OK“, aber nichts senden
    if (body.company && String(body.company).trim() !== '') {
      return sendJson(res, 200, { ok: true });
    }

    /* -------- Felder aus Body normalisieren -------- */
    const anrede            = String(body.anrede || '').trim();
    const vorname           = String(body.vorname || '').trim();
    const nachname          = String(body.nachname || '').trim();
    const email             = String(body.email || '').trim();

    const company_name      = String(body.company_name || '').trim();
    const company_address   = String(body.company_address || '').trim();

    const app_title         = String(body.app_title || '').trim();
    const play_emails       = ensureArray(body.play_emails);
    const behandlers        = ensureArray(body.behandlers);

    const nutzer_typ        = (body.nutzer_typ === 'team' ? 'team' : 'single');
    const team_count        = nutzer_typ === 'team'
                                ? Number.parseInt(body.team_count, 10) || 0
                                : 1;

    const treatments_file_name = String(body.treatments_file_name || '').trim(); // Name reicht (kein Anhang)
    const logo_file_name       = String(body.logo_file_name || '').trim();

    const b2b = String(body.b2b || '').toLowerCase() === 'true';

    /* -------- Validierung -------- */
    const missing = [];
    const invalid = [];

    if (!anrede)     missing.push('Anrede');
    if (!vorname)    missing.push('Vorname');
    if (!nachname)   missing.push('Nachname');
    if (!email)      missing.push('E-Mail');
    if (email && !EMAIL_RE.test(email)) invalid.push('E-Mail (Format)');

    if (!company_name)    missing.push('Unternehmensname');
    if (!company_address) missing.push('Anschrift');

    if (!app_title)       missing.push('Praxisname (App-Titel)');

    if (play_emails.length === 0) missing.push('Google-Mailadressen (Play-Store-Zugriff)');
    if (play_emails.length > 0) {
      const bad = play_emails.filter(e => !EMAIL_RE.test(e));
      if (bad.length) invalid.push(`Google-Mailadressen ungültig: ${bad.join(', ')}`);
    }

    if (behandlers.length === 0) missing.push('Behandler:innen (Name/Kürzel)');

    if (!nutzer_typ)      missing.push('Nutzeranzahl');
    if (nutzer_typ === 'team' && (!team_count || team_count < 2)) {
      invalid.push('Teamgröße (mind. 2)');
    }

    // Dateien sind optional – wenn du „Behandlungen/Logo“ verpflichtend willst: nächste zwei Zeilen einkommentieren
    if (!treatments_file_name) missing.push('Behandlungen – Datei');
    if (!logo_file_name)       missing.push('Logo – Datei');

    if (!b2b) invalid.push('B2B-Bestätigung (§14 BGB)');

    if (missing.length || invalid.length) {
      const message = [
        missing.length ? `Bitte ausfüllen: ${missing.join(', ')}.` : '',
        invalid.length ? `Bitte prüfen: ${invalid.join(', ')}.` : ''
      ].filter(Boolean).join(' ');
      return sendJson(res, 400, { ok: false, error: message || 'Validierung fehlgeschlagen.' });
    }

    /* -------- SendGrid vorbereiten -------- */
    const apiKey = process.env.SENDGRID_API_KEY;
    const from   = process.env.SENDGRID_FROM; // verifizierte Absenderadresse (Single Sender)
    const to     = process.env.SENDGRID_TO || 'michel.daniel@gmx.net';

    if (!apiKey || !from) {
      return sendJson(res, 500, { ok: false, error: 'Server nicht konfiguriert (SENDGRID_API_KEY oder SENDGRID_FROM fehlt).' });
    }

    sgMail.setApiKey(apiKey);

    /* -------- Mailinhalt aufbauen -------- */
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

[Uploads]
Behandlungen: ${treatments_file_name || '-'}
Logo:         ${logo_file_name || '-'}

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

  <h3>Uploads</h3>
  <p>Behandlungen: ${esc(treatments_file_name || '-')}<br>
  Logo: ${esc(logo_file_name || '-')}</p>

  <p><strong>B2B bestätigt:</strong> ${b2b ? 'Ja' : 'Nein'}</p>
</div>`;

    const msg = {
      to,
      from,            // verifizierter Absender
      replyTo: email,  // Antworten gehen an die anfragende Person
      subject,
      text,
      html
    };

    await sgMail.send(msg);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    const detail = err?.response?.body || err?.message || String(err);
    console.error('SendGrid error:', detail);
    return sendJson(res, 502, { ok: false, error: 'Versand fehlgeschlagen.' });
  }
}
