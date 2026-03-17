// Cloudflare Pages Function: /submit
// Handles form submissions — keeps Telegram token off the client

const ALLOWED_ORIGINS = [
  'https://aura-cooperation.shashibatra0017.workers.dev',
  'https://aura-cooperation.pages.dev',
  'http://localhost:8081',
  'http://172.16.30.29:8081',
  'http://172.16.31.191:8081',
];

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // H-1: Origin validation
  const origin = request.headers.get('Origin') || '';
  if (origin && !ALLOWED_ORIGINS.some(o => origin === o || origin.startsWith(o))) {
    return jsonRes({ ok: false, error: 'Unauthorized' }, 403);
  }

  const TOKEN = env.TELEGRAM_TOKEN;
  const CHAT  = env.TELEGRAM_CHAT;
  const SHEETS = env.SHEETS_URL;

  if (!TOKEN || !CHAT) {
    return jsonRes({ ok: false, error: 'Server not configured' }, 500);
  }

  let text, sheetsPayload, submissionId, submitterName, photos = {};

  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('multipart/form-data')) {
      const fd = await request.formData();
      text          = fd.get('text') || '';
      sheetsPayload = JSON.parse(fd.get('sheets') || '{}');
      submissionId  = fd.get('submission_id') || '';
      submitterName = fd.get('submitter_name') || '';
      for (const key of ['c1', 'c2', 'b1', 'b2']) {
        const f = fd.get('photo_' + key);
        if (f && f.size > 0) photos[key] = f;
      }
    } else {
      const body    = await request.json();
      text          = body.text || '';
      sheetsPayload = body.sheets || {};
      submissionId  = body.submission_id || '';
      submitterName = body.submitter_name || '';
    }
  } catch (e) {
    return jsonRes({ ok: false, error: 'Invalid request body' }, 400);
  }

  // Send text message to Telegram
  let tgOk = false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text }),
    });
    const json = await res.json();
    tgOk = json.ok;
    if (!tgOk) throw new Error(json.description || 'Telegram error');
  } catch (e) {
    return jsonRes({ ok: false, error: 'Message delivery failed' }, 502);
  }

  // Send photos to Telegram
  const photoLabels = { c1: 'Close-up 1', c2: 'Close-up 2', b1: 'Full body 1', b2: 'Full body 2' };
  for (const [slot, label] of Object.entries(photoLabels)) {
    if (photos[slot]) {
      try {
        const pfd = new FormData();
        pfd.append('chat_id', CHAT);
        pfd.append('document', photos[slot]);
        pfd.append('caption', `#${submissionId} 📸 ${label} — ${submitterName}`);
        await fetch(`https://api.telegram.org/bot${TOKEN}/sendDocument`, {
          method: 'POST',
          body: pfd,
        });
      } catch (e) {
        // Photo failed — don't block the whole submission
        console.error(`Photo ${slot} failed:`, e);
      }
    }
  }

  // H-2: Google Sheets — await and report failure
  let sheetsOk = true;
  if (SHEETS && sheetsPayload) {
    try {
      const sr = await fetch(SHEETS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetsPayload),
      });
      if (!sr.ok) sheetsOk = false;
    } catch (e) {
      sheetsOk = false;
      console.error('Sheets write failed:', e);
    }
  }

  return jsonRes({ ok: true, sheets_ok: sheetsOk });
}
