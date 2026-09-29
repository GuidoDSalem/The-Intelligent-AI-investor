import { build } from "esbuild";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/**
 * Genera:
 *  - dist/web/            la app que sirve `npm start` (index.html + app.js + estilos.css)
 *  - dist/motor-graham.html  una sola página autocontenida, para publicar como artifact en Claude
 * Si existe data/snapshot.json (ver `npm run snapshot`), sus empresas reales quedan embebidas.
 */
const FUENTES = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">`;

const js = await build({ entryPoints: ["src/web/app.ts"], bundle: true, format: "iife", target: "es2022", minify: true, write: false, legalComments: "none" });
const app = js.outputFiles[0].text;
const css = await readFile("src/web/estilos.css", "utf8");
const cuerpo = await readFile("src/web/pagina.html", "utf8");
const snapshot = existsSync("data/snapshot.json") ? await readFile("data/snapshot.json", "utf8") : `{"generado":"","empresas":[]}`;
const snap = `<script>window.__SNAPSHOT__=${snapshot.trim().replace(/</g, "\\u003c")};</script>`;

await mkdir("dist/web", { recursive: true });
await writeFile("dist/web/app.js", app);
await writeFile("dist/web/estilos.css", css);
await writeFile("dist/web/index.html", `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Motor Graham</title>
${FUENTES}
<link rel="stylesheet" href="estilos.css">
</head>
<body>
${cuerpo}
${snap}
<script src="app.js"></script>
</body>
</html>
`);

// Página para artifact: sin <html>/<head>/<body> (la plataforma agrega el esqueleto).
await writeFile("dist/motor-graham.html", `<title>Motor Graham</title>
${FUENTES}
<style>
${css}
</style>
${cuerpo}
${snap}
<script>
${app.replace(/<\/script/gi, "<\\/script")}
</script>
`);
const n = JSON.parse(snapshot).empresas.length;
console.log(`dist/web y dist/motor-graham.html listos (${n} empresas reales en el snapshot).`);
