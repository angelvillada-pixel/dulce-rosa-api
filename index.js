require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = new Set([
  'https://dulcerosanails.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || ALLOWED_ORIGINS.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin not allowed'));
    },
  }),
);
app.use(express.json({ limit: '10mb' }));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function sendSupabaseError(res, error, fallback) {
  return res.status(500).json({ error: error?.message || fallback });
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isHour(value) {
  return typeof value === 'string' && /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeText(value, max = 500) {
  return String(value || '').trim().slice(0, max);
}

function validateCita(payload = {}) {
  const nombre = normalizeText(payload.nombre, 80);
  const tel = normalizeText(payload.tel, 30);
  const servicio = normalizeText(payload.servicio, 160);
  const fecha = normalizeText(payload.fecha, 10);
  const hora = normalizeText(payload.hora, 5);
  const nota = normalizeText(payload.nota, 800);
  const creado = typeof payload.creado === 'string' ? payload.creado : new Date().toISOString();

  if (!nombre) return { error: 'nombre es obligatorio' };
  if (!tel) return { error: 'tel es obligatorio' };
  if (!servicio) return { error: 'servicio es obligatorio' };
  if (!isIsoDate(fecha)) return { error: 'fecha invalida' };
  if (!isHour(hora)) return { error: 'hora invalida' };

  return {
    value: { nombre, tel, servicio, fecha, hora, nota, creado },
  };
}

function validateHoraPayload(payload = {}) {
  const hora = normalizeText(payload.hora, 5);
  if (!isHour(hora)) return { error: 'hora invalida' };
  return { value: hora };
}

function validateBookedArray(payload = {}) {
  const booked = Array.isArray(payload.booked) ? payload.booked.filter(isHour) : [];
  return { value: booked };
}

async function getArr(key) {
  const { data, error } = await supabase.from('config').select('value').eq('key', key).single();
  if (error && error.code !== 'PGRST116') throw error;
  return Array.isArray(data?.value) ? data.value : [];
}

async function setArr(key, arr) {
  const { error } = await supabase.from('config').upsert({ key, value: arr }, { onConflict: 'key' });
  if (error) throw error;
}

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'Dulce Rosa API' });
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Dulce Rosa API',
    time: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get(
  '/citas',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase.from('citas').select('*').order('fecha').order('hora');
    if (error) return sendSupabaseError(res, error, 'No se pudieron cargar las citas.');
    return res.json(data || []);
  }),
);

app.post(
  '/citas',
  asyncHandler(async (req, res) => {
    const parsed = validateCita(req.body);
    if (parsed.error) return badRequest(res, parsed.error);

    const { data, error } = await supabase.from('citas').insert([parsed.value]).select();
    if (error) return sendSupabaseError(res, error, 'No se pudo guardar la cita.');
    return res.json(data[0]);
  }),
);

app.delete(
  '/citas/:id',
  asyncHandler(async (req, res) => {
    const id = normalizeText(req.params.id, 80);
    if (!id) return badRequest(res, 'id invalido');

    const { error } = await supabase.from('citas').delete().eq('id', id);
    if (error) return sendSupabaseError(res, error, 'No se pudo eliminar la cita.');
    return res.json({ ok: true });
  }),
);

app.get(
  '/slots/:fecha',
  asyncHandler(async (req, res) => {
    const fecha = normalizeText(req.params.fecha, 10);
    if (!isIsoDate(fecha)) return badRequest(res, 'fecha invalida');

    const { data, error } = await supabase.from('slots').select('booked').eq('fecha', fecha).single();
    if (error && error.code !== 'PGRST116') return sendSupabaseError(res, error, 'No se pudieron cargar los slots.');
    return res.json({ booked: data?.booked || [] });
  }),
);

app.post(
  '/slots/:fecha/book',
  asyncHandler(async (req, res) => {
    const fecha = normalizeText(req.params.fecha, 10);
    if (!isIsoDate(fecha)) return badRequest(res, 'fecha invalida');

    const parsed = validateHoraPayload(req.body);
    if (parsed.error) return badRequest(res, parsed.error);

    const { data: existing, error: readError } = await supabase.from('slots').select('booked').eq('fecha', fecha).single();
    if (readError && readError.code !== 'PGRST116') return sendSupabaseError(res, readError, 'No se pudieron leer los slots.');

    const booked = existing?.booked || [];
    if (booked.includes(parsed.value)) return res.status(409).json({ error: 'Slot ocupado' });

    const nextBooked = [...booked, parsed.value];
    const mutation = existing
      ? supabase.from('slots').update({ booked: nextBooked }).eq('fecha', fecha)
      : supabase.from('slots').insert([{ fecha, booked: nextBooked }]);
    const { error } = await mutation;
    if (error) return sendSupabaseError(res, error, 'No se pudo bloquear el slot.');

    return res.json({ ok: true, booked: nextBooked });
  }),
);

app.post(
  '/slots/:fecha/unbook',
  asyncHandler(async (req, res) => {
    const fecha = normalizeText(req.params.fecha, 10);
    if (!isIsoDate(fecha)) return badRequest(res, 'fecha invalida');

    const parsed = validateHoraPayload(req.body);
    if (parsed.error) return badRequest(res, parsed.error);

    const { data: existing, error: readError } = await supabase.from('slots').select('booked').eq('fecha', fecha).single();
    if (readError && readError.code !== 'PGRST116') return sendSupabaseError(res, readError, 'No se pudieron leer los slots.');

    const booked = (existing?.booked || []).filter((hour) => hour !== parsed.value);
    if (existing) {
      const { error } = await supabase.from('slots').update({ booked }).eq('fecha', fecha);
      if (error) return sendSupabaseError(res, error, 'No se pudo liberar el slot.');
    }

    return res.json({ ok: true, booked });
  }),
);

app.post(
  '/slots/:fecha/set',
  asyncHandler(async (req, res) => {
    const fecha = normalizeText(req.params.fecha, 10);
    if (!isIsoDate(fecha)) return badRequest(res, 'fecha invalida');

    const parsed = validateBookedArray(req.body);
    const payload = { booked: parsed.value };
    const { data: existing, error: readError } = await supabase.from('slots').select('fecha').eq('fecha', fecha).single();
    if (readError && readError.code !== 'PGRST116') return sendSupabaseError(res, readError, 'No se pudo leer el slot.');

    const mutation = existing
      ? supabase.from('slots').update(payload).eq('fecha', fecha)
      : supabase.from('slots').insert([{ fecha, ...payload }]);
    const { error } = await mutation;
    if (error) return sendSupabaseError(res, error, 'No se pudo guardar el slot.');

    return res.json({ ok: true });
  }),
);

app.get(
  '/galeria',
  asyncHandler(async (_req, res) => {
    const { data, error } = await supabase.from('galeria').select('*').order('orden');
    if (error) return sendSupabaseError(res, error, 'No se pudo cargar la galeria.');
    return res.json(data || []);
  }),
);

app.post(
  '/galeria',
  asyncHandler(async (req, res) => {
    const payload = {
      url: normalizeText(req.body?.url, 4000000),
      titulo: normalizeText(req.body?.titulo, 140),
      orden: Date.now(),
      creado: typeof req.body?.creado === 'string' ? req.body.creado : new Date().toISOString(),
    };
    if (!payload.url) return badRequest(res, 'url es obligatoria');

    const { data, error } = await supabase.from('galeria').insert([payload]).select();
    if (error) return sendSupabaseError(res, error, 'No se pudo guardar la foto.');
    return res.json(data[0]);
  }),
);

app.delete(
  '/galeria/:id',
  asyncHandler(async (req, res) => {
    const id = normalizeText(req.params.id, 80);
    if (!id) return badRequest(res, 'id invalido');

    const { error } = await supabase.from('galeria').delete().eq('id', id);
    if (error) return sendSupabaseError(res, error, 'No se pudo eliminar la foto.');
    return res.json({ ok: true });
  }),
);

app.get(
  '/config/:key',
  asyncHandler(async (req, res) => {
    const key = normalizeText(req.params.key, 80);
    if (!key) return badRequest(res, 'key invalida');

    const { data, error } = await supabase.from('config').select('value').eq('key', key).single();
    if (error && error.code !== 'PGRST116') return sendSupabaseError(res, error, 'No se pudo cargar la configuracion.');
    return res.json(data?.value || {});
  }),
);

app.post(
  '/config/:key',
  asyncHandler(async (req, res) => {
    const key = normalizeText(req.params.key, 80);
    if (!key) return badRequest(res, 'key invalida');

    const { error } = await supabase.from('config').upsert({ key, value: req.body }, { onConflict: 'key' });
    if (error) return sendSupabaseError(res, error, 'No se pudo guardar la configuracion.');
    return res.json({ ok: true });
  }),
);

// Legacy endpoints kept for backward compatibility. The current frontend uses Firestore for reviews/promos.
app.get(
  '/promociones',
  asyncHandler(async (_req, res) => {
    const arr = await getArr('promociones');
    return res.json(arr.filter((promo) => promo.activa !== false).reverse());
  }),
);

app.post(
  '/promociones',
  asyncHandler(async (req, res) => {
    const arr = await getArr('promociones');
    const item = {
      ...req.body,
      titulo: normalizeText(req.body?.titulo, 120),
      descripcion: normalizeText(req.body?.descripcion, 300),
      descuento: normalizeText(req.body?.descuento, 80),
      fechafin: normalizeText(req.body?.fechafin, 30),
      id: Date.now().toString(),
      activa: true,
      creado: new Date().toISOString(),
    };
    if (!item.titulo) return badRequest(res, 'titulo es obligatorio');

    arr.push(item);
    await setArr('promociones', arr);
    return res.json(item);
  }),
);

app.patch(
  '/promociones/:id',
  asyncHandler(async (req, res) => {
    const arr = await getArr('promociones');
    const idx = arr.findIndex((promo) => promo.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    arr[idx] = { ...arr[idx], ...req.body };
    await setArr('promociones', arr);
    return res.json(arr[idx]);
  }),
);

app.delete(
  '/promociones/:id',
  asyncHandler(async (req, res) => {
    const arr = await getArr('promociones');
    await setArr(
      'promociones',
      arr.filter((promo) => promo.id !== req.params.id),
    );
    return res.json({ ok: true });
  }),
);

app.get(
  '/resenas',
  asyncHandler(async (req, res) => {
    let arr = await getArr('resenas');
    if (req.query.aprobada !== undefined) {
      const approved = req.query.aprobada === 'true';
      arr = arr.filter((review) => review.aprobada === approved);
    }
    return res.json([...arr].reverse());
  }),
);

app.post(
  '/resenas',
  asyncHandler(async (req, res) => {
    const arr = await getArr('resenas');
    const item = {
      ...req.body,
      nombre: normalizeText(req.body?.nombre, 80),
      servicio: normalizeText(req.body?.servicio, 120),
      comentario: normalizeText(req.body?.comentario, 1000),
      id: Date.now().toString(),
      aprobada: false,
      creado: new Date().toISOString(),
    };
    if (!item.nombre || !item.comentario) return badRequest(res, 'nombre y comentario son obligatorios');

    arr.push(item);
    await setArr('resenas', arr);
    return res.json(item);
  }),
);

app.patch(
  '/resenas/:id',
  asyncHandler(async (req, res) => {
    const arr = await getArr('resenas');
    const idx = arr.findIndex((review) => review.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });

    arr[idx] = { ...arr[idx], ...req.body };
    await setArr('resenas', arr);
    return res.json(arr[idx]);
  }),
);

app.delete(
  '/resenas/:id',
  asyncHandler(async (req, res) => {
    const arr = await getArr('resenas');
    await setArr(
      'resenas',
      arr.filter((review) => review.id !== req.params.id),
    );
    return res.json({ ok: true });
  }),
);

app.use((error, _req, res, _next) => {
  if (error?.message === 'Origin not allowed') {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }

  console.error('Unhandled API error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Dulce Rosa API listening on port ${PORT}`);
});
