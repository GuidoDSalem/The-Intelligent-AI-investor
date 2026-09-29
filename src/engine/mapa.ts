/**
 * Treemap "squarified" (Bruls, Huizing y van Wijk, 2000): reparte un rectángulo en rectángulos con área
 * proporcional a cada valor, buscando que sean lo más cuadrados posible. Función pura.
 */
export interface Rect { x: number; y: number; w: number; h: number }

export function squarify<T>(items: T[], valor: (t: T) => number, r: Rect): (Rect & { item: T })[] {
  const datos = items.map(item => ({ item, v: Math.max(0, valor(item)) })).filter(d => d.v > 0).sort((a, b) => b.v - a.v);
  const total = datos.reduce((s, d) => s + d.v, 0);
  if (!total || r.w <= 0 || r.h <= 0) return [];
  const escala = (r.w * r.h) / total;
  const areas = datos.map(d => ({ item: d.item, a: d.v * escala }));
  const out: (Rect & { item: T })[] = [];
  let { x, y, w, h } = r;

  const peor = (fila: { a: number }[], lado: number) => {
    const s = fila.reduce((t, f) => t + f.a, 0);
    let max = 0, min = Infinity;
    for (const f of fila) { max = Math.max(max, f.a); min = Math.min(min, f.a); }
    return Math.max((lado * lado * max) / (s * s), (s * s) / (lado * lado * min));
  };
  const colocar = (fila: { item: T; a: number }[]) => {
    const s = fila.reduce((t, f) => t + f.a, 0);
    if (w >= h) {
      const ancho = s / h;
      let yy = y;
      for (const f of fila) { const alto = f.a / ancho; out.push({ item: f.item, x, y: yy, w: ancho, h: alto }); yy += alto; }
      x += ancho; w -= ancho;
    } else {
      const alto = s / w;
      let xx = x;
      for (const f of fila) { const ancho = f.a / alto; out.push({ item: f.item, x: xx, y, w: ancho, h: alto }); xx += ancho; }
      y += alto; h -= alto;
    }
  };

  let fila: { item: T; a: number }[] = [];
  for (const d of areas) {
    const lado = Math.min(w, h);
    if (!fila.length || peor([...fila, d], lado) <= peor(fila, lado)) fila.push(d);
    else { colocar(fila); fila = [d]; }
  }
  if (fila.length) colocar(fila);
  return out;
}
