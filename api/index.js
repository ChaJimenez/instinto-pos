const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const app = express();
app.use(cors());
// verify captura el raw body Buffer para verificación HMAC de webhooks externos
app.use(express.json({
  limit: '10mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

const KEYS = { cmd: 'i:cmd', vta: 'i:vta', mes: 'i:mes', canc: 'i:canc', ts: 'i:lastUpdate' };
const PIN = process.env.PIN_ADMIN || '1234';
const API_SECRET = process.env.API_SECRET || 'instinto-pos-2026';

// Middleware de autenticación — activo siempre (configura API_SECRET en Vercel para producción)
function requireAuth(req, res, next) {
  if (req.headers['x-api-key'] !== API_SECRET) return res.status(401).json({ error: 'No autorizado' });
  next();
}

// ── Cargar todos los datos ──
app.get('/api/datos', async (req, res) => {
  try {
    const [cmd, vta, mes, canc] = await Promise.all([
      kv.get(KEYS.cmd),
      kv.get(KEYS.vta),
      kv.get(KEYS.mes),
      kv.get(KEYS.canc),
    ]);
    res.json({ cmd: cmd || [], vta: vta || [], mes: mes || [], canc: canc || [] });
  } catch (e) {
    console.error('Error /api/datos:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

// ── Guardar todos los datos ──
app.post('/api/guardar', requireAuth, async (req, res) => {
  try {
    const { cmd, vta, mes, canc, ts: clientTs } = req.body;
    if (clientTs !== undefined && clientTs > 0) {
      const serverTs = Number(await kv.get(KEYS.ts) || 0);
      if (serverTs > Number(clientTs) + 1000) {
        return res.status(409).json({ error: 'conflicto', serverTs });
      }
    }
    await Promise.all([
      kv.set(KEYS.cmd, cmd || []),
      kv.set(KEYS.vta, vta || []),
      kv.set(KEYS.mes, mes || []),
      kv.set(KEYS.canc, canc || []),
      kv.set(KEYS.ts, Date.now()),
    ]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Error /api/guardar:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

// ── Timestamp para polling de sync ──
app.get('/api/lastUpdate', async (req, res) => {
  try {
    const ts = await kv.get(KEYS.ts);
    res.json({ ts: ts || 0 });
  } catch (e) {
    res.json({ ts: 0 });
  }
});

// ── Importar backup de localStorage (una sola vez) ──
app.post('/api/importar', requireAuth, async (req, res) => {
  try {
    const { pin, cmd, vta, mes, canc } = req.body;
    if (pin !== PIN) return res.status(401).json({ error: 'PIN incorrecto' });
    await Promise.all([
      kv.set(KEYS.cmd, cmd || []),
      kv.set(KEYS.vta, vta || []),
      kv.set(KEYS.mes, mes || []),
      kv.set(KEYS.canc, canc || []),
      kv.set(KEYS.ts, Date.now()),
    ]);
    res.json({ ok: true, importados: { cmd: (cmd||[]).length, vta: (vta||[]).length, mes: (mes||[]).length, canc: (canc||[]).length } });
  } catch (e) {
    console.error('Error /api/importar:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

// ── Impresión en cocina / barra ──
const BARRA_CATS = ['Refrescos', 'Cervezas', 'Cervezas Artesanales', 'Preparados'];

app.post('/api/imprimir', requireAuth, async (req, res) => {
  try {
    const { mesa, mesero, items = [], hora } = req.body;
    const activos = items.filter(it => !it.cancelado);
    const cocina = activos.filter(it => !BARRA_CATS.includes(it.cat));
    const barra  = activos.filter(it =>  BARRA_CATS.includes(it.cat));
    const ts = Date.now();
    const jobs = [];
    if (cocina.length) jobs.push({ id: ts + 'c', destino: 'cocina', mesa, mesero, items: cocina, hora, ts });
    if (barra.length)  jobs.push({ id: ts + 'b', destino: 'barra',  mesa, mesero, items: barra,  hora, ts });
    if (jobs.length) await kv.rpush('i:printjobs', ...jobs.map(j => JSON.stringify(j)));
    res.json({ ok: true, enviados: jobs.length });
  } catch (e) {
    console.error('Error /api/imprimir:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

// ── Imprimir recibo de cuenta (preview o ticket final) ──
app.post('/api/imprimir-recibo', requireAuth, async (req, res) => {
  try {
    const job = { id: Date.now() + 'r', destino: 'recibo', ts: Date.now(), ...req.body };
    await kv.rpush('i:printjobs', JSON.stringify(job));
    res.json({ ok: true });
  } catch (e) {
    console.error('Error /api/imprimir-recibo:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

app.get('/api/print-queue', async (req, res) => {
  try {
    const raw = await kv.lrange('i:printjobs', 0, -1);
    const jobs = raw.map(j => (typeof j === 'string' ? JSON.parse(j) : j));
    res.json({ jobs });
    // ltrim mantiene solo los elementos DESPUÉS de los que leímos,
    // evitando borrar jobs nuevos encolados mientras procesamos
    if (raw.length) await kv.ltrim('i:printjobs', raw.length, -1);
  } catch (e) {
    res.json({ jobs: [] });
  }
});

// ── Test print — envía ticket de prueba a una impresora ──
app.post('/api/test-print', requireAuth, async (req, res) => {
  try {
    const { destino } = req.body;
    if (!['cocina','barra','recibo'].includes(destino)) return res.status(400).json({ error: 'destino inválido' });
    const ts = Date.now();
    let job;
    if (destino === 'recibo') {
      job = { id: ts+'t', destino: 'recibo', mesa: 'TEST', mesero: 'Prueba', hora: new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}), fecha: new Date().toLocaleDateString('es-MX'), items: [{n:'Prueba impresora',p:100,q:1,cancelado:false}], total: 100, cortesias: 0, pago: 'Efectivo', propina: 0, preview: false, ts };
    } else {
      job = { id: ts+'t', destino, mesa: 'TEST', mesero: 'Prueba', hora: new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'}), items: [{n:'Prueba impresora '+destino,q:1}], ts };
    }
    await kv.rpush('i:printjobs', JSON.stringify(job));
    res.json({ ok: true });
  } catch (e) {
    console.error('Error /api/test-print:', e);
    res.status(500).json({ error: 'Error de conexión' });
  }
});

// ── Re-encolar jobs que fallaron al imprimir ──
app.post('/api/requeue', requireAuth, async (req, res) => {
  try {
    const { jobs = [] } = req.body;
    if (jobs.length) await kv.rpush('i:printjobs', ...jobs.map(j => JSON.stringify(j)));
    res.json({ ok: true, requeued: jobs.length });
  } catch (e) {
    console.error('Error /api/requeue:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

// ── Validar PIN (sin exponer el PIN en el cliente) ──
app.post('/api/validate-pin', async (req, res) => {
  const { pin } = req.body || {};
  if (pin === PIN) res.json({ ok: true });
  else res.status(401).json({ ok: false });
});

// ── Gerentes autorizadores ──
const GERENTES_KEY = 'i:gerentes';

// Nombres de gerentes (sin PINs)
app.get('/api/gerentes', async (req, res) => {
  try {
    const lista = await kv.get(GERENTES_KEY) || [];
    res.json({ gerentes: lista.map(x => x.nombre) });
  } catch(e) { res.json({ gerentes: [] }); }
});

// Validar PIN de un gerente específico
app.post('/api/gerentes/validar', async (req, res) => {
  try {
    const { nombre, pin } = req.body || {};
    if (!nombre || !pin) return res.json({ ok: false });
    const lista = await kv.get(GERENTES_KEY) || [];
    const ok = lista.some(x => x.nombre === nombre && x.pin === String(pin));
    res.json({ ok });
  } catch(e) { res.status(500).json({ ok: false }); }
});

// Guardar lista de gerentes (requiere PIN admin)
// Si un gerente tiene pin '___keep___', se preserva el PIN existente de Redis
app.post('/api/gerentes/guardar', async (req, res) => {
  try {
    const { pin_admin, gerentes } = req.body || {};
    if (pin_admin !== PIN) return res.status(401).json({ error: 'PIN incorrecto' });
    if (!Array.isArray(gerentes)) return res.status(400).json({ error: 'Formato inválido' });
    const existentes = await kv.get(GERENTES_KEY) || [];
    const pinMap = {};
    existentes.forEach(g => { pinMap[g.nombre] = g.pin; });
    const nuevaLista = gerentes.map(g => ({
      nombre: g.nombre,
      pin: g.pin === '___keep___' ? (pinMap[g.nombre] || '') : String(g.pin)
    }));
    await kv.set(GERENTES_KEY, nuevaLista);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

// ── Alertas de inventario (lee inv:insumos + proyecta consumo de i:vta) ──
app.get('/api/inv-alertas', async (req, res) => {
  try {
    const [insumosRaw, recetasRaw, posVentas, cortesRaw, configRaw, toteatDias] = await Promise.all([
      kv.get('inv:insumos'),
      kv.get('inv:recetas'),
      kv.get(KEYS.vta),
      kv.get('inv:cortes'),
      kv.get('inv:config'),
      kv.get('inv:toteatDias'),
    ]);

    const insumos   = insumosRaw  || [];
    const recetas   = recetasRaw  || [];
    const ventas    = posVentas   || [];
    const cortes    = cortesRaw   || [];
    const config    = configRaw   || {};
    const toteatArr = toteatDias  || [];

    const fechaInicio     = config.fechaInicioVentas || '2000-01-01';
    const fechasProcesadas = new Set(cortes.map(c => c.fecha));

    const normFecha = (v) => {
      if (v.fecha) {
        const f = v.fecha;
        if (f.includes('/')) {
          const [d,m,y] = f.split('/');
          return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        }
        return f.slice(0,10);
      }
      return new Date(v.id).toISOString().slice(0,10);
    };

    const recetaMap = {};
    recetas.forEach(r => { recetaMap[r.platillo] = r.ingredientes || []; });

    // Consumo proyectado de ventas no procesadas en corte
    const consumo = {};
    ventas.filter(v => {
      if (v.excluida) return false;
      const fv = normFecha(v);
      return fv >= fechaInicio && !fechasProcesadas.has(fv);
    }).forEach(v => {
      (v.items || []).filter(it => !it.cancelado).forEach(item => {
        const receta = recetaMap[item.n];
        if (!receta) return;
        const qty = item.q || 1;
        receta.forEach(ing => {
          consumo[ing.insumoId] = (consumo[ing.insumoId] || 0) + ing.cantidad * qty;
        });
      });
    });

    // Insumos bajo mínimo (stock proyectado)
    const alertas = insumos
      .filter(ins => ins.stockMin > 0)
      .map(ins => {
        const proyectado = Math.max(0, ins.stock - (consumo[ins.id] || 0));
        return { id: ins.id, nombre: ins.nombre, unidad: ins.unidad,
                 stock: ins.stock, proyectado, stockMin: ins.stockMin,
                 critico: proyectado <= ins.stockMin * 0.5 };
      })
      .filter(ins => ins.proyectado <= ins.stockMin);

    // Días faltantes de Toteat (últimos 3 días excluido hoy)
    const diasFaltantes = [];
    if (config.fechaInicioVentas) {
      for (let i = 1; i <= 3; i++) {
        const d = new Date(Date.now() - i * 86400000).toISOString().slice(0,10);
        if (d >= config.fechaInicioVentas && !toteatArr.includes(d)) {
          diasFaltantes.push(d);
        }
      }
    }

    res.json({ alertas, diasFaltantes, totalAlertas: alertas.length + diasFaltantes.length });
  } catch (e) {
    console.error('/api/inv-alertas', e);
    res.json({ alertas: [], diasFaltantes: [], totalAlertas: 0 });
  }
});

// ── Toteat días (proxy al key compartido inv:toteatDias) ──
app.get('/api/toteat-dias', async (req, res) => {
  try {
    const dias = await kv.get('inv:toteatDias') || [];
    res.json({ dias });
  } catch (e) { res.json({ dias: [] }); }
});

app.post('/api/toteat-dias', async (req, res) => {
  try {
    const { fecha } = req.body || {};
    if (!fecha) return res.status(400).json({ error: 'Falta fecha' });
    const dias = await kv.get('inv:toteatDias') || [];
    if (!dias.includes(fecha)) { dias.push(fecha); dias.sort(); await kv.set('inv:toteatDias', dias); }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: "Error de conexión" }); }
});

// ── Menú configurable ──
const MENU_KEY = 'i:menu';

app.get('/api/menu', async (req, res) => {
  try {
    const menu = await kv.get(MENU_KEY);
    res.json({ menu: menu || null });
  } catch (e) {
    res.json({ menu: null });
  }
});

app.post('/api/menu', async (req, res) => {
  try {
    const { pin, categorias, extras, log86 } = req.body || {};
    if (pin !== PIN) return res.status(401).json({ error: 'PIN incorrecto' });
    if (!categorias || typeof categorias !== 'object') return res.status(400).json({ error: 'Formato inválido' });
    await kv.set(MENU_KEY, { categorias, extras: extras || [] });
    if (Array.isArray(log86) && log86.length) {
      await kv.rpush('i:86log', ...log86.map(e => JSON.stringify(e)));
      await kv.ltrim('i:86log', -500, -1);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('/api/menu POST:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

// ── Reporte 86 — historial de ítems desactivados/reactivados ──
app.get('/api/86log', async (req, res) => {
  try {
    const raw = await kv.lrange('i:86log', -200, -1);
    const entries = raw.map(e => (typeof e === 'string' ? JSON.parse(e) : e));
    res.json({ entries: entries.reverse() });
  } catch(e) { res.json({ entries: [] }); }
});

// ── Empleados (todos: meseros, cocineros, gerentes, etc.) ──
const EMPLEADOS_KEY = 'i:empleados';

app.get('/api/empleados', async (req, res) => {
  try {
    const lista = await kv.get(EMPLEADOS_KEY) || [];
    res.json({ empleados: lista });
  } catch(e) { res.json({ empleados: [] }); }
});

app.post('/api/empleados', async (req, res) => {
  try {
    const { pin, empleados } = req.body || {};
    if (pin !== PIN) return res.status(401).json({ error: 'PIN incorrecto' });
    if (!Array.isArray(empleados)) return res.status(400).json({ error: 'Formato inválido' });
    await kv.set(EMPLEADOS_KEY, empleados);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

// ── Turnos — check-in / check-out ──
// Cada turno: { id, nombre, rol, salarioDia, fecha, entrada, salida }
// Key diario: i:turnos:YYYY-MM-DD (expira en 90 días)

function fechaHoy() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
}

app.post('/api/turno/entrada', async (req, res) => {
  try {
    const { nombre } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
    const fecha = fechaHoy();
    const key = `i:turnos:${fecha}`;
    const turnos = await kv.get(key) || [];
    // Verificar que no tenga entrada activa sin salida
    const activo = turnos.find(t => t.nombre === nombre && !t.salida);
    if (activo) return res.json({ ok: false, yaEntro: true });
    const turno = { id: Date.now(), nombre, fecha, entrada: new Date().toISOString(), salida: null };
    turnos.push(turno);
    await kv.set(key, turnos, { ex: 60 * 60 * 24 * 90 });
    res.json({ ok: true, turno });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

app.post('/api/turno/salida', async (req, res) => {
  try {
    const { nombre } = req.body || {};
    if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
    const fecha = fechaHoy();
    const key = `i:turnos:${fecha}`;
    const turnos = await kv.get(key) || [];
    const turno = turnos.find(t => t.nombre === nombre && !t.salida);
    if (!turno) return res.json({ ok: false, noEntrada: true });
    turno.salida = new Date().toISOString();
    const mins = Math.round((new Date(turno.salida) - new Date(turno.entrada)) / 60000);
    turno.minutos = mins;
    await kv.set(key, turnos, { ex: 60 * 60 * 24 * 90 });
    res.json({ ok: true, turno, minutos: mins });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

app.get('/api/turno/hoy', async (req, res) => {
  try {
    const fecha = fechaHoy();
    const [turnos, empleados] = await Promise.all([
      kv.get(`i:turnos:${fecha}`) || [],
      kv.get(EMPLEADOS_KEY) || [],
    ]);
    const turnosReal = turnos || [];
    // Enriquecer con salarioDia del catálogo
    const empMap = {};
    (empleados || []).forEach(e => { empMap[e.nombre] = e; });
    const enriquecidos = turnosReal.map(t => ({
      ...t,
      rol: empMap[t.nombre]?.rol || '',
      salarioDia: empMap[t.nombre]?.salarioDia || 0,
    }));
    res.json({ fecha, turnos: enriquecidos });
  } catch(e) { res.json({ fecha: fechaHoy(), turnos: [] }); }
});

// ── Gastos operativos ──
const GASTOS_KEY = 'i:gastos';

app.get('/api/gastos', async (req, res) => {
  try {
    const gastos = await kv.get(GASTOS_KEY) || [];
    const { desde, hasta } = req.query;
    if (desde && hasta) {
      return res.json({ gastos: gastos.filter(g => g.fecha >= desde && g.fecha <= hasta) });
    }
    res.json({ gastos });
  } catch(e) { res.json({ gastos: [] }); }
});

app.post('/api/gastos', async (req, res) => {
  try {
    const { fecha, categoria, descripcion, monto, formaPago, comprobante, notas } = req.body || {};
    if (!fecha || !descripcion || !monto) return res.status(400).json({ error: 'Faltan campos' });
    const gastos = await kv.get(GASTOS_KEY) || [];
    const gasto = {
      id: Date.now(),
      fecha,
      categoria: categoria || 'Otro',
      descripcion,
      monto: Number(monto),
      formaPago: formaPago || 'Efectivo',
      notas: notas || '',
    };
    if (comprobante) gasto.comprobante = comprobante;
    gastos.push(gasto);
    await kv.set(GASTOS_KEY, gastos);
    res.json({ ok: true, gasto });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

app.delete('/api/gastos/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const gastos = await kv.get(GASTOS_KEY) || [];
    await kv.set(GASTOS_KEY, gastos.filter(g => g.id !== id));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

// ── Cambios de menú → inventarios ──
app.post('/api/menu-cambios', async (req, res) => {
  try {
    const { cambios, ts } = req.body;
    if (!cambios || !cambios.length) return res.json({ ok: true });
    // Acumula cambios pendientes para que el sistema de inventarios los lea
    const prev = await kv.get('inv:menu-cambios') || [];
    const nuevos = [...prev.filter(c => Date.now() - c.ts < 7 * 24 * 3600000), { cambios, ts }];
    await kv.set('inv:menu-cambios', nuevos);
    res.json({ ok: true, pendientes: nuevos.length });
  } catch(e) { res.status(500).json({ error: "Error de conexión" }); }
});

// ── Reportes de ventas ──
app.get('/api/reportes', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    const ventas = await kv.get(KEYS.vta) || [];

    const normFecha = (v) => {
      if (v.fecha) return String(v.fecha).slice(0, 10);
      return new Date(v.id).toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' });
    };

    const filtradas = ventas.filter(v => {
      const f = normFecha(v);
      return (!desde || f >= desde) && (!hasta || f <= hasta);
    });

    const totalDinero = filtradas.reduce((s, v) => s + (v.total || 0), 0);
    const resumen = {
      ventas: filtradas.length,
      total: totalDinero,
      ticketProm: filtradas.length ? Math.round(totalDinero / filtradas.length) : 0,
    };

    // Por día
    const diaMap = {};
    filtradas.forEach(v => {
      const f = normFecha(v);
      if (!diaMap[f]) diaMap[f] = { fecha: f, ventas: 0, total: 0 };
      diaMap[f].ventas++;
      diaMap[f].total += v.total || 0;
    });
    const porDia = Object.values(diaMap).sort((a, b) => a.fecha.localeCompare(b.fecha));

    // Por hora (Mexico City)
    const horaMap = {};
    filtradas.forEach(v => {
      try {
        const hora = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Mexico_City' }).format(new Date(v.id)), 10);
        if (!horaMap[hora]) horaMap[hora] = { hora, ventas: 0, total: 0 };
        horaMap[hora].ventas++;
        horaMap[hora].total += v.total || 0;
      } catch(e) {}
    });
    const porHora = Array.from({ length: 24 }, (_, i) => horaMap[i] || { hora: i, ventas: 0, total: 0 });

    // Por mesero
    const meseroMap = {};
    filtradas.forEach(v => {
      const m = v.mesero || 'Sin asignar';
      if (!meseroMap[m]) meseroMap[m] = { nombre: m, cuentas: 0, total: 0 };
      meseroMap[m].cuentas++;
      meseroMap[m].total += v.total || 0;
    });
    const porMesero = Object.values(meseroMap)
      .map(m => ({ ...m, ticketProm: Math.round(m.total / m.cuentas) }))
      .sort((a, b) => b.total - a.total);

    // Por producto (platillos principales — sin + prefix)
    const prodMap = {};
    filtradas.forEach(v => {
      (v.items || []).filter(it => !it.cancelado && !it.n.startsWith('+')).forEach(it => {
        const k = it.n;
        if (!prodMap[k]) prodMap[k] = { nombre: k, cat: it.cat || '', unidades: 0, total: 0 };
        prodMap[k].unidades += it.q || 1;
        prodMap[k].total += (it.p || 0) * (it.q || 1);
      });
    });
    const porProducto = Object.values(prodMap).sort((a, b) => b.total - a.total).slice(0, 30);

    // Por categoría
    const catMap = {};
    filtradas.forEach(v => {
      (v.items || []).filter(it => !it.cancelado && !it.n.startsWith('+')).forEach(it => {
        const c = it.cat || 'Sin categoría';
        if (!catMap[c]) catMap[c] = { cat: c, total: 0, unidades: 0 };
        catMap[c].total += (it.p || 0) * (it.q || 1);
        catMap[c].unidades += it.q || 1;
      });
    });
    const porCategoria = Object.values(catMap).sort((a, b) => b.total - a.total);

    // Por forma de pago
    const pagoMap = {};
    filtradas.forEach(v => {
      const raw = v.formaPago || 'Efectivo';
      const label = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
      if (!pagoMap[label]) pagoMap[label] = { forma: label, cuentas: 0, total: 0 };
      pagoMap[label].cuentas++;
      pagoMap[label].total += v.total || 0;
    });
    const porFormaPago = Object.values(pagoMap).sort((a, b) => b.total - a.total);

    res.json({ resumen, porDia, porHora, porMesero, porProducto, porCategoria, porFormaPago });
  } catch(e) {
    console.error('/api/reportes:', e);
    res.status(500).json({ error: "Error de conexión" });
  }
});

app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ══════════════════════════════════════════════════════════════════
// ── DELIVERECT WEBHOOK ──────────────────────────────────────────
// Recibe órdenes de Rappi, UberEats y DiDi Food vía Deliverect.
// Configura DELIVERECT_WEBHOOK_SECRET en Vercel → Settings → Env vars.
// ══════════════════════════════════════════════════════════════════

const DELIVERECT_SECRET = process.env.DELIVERECT_WEBHOOK_SECRET || '';

// Status codes de Deliverect (solo procesamos 10 = nueva orden)
const DLV_STATUS = { 10:'nueva', 20:'aceptada', 30:'preparando', 40:'lista', 50:'despachada', 60:'entregada', 100:'cancelada' };

// Nombres legibles por canal
const DLV_CHANNELS = {
  rappi:'Rappi', ubereats:'UberEats', 'uber eats':'UberEats',
  didifood:'DiDi Food', didi:'DiDi Food', cornershop:'Cornershop',
};

function dlvChannelLabel(name) {
  return DLV_CHANNELS[(name||'').toLowerCase()] || (name || 'Delivery');
}

// Categorías de barra — usa el array ya declarado en el módulo (BARRA_CATS arriba)
const BARRA_SET = new Set(BARRA_CATS);

// ── POST /api/webhooks/deliverect ──
app.post('/api/webhooks/deliverect', async (req, res) => {
  // 1. Verificar firma HMAC-SHA256 si el secret está configurado
  if (DELIVERECT_SECRET) {
    const sig = (req.headers['x-deliverect-hash'] || '').toLowerCase();
    try {
      const computed = crypto
        .createHmac('sha256', DELIVERECT_SECRET)
        .update(req.rawBody || Buffer.from(JSON.stringify(req.body)))
        .digest('hex');
      if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed))) {
        console.warn('Deliverect webhook: firma inválida');
        return res.status(401).json({ error: 'Firma inválida' });
      }
    } catch (e) {
      console.warn('Deliverect webhook: error HMAC:', e.message);
      return res.status(401).json({ error: 'Error de verificación' });
    }
  }

  const payload = req.body || {};

  // 2. Solo procesar órdenes nuevas (status 10)
  // Deliverect envía webhooks para cada cambio de status → ignorar el resto
  if (payload.status !== 10) {
    return res.json({ ok: true, action: 'ignored', status: payload.status, statusLabel: DLV_STATUS[payload.status] || 'desconocido' });
  }

  try {
    const channel = dlvChannelLabel(payload.channelName);
    // Últimos 4 chars del ID del canal para el label de mesa (ej. "Rappi #A3F2")
    const shortId = String(payload.channelOrderId || payload.orderId || '???').slice(-4).toUpperCase();
    const mesaLabel = `${channel} #${shortId}`;

    // 3. Convertir ítems Deliverect → formato INSTINTO
    // Deliverect envía precios en la unidad mínima de la moneda (centavos MXN)
    // ej. $140.00 MXN → price: 14000 → dividimos entre 100
    const items = (payload.items || []).map(it => {
      const precioMXN = Math.round((it.price || 0) / 100);
      const subitems  = (it.subItems || []).map(s => s.name).filter(Boolean).join(', ');
      return {
        n:        it.name || it.plu || 'Producto delivery',
        p:        precioMXN,
        q:        it.quantity || 1,
        nota:     subitems || '',
        cat:      'Delivery',
        cancelado: false,
        cortesia:  false,
        plu:      it.plu || '',
      };
    });

    const subtotal = items.reduce((s, it) => s + it.p * it.q, 0);
    const hora  = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City' });
    const fecha = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

    const comanda = {
      id:        Date.now(),
      mesa:      mesaLabel,
      mesero:    channel,
      items,
      total:     subtotal,
      subtotal,
      cortesias: 0,
      cancelados: 0,
      propina:   0,
      hora,
      fecha,
      estado:    'abierta',
      // Metadata delivery — visible en el reporte y para el mesero
      delivery: {
        orderId:        payload.orderId       || null,
        channelOrderId: payload.channelOrderId || null,
        channel:        payload.channelName   || null,
        channelLabel:   channel,
        customer:       payload.customer      || {},
        notes:          payload.notes         || '',
        orderType:      payload.orderType === 2 ? 'pickup' : 'delivery',
        paymentType:    (payload.payment?.type === 1) ? 'cash' : 'online',
        pickupTime:     payload.pickupTime    || null,
        receivedAt:     new Date().toISOString(),
      },
    };

    // 4. Agregar a comandas abiertas (evitar duplicados por orderId)
    const cmdActuales = await kv.get(KEYS.cmd) || [];
    const orderId = payload.orderId;
    const yaExiste = orderId && cmdActuales.some(c => c.delivery?.orderId === orderId);

    if (!yaExiste) {
      cmdActuales.push(comanda);
      await Promise.all([
        kv.set(KEYS.cmd, cmdActuales),
        kv.set(KEYS.ts, Date.now()),
      ]);

      // 5. Print job para cocina (excluye barra)
      const itemsCocina = items.filter(it => !BARRA_SET.has(it.cat));
      if (itemsCocina.length) {
        const job = {
          id:      String(comanda.id) + 'd',
          destino: 'cocina',
          mesa:    mesaLabel,
          mesero:  `📱 ${channel}`,
          items:   itemsCocina,
          hora,
          ts:      Date.now(),
          delivery: true,
          customer: payload.customer?.name || '',
          notes:   payload.notes || '',
        };
        await kv.rpush('i:printjobs', JSON.stringify(job));
      }

      console.log(`📦 Deliverect: nueva orden ${mesaLabel} · ${items.length} ítem(s) · $${subtotal}`);
    } else {
      console.log(`📦 Deliverect: orden duplicada ignorada — orderId ${orderId}`);
    }

    res.json({ ok: true, commandaId: comanda.id, mesa: mesaLabel, itemCount: items.length });
  } catch (e) {
    console.error('Error procesando webhook Deliverect:', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── GET /api/delivery/pending — ordenes delivery abiertas (para debug) ──
app.get('/api/delivery/pending', async (req, res) => {
  try {
    const cmd = await kv.get(KEYS.cmd) || [];
    const delivery = cmd.filter(c => c.estado === 'abierta' && c.delivery);
    res.json({ orders: delivery, count: delivery.length });
  } catch(e) { res.json({ orders: [], count: 0 }); }
});

module.exports = app;
