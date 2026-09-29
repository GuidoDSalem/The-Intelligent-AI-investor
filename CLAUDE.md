# The Intelligent AI Investor (Motor Graham)

Motor de análisis de acciones al estilo de *El inversor inteligente*, con datos de SEC EDGAR. Node + TypeScript,
sin framework de UI. Textos de la interfaz y documentación en español rioplatense.

- Antes de commitear: `npm run typecheck`, `npm test` y `npm run build` tienen que pasar.
- Tres capas: `src/engine/analisis.ts` (capa fija determinística + Sistema 1) y `src/engine/sistema2.ts` (arma y
  valida la consulta a Claude). `src/engine/` es lógica pura: no importa nada de Node ni del DOM.
- Todo número que no viene del balance vive en `src/engine/supuestos.ts`. Si cambia la lógica del Sistema 1,
  subir `SUPUESTOS.version` (cambia la semilla).
- `src/edgar/xbrl.ts` convierte companyfacts/submissions en `Empresa` sin hacer red: testearlo con fixtures
  (`test/fixtures/edgar.ts`). Las etiquetas XBRL van en `ETIQ`, en orden de preferencia.
- `src/edgar/cliente.ts` es el único lugar que habla con la SEC: exige `SEC_USER_AGENT`, espacia los pedidos y
  cachea en `.cache/edgar`.
- La web (`src/web/`) se arma con `scripts/construir.ts` en dos salidas: `dist/web/` (servidor local) y
  `dist/motor-graham.html` (página única para publicar como artifact, sin `<html>/<head>/<body>`).
  La versión publicada no puede consultar EDGAR: usa `data/snapshot.json` (`npm run snapshot`).
- `src/web/app.ts` detecta el modo: con servidor (`/api/estado`) busca en EDGAR y usa `/api/sistema2`;
  publicada en Claude usa la capacidad `sample` para el Sistema 2.
- Estilo visual: tokens en `:root` de `src/web/estilos.css` (claro y oscuro).
- Para probar el servidor sin red, se puede sembrar `.cache/edgar/` con los JSON del fixture.
- En la nube, Node necesita `NODE_USE_ENV_PROXY=1` para que `fetch` use el proxy del entorno (EDGAR, Yahoo).
