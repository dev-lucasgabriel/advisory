// Receives the onboarding checklist from the landing page and emails it,
// answers and attachments together, from contato@atalaiagestao.com through
// Google Workspace SMTP. Needs the SMTP_PASS environment variable (an app
// password of that account); without it the page falls back to FormSubmit.
import nodemailer from 'nodemailer';

const MAILBOX = 'contato@atalaiagestao.com';
const MAX_FILES_BYTES = 4 * 1024 * 1024;
const MAX_FIELD_CHARS = 20000;
const ALLOWED_ORIGINS = [/^https:\/\/(www\.)?atalaiagestao\.com$/, /^https:\/\/atalaia-site[\w-]*\.vercel\.app$/];

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Builds the email from the submitted form data; kept separate from sending so it can be tested.
export async function buildMessage(form) {
  let answers;
  try {
    answers = JSON.parse(String(form.get('answers') || '{}'));
  } catch {
    throw new Error('bad_answers');
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('bad_answers');

  const office = String(answers['Escritório'] || '').trim().slice(0, 200);
  const replyTo = String(answers.email || '').trim();
  if (!office || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new Error('missing_contact');

  const rows = Object.entries(answers).map(([k, v]) => {
    const key = String(k).slice(0, 500);
    const val = String(v ?? '').slice(0, MAX_FIELD_CHARS);
    return { key, val };
  });

  const attachments = [];
  let total = 0;
  for (const [name, value] of form.entries()) {
    if (name !== 'anexo' || typeof value === 'string') continue;
    total += value.size;
    if (total > MAX_FILES_BYTES) throw new Error('files_too_large');
    attachments.push({ filename: value.name || 'anexo', content: Buffer.from(await value.arrayBuffer()) });
  }

  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#10263A">' +
    '<h2 style="margin:0 0 4px">Checklist de início: ' + escapeHtml(office) + '</h2>' +
    '<p style="margin:0 0 16px;color:#566877">Enviado pelo site atalaiagestao.com' +
    (attachments.length ? ' com ' + attachments.length + (attachments.length === 1 ? ' anexo' : ' anexos') : '') + '.</p>' +
    '<table cellpadding="8" style="border-collapse:collapse;width:100%">' +
    rows.map(({ key, val }, i) =>
      '<tr style="background:' + (i % 2 ? '#ffffff' : '#F3F6F8') + '">' +
      '<td style="vertical-align:top;width:40%;border-bottom:1px solid #E1E7EC"><b>' + escapeHtml(key) + '</b></td>' +
      '<td style="vertical-align:top;border-bottom:1px solid #E1E7EC;white-space:pre-wrap">' + escapeHtml(val) + '</td></tr>'
    ).join('') +
    '</table></div>';
  const text = rows.map(({ key, val }) => key + ': ' + val).join('\n');

  return {
    from: { name: 'Site Atalaia', address: MAILBOX },
    to: MAILBOX,
    replyTo,
    subject: 'Checklist de início: ' + office,
    text,
    html,
    attachments,
  };
}

export async function POST(request) {
  const origin = request.headers.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin))) return json(403, { error: 'origin' });
  if (!process.env.SMTP_PASS) return json(503, { error: 'not_configured' });

  let form;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  if (String(form.get('_honey') || '')) return json(200, { ok: true });

  let message;
  try {
    message = await buildMessage(form);
  } catch (err) {
    return json(400, { error: err.message });
  }

  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USER || MAILBOX, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail(message);
  } catch (err) {
    console.error('checklist send failed:', err && err.message);
    return json(502, { error: 'send_failed' });
  }
  return json(200, { ok: true });
}
