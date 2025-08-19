// api/send-request.js
// Serverless Mailversand via Resend (ESM, kompatibel mit "type":"module")

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Fallback-kompatible JSON-Antwort (funktioniert mit/ohne res.status/res.json)
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
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
    }

    const body = await readJson(req);
    if (!body) return sendJson(res, 400, { ok: false, error: 'Ungültiges JSON.' });

    const { anrede, vorname, nachname, email } = body;
    if (!anrede || !vorname || !nachname || !email) {
      return sendJson(res, 400, { ok: false, error: 'Bitte Anrede, Vorname, Nachname und E-Mail ausfüllen.' });
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) return sendJson(res, 400, { ok: false, error: 'Bitte gültige E-Mail-Adresse eingeben.' });

    const subject = 'Anfrage Vollversion – Praxiskalender';
    const text = `Neue Anfrage zur Vollversion:

Anrede: ${anrede}
Name:   ${vorname} ${nachname}
E-Mail: ${email}
`;
    const html = `
      <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;">
        <h2 style="margin:0 0 8px 0;">Anfrage Vollversion – Praxiskalender</h2>
        <p style="margin:0 0 8px 0;"><strong>Anrede:</strong> ${anrede}</p>
        <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${vorname} ${nachname}</p>
        <p style="margin:0 0 8px 0;"><strong>E-Mail:</strong> ${email}</p>
      </div>
    `;

    const result = await resend.emails.send({
      from: 'Praxiskalender <onboarding@resend.dev>', // funktioniert ohne eigene Domain
      to: ['michel.daniel@gmx.net'],
      reply_to: email, // Antworten landen beim Absender
      subject,
      text,
      html,
    });

    if (result?.error) {
      console.error('Resend error:', result.error);
      return sendJson(res, 500, { ok: false, error: 'Versand fehlgeschlagen.' });
    }
    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error('Mailer exception:', err);
    return sendJson(res, 500, { ok: false, error: 'Unerwarteter Fehler beim Versand.' });
  }
}
