export const nf1 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nf2 = new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const nf0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export const fmtPrecio = (v: number) => "$ " + nf2.format(v);
export const pct = (v: number) => Math.round(v * 100) + " %";
export const millones = (v: number) => nf0.format(Math.round(v)) + " M";

/** Acepta "1,20; 1,31" o "1.2 1.31" o "1.2,1.31". */
export function parsearLista(s: string): number[] {
  let tokens = s.trim().split(/[;\s]+/).filter(Boolean);
  if (tokens.length === 1 && (tokens[0].match(/,/g) ?? []).length > 1) tokens = tokens[0].split(",");
  if (tokens.length === 1 && tokens[0].includes(",") && tokens[0].includes(".")) tokens = tokens[0].split(",");
  return tokens.map(t => Number(t.includes(",") && !t.includes(".") ? t.replace(",", ".") : t.replace(/,/g, "")));
}
