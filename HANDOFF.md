# HANDOFF — POS INSTINTO
**Última actualización:** 17 junio 2026 · tarde
**Rama:** `main` · Deploy automático en Vercel al hacer push

---

## ESTADO GENERAL

Sistema POS en producción con respaldo continuo activo. Hoy se resolvió el bug de cuentas perdidas y se implementó una arquitectura de 3 capas para que ningún cobro se pierda jamás.

**URL activa:** https://instinto-sistema-cobranza.vercel.app
**Proyecto Vercel:** `instinto-sistema-cobranza` ← aquí van los env vars
**Repo:** `ChaJimenez/instinto-pos` — push a `main` = deploy automático

---

## LO QUE SE HIZO HOY ✅ (17 junio 2026)

### Bug raíz — cuentas que no aparecían en el reporte
**Causa:** Al recargar la página, el sistema pisaba localStorage con el estado del servidor sin merge. Si un `guardar()` había fallado por red inestable durante la noche, esas ventas se perdían para siempre.

**Fix 1 — carga inicial con merge:** `cargarDatos()` ahora recupera ventas que están en localStorage pero no en el servidor antes de sobreescribir. Si las detecta, las sube automáticamente y muestra un toast.

**Fix 2 — filtros de fecha más robustos:** Todos los filtros del reporte (`renderReporte`, `generarTextoCierre`, `exportarReporteCSV`, cierre de turno) ahora leen `v.fecha` (campo guardado explícito en locale) en lugar de `v.id` (timestamp sensible a zona horaria entre dispositivos).

---

### Sistema de respaldo continuo — WAL + Snapshots + Auto-save

**Capa 1 — WAL (Write-Ahead Log):**
- Nuevo endpoint `POST /api/cobro` → cada cobro se escribe con `RPUSH` atómico en `i:vta:wal` ANTES del bulk `guardar()`.
- Sin conflictos entre tablets: `RPUSH` es atómico en Redis.
- `/api/datos` y `/api/guardar` fusionan el WAL antes de responder/escribir.
- Después de fusionar, se hace `LTRIM` del WAL para que no crezca indefinidamente.

**Capa 2 — Snapshots horarios:**
- Cada `guardar()` escribe `i:vta:bak:YYYY-MM-DDHH` con TTL 48h.
- Nuevos endpoints: `GET /api/backups` y `POST /api/restaurar`.
- UI en **Config → Respaldo de datos → "Ver snapshots disponibles"** → lista por hora → restaurar con un clic.
- La restauración hace merge: las ventas posteriores al snapshot no se pierden.

**Capa 3 — Auto-save cada 5 minutos:**
- `setInterval` silencioso en el frontend — se activa solo cuando hay datos y hay conexión.

---

## LO QUE SE CORRIGIÓ EN LA TARDE ✅ (17 junio 2026)

### Bug #8 — Reporte mostraba $233k (todas las ventas históricas) ignorando el filtro de fecha
- **Síntoma en vivo:** Al seleccionar "Hoy" aparecían 489 comandas y $233k — acumulado de todos los meses
- **Causa raíz:** `toLocaleDateString('es-MX')` guardaba `'17/6/2026'` sin cero en el mes. Al parsear → `'2026-6-17'` → `Invalid Date` → `NaN`. En JS, `NaN < fecha` siempre es `false`, así que TODAS las ventas pasaban el filtro
- **Fix 1:** Guardar fecha como `toLocaleDateString('sv-SE', {timeZone:'America/Mexico_City'})` → siempre `YYYY-MM-DD`
- **Fix 2:** `padStart(2,'0')` en el parseo de fechas `DD/MM/YYYY` para ventas históricas ya guardadas
- **Commit:** `cd1f1a4` · **Archivo:** `public/index.html`

### Incidente operativo — Comanda Mesa S2 perdida ($193)
- Montse · Crispy Chicken Hot Honey $148 + Soda Casera $45
- Se perdió al refrescar la tablet antes de que sincronizara con el servidor
- **Causa:** El WAL protege cobros cerrados, no comandas abiertas en proceso
- Re-entrada manual requerida

---

## PENDIENTE — PRÓXIMA SESIÓN 🔜

| Bug | Impacto | Archivo / Acción |
|-----|---------|-----------------|
| PIN_ADMIN `1234` → cambiar a algo más seguro | Seguridad media | Vercel → Settings → Env Vars |
| `costoTotal` en turnos no proratea por horas | Dato incorrecto en nómina | `turnos.html:325` |
| XSS en `reportes.html` | Seguridad media | `reportes.html` |
| CORS abierto a todos los orígenes | Seguridad baja | `api/index.js` línea 12 |
| PINs de gerentes en plaintext en Redis | Seguridad baja | `api/index.js` ≈ línea 270 |
| ~~Ventana de conflicto sync 1 segundo~~ | ✅ Resuelto por WAL | — |

### Para verificar en el restaurante esta noche (Windows tablets)
- Abrir el POS → cobrar una mesa → revisar que en Config aparezca el snapshot en "Ver snapshots disponibles"
- Confirmar que el punto rojo/verde de sync se mantiene verde durante el servicio

---

## ARQUITECTURA DE DATOS (actualizada)

```
Redis keys activos:
  i:cmd              → comandas abiertas (bulk, reemplaza en cada guardar)
  i:vta              → ventas cerradas (bulk, con merge de WAL en cada escritura)
  i:vta:wal          → Write-Ahead Log de cobros individuales (lista Redis)
  i:vta:bak:HHHH     → Snapshots horarios, TTL 48h
  i:mes              → meseros
  i:canc             → cancelaciones
  i:lastUpdate       → timestamp para polling multi-tablet
  i:gerentes         → lista de gerentes con PINs
  i:empleados        → catálogo de empleados
  i:turnos:YYYY-MM-DD → turnos por día (TTL 90 días)
  i:gastos           → gastos operativos
  i:menu             → menú configurable
  i:printjobs        → cola de impresión
  inv:*              → inventarios (compartido con instinto-inventario)
```

---

## VARIABLES DE ENTORNO (proyecto instinto-sistema-cobranza)

| Variable | Estado | Notas |
|----------|--------|-------|
| `API_SECRET` | ✅ Configurado | Desde mayo 2026. No cambiar. |
| `PIN_ADMIN` | ⚠️ `1234` | Funciona pero es inseguro. Pendiente cambiar. |
| `KV_REST_API_URL` | ⚠️ Needs Attention | Revisar en Vercel |
| `KV_REST_API_TOKEN` | ⚠️ Needs Attention | Revisar en Vercel |

---

## PARA ARRANCAR LA PRÓXIMA SESIÓN

Di: **"continuemos con el POS"** → cargo este handoff automáticamente.

Comandos rápidos:
- `"corrige los bugs pendientes del POS"` → ataca la tabla de arriba en orden
- `"cambia el PIN del POS"` → guía para actualizar PIN_ADMIN en Vercel
- `"analiza Rappi"` o `"analiza DiDi"` → adjunta screenshot del dashboard

---

## CONTEXTO DELIVERY (meta junio 2026)

| Canal | Meta | Estado |
|-------|------|--------|
| Uber Eats | $100,000 MXN | ✅ Precios actualizados, campañas optimizadas |
| Rappi | $50,000 MXN | ⏳ Pendiente análisis |
| DiDi Food | $25,000 MXN | ⏳ Pendiente análisis |
