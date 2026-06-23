# TESTING GUIDE — WebSocket Sync Implementation

## Escenarios de prueba

### 1. ESCENARIO: Mesero comanda mientras caja edita
**Objetivo:** Verificar que la comanda se sincroniza SIN interrumpir la edición de la caja

**Pasos:**
1. Abrir `http://localhost:3001` en Navegador A (Mesero)
2. Abrir `http://localhost:3001` en Navegador B (Caja)
3. En Navegador B (Caja):
   - Hacer clic en "Abrir Comanda"
   - Agregar 2-3 items al carrito (NO guardar)
4. En Navegador A (Mesero):
   - Seleccionar mesa "3"
   - Agregar items y guardar comanda
5. **Verificación:**
   - ✅ En Navegador B, los items del mesero aparecen SIN interrumpir la edición
   - ✅ El sync-dot (verde) parpadeó indicando actualización en background
   - ✅ Cuando caja termina edición y guarda, ambas comandas se sincronizaron

**Esperado:** Mensaje en console: "🔄 Sync en background (no interrumpemos edición)"

---

### 2. ESCENARIO: Sincronización en tiempo real (<100ms)
**Objetivo:** Verificar que WebSocket funciona con latencia mínima

**Pasos:**
1. Abrir DevTools en ambos navegadores (F12)
2. Ir a Network → filtrar WS para ver WebSocket
3. Mesero agrega una comanda rápidamente
4. **Verificación:**
   - ✅ En Network, ver mensaje WebSocket con `type: 'sync'`
   - ✅ Caja recibe evento en < 100ms (timeline en DevTools)

---

### 3. ESCENARIO: Conflicto 409 se resuelve automáticamente
**Objetivo:** Verificar que dos tablets pueden guardar simultáneamente sin perder datos

**Pasos:**
1. En Navegador A y B, ambos abiertos en "Comanda Abierta" de la misma mesa
2. Ambos agregan items DIFERENTES a la misma comanda
3. A: Hace clic "Guardar"
4. B: Hace clic "Guardar" inmediatamente después (antes de que A termine)
5. **Verificación:**
   - ✅ B recibe "⚠ Conflicto de sync"
   - ✅ B recarga datos del servidor
   - ✅ B re-intenta guardar automáticamente (después de 1s)
   - ✅ Ambos items (de A y B) están en la comanda final

**NO debe ocurrir:** Pérdida de items de ninguno de los dos

---

### 4. ESCENARIO: Fallback a polling si WebSocket falla
**Objetivo:** Verificar que el sistema degrada gracefully sin WebSocket

**Pasos:**
1. Abrir DevTools → Network
2. Buscar y bloquear conexión WS (Network → XHR+WS → desactivar)
3. Recargar navegador
4. Mesero agrega comanda
5. **Verificación:**
   - ✅ Console debe mostrar "WS no disponible: [error], fallback a SSE"
   - ✅ Caja EVENTUALMENTE ve la comanda (máximo 30s de polling fallback)
   - ✅ Sistema sigue siendo funcional

---

### 5. ESCENARIO: Cobro (WAL) se sincroniza
**Objetivo:** Verificar que cobros nunca se pierden

**Pasos:**
1. Crear comanda en Mesa 5
2. En Network de DevTools, simular que `/api/guardar` después de cobro devuelve error (throttle)
3. Mesero clic "Cobrar" y elige método de pago
4. Mientras se procesa pago, desconectar (Network → Offline)
5. Reconectar después de 5 segundos
6. **Verificación:**
   - ✅ Cobro está en localStorage (guardado antes de guardar())
   - ✅ WAL contiene el cobro incluso si guardar() falló
   - ✅ Al reconectar, cobro se sincroniza automáticamente

---

### 6. ESCENARIO: Servidor Vercel (SSE sin WebSocket)
**Objetivo:** Verificar que SSE funciona en Vercel

**Pasos:**
1. Hacer deploy a Vercel
2. Verificar que `/api/sync` responde con tipo `text/event-stream`
3. Conectar desde navegador: verificar que EventSource se abre
4. Hacer comanda: verificar que evento llega

**Verificación en Vercel:**
```bash
curl -s -N "https://instinto-pos.vercel.app/api/sync?token=YOUR_TOKEN" | head -5
```
Debe mostrar: `:connected` seguido de eventos SSE

---

## Checklist de verificación

- [ ] Local WebSocket funciona (ws://localhost:3001/api/ws)
- [ ] Mesero→Caja sincroniza < 100ms
- [ ] Edición no se interrumpe cuando llega comanda
- [ ] Conflicto 409 se resuelve automáticamente
- [ ] WAL preserva cobros sin perder
- [ ] Fallback a polling funciona si WS no disponible
- [ ] SSE en Vercel funciona (token en query)
- [ ] DevTools → Console limpia (sin errores)
- [ ] Sync-dot cambia de color indicando estado

---

## Debug Commands

**Ver si WebSocket se conectó:**
```javascript
// En DevTools Console
console.log(_syncConn); // Debe mostrar WebSocket object
```

**Simular error de red:**
```javascript
// En DevTools Console
_syncConn.close(); // Cierra WebSocket
// Sistema debe degradar a SSE/polling
```

**Ver últimos eventos de sync:**
```javascript
// Agregar a index.html (temporal):
const _syncLog=[];
// En handleSyncEvent():
_syncLog.push({ts:Date.now(),type:msg.type,data:msg.data});
console.log(_syncLog); // Ver
```

---

## Notas de performance

- **Local WebSocket:** 50-100ms latencia
- **Vercel SSE:** 200-500ms latencia (depende de región)
- **Fallback polling:** 30s (máximo aceptable para caja)
- **Auto-save:** Cada 5 minutos (respaldo)

Si latencia > 1000ms en cualquier modo, revisar:
1. Conexión de red (speedtest)
2. Carga del servidor (herramientas de Vercel/local)
3. Browser DevTools → Performance
