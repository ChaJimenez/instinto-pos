# HANDOFF — POS INSTINTO · Revisión de Seguridad + Bug de cuentas perdidas
**Última actualización:** 17 junio 2026 · sesión matutina
**Sesión anterior:** 16 junio 2026 · Revisión profunda de bugs + fixes de seguridad

---

## ESTADO GENERAL

Sistema POS funcionando en producción. Hoy se hizo revisión profunda de código y se corrigieron los 3 bugs más críticos. El sistema requiere PIN `1234` al abrir (pendiente cambiarlo a algo más seguro).

**URL activa:** https://instinto-sistema-cobranza.vercel.app
**Proyecto Vercel:** `instinto-sistema-cobranza` ← aquí van los env vars, NO en `instinto-pos`
**Repo:** `ChaJimenez/instinto-pos` — push a `main` = deploy automático

---

## LO QUE SE CORRIGIÓ HOY ✅ (17 junio 2026)

### 6. Cuentas de la noche que no aparecen en el reporte (CRÍTICO operativo)
- **Causa raíz:** Si durante la noche fallaba un `guardar()` por red inestable, la venta quedaba en localStorage pero no en Redis. Al recargar la página, `cargarDatos()` pisaba localStorage con el estado del servidor → pérdida permanente de datos.
- **Fix 1:** `cargarDatos()` ahora hace merge de ventas locales en la carga inicial (igual que en recarga), recuperando cualquier venta que no haya llegado al servidor. Si detecta ventas recuperadas, muestra un toast y las sincroniza al servidor automáticamente.
- **Fix 2:** Todos los filtros de fecha ahora usan `v.fecha` (campo guardado explícitamente en locale) en lugar de `v.id` (timestamp sensible a zona horaria entre dispositivos). Esto afecta `renderReporte`, `generarTextoCierre`, `exportarReporteCSV`, `renderCierre`, `verCierreParcial` y `descargarCierreParcial`.

---

## LO QUE SE CORRIGIÓ EN LA SESIÓN ANTERIOR ✅ (16 junio 2026)

### 1. API_KEY expuesta en código fuente (CRÍTICO)
- **Antes:** `const API_KEY = 'instinto-pos-2026'` visible para cualquiera en DevTools
- **Ahora:** Modal de PIN al abrir el POS → servidor genera token HMAC-SHA256 con TTL 12h
- El token se guarda en `sessionStorage` — solo pide PIN una vez por sesión

### 2. Sin rate limiting en endpoints de PIN (CRÍTICO)
- **Antes:** Podías adivinar el PIN en segundos con un script
- **Ahora:** Máximo 10 intentos por minuto por IP en `/api/auth`, `/api/validate-pin` y `/api/gerentes/validar`

### 3. Zona horaria incorrecta en alertas de inventario (MEDIO)
- **Antes:** `toISOString()` usaba UTC → después de las 7 PM México los días faltantes eran incorrectos
- **Ahora:** `toLocaleDateString('sv-SE', { timeZone: 'America/Mexico_City' })`

### 4. KDS — índices se desplazaban al cancelar ítems (CRÍTICO operativo)
- **Antes:** Si cocina marcaba un ítem como "listo" y luego alguien lo cancelaba, el checkmark quedaba en el ítem equivocado
- **Ahora:** Los ítems se identifican por su posición original en `cmd.items` — estable ante cancelaciones

### 5. XSS en pantalla de cocina (MEDIO)
- **Antes:** Nombres de platillo y notas iban directo a `innerHTML`
- **Ahora:** Función `esc()` agregada, todos los datos del usuario escapados

---

## PENDIENTE — PRÓXIMA SESIÓN 🔜

> **Nota sobre cuentas de anoche:** Si la página fue recargada antes de este fix, las cuentas perdidas ya no se pueden recuperar automáticamente (localStorage fue sobreescrito con el estado del servidor). El fix previene futuros casos, pero no recupera datos ya perdidos.



### Pendiente operativo (cuando quieras)
| Bug | Impacto | Archivo |
|-----|---------|---------|
| PIN_ADMIN `1234` → cambiar a algo más seguro | Seguridad media | Vercel env vars |
| `costoTotal` en turnos no proratea por horas | Dato incorrecto en nómina | `turnos.html:325` |
| XSS en `reportes.html` | Seguridad media | `reportes.html` |
| Ventana de conflicto sync 1 segundo (2 tablets simultáneos) | Pérdida silenciosa de datos | `api/index.js:64` |
| CORS abierto a todos los orígenes | Seguridad baja | `api/index.js:11` |
| PINs de gerentes en plaintext en Redis | Seguridad baja | `api/index.js:220` |

### Para verificar en el restaurante (Windows)
- Confirmar que el PIN modal funciona en las tablets
- Confirmar que el KDS de cocina ya no desplaza ítems al cancelar
- Confirmar que los datos de inventario muestran fechas correctas después de las 7 PM

---

## VARIABLES DE ENTORNO (proyecto instinto-sistema-cobranza)

| Variable | Estado | Notas |
|----------|--------|-------|
| `API_SECRET` | ✅ Configurado | Desde mayo 2026. No cambiar. |
| `PIN_ADMIN` | ⚠️ `1234` | Funciona pero es inseguro. Pendiente cambiar. |
| `KV_REST_API_URL` | ⚠️ Needs Attention | Ya estaba así antes de hoy |
| `KV_REST_API_TOKEN` | ⚠️ Needs Attention | Ya estaba así antes de hoy |

---

## PARA ARRANCAR LA PRÓXIMA SESIÓN

Di: **"continuemos con el POS"** y cargo este handoff automáticamente.

Si quieres continuar con los bugs pendientes: **"corrige los bugs pendientes del POS"**
Si quieres cambiar el PIN: **"cambia el PIN del POS"**

---

## CONTEXTO DELIVERY (sesión anterior — 30 mayo 2026)

Meta junio 2026:
- Uber Eats: **$100,000 MXN** ← precios actualizados, campañas optimizadas
- Rappi: **$50,000 MXN** ← pendiente análisis dashboard
- DiDi Food: **$25,000 MXN** ← pendiente análisis dashboard

Estado: **UE listo. Faltan Rappi y DiDi.**
Di: "análisis Rappi" o "análisis DiDi" y adjunta screenshots del dashboard.
