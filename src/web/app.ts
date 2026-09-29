import { type Analisis, analizar, hash, validarEmpresa, VEREDICTOS } from "../engine/analisis.ts";
import { EJEMPLOS } from "../engine/ejemplos.ts";
import { fmtPrecio, millones, nf1, nf2, parsearLista, pct } from "../engine/formato.ts";
import { promptS2, type RespuestaS2, validarS2 } from "../engine/sistema2.ts";
import { SUPUESTOS } from "../engine/supuestos.ts";
import type { Empresa, VeredictoId } from "../engine/tipos.ts";
import { epsChart, esc, logoSVG, rangeBar, rosettePath, sparkSVG, valuationChart } from "./graficos.ts";

/* ============================================================
   Estado y fuentes de datos
   ============================================================ */
interface Snapshot { generado: string; empresas: Empresa[] }
interface EstadoServidor { edgar: boolean; claude: boolean; modeloS2: string; precios: boolean }
type Sample = ((input: string, opts?: object) => Promise<{ text: string }>) & { json: (input: string, opts?: object) => Promise<unknown> };
declare global {
  interface Window {
    __SNAPSHOT__?: Snapshot;
    claude?: { use: (name: string) => Promise<unknown> };
  }
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const store = {
  get<T>(k: string, def: T): T { try { const v = localStorage.getItem(k); return v === null ? def : (JSON.parse(v) as T); } catch { return def; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const SNAPSHOT: Snapshot = window.__SNAPSHOT__ ?? { generado: "", empresas: [] };
let mias: Empresa[] = store.get("mg.mias", []);
let S2: Record<string, RespuestaS2> = store.get("mg.s2", {});
const UI = Object.assign({ filtro: "todas", orden: "margen", vista: "grid", verEjemplos: !SNAPSHOT.empresas.length }, store.get("mg.ui", {}));
if (!SNAPSHOT.empresas.length && !mias.length) UI.verEjemplos = true;
let servidor: EstadoServidor | null = null;
let analisis: Analisis[] = [];

const idDe = (e: Empresa) => (e.fuente?.tipo === "ejemplo" ? "ej:" : "") + e.ticker;
const s2Key = (a: Analisis) => a.c.ticker + ":" + hash(JSON.stringify({ ...a.c, fuente: undefined }));
const esMia = (e: Empresa) => mias.some(m => m.ticker === e.ticker);
const veredictoFinal = (a: Analisis): VeredictoId => S2[s2Key(a)]?.veredicto ?? a.s1.veredicto;

function empresas(): Empresa[] {
  const propias = new Set(mias.map(m => m.ticker));
  return [
    ...mias,
    ...SNAPSHOT.empresas.filter(e => !propias.has(e.ticker)),
    ...(UI.verEjemplos ? EJEMPLOS : []),
  ];
}
function guardarMia(e: Empresa) {
  mias = mias.filter(m => m.ticker !== e.ticker).concat(e);
  store.set("mg.mias", mias);
}
const saveUI = () => store.set("mg.ui", UI);

/* ============================================================
   Render de la lista
   ============================================================ */
function etiquetaFuente(e: Empresa) {
  const t = e.fuente?.tipo ?? "manual";
  return `<span class="src ${t}">${t === "edgar" ? "EDGAR" : t === "ejemplo" ? "Ejemplo" : "Manual"}</span>`;
}
function s2Tag(a: Analisis) {
  if (S2[s2Key(a)]) return `<span class="tag-s2 done">Revisado por S2</span>`;
  if (a.s1.escalar.length) return `<span class="tag-s2">Requiere S2</span>`;
  return "";
}

function renderEstado() {
  const partes: string[] = [];
  if (servidor) {
    partes.push(`<span class="dot ${servidor.edgar ? "on" : ""}">${servidor.edgar ? "Conectado a SEC EDGAR" : "EDGAR desactivado (falta SEC_USER_AGENT en el servidor)"}</span>`);
    partes.push(`<span class="dot ${servidor.claude ? "on" : ""}">${servidor.claude ? `Sistema 2 con ${esc(servidor.modeloS2)}` : "Sistema 2 desactivado (falta ANTHROPIC_API_KEY)"}</span>`);
  } else {
    partes.push(`<span class="dot">Versión publicada: sin acceso directo a EDGAR</span>`);
    if (SNAPSHOT.empresas.length) partes.push(`<span>${SNAPSHOT.empresas.length} empresas reales de EDGAR, datos al ${esc(SNAPSHOT.generado.slice(0, 10))}</span>`);
  }
  $("estado").innerHTML = partes.join("");
}

function renderPipeline() {
  const n = analisis.length, esc2 = analisis.filter(a => a.s1.escalar.length).length, hechos = analisis.filter(a => S2[s2Key(a)]).length;
  const ms = analisis.reduce((s, a) => s + a.tiempos.d, 0), ms1 = analisis.reduce((s, a) => s + a.tiempos.s1, 0);
  $("pipeline").innerHTML = `
    <div class="layer"><span class="k">Capa fija</span><h3>Código determinístico</h3><p>Ratios, criterios de Graham y tres valuaciones. Mismos datos, mismo resultado.</p><span class="stat">${n} empresas · ${nf1.format(ms)} ms</span></div>
    <div class="layer"><span class="k">Sistema 1</span><h3>Decisión rápida</h3><p>${SUPUESTOS.simulaciones.toLocaleString("es-AR")} simulaciones por empresa y señales de calidad ponderadas. Da veredicto y confianza.</p><span class="stat">${n - esc2} de ${n} resueltas sin ayuda · ${nf1.format(ms1)} ms</span></div>
    <div class="layer s2"><span class="k">Sistema 2</span><h3>Razonamiento puntual</h3><p>Se activa sólo con confianza baja, señales en conflicto o ciclos. Lo pedís vos, caso por caso.</p><span class="stat">${esc2} escaladas · ${hechos} revisadas</span></div>`;
}

function renderChips() {
  const counts: Record<string, number> = { todas: analisis.length };
  for (const a of analisis) counts[veredictoFinal(a)] = (counts[veredictoFinal(a)] || 0) + 1;
  counts.s2 = analisis.filter(a => a.s1.escalar.length).length;
  const opts: [string, string][] = [["todas", "Todas"], ...Object.entries(VEREDICTOS).map(([k, v]) => [k, v.txt] as [string, string]), ["s2", "Requieren S2"]];
  $("chips").innerHTML = opts.map(([k, t]) => `<button class="chip" type="button" data-f="${k}" aria-pressed="${UI.filtro === k}">${t}<span class="c">${counts[k] || 0}</span></button>`).join("");
}

function renderList() {
  const list = $("list");
  list.className = UI.vista === "rows" ? "rows" : "grid";
  $("vGrid").setAttribute("aria-pressed", String(UI.vista !== "rows"));
  $("vRows").setAttribute("aria-pressed", String(UI.vista === "rows"));
  $<HTMLSelectElement>("sort").value = UI.orden;
  $<HTMLInputElement>("verEjemplos").checked = UI.verEjemplos;
  const items = analisis.filter(a => UI.filtro === "todas" || (UI.filtro === "s2" ? a.s1.escalar.length : veredictoFinal(a) === UI.filtro));
  const orden: Record<string, (a: Analisis, b: Analisis) => number> = {
    margen: (a, b) => b.s1.ratio - a.s1.ratio,
    calidad: (a, b) => b.s1.calidad - a.s1.calidad,
    nombre: (a, b) => a.c.nombre.localeCompare(b.c.nombre, "es"),
  };
  items.sort(orden[UI.orden] ?? orden.margen);
  if (!analisis.length) {
    list.innerHTML = `<p class="empty">Todavía no hay empresas. Buscá un ticker arriba, cargá una a mano o activá los ejemplos ficticios.</p>`;
    return;
  }
  if (!items.length) { list.innerHTML = `<p class="empty">Ninguna empresa con esa conclusión.</p>`; return; }
  list.innerHTML = items.map(a => {
    const v = veredictoFinal(a);
    return `<button class="card" type="button" data-id="${esc(idDe(a.c))}" aria-label="Ver análisis de ${esc(a.c.nombre)}">
      ${logoSVG(a.c)}
      <div class="id"><div class="name">${esc(a.c.nombre)}</div><div class="meta"><b>${esc(a.c.ticker)}</b> · ${esc(a.c.sector.split(" · ")[0])} ${etiquetaFuente(a.c)}</div></div>
      <div class="price"><div class="p">${fmtPrecio(a.c.precio)}</div></div>
      <div class="verdict"><span class="pill v-${v}">${VEREDICTOS[v].txt}</span>${s2Tag(a)}<span class="concl">${VEREDICTOS[v].corto}</span></div>
      <div class="bar">${rangeBar(a)}</div>
      <div class="foot"><span>Calidad ${pct(a.s1.calidad)}</span>${sparkSVG(a.c.eps, 64, 18)}<span>Confianza ${pct(S2[s2Key(a)]?.confianza ?? a.s1.confianza)}</span></div>
    </button>`;
  }).join("");
}

function renderFooter() {
  const S = SUPUESTOS;
  $("foot").innerHTML = `
    <p><strong>Supuestos del motor.</strong> Rendimiento exigido entre ${pct(S.tasa[0])} y ${pct(S.tasa[1])}; crecimiento perpetuo entre ${nf1.format(S.crecimientoTerminal[0] * 100)} % y ${nf1.format(S.crecimientoTerminal[1] * 100)} %; ${S.horizonte} años de crecimiento explícito, acotado entre ${pct(S.crecimientoLimites[0])} y ${pct(S.crecimientoLimites[1])}. “Comprar con margen” exige un valor mediano de al menos ${nf2.format(S.umbralComprar)} veces el precio; “Cara”, menos de ${nf2.format(S.umbralCara)} veces. Debajo de ${pct(S.confianzaMinima)} de confianza, el caso se escala al Sistema 2.</p>
    <p>Datos reales: estados contables anuales (10-K) de SEC EDGAR en formato XBRL. EDGAR no publica precios: se toman de Stooq cuando se puede o los ingresás vos. Las ponderaciones del Sistema 1 están fijadas a mano, no calibradas con datos históricos. Esto es una herramienta de estudio, no una recomendación de inversión.</p>`;
}

function renderAll() {
  analisis = empresas().filter(e => e.precio > 0 && !validarEmpresa(e)).map(e => analizar(e));
  renderPipeline(); renderChips(); renderList(); renderFooter(); renderEstado();
}

/* ============================================================
   Ficha de detalle
   ============================================================ */
const kv = (k: string, v: string) => `<div class="kv"><dt>${k}</dt><dd>${v}</dd></div>`;
const f = (v: number | null | undefined, fn: (x: number) => string) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : fn(v));
const P = (v: number) => nf1.format(v * 100) + " %", X = (v: number) => nf1.format(v) + "×";

function bloqueFuente(c: Empresa) {
  const fu = c.fuente;
  if (!fu || fu.tipo === "ejemplo") return `<div class="fuente">Empresa y cifras ficticias, para mostrar cómo trabaja el motor.</div>`;
  if (fu.tipo === "manual") return `<div class="fuente">Datos cargados a mano${fu.avisos?.length ? `<ul>${fu.avisos.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>`;
  const precio = fu.precioFuente ? `Precio: ${esc(fu.precioFuente)}${fu.precioFecha ? ` del ${esc(fu.precioFecha)}` : ""}.` : "Precio ingresado a mano.";
  return `<div class="fuente">
    <div>Fuente: <a href="${esc(fu.url)}" target="_blank" rel="noopener">SEC EDGAR, CIK ${esc(fu.cik)}</a>. Último ${esc(fu.formulario)} con ejercicio cerrado el ${esc(fu.cierre)} (presentado el ${esc(fu.presentado)}). Montos en millones de ${esc(fu.moneda ?? "USD")}. ${precio}</div>
    ${fu.avisos?.length ? `<ul>${fu.avisos.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
  </div>`;
}

function openDetail(id: string) {
  const a = analisis.find(x => idDe(x.c) === id);
  if (!a) return;
  const { c, d, s1 } = a, v = veredictoFinal(a), r2 = S2[s2Key(a)];
  const checks = d.criterios.map(k => `<tr><td>${k.nombre}${k.nota ? `<div class="muted">${k.nota}</div>` : ""}</td><td class="muted">${k.regla}</td><td class="v">${k.valor}</td><td><span class="mark ${k.pasa === null ? "na" : k.pasa ? "ok" : "no"}">${k.pasa === null ? "n/a" : k.pasa ? "sí" : "no"}</span></td></tr>`).join("");
  const sig = s1.senales.map(s => `<div class="sig"><span>${s.nombre}</span><span class="track"><i class="${s.valor >= 0 ? "pos" : "neg"}" style="width:${(Math.abs(s.valor) / 1.5) * 50}%"></i></span><span class="val">${s.texto}</span></div>`).join("");
  const puedeActualizar = servidor?.edgar && c.fuente?.tipo === "edgar";
  const sheet = $("sheet");
  sheet.innerHTML = `
    <div class="sheet-head">${logoSVG(c)}<div><h2>${esc(c.nombre)}</h2><div class="meta"><b class="mono">${esc(c.ticker)}</b> · ${esc(c.sector)} · ${fmtPrecio(c.precio)} por acción · capitalización ${millones(d.capitalizacion)}</div></div>
      <button class="close" id="closeDetail" type="button" aria-label="Cerrar">×</button></div>
    ${bloqueFuente(c)}
    <div class="acciones-ficha">
      ${c.fuente?.tipo !== "ejemplo" ? `<button class="btn ghost" type="button" id="editar">Editar datos</button>` : `<button class="btn ghost" type="button" id="editar">Copiar como plantilla</button>`}
      ${puedeActualizar ? `<button class="btn ghost" type="button" id="actualizar">Actualizar desde EDGAR</button>` : ""}
      ${esMia(c) ? `<button class="linkbtn" type="button" id="quitar">Quitar de mi lista</button>` : ""}
    </div>

    <div class="verdict-block">
      <div class="row1"><span class="pill v-${v}">${VEREDICTOS[v].txt}</span>
        <span class="conf">Confianza <span class="meter"><i style="width:${(r2?.confianza ?? s1.confianza) * 100}%"></i></span>${pct(r2?.confianza ?? s1.confianza)}</span>
        <span class="muted">Decidió: ${r2 ? "Sistema 2" : "Sistema 1"}</span></div>
      <p class="big">${esc(r2?.resumen || VEREDICTOS[v].corto)}</p>
      <ul class="why">${a.porque.map(p => `<li>${p}</li>`).join("")}</ul>
    </div>

    <section class="sec"><div class="sec-h"><h3>Precio frente a valor</h3><span class="layer-tag s1">Capa fija + Sistema 1</span></div>
      ${valuationChart(a)}
      <p class="note">Barras: distribución de ${SUPUESTOS.simulaciones.toLocaleString("es-AR")} valuaciones simuladas variando tasa, crecimiento y flujo base. Marcas: las valuaciones determinísticas.</p>
      <div class="tablewrap" style="margin-top:12px"><table class="checks"><thead><tr><th>Método</th><th>Cálculo</th><th style="text-align:right">Valor</th><th>vs. precio</th></tr></thead><tbody>
        ${d.valuaciones.map(m => `<tr><td>${m.nombre}</td><td class="muted mono" style="font-size:12px">${m.formula}</td><td class="v">${fmtPrecio(m.valor)}</td><td class="v">${m.valor > 0 ? (m.valor >= c.precio ? "+" : "") + Math.round((m.valor / c.precio - 1) * 100) + " %" : "—"}</td></tr>`).join("")}
      </tbody></table></div>
    </section>

    <section class="sec"><div class="sec-h"><h3>Criterios de Graham</h3><span class="layer-tag">Código determinístico</span></div>
      <div class="tablewrap"><table class="checks"><thead><tr><th>Criterio</th><th>Regla</th><th style="text-align:right">Valor</th><th>Pasa</th></tr></thead><tbody>${checks}</tbody></table></div>
    </section>

    <section class="sec"><div class="sec-h"><h3>Ganancia por acción</h3><span class="layer-tag">Código determinístico</span></div>
      ${epsChart(a)}
      <p class="note">Crecimiento entre el promedio de los primeros y los últimos 3 años: ${f(d.crecimiento, P)} (${f(d.cagr, P)} anual). Variabilidad: ${Number.isFinite(d.cv) ? nf2.format(d.cv) : "muy alta"}.</p>
    </section>

    <section class="sec"><div class="sec-h"><h3>Ratios</h3><span class="layer-tag">Código determinístico</span></div>
      <div class="ratios">
        <div><h4>Rentabilidad</h4><dl>${kv("ROE", f(d.roe, P))}${kv("Margen operativo", f(d.margenOperativo, P))}${kv("Margen neto", f(d.margenNeto, P))}${kv("Ganancia neta", millones(d.gananciaNeta))}</dl></div>
        <div><h4>Solidez</h4><dl>${kv("Liquidez corriente", f(d.liquidez, x => nf2.format(x)))}${kv("Capital de trabajo", f(d.capitalTrabajo, millones))}${kv("Deuda neta / EBITDA", f(d.deudaNetaEbitda, X))}${kv("Cobertura de intereses", f(d.cobertura, X))}</dl></div>
        <div><h4>Flujo de caja</h4><dl>${kv("Flujo de caja libre", f(d.fcf, millones))}${kv("FCF por acción", f(d.fcfpa, fmtPrecio))}${kv("Caja / ganancia", f(d.conversion, x => nf2.format(x)))}${kv("FCF yield", f(d.fcfYield, P))}</dl></div>
        <div><h4>Valuación</h4><dl>${kv("P/E (prom. 3 años)", f(d.pe, x => nf1.format(x)))}${kv("P/B", f(d.pb, x => nf2.format(x)))}${kv("P/E × P/B", f(d.pe !== null && d.pb !== null ? d.pe * d.pb : null, x => nf1.format(x)))}${kv("EV / EBITDA", f(d.evEbitda, X))}</dl></div>
      </div>
    </section>

    <section class="sec"><div class="sec-h"><h3>Señales de calidad</h3><span class="layer-tag s1">Sistema 1</span></div>
      <div class="signals">${sig}</div>
      <p class="note">Cada señal suma o resta al puntaje (log-odds). Calidad resultante: <b class="num">${pct(s1.calidad)}</b>. Probabilidad de valer más que el precio: <b class="num">${pct(s1.pSobre)}</b>; con margen de un tercio: <b class="num">${pct(s1.pMargen)}</b>.</p>
    </section>

    <section class="sec"><div class="sec-h"><h3>Razonamiento puntual</h3><span class="layer-tag s2">Sistema 2</span></div>
      <div class="s2box" id="s2box"></div>
    </section>

    <section class="sec"><div class="sec-h"><h3>Traza del motor</h3><span class="layer-tag">Auditoría</span></div>
      <div class="trace">
        <div class="t"><span>capa fija</span><span>${d.criterios.length} criterios, ${d.valuaciones.length} valuaciones, ${d.ciclica ? "cíclica → EPS normalizada" : d.banco ? "financiera → P/B justificado" : "flujo de caja libre como base"}</span><span>${nf2.format(a.tiempos.d)} ms</span></div>
        <div class="t"><span>sistema 1</span><span>${SUPUESTOS.simulaciones} simulaciones, semilla ${hash(c.ticker)}, veredicto ${VEREDICTOS[s1.veredicto].txt.toLowerCase()}, confianza ${pct(s1.confianza)}</span><span>${nf2.format(a.tiempos.s1)} ms</span></div>
        <div class="t"><span>sistema 2</span><span>${s1.escalar.length ? (r2 ? `consultado, veredicto ${VEREDICTOS[r2.veredicto].txt.toLowerCase()}` : "escalado, sin consultar todavía") : r2 ? "consultado a pedido" : "no hizo falta"}</span><span></span></div>
      </div>
    </section>`;
  renderS2(a);
  $("closeDetail").onclick = () => $<HTMLDialogElement>("detail").close();
  $("editar").onclick = () => abrirFormulario(c);
  const act = document.getElementById("actualizar");
  if (act) act.onclick = () => { $<HTMLDialogElement>("detail").close(); traerDeEdgar(c.ticker, c.fuente?.precioFuente === "ingresado a mano" ? c.precio : undefined); };
  const q = document.getElementById("quitar");
  if (q) q.onclick = () => { mias = mias.filter(m => m.ticker !== c.ticker); store.set("mg.mias", mias); $<HTMLDialogElement>("detail").close(); renderAll(); };
  const dlg = $<HTMLDialogElement>("detail");
  if (!dlg.open) dlg.showModal();
  sheet.scrollTop = 0;
}

/* ============================================================
   Sistema 2: en Claude (capacidad `sample`) o vía el servidor local
   ============================================================ */
let samplePromise: Promise<Sample | null> | null = null;
function getSample(): Promise<Sample | null> {
  samplePromise ??= window.claude?.use ? (window.claude.use("sample") as Promise<Sample | null>).catch(() => null) : Promise.resolve(null);
  return samplePromise;
}
let sampleDisponible: boolean | null = null;
let s2ctl: AbortController | null = null;

const s2Posible = () => sampleDisponible === true || !!servidor?.claude;

function renderS2(a: Analisis, estado?: { stream?: string; error?: string }) {
  const box = document.getElementById("s2box");
  if (!box) return;
  const r2 = S2[s2Key(a)], esc2 = a.s1.escalar;
  const razones = esc2.length
    ? `<p style="margin:0">El Sistema 1 escaló este caso por:</p><ul class="reasons">${esc2.map(r => `<li>${r}</li>`).join("")}</ul>`
    : `<p style="margin:0">El Sistema 1 resolvió este caso con confianza suficiente; no hace falta razonar más.</p>`;
  let cuerpo = "";
  if (estado?.stream !== undefined) {
    cuerpo = `<div class="actions"><span class="muted">${estado.stream ? "Escribiendo…" : "Pensando… (puede tardar hasta un minuto)"}</span><button class="btn ghost" type="button" id="s2stop">Detener</button></div>${estado.stream ? `<div class="stream">${esc(estado.stream)}</div>` : ""}`;
  } else if (r2) {
    const lista = (t: string, xs: string[]) => (xs.length ? `<div><h5>${t}</h5><ul>${xs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "");
    cuerpo = `<div class="out">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="pill v-${r2.veredicto}">${VEREDICTOS[r2.veredicto].txt}</span><span class="muted">${r2.veredicto === a.s1.veredicto ? "Coincide con el Sistema 1" : `Corrige al Sistema 1 (${VEREDICTOS[a.s1.veredicto].txt})`}</span></div>
      ${lista("Argumentos", r2.argumentos)}${lista("Riesgos", r2.riesgos)}${lista("Qué verificar", r2.que_verificar)}
      <div class="actions"><button class="linkbtn" type="button" id="s2go">Volver a razonar</button><button class="linkbtn" type="button" id="s2clear">Descartar y volver al Sistema 1</button></div></div>`;
  } else if (!s2Posible()) {
    cuerpo = `<p class="muted" style="margin:0">El Sistema 2 no está disponible acá. Funciona en la versión publicada en Claude (consulta con tu cuenta) o en el servidor local con <span class="mono">ANTHROPIC_API_KEY</span>. Mientras tanto decide el Sistema 1.</p>`;
  } else {
    const donde = sampleDisponible ? "Usa tu cuenta de Claude." : `Consulta a ${esc(servidor?.modeloS2 ?? "Claude")} desde el servidor.`;
    cuerpo = `<div class="actions">${esc2.length ? `<button class="btn s2" type="button" id="s2go">Razonar este caso</button>` : `<button class="linkbtn" type="button" id="s2go">Razonar igual</button>`}<span class="muted">${donde} ${estado?.error ? `<span style="color:var(--bad)">${esc(estado.error)}</span>` : ""}</span></div>`;
  }
  box.innerHTML = razones + cuerpo;
  const go = document.getElementById("s2go");
  if (go) go.onclick = () => runS2(a);
  const clr = document.getElementById("s2clear");
  if (clr) clr.onclick = () => { delete S2[s2Key(a)]; store.set("mg.s2", S2); refrescarTrasS2(a); };
  const stop = document.getElementById("s2stop");
  if (stop) stop.onclick = () => s2ctl?.abort();
}

async function runS2(a: Analisis) {
  s2ctl = new AbortController();
  renderS2(a, { stream: "" });
  try {
    let r: RespuestaS2 | null;
    const sample = sampleDisponible ? await getSample() : null;
    if (sample) {
      r = validarS2(await sample.json(promptS2(a), { signal: s2ctl.signal, cache: { gcTime: 86400000 }, onText: ({ text }: { text: string }) => renderS2(a, { stream: text }) }));
    } else {
      const res = await fetch("/api/sistema2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresa: a.c }), signal: s2ctl.signal });
      const body = await res.json();
      if (!res.ok) throw { code: "servidor", message: body.error };
      r = validarS2(body);
    }
    if (!r) throw { code: "invalid_json" };
    S2[s2Key(a)] = r;
    store.set("mg.s2", S2);
    refrescarTrasS2(a);
  } catch (e) {
    const err = e as { code?: string; message?: string; name?: string };
    if (err.name === "AbortError" || err.code === "cancelled") { renderS2(a); return; }
    if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(err.code ?? "")) { sampleDisponible = false; renderS2(a); return; }
    const msg: Record<string, string> = {
      rate_limited: "Hay demasiadas consultas seguidas. Probá de nuevo en un rato.",
      invalid_json: "La respuesta no vino en el formato esperado. Probá de nuevo.",
      refused: "Claude no quiso responder este caso.",
      session_expired: "Tu sesión venció: volvé a iniciar sesión.",
    };
    renderS2(a, { error: err.code === "servidor" ? err.message : msg[err.code ?? ""] ?? "No se pudo completar la consulta. Probá de nuevo." });
  }
}

function refrescarTrasS2(a: Analisis) {
  renderPipeline(); renderChips(); renderList();
  if ($<HTMLDialogElement>("detail").open) openDetail(idDe(a.c));
}

/* ============================================================
   Búsqueda por ticker (EDGAR vía servidor, o snapshot en la versión publicada)
   ============================================================ */
let pendiente: Empresa | null = null;
const msg = (t: string, tipo: "" | "err" | "ok" = "") => { const m = $("qMsg"); m.textContent = t; m.className = "msg " + tipo; };

async function traerDeEdgar(ticker: string, precio?: number) {
  msg(`Buscando ${ticker} en EDGAR…`);
  $<HTMLButtonElement>("qIr").disabled = true;
  try {
    const res = await fetch(`/api/empresa/${encodeURIComponent(ticker)}${precio ? `?precio=${precio}` : ""}`);
    const body = await res.json();
    if (!res.ok) { msg(body.error ?? `Error ${res.status}`, "err"); return; }
    const e = body as Empresa;
    if (!(e.precio > 0)) {
      pendiente = e;
      msg(`Encontré ${e.nombre} (ejercicio cerrado el ${e.fuente?.cierre}). EDGAR no publica precios y no pude obtenerlo solo: ingresá el precio por acción y apretá Analizar.`, "err");
      $("qPrecio").focus();
      return;
    }
    terminarAlta(e);
  } catch {
    msg("No pude hablar con el servidor local. ¿Está corriendo npm start?", "err");
  } finally {
    $<HTMLButtonElement>("qIr").disabled = false;
  }
}

function terminarAlta(e: Empresa) {
  pendiente = null;
  guardarMia(e);
  $<HTMLInputElement>("q").value = "";
  $<HTMLInputElement>("qPrecio").value = "";
  msg(`${e.nombre} analizada${e.fuente?.precioFuente ? ` (precio: ${e.fuente.precioFuente}${e.fuente.precioFecha ? `, ${e.fuente.precioFecha}` : ""})` : ""}.`, "ok");
  if (UI.filtro !== "todas") { UI.filtro = "todas"; saveUI(); }
  renderAll();
  openDetail(idDe(e));
}

async function onBuscar(ev: Event) {
  ev.preventDefault();
  const t = $<HTMLInputElement>("q").value.trim().toUpperCase();
  const precio = Number($<HTMLInputElement>("qPrecio").value) || undefined;
  if (pendiente && (!t || t === pendiente.ticker)) {
    if (!precio) { msg("Ingresá el precio por acción.", "err"); return; }
    terminarAlta({ ...pendiente, precio, fuente: { ...pendiente.fuente!, tipo: "edgar", precioFuente: "ingresado a mano", precioFecha: undefined } });
    return;
  }
  if (!t) { msg("Escribí un ticker.", "err"); return; }
  pendiente = null;
  if (servidor?.edgar) return traerDeEdgar(t, precio);
  const conocida = empresas().find(e => e.ticker === t && e.fuente?.tipo !== "ejemplo");
  if (conocida) {
    if (precio && precio !== conocida.precio) terminarAlta({ ...conocida, precio, fuente: { ...(conocida.fuente ?? { tipo: "manual" }), precioFuente: "ingresado a mano", precioFecha: undefined } });
    else { msg(""); openDetail(idDe(conocida)); }
    return;
  }
  msg(servidor
    ? "El servidor no tiene EDGAR habilitado (falta SEC_USER_AGENT). Podés cargar la empresa a mano."
    : `${t} no está entre las empresas guardadas en esta versión publicada, que no puede consultar EDGAR. Para cualquier ticker corré el servidor local (npm start) o cargala a mano.`, "err");
}

let buscarTimer: ReturnType<typeof setTimeout> | undefined;
function onEscribir() {
  clearTimeout(buscarTimer);
  const q = $<HTMLInputElement>("q").value.trim();
  const dl = $("qLista");
  if (!q) { dl.innerHTML = ""; return; }
  buscarTimer = setTimeout(async () => {
    let lista: { ticker: string; nombre: string }[] = [];
    if (servidor?.edgar) {
      try { lista = await (await fetch(`/api/buscar?q=${encodeURIComponent(q)}`)).json(); } catch { lista = []; }
    } else {
      const Q = q.toUpperCase();
      lista = empresas().filter(e => e.fuente?.tipo !== "ejemplo" && (e.ticker.startsWith(Q) || e.nombre.toUpperCase().includes(Q)));
    }
    dl.innerHTML = lista.map(x => `<option value="${esc(x.ticker)}">${esc(x.nombre)}</option>`).join("");
  }, 200);
}

/* ============================================================
   Formulario de carga manual
   ============================================================ */
const CAMPOS_NUM = ["precio", "acciones", "aniosDividendos", "ventas", "patrimonio", "activoCorriente", "pasivoCorriente", "caja", "deudaTotal", "deudaLP", "ebit", "depreciaciones", "intereses", "flujoOperativo", "capex"] as const;
const PLANTILLA: Empresa = {
  ticker: "", nombre: "", sector: "", precio: 0, acciones: 0, eps: [], ventas: 0, patrimonio: 0, activoCorriente: null, pasivoCorriente: null,
  caja: null, deudaTotal: null, deudaLP: null, ebit: null, depreciaciones: null, intereses: null, flujoOperativo: null, capex: null, aniosDividendos: 0,
};
let editando: Empresa | null = null;

const numero = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

function llenarFormulario(e: Empresa) {
  const form = $<HTMLFormElement>("loaderForm");
  const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  el("ticker").value = e.ticker; el("nombre").value = e.nombre; el("sector").value = e.sector;
  for (const k of CAMPOS_NUM) { const v = e[k]; el(k).value = v === null || v === undefined || (v === 0 && !e.ticker) ? "" : String(Math.round(Number(v) * 1000) / 1000); }
  el("eps").value = e.eps.map(x => nf2.format(x)).join("; ");
  el("banco").checked = !!e.banco; el("ciclica").checked = !!e.ciclica;
  $<HTMLTextAreaElement>("jsonIn").value = JSON.stringify({ ...e, fuente: undefined }, null, 2);
}

function leerFormulario(): Empresa {
  const form = $<HTMLFormElement>("loaderForm");
  const el = (n: string) => form.elements.namedItem(n) as HTMLInputElement;
  const e: Empresa = { ...PLANTILLA, ...(editando ?? {}) };
  e.ticker = el("ticker").value.trim().toUpperCase().slice(0, 12);
  e.nombre = el("nombre").value.trim();
  e.sector = el("sector").value.trim();
  for (const k of CAMPOS_NUM) (e as unknown as Record<string, number | null>)[k] = numero(el(k).value);
  e.eps = parsearLista(el("eps").value);
  if (editando?.anios && editando.anios.length !== e.eps.length) delete e.anios;
  e.banco = el("banco").checked; e.ciclica = el("ciclica").checked;
  return e;
}

function abrirFormulario(base?: Empresa) {
  editando = base && base.fuente?.tipo !== "ejemplo" ? base : null;
  llenarFormulario(base ? { ...base, ticker: base.fuente?.tipo === "ejemplo" ? "" : base.ticker } : PLANTILLA);
  $("loaderTitle").textContent = editando ? `Editar ${editando.nombre}` : "Cargar empresa a mano";
  $("formErr").textContent = "";
  if ($<HTMLDialogElement>("detail").open) $<HTMLDialogElement>("detail").close();
  $<HTMLDialogElement>("loader").showModal();
}

function onGuardarFormulario(ev: Event) {
  ev.preventDefault();
  const e = leerFormulario();
  const err = validarEmpresa(e);
  if (err) { $("formErr").textContent = err; return; }
  if (editando?.fuente?.tipo === "edgar") {
    const cambios = JSON.stringify({ ...e, fuente: undefined }) !== JSON.stringify({ ...editando, fuente: undefined });
    e.fuente = { ...editando.fuente, avisos: [...(editando.fuente.avisos ?? []).filter(x => !x.startsWith("Editado a mano")), ...(cambios ? ["Editado a mano después de traerlo de EDGAR."] : [])] };
    if (e.precio !== editando.precio) e.fuente = { ...e.fuente, precioFuente: "ingresado a mano", precioFecha: undefined };
  } else {
    e.fuente = { tipo: "manual" };
  }
  guardarMia(e);
  $<HTMLDialogElement>("loader").close();
  renderAll();
  openDetail(idDe(e));
}

function onAplicarJson() {
  try {
    const o = JSON.parse($<HTMLTextAreaElement>("jsonIn").value) as Empresa;
    llenarFormulario({ ...PLANTILLA, ...o, eps: Array.isArray(o.eps) ? o.eps : [] });
    $("formErr").textContent = "";
  } catch (err) {
    $("formErr").textContent = "El texto no es JSON válido: " + (err as Error).message;
  }
}

/* ============================================================
   Arranque
   ============================================================ */
function eventos() {
  $("chips").addEventListener("click", e => { const b = (e.target as HTMLElement).closest<HTMLElement>(".chip"); if (!b) return; UI.filtro = b.dataset.f!; saveUI(); renderChips(); renderList(); });
  $("sort").addEventListener("change", e => { UI.orden = (e.target as HTMLSelectElement).value; saveUI(); renderList(); });
  $("verEjemplos").addEventListener("change", e => { UI.verEjemplos = (e.target as HTMLInputElement).checked; saveUI(); renderAll(); });
  $("vGrid").onclick = () => { UI.vista = "grid"; saveUI(); renderList(); };
  $("vRows").onclick = () => { UI.vista = "rows"; saveUI(); renderList(); };
  $("list").addEventListener("click", e => { const c = (e.target as HTMLElement).closest<HTMLElement>(".card"); if (c) openDetail(c.dataset.id!); });
  $("detail").addEventListener("click", e => { if ((e.target as HTMLElement).id === "detail") $<HTMLDialogElement>("detail").close(); });
  $("detail").addEventListener("close", () => s2ctl?.abort());
  $("buscarForm").addEventListener("submit", onBuscar);
  $("q").addEventListener("input", onEscribir);
  $("openLoader").onclick = () => abrirFormulario();
  $("cancelLoader").onclick = () => $<HTMLDialogElement>("loader").close();
  $("loaderForm").addEventListener("submit", onGuardarFormulario);
  $("jsonAplicar").onclick = onAplicarJson;
}

async function detectarServidor(): Promise<EstadoServidor | null> {
  if (location.protocol === "file:") return null;
  try {
    const res = await fetch("/api/estado", { signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as EstadoServidor) : null;
  } catch {
    return null;
  }
}

$("bgRosette").setAttribute("d", rosettePath(hash("GRAHAM-1949"), 48));
eventos();
renderAll();
detectarServidor().then(s => { servidor = s; renderEstado(); });
getSample().then(s => { sampleDisponible = !!s; });
