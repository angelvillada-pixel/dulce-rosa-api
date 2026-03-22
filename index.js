require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.get('/', (_, res) => res.json({ status: 'ok', service: 'Dulce Rosa API 🌸' }));

// ── CITAS ──
app.get('/citas', async (req, res) => {
  const { data, error } = await supabase.from('citas').select('*').order('fecha').order('hora');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
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
  res.json(data);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🌸 Dulce Rosa API en puerto ${PORT}`));

// ── PROMOCIONES ──
app.get('/promociones', async (req, res) => {
  const { data, error } = await supabase.from('promociones').select('*').eq('activa', true).order('creado', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/promociones', async (req, res) => {
  const { data, error } = await supabase.from('promociones').insert([{ ...req.body, activa: true }]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/promociones/:id', async (req, res) => {
  const { error } = await supabase.from('promociones').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── RESEÑAS ──
app.get('/resenas', async (req, res) => {
  const aprobada = req.query.aprobada;
  let q = supabase.from('resenas').select('*').order('creado', { ascending: false });
  if (aprobada !== undefined) q = q.eq('aprobada', aprobada === 'true');
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/resenas', async (req, res) => {
  const { data, error } = await supabase.from('resenas').insert([{ ...req.body, aprobada: false }]).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.patch('/resenas/:id', async (req, res) => {
  const { data, error } = await supabase.from('resenas').update(req.body).eq('id', req.params.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/resenas/:id', async (req, res) => {
  const { error } = await supabase.from('resenas').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
