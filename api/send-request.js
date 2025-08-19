// api/send-request.js
// Serverless Mailversand via Resend (ohne SMTP, ohne Mailprogramm)

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

// Minimaler CORS-Schutz (nur POST, nur JSON)
function badReq(res, msg) {
  return res.status(400).json({ ok: false, error: msg });
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'Method Not Allowed' });
    }

    // Erwartet JSON
    const { anrede, vorname, nachname, email } = req.body || {};
    if (!anrede || !vorname || !nachname || !email) {
      return badReq(res, 'Bitte alle Felder ausfüllen (Anrede, Vorname, Nachname, E-Mail).');
    }

    // einfache Validierung
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) return badReq(res, 'Bitte eine gültige E-Mail-Adresse eingeben.');

    // E-Mail-Inhalte
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

    // Versand: From kann ohne eigene Domain über onboarding@resend.dev laufen
    const sendResult = await resend.emails.send({
      from: 'Praxiskalender <onboarding@resend.dev>',
      to: ['michel.daniel@gmx.net'],
      reply_to: email, // optional: Antwort geht direkt an Absender
      subject,
      text,
      html,
    });

    if (sendResult.error) {
      console.error('Resend error:', sendResult.error);
      return res.status(500).json({ ok: false, error: 'Versand fehlgeschlagen.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Mailer exception:', err);
    return res.status(500).json({ ok: false, error: 'Unerwarteter Fehler beim Versand.' });
  }
};
