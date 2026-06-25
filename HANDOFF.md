# HANDOFF — POS INSTINTO
**Última actualización:** 25 junio 2026  
**Commit activo:** `6ccd4f8`  
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

## PINS DEL SISTEMA

| PIN | Valor | Para qué |
|-----|-------|----------|
| Gerentes (Omar/Tony/Cha) | `2517` | Entrar al POS, autorizar descuentos/cortesías/cancelaciones |
| Administrador (`PIN_ADMIN`) | `1234` | Entrar a 📋 Reportes · Cambiar menú/config |

> ⚠️ Los PINs de gerentes ahora están hasheados (HMAC-SHA256). Se auto-migran en el **primer login** — no hay que hacer nada.  
> Si Reportes dice "Demasiados intentos": espera 1 minuto (rate limit en Redis) y entra con `1234`.

---

## VARIABLES DE ENTORNO (Vercel → instinto-sistema-cobranza)

| Variable | Notas |
|----------|-------|
| `API_SECRET` | Encriptado. No cambiar. |
| `PIN_ADMIN` | `1234` — pendiente cambiar a algo más seguro |
| `KV_REST_API_URL` | `https://cool-toad-149285.upstash.io` |
| `KV_REST_API_TOKEN` | Encriptado |

---

## ARQUITECTURA DE DATOS (Redis)

```
i:cmd              → comandas abiertas
i:vta              → ventas cerradas (con merge de WAL en cada escritura)
i:vta:wal          → Write-Ahead Log — cobros individuales antes del bulk save
i:vta:bak:HHHH     → Snapshots horarios, TTL 48h
i:vta:archivo:YYYY-MM → Ventas archivadas >90 días
i:mes              → meseros: SAM, MONTSE, DANI, OMAR, TONE
i:canc             → cancelaciones
i:lastUpdate       → timestamp para polling multi-tablet
i:gerentes         → Omar, Tony, Cha (PIN hasheado HMAC-SHA256)
i:empleados        → catálogo de empleados con salarioDia
i:turnos:YYYY-MM-DD → turnos por día (TTL 90 días)
i:gastos           → gastos operativos
i:menu             → menú configurable (TTL 90 días)
i:printjobs        → cola de impresión (LPOP atómico)
inv:*              → inventarios (compartido con instinto-inventario)
rl:*               → rate limiting Redis (TTL auto-expirado)
```

---

## ESTADO DEL SISTEMA

| Área | Estado |
|------|--------|
| Sync multi-tablet | ✅ WebSocket + SSE + fallback polling 30s |
| Persistencia de precios | ✅ localStorage + Redis 90d TTL |
| Comandas perdidas | ✅ Resuelto (flag `_guardandoAhora` + merge backend) |
| Propinas en pago mixto | ✅ Calculadas sobre total de cuenta, no sobre tarjeta |
| Token de sesión | ✅ Se renueva 2 min antes de expirar (check cada 10 min) |
| SSE conexión muerta | ✅ Heartbeat 15s, reconecta si 45s sin mensaje |
| Descuento empleado | ✅ Solo aplica a ítems con categoría de alimento |
| Dropdown gerentes vacío | ✅ Auto-recarga si cache vacía al abrir cobro |
| Duplicados en reporte canc. | ✅ `_loggedCanc=true` en cancelación completa |
| CORS | ✅ Restringido a dominio de producción + localhost |
| Rate limiting | ✅ Redis cross-instance (antes era in-memory, no funcionaba en Vercel) |
| PINs gerentes | ✅ HMAC-SHA256 + pepper; legacy se migra en primer login |
| costoTotal en turnos | ✅ Prorateado por horas trabajadas (jornada base 8h) |
| porFormaPago en reportes | ✅ Ahora lee `v.pago` (antes leía `v.formaPago` → siempre "Efectivo") |
| cargarResumen() stale | ✅ await cargar() antes de calcular resumen |
| Consumo Vercel | ✅ ~400k req/mes (cocina 10s, caja 15s) |

---

## ÚNICO PENDIENTE

| Item | Acción |
|------|--------|
| Proyecto `instinto-pos` huérfano en Vercel | Manual: Vercel → instinto-pos → Settings → Delete Project |

No hay bugs conocidos en el sistema.

---

## HISTORIAL DE COMMITS (sesión 25 jun 2026)

| Commit | Qué |
|--------|-----|
| `c86a686` | Race condition comandas: flag `_guardandoAhora` + merge backend + ventana 30s |
| `9084453` | Propinas mixto + token 401 + sync tablet pendiente |
| `de1f358` | Ronda 2: descuento empleado, gerentes vacíos, SSE heartbeat, `_loggedCanc` |
| `7e6e276` | Infraestructura: CORS, rate limit Redis, PINs hash, costoTotal prorateado |
| `6ccd4f8` | Auditoría final: porFormaPago fix + cargarResumen stale |

---

## PARA ARRANCAR LA PRÓXIMA SESIÓN

Di: **"continuemos con el POS"** → cargo este handoff automáticamente.

```bash
cd ~/Desktop/instinto-pos
npm start
# http://localhost:3001
```

Tests rápidos de sanidad:
1. **Sync:** 2 navegadores → mesero agrega comanda → caja la ve en <100ms
2. **Cobro mixto:** Mesa $300, tarjeta $100 → propina 15% debe ser $45 (no $15)
3. **Reportes:** `reportes.html` → Forma de pago debe mostrar Efectivo/Tarjeta/Débito reales (no todo "Efectivo")
4. **Turnos:** Costo estimado debe subir gradualmente conforme pasan las horas (no mostrar salario completo desde el inicio)
