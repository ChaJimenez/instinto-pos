# HANDOFF — POS INSTINTO
**Última actualización:** 26 junio 2026 (sesión 4)  
**Commit activo:** `73a0a39`  
**Rama:** `main` · Deploy automático en Vercel al hacer push

---

## ACCESO RÁPIDO

| Qué | Dónde |
|-----|-------|
| URL producción | https://instinto-sistema-cobranza.vercel.app |
| Proyecto Vercel | `instinto-sistema-cobranza` (env vars aquí) |
| Repo GitHub | `ChaJimenez/instinto-pos` |
| Redis | `cool-toad-149285.upstash.io` (Upstash, proyecto Instinto-POS) |

---

## SETUP REAL DEL RESTAURANTE

- **2 tablets** para meseros (POS principal — `index.html`)
- **1 computadora en caja** — Cha quiere cambiarla por iPad (compatible, pendiente probar)
- **Impresoras físicas:** cocina · barra · caja/recibo
- **Sin KDS:** `cocina.html` existe pero NO se usa — los pedidos van a impresoras

---

## PINS DEL SISTEMA

| PIN | Valor | Para qué |
|-----|-------|----------|
| Gerentes (Omar/Tony/Cha) | `2517` | Entrar al POS, autorizar descuentos/cortesías/cancelaciones |
| Administrador (`PIN_ADMIN`) | `1234` | Reportes · Cambiar menú/config |

> ⚠️ Los PINs de gerentes están hasheados (HMAC-SHA256). Se auto-migran en el primer login.  
> Si Reportes dice "Demasiados intentos": espera 1 minuto (rate limit Redis) y entra con `1234`.

---

## VARIABLES DE ENTORNO (Vercel → instinto-sistema-cobranza)

| Variable | Notas |
|----------|-------|
| `API_SECRET` | Encriptado. No cambiar. |
| `PIN_ADMIN` | `1234` — pendiente cambiar |
| `KV_REST_API_URL` | `https://cool-toad-149285.upstash.io` |
| `KV_REST_API_TOKEN` | Encriptado |

---

## ARQUITECTURA DE DATOS (Redis)

```
i:cmd              → comandas abiertas
i:vta              → ventas cerradas
i:vta:wal          → Write-Ahead Log — cobros individuales antes del bulk save
i:vta:bak:HHHH     → Snapshots horarios, TTL 48h
i:mes              → meseros
i:canc             → cancelaciones
i:lastUpdate       → timestamp para polling multi-tablet
i:gerentes         → Omar, Tony, Cha (PIN hasheado)
i:empleados        → catálogo empleados con salarioDia
i:turnos:YYYY-MM-DD → turnos por día (TTL 90 días)
i:gastos           → gastos operativos
i:menu             → menú configurable
i:printjobs        → cola de impresión (LPOP atómico)
i:barra_cats       → categorías de barra (configurable; si no existe, usa el default hardcodeado)
i:guardar:lock     → mutex Redis para serializar saves (TTL 5s)
rl:*               → rate limiting (TTL auto-expirado)
inv:*              → inventarios (compartido con instinto-inventario)
```

---

## NOTA CRÍTICA: SSE EN VERCEL SERVERLESS

`broadcastChange()` usa un Set en memoria por invocación. En Vercel, `/api/guardar` y `/api/sync` corren en invocaciones distintas — el push SSE entre tablets **no funciona**. El mecanismo real de sync multi-tablet es el **polling cada 15 segundos** (`/api/lastUpdate`). El SSE sigue conectado pero solo recibe sus propios heartbeats. Esto es normal y esperado — no intentar "arreglar" el SSE sin migrar a Redis Pub/Sub.

---

## BUGS CORREGIDOS (sesión 25 jun 2026 — segunda ronda)

### Commit `9c6c533`
- Tablets desactualizadas re-abrían cuentas cobradas → `clientCmd` filtrado vs `vtaIds`
- Heartbeat SSE como dato real `{"type":"hb"}` (antes era comentario, invisible para el cliente)
- Polling cada 15s activo siempre
- Carga inicial filtra comandas del servidor vs ventas locales

### Commit `0cb8298`
- **Mutex Redis** en `/api/guardar`: una tablet a la vez (previene race condition)
- **WAL safeguard**: ltrim en bloque separado + retry + cap automático 200 entradas
- **`walMerge`**: `Array.isArray()` — dato corrupto en Redis ya no tira el servidor
- **`normalizarFecha`**: `isNaN` guard — venta con ID inválido ya no rompe reportes
- **Panel admin `turnos.html`**: timeout 5 min por inactividad (`cerrarSesionAdmin()`)
- **Token 401**: cierra todos los modales antes de mostrar PIN gate

### Commit `bd3e344`
- Carga inicial recupera comandas abiertas del localStorage que el servidor no tenía
- `BARRA_CATS` sincronizada servidor↔cliente via `/api/datos` (impresoras ruteando bien)
- `currentCanal` (delivery) persiste en localStorage entre recargas y tablets
- `cargarEmpleadosAdmin()` trae datos frescos del servidor — dos tabs ya no se pisan

### Sesión 25 jun — tercera ronda (pendiente push)
- **B9**: Corregido comentario heartbeat (decía "30s", código es "25s")
- **B18**: `enviarRecibo` guarda `firstErr` — muestra el error original, no el del último reintento
- **B20**: Confirmado resuelto — `BARRA_CATS_FRONT` se actualiza desde servidor en `/api/datos`
- **B24**: 3 `setInterval` globales asignados a `_autoSaveInterval`, `_tokenCheckInterval`, `_pollingInterval` + `pagehide` listener para bfcache
- **B25**: SW navegación cambia de cache-first a network-first → deploy llega en 1 recarga
- **B26**: SW valida content-type en API calls → HTML 500 de Vercel ya no rompe JSON.parse
- **B13, B17, B21**: Won't fix — B13: riesgo teórico en POS interno; B17: dos tabs mismo browser no es escenario real; B21: lock timer no debe resetear en SSE (correcto por seguridad)

### Commits anteriores (sesión 25 jun — primera ronda)
- Race condition comandas, propinas en pago mixto, token 401, descuento empleado
- CORS restringido, rate limit en Redis, PINs hasheados, costoTotal prorateado
- `porFormaPago` en reportes, `cargarResumen` stale, SSE heartbeat, `_loggedCanc`

---

### Sesión 26 jun 2026 — bug precios multi-tablet
- **B27 ✅**: Cambios de precio no se propagaban a otros tablets. `POST /api/menu` ahora también escribe `i:menuUpdate` en Redis. `GET /api/lastUpdate` ahora retorna `{ts, menuTs}`. El polling cada 15s compara `menuTs` y llama `cargarMenuRemoto()` + `initMenu()` si detecta cambio — precios se sincronizan en ≤15s entre todos los dispositivos.

### Sesión 26 jun 2026 — pérdida de comandas y productos (4ª vez reportado)
- **B28 ✅ (productos desaparecen)**: En el handler de 409 de `guardar()`, se llamaba `cargarDatos(true)`. Dentro del merge, si una comanda ya existía en el servidor (aunque con ítems viejos), se pisaba con la versión del servidor y los ítems nuevos que el mesero había agregado se perdían. Fix: `_preferirLocal()` en el merge — si la versión local de una comanda tiene MÁS ítems que la del servidor, se usa la local.
- **B29 ✅ (comandas/datos corruptos)**: `guardar()` no tenía guard de re-entrada. El auto-save de 5 min podía dispararse mientras ya había un `guardar()` en vuelo, creando 2 saves simultáneos. El `finally` del primero liberaba `_guardandoAhora=false` antes de que el segundo terminara, permitiendo que el polling interfiriera con datos parcialmente escritos. Fix: guard de re-entrada con flag `_pendingGuardar` — si ya hay un save en vuelo, el nuevo se encola y ejecuta al terminar el actual.
- **B30 ✅ (crash silencioso)**: El `fetch` interno de sync dentro de `cargarDatos(true)` (cuando hay soloLocales) no tenía try-catch. Un 409 ahí propagaba el error y dejaba el estado en un limbo. Ahora envuelto en try-catch.

### Sesión 26 jun 2026 — segunda ronda (bugs descubiertos en operación real)

- **B31 ✅ (conflicto 409 ruidoso)**: El toast "Conflicto de sync — recargando datos..." aparecía en el área de meseros al guardar simultáneamente. Era correcto en lógica pero alarmante. Ahora es silencioso (solo `console.warn`). Commit `92e9d23`.

- **B32 ✅ (precios no guardan — causa raíz)**: `guardarMenuAdmin()` usaba `pedirPin()` que valida contra `/api/validate-pin`. Ese endpoint tiene rate limit compartido con todos los dispositivos de la misma IP. Con 3 tablets, el límite de 10/min se agotaba bloqueando la validación silenciosamente — el callback de guardado nunca se ejecutaba. Además, los gerentes usan PIN 2517 pero el menú pedía PIN de admin (1234): dos PINs distintos que se confundían. Fix: `guardarMenuAdmin()` y `guardarMenuDelivery()` ahora usan directamente `X-API-Key: API_KEY` (el gerente ya está autenticado para estar en el tab Config). El backend acepta token JWT O PIN admin. Commit `0424160`.

- **B33 ✅ (rate limiter cascada — bloqueaba login, impresión y todo)**: El rate limiter usaba una sola clave por IP para TODOS los endpoints de auth. 10 intentos fallidos en cualquier endpoint (tablets recargando, meseros probando PINs) bloqueaba también el login de gerente (`/api/gerentes/validar`), el gate inicial (`/api/auth`) y el guardado de menú. Sin `API_KEY` válida, las impresiones también fallaban (usan `requireAuth`). Fix: clave de rate limit ahora incluye el endpoint (`rl:{ip+route}:{window}`). Límite subido de 10 a 30/min. Commit `90ebd31`.

- **B34 ✅ (ID duplicado `#pinError` — errores del gate invisible)**: `#pinGate` y `#modalPinGenerico` ambos tenían `id="pinError"`. `getElementById` devuelve el primero en el DOM (el del modal), así que el gate nunca mostraba sus errores. Renombrado a `#pinGateError` en el gate. Commit `73a0a39`.

- **B35 ✅ (429 confundido con PIN incorrecto)**: Al rate-limitar, el servidor devuelve 429 pero el frontend mostraba "PIN incorrecto". El usuario reintentaba → empeoraba el rate limit. Ahora muestra "Demasiados intentos — espera 1 minuto" correctamente en gate y lock screen. Commit `73a0a39`.

---

## BUGS PENDIENTES

Todos los bugs conocidos han sido corregidos. Sistema limpio.

| # | Decisión | Razón |
|---|----------|-------|
| B13 | Won't fix | Rate limit fija es suficiente para POS interno — sliding window es over-engineering |
| B17 | Won't fix | Dos tabs del mismo POS en el mismo browser no es un escenario real |
| B21 | No es bug | Lock timer NO debe resetear en SSE — solo interacción humana (correcto por seguridad) |

---

## PENDIENTE ÚNICO DE INFRAESTRUCTURA

| Item | Acción |
|------|--------|
| Proyecto `instinto-pos` huérfano en Vercel | Manual: Vercel → instinto-pos → Settings → Delete Project |
| PIN_ADMIN `1234` | Cambiar a algo más seguro en Vercel env vars |
| Caja → iPad | Probar sw.js + modales táctiles en Safari/iOS |

---

## PARA ARRANCAR LA PRÓXIMA SESIÓN

Di: **"continuemos con el POS"** → cargo este handoff automáticamente.

```bash
cd ~/Desktop/instinto-pos
npm start
# http://localhost:3001
```

Tests rápidos de sanidad:
1. **Sync:** 2 browsers → mesero agrega comanda → caja la ve en <30s
2. **Cobro mixto:** Mesa $300, tarjeta $100 → propina 15% = $45
3. **Reportes:** Forma de pago muestra Efectivo/Tarjeta/Débito reales
4. **Impresoras:** Refresco → barra ✓ | Hamburguesa → cocina ✓
5. **Turnos panel admin:** inactivo 5 min → pide PIN de nuevo
6. **Precio:** Config → Menú base → cambiar precio → Guardar → refrescar → precio nuevo ✓ (sin pedir PIN)
7. **Gerente login:** seleccionar nombre → PIN 2517 → entra sin error
