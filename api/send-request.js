// api/send-request.js  (ESM, "type":"module" in package.json)
const SG_URL = 'https://api.sendgrid.com/v3/mail/send';

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

    const FROM = process.env.FROM_EMAIL;             // verifizierte Single-Sender-Adresse
    const TO = process.env.RECEIVER_EMAIL || 'michel.daniel@gmx.net';
    const KEY = process.env.SENDGRID_API_KEY;

    if (!KEY || !FROM) {
      return sendJson(res, 500, { ok: false, error: 'Mailserver ist nicht konfiguriert (Umgebungsvariablen fehlen).' });
    }

    const subject = 'Anfrage Vollversion – Praxiskalender';
    const html = `
      <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;">
        <h2 style="margin:0 0 8px 0;">Anfrage Vollversion – Praxiskalender</h2>
        <p style="margin:0 0 8px 0;"><strong>Anrede:</strong> ${anrede}</p>
        <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${vorname} ${nachname}</p>
        <p style="margin:0 0 8px 0;"><strong>E-Mail:</strong> ${email}</p>
      </div>
    `;
    const text = `Neue Anfrage zur Vollversion:

Anrede: ${anrede}
Name:   ${vorname} ${nachname}
E-Mail: ${email}
`;

    const sgRes = await fetch(SG_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: TO }], subject }],
        from: { email: FROM, name: 'Praxiskalender' },
        reply_to: { email },
        content: [
          { type: 'text/plain', value: text },
          { type: 'text/html',  value: html },
        ],
      }),
    });

    // SendGrid gibt bei Erfolg 202 zurück (Accepted)
    if (sgRes.status === 202) {
      return sendJson(res, 200, { ok: true });
    }

    const errTxt = await sgRes.text();
    console.error('SendGrid error:', sgRes.status, errTxt);
    return sendJson(res, 500, { ok: false, error: 'Versand fehlgeschlagen.' });
  } catch (err) {
    console.error('Mailer exception:', err);
    return sendJson(res, 500, { ok: false, error: 'Unerwarteter Fehler beim Versand.' });
  }
}
