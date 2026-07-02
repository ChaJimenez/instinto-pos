# CLAUDE.md — Instinto Sistema de Cobranza (POS)

## Project Overview

Restaurant point-of-sale (POS) system for "Instinto — Operadora Chapa". Built with vanilla JavaScript (no framework), deployed on Vercel with an Upstash Redis backend and a local Node.js print server for thermal printers.

## Repository Structure

```
instinto-sistema-cobranza/
├── public/
│   └── index.html        # Entire frontend: HTML + CSS + JS (~2400 lines)
├── api/
│   └── index.js          # Express REST API (Vercel serverless function)
├── print-server/
│   ├── server.js         # Local TCP print server for thermal printers
│   └── package.json
├── package.json          # Root deps: express, @upstash/redis, vercel
└── vercel.json           # Routing: /api/* → api/index.js, /* → index.html
```

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (no framework, no build step) |
| Backend | Node.js + Express (Vercel serverless) |
| Database | Upstash Redis (cloud key-value store) |
| Deployment | Vercel |
| Print | Local Node.js TCP server → ESC/POS → thermal printers |

## Development Commands

```bash
# Install dependencies
npm install

# Run locally with Vercel dev emulation (requires Vercel CLI)
npm run dev          # runs: vercel dev

# Run local server directly (no Vercel emulation)
npm start            # runs: node api/server-local.js

# Run the local print server (on restaurant's machine)
cd print-server && node server.js
```

## Environment Variables

These must be set in Vercel dashboard (or a `.env.local` file locally):

| Variable | Description |
|---|---|
| `KV_REST_API_URL` | Upstash Redis REST endpoint URL |
| `KV_REST_API_TOKEN` | Upstash Redis auth token |
| `PIN_ADMIN` | Admin PIN (defaults to `'1234'` in code) |

`.env.local` is gitignored. Never commit secrets.

## API Endpoints

All served from `api/index.js` under `/api/`:

| Method | Path | Description |
|---|---|---|
| GET | `/api/datos` | Load all data (comandas, ventas, meseros, cancelaciones) |
| POST | `/api/guardar` | Save all data to Redis |
| GET | `/api/lastUpdate` | Polling timestamp for multi-device sync |
| POST | `/api/importar` | Import backup JSON (PIN-protected) |
| POST | `/api/imprimir` | Queue kitchen/bar order ticket |
| POST | `/api/imprimir-recibo` | Queue receipt print job |
| GET | `/api/print-queue` | Fetch and clear the print queue |
| GET | `/health` | Health check |

## Frontend Architecture

The entire frontend lives in `public/index.html` as a single-file SPA. There is no build process — edits go directly to this file.

### Tab Sections

| Tab | Spanish Name | Purpose |
|---|---|---|
| Caja | Caja | Active order / POS interface |
| Abiertas | Órdenes Abiertas | View/manage open table orders |
| Comandas | Comandas | Full order history |
| Reporte | Reporte | Daily sales reports |
| Inventario | Inventario | Raw materials tracking |
| Admin | Gerencial | PIN-protected admin dashboard |

### Global State Variables

```javascript
let currentItems = []          // Items in the current in-progress order
let currentPago = "Efectivo"   // Active payment method
let currentPropina = 0         // Tip amount
let currentDescuento = {}      // Active discount
let comandas = []              // All open commands (orders)
let ventas = []                // All completed sales
let meseros = []               // Waiter/server names
let cancelaciones = []         // Cancellation history
let adminAutenticado = false   // Admin session state
```

### Sync Strategy

- Frontend polls `/api/lastUpdate` every 3 seconds.
- If the server timestamp is newer than local, it fetches `/api/datos` and merges.
- **Server-first merge**: server data wins, except items marked as local-only (open, unsaved order).
- Offline fallback: data persisted in `localStorage` and synced when connection restores.

## Data Models

### Comanda (open order)
```javascript
{
  id: "timestamp-based-id",
  mesa: 5,                       // Table number
  mesero: "Carlos",
  items: [{
    n: "Hamburguesa",            // name
    p: 120,                      // price
    q: 2,                        // quantity
    nota: "sin cebolla",         // special instruction
    cortesia: false,             // complimentary flag
    cancelado: false,            // cancellation flag
    cat: "Hamburguesas"          // category
  }],
  estado: "abierta",             // "abierta" | "cerrada"
  timestamp: "2024-01-01T12:00:00Z",
  descuento: { tipo: null, valor: 0 }
}
```

### Venta (completed sale)
```javascript
{
  id: "timestamp-based-id",
  mesa: 5,
  mesero: "Carlos",
  total: 350,
  pago: "Efectivo",              // "Efectivo" | "Tarjeta" | "Mixto ..."
  propina: 50,
  cortesias: 0,
  descuento: { tipo: "pct", valor: 10 },
  items: [...],                  // same structure as comanda items
  fecha: "2024-01-01",
  timestamp: "2024-01-01T13:00:00Z"
}
```

### Inventario
```javascript
{
  diaInicio: "2024-01-01T00:00:00Z",
  stockInicial: { carne: 50, bollo: 50, pollo: 30, papa: 5000, qamerica: 20, qsuizo: 20 },
  minimosIngredientes: { carne: 10, bollo: 10, pollo: 8, papa: 1000, qamerica: 5, qsuizo: 5 },
  comp: { carne: 0, bollo: 0, ... },   // purchased amounts
  uso: { carne: 0, bollo: 0, ... }     // consumed amounts (auto-calculated from sales)
}
```

## Business Logic

### Payment Methods
- **Efectivo**: Cash
- **Tarjeta**: Card
- **Mixto**: Split — stored as `"Mixto efectivo:X tarjeta:Y"`

### Discount Types
- `empleado`: 50% off all items
- `pct`: Percentage off (any %)
- Fixed amount discount also supported

### PIN Protection
The following actions require PIN entry:
- Marking items as courtesy (cortesía)
- Cancelling items from an open order
- Accessing admin dashboard
- Importing backup data
- Editing configuration

Default PIN is `'1234'`; override via `PIN_ADMIN` env var.

### Recipe / Ingredient Tracking (Materia Prima)

Recipes define ingredient consumption per item sold. Auto-calculation happens at report/inventory time from the `ventas` array:

| Ingredient | Unit | Notes |
|---|---|---|
| carne | bolitas (80g each) | Per burger patty |
| bollo | units | Per burger bun |
| pollo | pieces (120g each) | Per chicken item |
| papa | grams | 200g per portion |
| qamerica | slices | American cheese |
| qsuizo | slices | Swiss cheese |

### Print Server

The `print-server/server.js` runs on the local restaurant machine:
- Polls `/api/print-queue` every 2 seconds
- Sends ESC/POS formatted tickets via TCP to thermal printers on port 9100
- Three printer targets: cocina (kitchen), barra (bar), recibo (receipt)

## Coding Conventions

### Language & Style
- **Vanilla JavaScript only** — no TypeScript, no modules (`import`/`export`), no transpilation
- All frontend code is in one file: `public/index.html`
- Inline event handlers (`onclick="..."`) are the norm in HTML
- CSS lives in a `<style>` block at the top of `index.html`

### Naming
- Functions and variables: `camelCase`
- Section comments in Spanish, prefixed with `// ──` for visual separation
- All user-facing strings in Spanish

### No Build System
- There is no webpack, vite, babel, or any bundler
- Edits to `public/index.html` are immediately deployable — no build step needed

### No Tests
- No testing framework is present
- Validate changes manually via `npm run dev` and browser testing

## Deployment

Push to `main` branch triggers automatic Vercel deployment.

```
main branch → Vercel CI → production URL
```

Production URL: `https://instinto-sistema-cobranza.vercel.app`

The print server is **not deployed** — it runs locally on the restaurant's machine and communicates with the cloud API.

## Key Files to Know

| File | What to know |
|---|---|
| `public/index.html` | Entire frontend — HTML, CSS, and JS in one file |
| `api/index.js` | All REST API routes; data stored as JSON in Redis under key `pos_data` |
| `print-server/server.js` | TCP polling loop; format ESC/POS bytes per printer target |
| `vercel.json` | Route rewrites — all `/api/*` goes to serverless, everything else to SPA |

## Common Gotchas

1. **Monolithic frontend file**: All 2400+ lines of frontend live in `public/index.html`. Scroll carefully or use Ctrl+F with function names.
2. **No module system**: All functions are global. Avoid name collisions.
3. **Redis key**: All app data is stored in a single Redis key (`pos_data`). The entire state is read and written as one JSON blob.
4. **Local print server**: Printing won't work in development unless `print-server/server.js` is running locally and pointing at the correct API URL.
5. **Polling sync**: The 3-second polling in the frontend can cause race conditions if two devices save simultaneously. The merge logic in `api/index.js` uses timestamp comparison.
6. **PIN in env var**: In production, `PIN_ADMIN` must be set in Vercel environment variables or the PIN defaults to `'1234'`.
