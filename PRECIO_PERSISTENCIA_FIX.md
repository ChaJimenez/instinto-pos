# FIX: Precios editados se mantienen entre sesiones

## Problema reportado
"Cuando edito un precio puedo trabajar ese día bien pero al otro día que arranco, los precios vuelven al valor original. Los productos nuevos sí se mantiene con el precio actualizado."

## Causa raíz identificada

**Dos fuentes de verdad incompatibles:**

1. **Cliente (Hardcodeado)** — MENU comienza con valores fijos en línea 1167
2. **Servidor (Redis)** — `i:menu` key sin TTL adecuado

**Flujo fallido:**
```
Editar precio
  ↓
Guardar a Redis
  ↓
Usuario vuelve al día siguiente
  ↓
cargarMenuRemoto() intenta fetch /api/menu
  ↓
Si Redis perdió datos → devuelve {menu: null}
  ↓
MENU nunca se actualiza → vuelve al hardcodeado
  ↓
Precios perdidos ❌
```

## Solución implementada

### 1. Persistencia en localStorage (Cliente)
Cada vez que se editan precios, se guardan en `localStorage.i_menu_cache`:

```javascript
// En 3 lugares:
- cargarMenuRemoto() — Al cargar page
- guardarMenuAdmin() — Al guardar menú base
- guardarMenuDelivery() — Al guardar precios delivery

localStorage.setItem('i_menu_cache', JSON.stringify({categorias:MENU, extras:EXTRAS}));
```

### 2. Fallback a localStorage (Cliente)
Si Redis devuelve `null`, restaura desde localStorage:

```javascript
if (d.menu && d.menu.categorias) {
  MENU = d.menu.categorias;  // ← Servidor tiene datos
} else {
  // ← Servidor no tiene datos
  const cached = localStorage.getItem('i_menu_cache');
  if (cached) {
    MENU = JSON.parse(cached).categorias;
    console.warn('⚠ Menú restaurado desde caché local');
  }
}
```

### 3. TTL más largo en Redis (Servidor)
Menú ahora persiste 90 días (no debería expirar en uso normal):

```javascript
await kv.set(MENU_KEY, {...}, { ex: 60 * 60 * 24 * 90 });
```

## Flujo después del fix

```
Editar precio
  ↓
Guardar a Redis + localStorage
  ↓
Usuario vuelve al día siguiente
  ↓
cargarMenuRemoto() intenta fetch /api/menu
  ↓
Si Redis tiene datos → Carga desde Redis ✅
Si Redis perdió datos → Fallback a localStorage ✅
  ↓
Precios se mantienen ✅
```

## Testing

### Test 1: Editar precio y recargar misma sesión
1. Ir a Admin → Editar menú
2. Cambiar un precio (ej: Cheeseburger $95 → $100)
3. Guardar con PIN
4. Recargar página (F5)
5. **Verificar:** Precio debe ser $100

### Test 2: Editar precio y volver al día siguiente
1. Editar precio (ej: Corona $60 → $65)
2. Guardar
3. Cerrar navegador
4. **Esperar 24h O simular:**
   - Abrir DevTools → Application → Storage → Local Storage
   - Buscar `i_menu_cache`
   - Verificar que está ahí
5. Reabrir navegador
6. **Verificar:** Precio debe ser $65

### Test 3: Verificar localStorage después de guardar
1. Editar menú
2. Abrir DevTools (F12) → Application → Local Storage
3. Buscar clave `i_menu_cache`
4. **Verificar:** 
   - Clave existe
   - Contiene JSON con `{categorias: {...}, extras: [...]}`
   - Timestamp `i_menu_cache_ts` es reciente

### Test 4: Simular pérdida de Redis
1. Abrir DevTools → Console
2. Ejecutar: `localStorage.setItem('i_menu_cache', '{"categorias":{"Test":[{"n":"Burger Test","p":999}]},"extras":[]}')`
3. Hacer fetch manual: `fetch('/api/menu').then(r=>r.json()).then(console.log)`
4. **Verificar:** Si devuelve `{menu: null}`, recargar página
5. **Resultado:** Menú debe mostrar "Burger Test" a $999 (desde localStorage)

## Impacto

| Escenario | Antes | Después |
|-----------|-------|---------|
| Editar precio → recargar | ❌ Pierde | ✅ Se mantiene |
| Editar precio → nuevo día | ❌ Pierde | ✅ Se mantiene |
| Redis se reinicia | ❌ Pierde | ✅ Fallback a localStorage |
| Sin conexión a Redis | ❌ Pierde | ✅ Usa caché local |

## Notas técnicas

- **localStorage.i_menu_cache**: Respaldo permanente (nunca expira)
- **Redis i:menu**: Persistencia principal (90 días de TTL)
- **Cliente MENU hardcodeado**: Fallback final si ambos fallan
- **Tres niveles de redundancia:** Redis → localStorage → hardcodeado

## Si algo sigue sin funcionar

1. Abrir DevTools → Console → Buscar mensajes de error
2. Si ves `⚠ Menú restaurado desde caché local` → localStorage funcionando
3. Si ves `🔄 Sync en background` → WebSocket/SSE funcionando
4. Reportar exactamente qué precio se perdió y en qué contexto

