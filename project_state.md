# Estado del Proyecto — POS Instinto
**Última actualización:** 17 junio 2026 · noche
**Commit activo:** `5a8c978` · Branch: `main` · Deploy: Vercel auto

---

## Qué hicimos hoy

### Sesión mañana (commit `cd1f1a4`)
- Fix bug raíz cuentas perdidas: `cargarDatos()` ahora mergea localStorage antes de pisar con servidor
- Filtros de fecha ahora leen `v.fecha` en lugar de `v.id`
- WAL (Write-Ahead Log): cada cobro se escribe atómicamente en Redis antes del bulk save
- Snapshots horarios con TTL 48h + endpoint de restauración
- Auto-save cada 5 minutos en frontend

### Sesión tarde (commit `1375531`)
- Fix bug #8: reporte mostraba $233k (todas las ventas históricas) — causa: fecha sin cero de mes → Invalid Date → NaN pasaba todos los filtros
- Fix: `toLocaleDateString('sv-SE')` siempre produce `YYYY-MM-DD`; `padStart(2,'0')` en parseo DD/MM/YYYY

### Sesión noche (commit `5a8c978`)
- **Pantalla de bloqueo + roles:** meseros y gerentes con acceso diferenciado. Meseros ven solo Mapa y Comanda; gerentes (PIN de Redis) ven todo. Auto-lock 5 minutos
- **Sugerencias del mapa:** 100% dinámicas desde MENU de Redis. Muestra top 3 más vendidos hoy con precios reales. Elimina hardcoded desactualizados
- **238k en reporte (raíz real):** service worker v5 servía HTML viejo. Bumped a v6 + auto-reload `20260617-2` para forzar recarga limpia
- **`setRangoReporte`:** timezone `America/Mexico_City` explícito — ya no falla en dispositivos UTC
- **WAL en `/api/reportes`:** mergea WAL antes de filtrar → cobros recientes siempre visibles
- **Deliverect webhook:** fecha en `sv-SE` (consistente)
- **XSS en `reportes.html`:** `esc()` en todos los innerHTML con datos de usuario

---

## Decisiones tomadas

| Decisión | Razonamiento |
|----------|--------------|
| Roles sin PIN para meseros | Más ágil en servicio; el PIN admin se pide 1 vez al día por el gerente |
| Auto-lock 5 min | Balance entre seguridad y no molestar durante el servicio |
| Sugerencias dinámicas del top-vendido-hoy | Siempre refleja lo que está pasando en el turno actual |
| Bump service worker a v6 | Sin esto, los fixes de código nunca llegan a los dispositivos con caché |

---

## Próximos pasos (por prioridad)

1. **Verificar en restaurante** — pantalla de bloqueo carga con nombres de meseros; sugerencias muestran ítems reales
2. **Cambiar PIN_ADMIN** de `1234` a algo seguro — Vercel → Settings → Env Vars
3. **`costoTotal` en turnos** — no proratea por horas trabajadas (`turnos.html:325`)
4. **CORS restringido** — limitar a dominio de producción (`api/index.js:12`)
5. **Hash PINs de gerentes** — actualmente en plaintext en Redis

---

## Riesgos detectados

| Riesgo | Nivel | Notas |
|--------|-------|-------|
| Primera apertura con v6: si la tablet no tiene internet no descarga el SW nuevo | Bajo | Solo aplica offline total; en restaurante hay WiFi |
| Gerentes sin PIN configurado no pueden entrar a reportes | Bajo | Verificar que todos los gerentes estén en Config → Equipo → Gerentes |
| Rate limiting en memoria no funciona cross-instance Vercel | Bajo | Mitigado por token HMAC firmado de 12h |
