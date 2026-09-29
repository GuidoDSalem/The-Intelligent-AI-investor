# The Intelligent AI Investor · Motor Graham

Analiza acciones de forma sistemática con el método de Benjamin Graham (*El inversor inteligente*), usando los
balances reales que las empresas presentan ante la SEC (EDGAR), y muestra la conclusión y su justificación en una
página web.

Cada empresa pasa por tres capas:

| Capa | Qué hace | Cuándo corre |
|---|---|---|
| **Código determinístico** | Ratios, los 8 criterios del inversor defensivo y tres valuaciones (número de Graham, flujo descontado, fórmula de crecimiento). Financieras por P/B justificado; cíclicas con ganancias normalizadas. | Siempre |
| **Sistema 1** (rápido, probabilístico) | 4.000 simulaciones Monte Carlo del valor y señales de calidad ponderadas. Da veredicto (*Comprar con margen*, *Precio justo*, *Cara*, *Evitar*) y confianza. Semilla fija: mismos datos, mismo resultado. | Siempre |
| **Sistema 2** (razonamiento) | Claude revisa el caso con los números ya calculados. | Sólo si el Sistema 1 lo escala (confianza baja, señales en conflicto, cíclicas) y vos lo pedís |

## Uso

Requiere Node 20 o más nuevo.

```bash
npm install
SEC_USER_AGENT="Tu Nombre tu@email.com" npm start
# abrir http://localhost:5173
```

- **Analizar un ticker**: escribilo arriba (KO, JNJ, NUE…). El servidor baja los 10-K de EDGAR, arma los últimos
  10 ejercicios y busca el precio de cierre en Stooq o Yahoo Finance. Si no consigue el precio, te lo pide.
- **Cargar a mano**: cualquier empresa (por ejemplo, una que cotiza en BYMA), con un formulario o pegando JSON.
  Usá montos en millones y en moneda constante (balances ajustados por inflación).
- **Editar datos**: desde la ficha podés corregir el precio o cualquier dato traído de EDGAR; queda marcado.

Variables de entorno:

| Variable | Para qué |
|---|---|
| `SEC_USER_AGENT` | Obligatoria para EDGAR. La SEC exige identificarse con nombre y email ([reglas](https://www.sec.gov/os/accessing-edgar-data)). |
| `ANTHROPIC_API_KEY` | Habilita el Sistema 2 en el servidor local (modelo `claude-opus-5-5`, con respaldo automático del lado del servidor si un pedido es rechazado). Se puede cambiar con `MODELO_S2`. |
| `PRECIOS=off` | No consultar precios a Stooq ni a Yahoo Finance. |
| `PORT` | Puerto (5173 por defecto). |

Tus empresas y las respuestas del Sistema 2 se guardan en el navegador (localStorage).

## Versión publicada (artifact de Claude)

`npm run build` genera `dist/motor-graham.html`, una página autocontenida que se puede publicar como artifact en
Claude. Ahí el Sistema 2 usa la cuenta de Claude de quien la mira. Esa página no puede consultar EDGAR (el
navegador bloquea otros dominios y la SEC no permite CORS), así que lleva embebido un snapshot:

```bash
SEC_USER_AGENT="Tu Nombre tu@email.com" npm run snapshot              # las 10 mayores del S&P 500 por capitalización
SEC_USER_AGENT="…" npm run snapshot -- --top 15                       # las 15 mayores
SEC_USER_AGENT="…" npm run snapshot -- --precios precios.json         # precios a mano: {"NVDA": 180.2, …}
SEC_USER_AGENT="…" npm run snapshot -- KO JNJ NUE=72.5 --agregar      # tickers puntuales, precio con TICKER=precio
npm run build
```

## Cómo se leen los datos de EDGAR

`src/edgar/xbrl.ts` usa la API `companyfacts` (XBRL, us-gaap):

- Sólo formularios anuales 10-K; por período se queda con el valor presentado más reciente (re-expresiones).
- EPS diluido de los últimos 10 ejercicios, **ajustado por splits**: si un período aparece re-expresado con una
  razón de split (2:1, 3:1…), se corrigen los años que no volvieron a presentarse.
- Las etiquetas cambian con los años (p. ej. `SalesRevenueNet` → `Revenues`); se combinan en orden de preferencia.
- Acciones en circulación de la portada del último formulario (sumando clases) si es reciente y consistente; si
  no, el promedio diluido del ejercicio.
- Deuda: largo plazo + corriente, o la deuda combinada cuando no se informan por separado. D&A suma la
  amortización de intangibles cuando la depreciación viene sola. Si falta el capex, el flujo libre queda sin dato.
- Ejercicios de 52/53 semanas que cierran a principios de enero se rotulan con el año anterior.
- Dividendos: años seguidos con pago, hacia atrás.
- Sector y tipo (financiera, cíclica) según el código SIC.

Cada ficha muestra la fuente (CIK, 10-K, fechas) y los avisos de la extracción.

**Limitaciones**

- Sólo empresas que reportan en us-gaap (10-K). Las extranjeras con 20-F/40-F (IFRS) se cargan a mano.
- Empresas que informan la ganancia por clase de acción (Visa, Berkshire Hathaway) o cuyos 10-K no traen XBRL
  anual (Exxon Mobil) no se pueden leer automáticamente; el motor lo explica y se cargan a mano.
- El motor verifica que EPS × acciones dé la ganancia neta; si no cierra, no inventa el dato.
- XBRL existe desde 2009-2011: el criterio de 20 años de dividendos se da por cumplido si pagó en todos los años
  con datos (como mínimo 10), y la ficha lo aclara.
- Algunos datos pueden faltar o venir con etiquetas poco comunes; el motor avisa qué supuso.
- Las ponderaciones del Sistema 1 están fijadas a mano, no calibradas con datos históricos.
- Es una herramienta de estudio, no una recomendación de inversión.

## Desarrollo

```bash
npm test          # vitest: motor, extracción de EDGAR con fixtures, Sistema 2
npm run typecheck
npm run build
```

```
src/engine/   lógica pura: tipos, supuestos, análisis (capa fija + Sistema 1), Sistema 2, ejemplos ficticios
src/edgar/    xbrl.ts (companyfacts → Empresa, puro) y cliente.ts (red, caché, precios)
src/server/   servidor HTTP y llamada a Claude
src/web/      página, estilos, gráficos y app
scripts/      construir.ts (build) y snapshot.ts
```
