import type { Analisis } from "./analisis.ts";
import { VEREDICTOS } from "./analisis.ts";
import { SUPUESTOS } from "./supuestos.ts";
import type { VeredictoId } from "./tipos.ts";

/**
 * SISTEMA 2 — razonamiento puntual.
 * Este módulo sólo arma la consulta y valida la respuesta; quién llama a Claude
 * depende de dónde corre la app (servidor con la API de Anthropic, o la página publicada en Claude).
 */
export interface RespuestaS2 {
  veredicto: VeredictoId;
  confianza: number;
  resumen: string;
  argumentos: string[];
  riesgos: string[];
  que_verificar: string[];
}

/** JSON Schema de la respuesta (para salidas estructuradas). */
export const ESQUEMA_S2 = {
  type: "object",
  properties: {
    veredicto: { type: "string", enum: ["comprar", "justo", "cara", "evitar"] },
    confianza: { type: "number" },
    resumen: { type: "string" },
    argumentos: { type: "array", items: { type: "string" } },
    riesgos: { type: "array", items: { type: "string" } },
    que_verificar: { type: "array", items: { type: "string" } },
  },
  required: ["veredicto", "confianza", "resumen", "argumentos", "riesgos", "que_verificar"],
  additionalProperties: false,
} as const;

const r2 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);

export function datosS2(a: Analisis) {
  const { c, d, s1 } = a;
  return {
    empresa: {
      ticker: c.ticker, nombre: c.nombre, sector: c.sector, precio: c.precio, eps_por_anio: c.eps, anios: c.anios ?? null,
      anios_dividendos: c.aniosDividendos, financiera: !!c.banco, ciclica: d.ciclica,
      fuente: c.fuente?.tipo ?? "manual", cierre_ejercicio: c.fuente?.cierre ?? null, avisos_de_datos: c.fuente?.avisos ?? [],
    },
    ratios: {
      roe: r2(d.roe), margen_operativo: r2(d.margenOperativo), liquidez: r2(d.liquidez), deuda_neta_ebitda: r2(d.deudaNetaEbitda),
      cobertura_intereses: r2(d.cobertura), conversion_caja: r2(d.conversion), pe_prom3: r2(d.pe), pb: r2(d.pb), fcf_yield: r2(d.fcfYield),
      crecimiento_eps_anual: r2(d.cagr),
    },
    criterios_graham: d.criterios.map(k => ({ criterio: k.nombre, valor: k.valor, pasa: k.pasa })),
    valuaciones: d.valuaciones.map(m => ({ metodo: m.nombre, valor: r2(m.valor) })),
    sistema1: {
      veredicto: s1.veredicto, confianza: r2(s1.confianza), valor_p10: r2(s1.p10), valor_p50: r2(s1.p50), valor_p90: r2(s1.p90),
      prob_vale_mas_que_precio: r2(s1.pSobre), prob_margen_un_tercio: r2(s1.pMargen), calidad: r2(s1.calidad), fragilidad: s1.fragilidad,
    },
    supuestos: SUPUESTOS,
  };
}

export function promptS2(a: Analisis): string {
  const razones = a.s1.escalar.length ? a.s1.escalar : ["El usuario pidió una segunda opinión."];
  return `Sos el "Sistema 2" de un motor de análisis de acciones al estilo de Benjamin Graham (El inversor inteligente). El código determinístico ya calculó ratios, criterios y valuaciones, y el Sistema 1 (Monte Carlo + señales ponderadas) propuso un veredicto. Te consultan sólo porque:
${razones.map(r => "- " + r).join("\n")}

No recalcules todo: tomá los números como dados y razoná lo que el código no puede (en qué parte del ciclo está la empresa, si el crecimiento justifica el precio, si hay trampa de valor, si los supuestos son razonables para el sector, si los avisos de datos cambian la conclusión). No inventes datos externos: si algo depende de información que no está acá, ponelo en "que_verificar".

Datos (JSON):
${JSON.stringify(datosS2(a))}

Elegí el veredicto final entre "comprar" (comprar con margen de seguridad), "justo" (precio justo, esperar), "cara" y "evitar".
Respondé sólo con un objeto JSON, en español rioplatense y con oraciones cortas:
{"veredicto": "comprar|justo|cara|evitar", "confianza": número entre 0 y 1, "resumen": "una oración con la conclusión", "argumentos": ["hasta 4"], "riesgos": ["hasta 3"], "que_verificar": ["hasta 3 datos concretos a revisar"]}`;
}

/** Normaliza la respuesta del modelo; devuelve null si no sirve. */
export function validarS2(r: unknown): RespuestaS2 | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (typeof o.veredicto !== "string" || !(o.veredicto in VEREDICTOS)) return null;
  const lista = (x: unknown, n: number) => (Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, n) : []);
  const conf = Number(o.confianza);
  return {
    veredicto: o.veredicto as VeredictoId,
    confianza: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
    resumen: String(o.resumen ?? ""),
    argumentos: lista(o.argumentos, 4),
    riesgos: lista(o.riesgos, 3),
    que_verificar: lista(o.que_verificar, 3),
  };
}
