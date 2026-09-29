import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { candidatasPorTamano, type Cotizacion, cotizaciones, datosCrudos, empresaEdgar } from "../src/edgar/cliente.ts";
import { ingresosRecientes, sectorPorSic, tipoEmisor } from "../src/edgar/xbrl.ts";
import type { Empresa } from "../src/engine/tipos.ts";
import type { CeldaMapa, Snapshot } from "../src/engine/snapshot.ts";

/**
 * Genera data/snapshot.json, que el build embebe en la página publicada (que no puede consultar EDGAR).
 *
 *   SEC_USER_AGENT="Tu Nombre tu@email.com" npm run snapshot     # mapa de las 500 mayores, 10 destacadas
 *   … npm run snapshot -- --mapa 300 --top 15                     # otro tamaño
 *   … npm run snapshot -- KO JNJ NUE=72.5 --agregar               # tickers puntuales (precio a mano con =)
 *
 * Sin tickers: las candidatas salen de EDGAR (frames de acciones y valor de mercado de todas las empresas),
 * se cotizan con Yahoo en lotes de 20, se ordenan por acciones × precio y se bajan los 10-K de las más grandes.
 * Sólo entran emisoras locales (10-K): en la práctica, el S&P 500.
 */
const args = process.argv.slice(2);
const opcion = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const top = Number(opcion("--top") ?? 10);
const tamMapa = Number(opcion("--mapa") ?? 500);
const agregar = args.includes("--agregar");
const pedidos = args.filter(a => !a.startsWith("--"));

const previo: Snapshot | null = agregar && existsSync("data/snapshot.json") ? JSON.parse(await readFile("data/snapshot.json", "utf8")) : null;
const fallidas: string[] = [];
const cap = (e: Empresa) => e.precio * e.acciones;
const sectorDe = (e: Empresa) => e.sector.split(" · ")[0];

function celda(e: Empresa, cot: Cotizacion | null | undefined): CeldaMapa {
  return { ticker: e.ticker, nombre: e.nombre, sector: sectorDe(e), cap: Math.round(cap(e)), precio: e.precio, variacion: cot?.variacion ?? e.fuente?.variacionDia ?? null, analizable: true };
}

let snap: Snapshot;

if (pedidos.length) {
  const empresas: Empresa[] = [];
  for (const a of pedidos) {
    const [t, p] = a.split("=");
    try {
      const e = await empresaEdgar(t.toUpperCase(), p ? Number(p) : undefined);
      if (!(e.precio > 0)) { fallidas.push(`${t}: sin precio (${e.fuente?.precioError}); pasalo como ${t}=precio`); continue; }
      empresas.push(e);
      console.log(`✓ ${e.ticker}`);
    } catch (err) { fallidas.push(`${t}: ${(err as Error).message}`); }
  }
  snap = { generado: new Date().toISOString(), criterio: "Tickers elegidos a mano", destacadas: [], empresas, mapa: empresas.map(e => celda(e, null)) };
} else {
  // 1. Preselección: unión de los mayores por public float (viejo y a veces mal escalado) y por cantidad de acciones.
  const cands = await candidatasPorTamano();
  const porFlotante = [...cands].sort((a, b) => (b.flotante ?? 0) - (a.flotante ?? 0)).slice(0, tamMapa + 200);
  const porAcciones = [...cands].sort((a, b) => (b.acciones ?? 0) - (a.acciones ?? 0)).slice(0, tamMapa * 2);
  const presel = [...new Map([...porFlotante, ...porAcciones].map(c => [c.cik, c])).values()];
  console.log(`${cands.length} empresas con datos de portada; cotizo ${presel.length} en lotes de 20…`);

  // 2. Precios y variación del día, en lote.
  const cots = await cotizaciones(presel.map(c => c.ticker));
  const prelim = presel
    .map(c => ({ c, cot: cots.get(c.ticker) ?? null }))
    .filter(x => x.cot)
    .map(x => ({ ...x, valor: x.c.acciones ? x.cot!.precio * x.c.acciones : x.c.flotante ?? 0 }))
    .sort((a, b) => b.valor - a.valor);
  console.log(`${prelim.length} con precio. Bajo 10-K de las mayores…`);

  // 3. Datos completos. Las que no se pueden analizar igual entran al mapa (si son emisoras locales).
  const mapa: CeldaMapa[] = [];
  const empresas: Empresa[] = [];
  for (const { c, cot, valor } of prelim) {
    if (mapa.length >= tamMapa + 40) break;
    try {
      const e = await empresaEdgar(c.ticker, cot!);
      empresas.push(e);
      mapa.push(celda(e, cot));
      process.stdout.write(".");
    } catch (err) {
      const motivo = (err as Error).message;
      let crudos;
      try { crudos = await datosCrudos(c.ticker); } catch { continue; }
      const { sub, cf } = crudos;
      const sic = Number(sub.sic);
      // Fuera del mapa: extranjeras (no están en el S&P 500), fideicomisos de commodities y vehículos sin operaciones.
      if (tipoEmisor(sub) === "extranjera" || sic === 6221 || sic === 6189 || !sub.sic) { fallidas.push(`${c.ticker}: excluida (${motivo.split(":")[0]})`); continue; }
      // Sin análisis completo, la capitalización sale de datos de portada que a veces vienen mal escalados:
      // se acepta sólo si es coherente con los ingresos (menos de 60 veces un año de ventas).
      const ingresos = ingresosRecientes(cf);
      if (!ingresos || valor / ingresos > 60) { fallidas.push(`${c.ticker}: excluida (capitalización de ${Math.round(valor / 1000)} mil M incoherente con ingresos de ${Math.round(ingresos ?? 0)} M)`); continue; }
      mapa.push({ ticker: c.ticker, nombre: c.nombre, sector: sectorPorSic(sic, c.ticker), cap: Math.round(valor), precio: cot!.precio, variacion: cot!.variacion ?? null, analizable: false, motivo });
      fallidas.push(`${c.ticker}: en el mapa sin análisis (${motivo})`);
    }
  }
  mapa.sort((a, b) => b.cap - a.cap);
  const enMapa = new Set(mapa.slice(0, tamMapa).map(m => m.ticker));
  const elegidas = empresas.filter(e => enMapa.has(e.ticker)).sort((a, b) => cap(b) - cap(a));
  snap = {
    generado: new Date().toISOString(),
    criterio: `Las ${enMapa.size} mayores empresas de EE. UU. que presentan 10-K (en la práctica, el S&P 500), por acciones × precio`,
    destacadas: elegidas.slice(0, top).map(e => e.ticker),
    empresas: elegidas,
    mapa: mapa.slice(0, tamMapa),
  };
  console.log(`\nDestacadas: ${snap.destacadas?.join(", ")}`);
}

if (previo) {
  const nuevas = new Set(snap.empresas.map(e => e.ticker));
  snap = {
    ...previo,
    generado: new Date().toISOString(),
    empresas: [...previo.empresas.filter(e => !nuevas.has(e.ticker)), ...snap.empresas],
    // Las que ahora sí se pudieron analizar pasan a analizables en el mapa (se conserva la variación del día).
    mapa: (previo.mapa ?? []).map(c => {
      const e = snap.empresas.find(x => x.ticker === c.ticker);
      return e ? { ...celda(e, null), variacion: c.variacion } : c;
    }),
  };
}

await mkdir("data", { recursive: true });
await writeFile("data/snapshot.json", JSON.stringify(snap));
console.log(`${snap.empresas.length} empresas analizables y ${snap.mapa?.length ?? 0} en el mapa → data/snapshot.json`);
if (fallidas.length) console.log("\nAvisos:\n  " + fallidas.join("\n  "));
