import { type Analisis, clamp, hash, rng } from "../engine/analisis.ts";
import type { Empresa } from "../engine/tipos.ts";
import { fmtPrecio, nf2 } from "../engine/formato.ts";

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Roseta guilloché determinística (hipotrocoide) a partir de una semilla. */
export function rosettePath(seed: number, R = 40): string {
  const rnd = rng(seed);
  const k = 3 + Math.floor(rnd() * 6), m = 7 + Math.floor(rnd() * 9);
  const a = 1, b = k / m, dd = 0.35 + rnd() * 0.5;
  let p = "";
  const steps = 900;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI * k;
    const x = (a - b) * Math.cos(t) + dd * Math.cos(((a - b) / b) * t);
    const y = (a - b) * Math.sin(t) - dd * Math.sin(((a - b) / b) * t);
    const sc = R / (a - b + dd);
    p += (i ? "L" : "M") + (x * sc).toFixed(2) + " " + (y * sc).toFixed(2);
  }
  return p;
}

export function logoSVG(c: Empresa): string {
  const h = hash(c.ticker), hue = h % 360;
  return `<svg class="logo" viewBox="-50 -50 100 100" role="img" aria-label="Emblema de ${esc(c.nombre)}">
    <circle r="48" fill="hsl(${hue} 32% 42% / .12)" stroke="hsl(${hue} 30% 45% / .55)" stroke-width="1"></circle>
    <path d="${rosettePath(h, 40)}" fill="none" stroke="hsl(${hue} 38% 42%)" stroke-width=".5" opacity=".8"></path>
    <circle r="17" fill="var(--card)" stroke="hsl(${hue} 30% 45% / .6)" stroke-width=".8"></circle>
    <text y="6" text-anchor="middle" font-family="Bodoni Moda, Georgia, serif" font-weight="600" font-size="17" fill="var(--ink)">${esc(c.ticker.slice(0, 2))}</text>
  </svg>`;
}

export function sparkSVG(eps: number[], w = 76, h = 22): string {
  const lo = Math.min(0, ...eps), hi = Math.max(...eps);
  const sx = (i: number) => (i / (eps.length - 1)) * (w - 4) + 2;
  const sy = (v: number) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  const line = eps.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join("");
  const zero = lo < 0 ? `<line x1="0" x2="${w}" y1="${sy(0)}" y2="${sy(0)}" stroke="var(--rule)" stroke-dasharray="2 2"></line>` : "";
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="Ganancia por acción por año">${zero}
    <path d="${line} L${sx(eps.length - 1)} ${h} L${sx(0)} ${h}Z" fill="var(--accent)" opacity=".1"></path>
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.4"></path>
    <circle cx="${sx(eps.length - 1)}" cy="${sy(eps.at(-1)!)}" r="2" fill="var(--accent)"></circle></svg>`;
}

export function rangeBar(a: Analisis): string {
  const { p10, p50, p90 } = a.s1, precio = a.c.precio;
  const lo = Math.min(p10, precio) * 0.85, hi = Math.max(p90, precio) * 1.08 || 1;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return `<svg viewBox="0 0 100 18" preserveAspectRatio="none" width="100%" height="18" aria-label="Rango de valor frente al precio">
    <rect x="0" y="8" width="100" height="2" fill="var(--rule)"></rect>
    <rect x="${x(p10)}" y="5" width="${Math.max(0.5, x(p90) - x(p10))}" height="8" rx="1.5" fill="var(--accent)" opacity=".25"></rect>
    <rect x="${x(p50) - 0.6}" y="3" width="1.2" height="12" fill="var(--accent)"></rect>
    <rect x="${x(precio) - 0.5}" y="0" width="1" height="18" fill="var(--ink)"></rect>
  </svg>
  <div style="display:flex;justify-content:space-between;font:11px var(--f-mono);color:var(--ink-3);margin-top:2px"><span>valor ${fmtPrecio(p50)}</span><span>precio ${fmtPrecio(precio)}</span></div>`;
}

const FORMAS: Record<string, string> = { graham: "M0 -5 L5 0 L0 5 L-5 0Z", dcf: "M-4.5 -4.5 H4.5 V4.5 H-4.5Z", crec: "M0 -5.5 L5 4 L-5 4Z", pbjust: "M-4.5 -4.5 H4.5 V4.5 H-4.5Z" };

export function valuationChart(a: Analisis): string {
  const W = 720, H = 230, L = 20, R = 20, T = 34, B = 34;
  const { vals, p10, p50, p90 } = a.s1, precio = a.c.precio;
  const metodos = a.d.valuaciones;
  const lo = 0;
  const hi = Math.max(vals[Math.floor(vals.length * 0.97)], precio, ...metodos.map(m => m.valor)) * 1.08 || 1;
  const x = (v: number) => L + ((clamp(v, lo, hi) - lo) / (hi - lo)) * (W - L - R);
  const bins = 48, cnt = new Array<number>(bins).fill(0);
  for (const v of vals) if (v < hi) cnt[Math.floor(((v - lo) / (hi - lo)) * bins)]++;
  const mx = Math.max(1, ...cnt), bw = (W - L - R) / bins, base = H - B;
  const bars = cnt.map((c, i) => {
    const hh = (c / mx) * (base - T - 22), mid = lo + ((i + 0.5) / bins) * (hi - lo);
    const dentro = mid >= p10 && mid <= p90;
    return `<rect x="${(L + i * bw + 0.5).toFixed(1)}" y="${(base - hh).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${hh.toFixed(1)}" fill="var(--accent)" opacity="${dentro ? 0.55 : 0.2}"></rect>`;
  }).join("");
  const step = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000].find(s => hi / s <= 7) || 10000;
  let ticks = "";
  for (let v = 0; v <= hi; v += step) ticks += `<line x1="${x(v)}" x2="${x(v)}" y1="${base}" y2="${base + 4}" stroke="var(--ink-3)"></line><text x="${x(v)}" y="${base + 17}" text-anchor="middle">$${v.toLocaleString("es-AR")}</text>`;
  const marks = metodos.map(m => `<path transform="translate(${x(m.valor).toFixed(1)} ${T - 14})" d="${FORMAS[m.id]}" fill="var(--engrave)"></path><line x1="${x(m.valor)}" x2="${x(m.valor)}" y1="${T - 8}" y2="${base}" stroke="var(--engrave)" stroke-width="1" stroke-dasharray="2 3" opacity=".7"></line>`).join("");
  const px = x(precio), anchor = px > W - 140 ? "end" : "start", dx = anchor === "end" ? -6 : 6;
  const price = `<line x1="${px}" x2="${px}" y1="${T - 18}" y2="${base}" stroke="var(--ink)" stroke-width="2"></line><text x="${px + dx}" y="${T + 2}" text-anchor="${anchor}" style="fill:var(--ink);font-weight:500">Precio ${fmtPrecio(precio)}</text>`;
  const p50x = x(p50);
  const legend = metodos.map(m => `<span style="display:inline-flex;gap:6px;align-items:center"><svg width="12" height="12" viewBox="-6 -6 12 12"><path d="${FORMAS[m.id]}" fill="var(--engrave)"></path></svg>${m.nombre}: <b class="num">${fmtPrecio(m.valor)}</b></span>`).join("");
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribución del valor estimado frente al precio">
      <line x1="${L}" x2="${W - R}" y1="${base}" y2="${base}" stroke="var(--rule)"></line>
      ${bars}${ticks}${marks}
      <line x1="${p50x}" x2="${p50x}" y1="${T + 8}" y2="${base}" stroke="var(--accent)" stroke-width="1.5"></line>
      <text x="${p50x}" y="${H - 2}" text-anchor="middle" style="fill:var(--accent)">mediana ${fmtPrecio(p50)}</text>
      ${price}
    </svg></div>
    <div style="display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:var(--ink-2);margin-top:10px">${legend}
      <span style="display:inline-flex;gap:6px;align-items:center"><i style="width:12px;height:10px;background:var(--accent);opacity:.55;display:inline-block"></i>Rango P10–P90 del Sistema 1: <b class="num">${fmtPrecio(p10)} – ${fmtPrecio(p90)}</b></span></div>`;
}

export function epsChart(a: Analisis): string {
  const eps = a.c.eps, W = 720, H = 150, L = 40, R = 10, T = 12, B = 24;
  const lo = Math.min(0, ...eps), hi = Math.max(...eps, 0.01) * 1.1;
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B), bw = (W - L - R) / eps.length;
  const anios = a.c.anios?.length === eps.length ? a.c.anios : null;
  const bars = eps.map((v, i) => `<rect x="${L + i * bw + 6}" y="${Math.min(y(v), y(0))}" width="${bw - 12}" height="${Math.abs(y(v) - y(0))}" rx="2" fill="${v < 0 ? "var(--bad)" : "var(--accent)"}" opacity="${v < 0 ? 0.8 : 0.6}"></rect><text x="${L + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${anios ? anios[i] : `año ${i + 1}`}</text>`).join("");
  const line = (v: number, lbl: string, col: string) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${col}" stroke-dasharray="4 3"></line><text x="${L - 4}" y="${y(v) + 4}" text-anchor="end" style="fill:${col}">${nf2.format(v)}</text><text x="${W - R}" y="${y(v) - 5}" text-anchor="end" style="fill:${col}">${lbl}</text>`;
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Ganancia por acción por año">
    <line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink-3)"></line>${bars}
    ${line(a.d.epsFin, "promedio últimos 3 años", "var(--ink-2)")}${a.d.ciclica ? line(a.d.eps10, `promedio ${eps.length} años (normalizada)`, "var(--engrave)") : ""}
  </svg></div>`;
}
