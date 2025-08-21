// /api/send-request.js  (ESM: package.json hat "type": "module")
import sgMail from '@sendgrid/mail';

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
  }

  try {
    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { ok: false, error: 'Ungültiges JSON.' });

    const { anrede, vorname, nachname, email } = body;
    if (!anrede || !vorname || !nachname || !email) {
      return sendJson(res, 400, { ok: false, error: 'Bitte Anrede, Vorname, Nachname und E-Mail ausfüllen.' });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) return sendJson(res, 400, { ok: false, error: 'Bitte gültige E-Mail-Adresse eingeben.' });

    const apiKey = process.env.SENDGRID_API_KEY;
    const from   = process.env.SENDGRID_FROM; // DEINE verifizierte Single-Sender-Adresse
    const to     = process.env.SENDGRID_TO || 'michel.daniel@gmx.net';

    if (!apiKey || !from) {
      return sendJson(res, 500, { ok: false, error: 'Server nicht konfiguriert (SENDGRID_API_KEY oder SENDGRID_FROM fehlt).' });
    }

    sgMail.setApiKey(apiKey);

    const msg = {
      to,
      from,                 // MUSS der verifizierte Single Sender sein
      replyTo: email,       // Antworten gehen direkt an den Anfragenden
      subject: 'Anfrage Vollversion – Praxiskalender',
      text:
`Neue Anfrage zur Vollversion

Anrede: ${anrede}
Name:   ${vorname} ${nachname}
E-Mail: ${email}
`,
      html:
`<p><strong>Neue Anfrage zur Vollversion</strong></p>
<p>Anrede: ${anrede}<br>
Name: ${vorname} ${nachname}<br>
E-Mail: ${email}</p>`
    };

    await sgMail.send(msg);
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    // SendGrid liefert bei Fehlern oft response.body mit Details
    const detail = err?.response?.body || err?.message || String(err);
    console.error('SendGrid error:', detail);
    return sendJson(res, 502, { ok: false, error: 'Versand fehlgeschlagen.' });
  }
}
