require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.error('❌ Faltan SUPABASE_URL o SUPABASE_KEY');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ══════════════════════════════════════════
// HELPERS — reseñas y promos usan la tabla
// 'config' que YA EXISTE (key=resenas / key=promociones)
// SIN necesitar tablas nuevas en Supabase
// ══════════════════════════════════════════
async function getArr(key) {
  try {
    const { data } = await supabase.from('config').select('value').eq('key', key).single();
    return Array.isArray(data?.value) ? data.value : [];
  } catch { return []; }
}
async function setArr(key, arr) {
  await supabase.from('config').upsert({ key, value: arr }, { onConflict: 'key' });
}

app.get('/', (_, res) => res.json({ status: 'ok', service: 'Dulce Rosa API 🌸' }));

// ── CITAS ──
app.get('/citas', async (req, res) => {
  const { data, error } = await supabase.from('citas').select('*').order('fecha').order('hora');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
app.post('/citas', async (req, res) => {
  const { data, error } = await supabase.from('citas').insert([req.body]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.delete('/citas/:id', async (req, res) => {
  const { error } = await supabase.from('citas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── SLOTS ──
app.get('/slots/:fecha', async (req, res) => {
  const { data } = await supabase.from('slots').select('booked').eq('fecha', req.params.fecha).single();
  res.json({ booked: data?.booked || [] });
});
app.post('/slots/:fecha/book', async (req, res) => {
  const { hora } = req.body;
  const fecha = req.params.fecha;
  const { data: existing } = await supabase.from('slots').select('booked').eq('fecha', fecha).single();
  const booked = existing?.booked || [];
  if (booked.includes(hora)) return res.status(409).json({ error: 'Slot ocupado' });
  const newBooked = [...booked, hora];
  if (existing) await supabase.from('slots').update({ booked: newBooked }).eq('fecha', fecha);
  else await supabase.from('slots').insert([{ fecha, booked: newBooked }]);
  res.json({ ok: true, booked: newBooked });
});
app.post('/slots/:fecha/unbook', async (req, res) => {
  const { hora } = req.body;
  const fecha = req.params.fecha;
  const { data: existing } = await supabase.from('slots').select('booked').eq('fecha', fecha).single();
  const booked = (existing?.booked || []).filter(h => h !== hora);
  if (existing) await supabase.from('slots').update({ booked }).eq('fecha', fecha);
  res.json({ ok: true, booked });
});
app.post('/slots/:fecha/set', async (req, res) => {
  const fecha = req.params.fecha;
  const { data: existing } = await supabase.from('slots').select('fecha').eq('fecha', fecha).single();
  if (existing) await supabase.from('slots').update(req.body).eq('fecha', fecha);
  else await supabase.from('slots').insert([{ fecha, ...req.body }]);
  res.json({ ok: true });
});

// ── GALERÍA ──
app.get('/galeria', async (req, res) => {
  const { data, error } = await supabase.from('galeria').select('*').order('orden');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});
app.post('/galeria', async (req, res) => {
  const { data, error } = await supabase.from('galeria').insert([{ ...req.body, orden: Date.now() }]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
app.delete('/galeria/:id', async (req, res) => {
  const { error } = await supabase.from('galeria').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── CONFIG ──
app.get('/config/:key', async (req, res) => {
  const { data } = await supabase.from('config').select('value').eq('key', req.params.key).single();
  res.json(data?.value || {});
});
app.post('/config/:key', async (req, res) => {
  const { error } = await supabase.from('config').upsert({ key: req.params.key, value: req.body }, { onConflict: 'key' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── PROMOCIONES ──
// Almacenadas en config (key='promociones') — sin tabla nueva
app.get('/promociones', async (req, res) => {
  const arr = await getArr('promociones');
  res.json(arr.filter(p => p.activa !== false).reverse());
});
app.post('/promociones', async (req, res) => {
  const arr = await getArr('promociones');
  const item = { ...req.body, id: Date.now().toString(), activa: true, creado: new Date().toISOString() };
  arr.push(item);
  await setArr('promociones', arr);
  res.json(item);
});
app.patch('/promociones/:id', async (req, res) => {
  const arr = await getArr('promociones');
  const idx = arr.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  arr[idx] = { ...arr[idx], ...req.body };
  await setArr('promociones', arr);
  res.json(arr[idx]);
});
app.delete('/promociones/:id', async (req, res) => {
  const arr = await getArr('promociones');
  await setArr('promociones', arr.filter(p => p.id !== req.params.id));
  res.json({ ok: true });
});

// ── RESEÑAS ──
// Almacenadas en config (key='resenas') — sin tabla nueva
app.get('/resenas', async (req, res) => {
  let arr = await getArr('resenas');
  if (req.query.aprobada !== undefined) {
    const val = req.query.aprobada === 'true';
    arr = arr.filter(r => r.aprobada === val);
  }
  res.json([...arr].reverse());
});
app.post('/resenas', async (req, res) => {
  const arr = await getArr('resenas');
  const item = { ...req.body, id: Date.now().toString(), aprobada: false, creado: new Date().toISOString() };
  arr.push(item);
  await setArr('resenas', arr);
  res.json(item);
});
app.patch('/resenas/:id', async (req, res) => {
  const arr = await getArr('resenas');
  const idx = arr.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  arr[idx] = { ...arr[idx], ...req.body };
  await setArr('resenas', arr);
  res.json(arr[idx]);
});
app.delete('/resenas/:id', async (req, res) => {
  const arr = await getArr('resenas');
  await setArr('resenas', arr.filter(r => r.id !== req.params.id));
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🌸 Dulce Rosa API en puerto ${PORT}`));