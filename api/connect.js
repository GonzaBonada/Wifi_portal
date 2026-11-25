// Función serverless de Vercel: recibe el formulario del portal y lo reenvía
// al webhook de n8n (que está dentro de la red y es quien autoriza en UniFi).
//
// Variables de entorno a configurar en Vercel (Settings -> Environment Variables):
//   N8N_WEBHOOK_URL   URL pública del webhook de n8n (vía Cloudflare Tunnel).
//                     Ej: https://portal-hook.aden.org/webhook/wifi-portal
//   WEBHOOK_SECRET    Token compartido; n8n valida este mismo valor.
//   FALLBACK_URL      (opcional) A dónde redirigir si UniFi no mandó 'url'.
//                     Por defecto https://www.aden.org

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  }

  const webhook = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.WEBHOOK_SECRET || '';
  const fallback = process.env.FALLBACK_URL || 'https://www.aden.org';

  if (!webhook) {
    return res.status(500).json({ ok: false, error: 'Portal sin configurar (falta N8N_WEBHOOK_URL).' });
  }

  // El body ya viene parseado por Vercel cuando el content-type es JSON.
  const b = typeof req.body === 'object' && req.body ? req.body : {};

  // Sin campos obligatorios: se envía solo lo que la persona haya cargado.
  const payload = {
    nombre: (b.nombre || '').toString().slice(0, 120),
    apellido: (b.apellido || '').toString().slice(0, 120),
    email: (b.email || '').toString().trim().toLowerCase().slice(0, 200),
    telefono: (b.telefono || '').toString().slice(0, 40),
    password: (b.password || '').toString().slice(0, 200),
    terminos: b.terminos === true || b.terminos === 'true',
    id: (b.id || '').toString().toLowerCase(),
    ap: (b.ap || '').toString().toLowerCase(),
    ssid: (b.ssid || '').toString().slice(0, 64),
    url: (b.url || '').toString().slice(0, 1000),
    t: (b.t || '').toString().slice(0, 64)
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const r = await fetch(webhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-portal-secret': secret
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timer);

    let data = {};
    try { data = await r.json(); } catch (_) { /* n8n podría no devolver JSON */ }

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: 'El servicio de red rechazó la solicitud.' });
    }

    // Decidir destino de la redirección del lado del servidor (más confiable).
    let redirect = payload.url && /^https?:\/\//i.test(payload.url) ? payload.url : fallback;
    if (data && data.redirect && /^https?:\/\//i.test(data.redirect)) redirect = data.redirect;

    return res.status(200).json({
      ok: data.ok !== false,
      autorizado: data.autorizado === true,
      redirect
    });
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    return res.status(504).json({
      ok: false,
      error: aborted ? 'El servidor tardó demasiado en responder.' : 'No se pudo contactar al servicio de red.'
    });
  }
}
