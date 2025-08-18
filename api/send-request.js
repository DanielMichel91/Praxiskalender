// /api/send-request.js  (Vercel Serverless Function)
import nodemailer from 'nodemailer';

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v || '');
const safe = (s) => String(s || '').slice(0, 200);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { anrede, vorname, nachname, email, company } = req.body || {};

    // Honeypot -> Bot
    if (company) return res.status(200).json({ ok: true });

    if (!anrede || !vorname || !nachname || !email) {
      return res.status(400).json({ error: 'Bitte alle Felder ausfüllen.' });
    }
    if (!isEmail(email)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse.' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const subject = `Anfrage Vollversion – ${safe(anrede)} ${safe(nachname)}`;
    const text =
`Anrede: ${safe(anrede)}
Vorname: ${safe(vorname)}
Nachname: ${safe(nachname)}
E-Mail: ${safe(email)}

Bitte um Kontaktaufnahme zur Vollversion.`;

    await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: process.env.TO_EMAIL || 'michel.daniel@gmx.net',
      subject,
      text,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Mailer error:', err);
    return res.status(500).json({ error: 'Serverfehler beim Versand.' });
  }
}
