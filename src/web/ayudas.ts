import { type Analisis, VEREDICTOS } from "../engine/analisis.ts";
import { fmtPrecio, nf1, nf2, pct } from "../engine/formato.ts";
import { SUPUESTOS } from "../engine/supuestos.ts";
import { esc } from "./graficos.ts";

/**
 * Explicaciones de cada apartado del análisis: qué dato muestra, por qué importa y cómo leerlo.
 * `aca` (opcional) aplica la explicación a la empresa abierta.
 */
export interface Ayuda {
  que: string;
  porque: string;
  leer: string[];
  aca?: (a: Analisis) => string | null;
}

const S = SUPUESTOS;
const veces = (v: number | null) => (v === null ? "sin dato" : `${nf1.format(v)} veces`);

export const AYUDAS: Record<string, Ayuda> = {
  fuente: {
    que: "De dónde salen los números: el último balance anual (10-K) presentado ante la SEC, con su fecha, y de dónde salió el precio.",
    porque: "Un análisis vale lo que valen sus datos. Saber la fecha del balance te dice qué tan actualizado está, y los avisos te marcan qué tuvo que suponer el motor.",
    leer: [
      "Si el balance tiene más de un año, la empresa puede haber cambiado mucho: tomá el resultado con más cuidado.",
      "Los avisos de split son normales: el motor ajusta la ganancia por acción para que los años sean comparables.",
      "Si falta un dato (intereses, capex), la señal que lo usa queda como “sin dato” en vez de inventarse.",
    ],
    aca: a => a.c.fuente?.tipo === "edgar" ? `Ejercicio cerrado el ${a.c.fuente.cierre}; ${a.c.fuente.avisos?.length ?? 0} aviso(s) de extracción.` : null,
  },
  veredicto: {
    que: "La conclusión del motor: una de cuatro categorías, con su nivel de confianza y los motivos principales.",
    porque: "Resume todo el análisis en una decisión al estilo Graham: comprar sólo cuando hay margen de seguridad, esperar si el precio es justo, y evitar empresas frágiles aunque parezcan baratas.",
    leer: [
      `“Comprar con margen”: el valor mediano estimado es al menos ${nf2.format(S.umbralComprar)} veces el precio (margen de un tercio) y el negocio es sano.`,
      `“Precio justo”: vale más o menos lo que cuesta (entre ${nf2.format(S.umbralCara)} y ${nf2.format(S.umbralComprar)} veces). Buena para seguir, no para comprar ya.`,
      `“Cara”: el valor mediano es menos de ${nf2.format(S.umbralCara)} veces el precio; el mercado paga por un futuro mejor que el pasado.`,
      "“Evitar”: señales de fragilidad financiera (deuda alta, intereses difíciles de pagar, pérdidas frecuentes). El precio no importa.",
      `La confianza mide qué tan lejos quedó de los umbrales y qué tan dispersas son las simulaciones. Debajo de ${pct(S.confianzaMinima)} se sugiere el Sistema 2.`,
    ],
    aca: a => `Veredicto del Sistema 1: ${VEREDICTOS[a.s1.veredicto].txt.toLowerCase()} con ${pct(a.s1.confianza)} de confianza; el valor mediano es ${nf2.format(a.s1.ratio)} veces el precio.`,
  },
  valor: {
    que: `La distribución del valor por acción que surge de ${S.simulaciones.toLocaleString("es-AR")} simulaciones (barras), comparada con el precio actual (línea negra) y con tres valuaciones clásicas (marcas).`,
    porque: "Nadie conoce el valor exacto de una empresa: depende del crecimiento y de la tasa que exigís. Ver un rango en vez de un número te obliga a pensar en probabilidades, que es la idea del margen de seguridad.",
    leer: [
      "Si la línea del precio queda a la izquierda de casi todas las barras, la acción está barata con buena probabilidad; si queda a la derecha, está cara.",
      "La zona oscura es el rango probable (del 10 % al 90 % de las simulaciones). Cuanto más ancha, más incierto es el valor.",
      "Número de Graham: √(22,5 × EPS × valor libro); el precio máximo que Graham pagaba por una empresa defensiva.",
      `Flujo descontado: ${S.horizonte} años de flujo de caja creciendo y después un crecimiento perpetuo bajo, traídos a hoy con una tasa de ${pct(S.tasa[0])} a ${pct(S.tasa[1])}.`,
      "Fórmula de crecimiento: EPS × (8,5 + 2 × crecimiento). Es optimista y muy sensible al crecimiento supuesto.",
      "Si las tres marcas están lejos entre sí, los métodos no coinciden: la empresa es difícil de valuar.",
    ],
    aca: a => `Precio ${fmtPrecio(a.c.precio)}; rango probable ${fmtPrecio(a.s1.p10)} a ${fmtPrecio(a.s1.p90)}. Probabilidad de valer más que el precio: ${pct(a.s1.pSobre)}.`,
  },
  criterios: {
    que: "Los criterios que Benjamin Graham propone en “El inversor inteligente” para el inversor defensivo, aplicados uno por uno.",
    porque: "Son filtros simples y probados para evitar errores graves: empresas chicas, endeudadas, con ganancias erráticas o compradas demasiado caras.",
    leer: [
      "Cada fila muestra la regla, el valor de la empresa y si pasa. “n/a” significa que no aplica (por ejemplo, liquidez en un banco).",
      "Graham pedía cumplir todos; en la práctica, casi ninguna empresa de crecimiento los cumple. Mirá cuáles falla y por qué.",
      "Fallar en P/E o P/B indica precio alto; fallar en liquidez o deuda indica riesgo financiero; fallar en ganancias o dividendos indica un negocio inestable.",
      "La historia de EDGAR empieza hacia 2009, así que “20 años de dividendos” se da por cumplido si pagó todos los años con datos (mínimo 10).",
    ],
    aca: a => { const ap = a.d.criterios.filter(k => k.pasa !== null); return `Cumple ${ap.filter(k => k.pasa).length} de ${ap.length} criterios que aplican.`; },
  },
  eps: {
    que: "La ganancia por acción (EPS) de cada año, ajustada por splits, con el promedio de los últimos 3 años (y la ganancia normalizada si la empresa es cíclica).",
    porque: "Graham desconfiaba de un solo año bueno: quería ver ganancias estables y crecientes durante una década. Es la base de casi todas las valuaciones.",
    leer: [
      "Barras que suben de forma pareja: negocio estable y previsible. Barras en serrucho o rojas (pérdidas): negocio cíclico o frágil.",
      "El crecimiento compara el promedio de los primeros 3 años con el de los últimos 3; Graham pedía al menos +33 % en 10 años.",
      "La variabilidad mide cuánto se aparta la ganancia de su tendencia: si es alta, el motor la trata como cíclica y valúa con la ganancia normalizada, no con la del pico.",
    ],
    aca: a => `Crecimiento ${a.d.crecimiento === null ? "sin base" : `${a.d.crecimiento >= 0 ? "+" : ""}${Math.round(a.d.crecimiento * 100)} %`} entre puntas; ${a.d.positivos} de ${a.d.anios} años con ganancia${a.d.ciclica ? "; tratada como cíclica" : ""}.`,
  },
  rentabilidad: {
    que: "Cuánto gana la empresa en relación con su capital y con sus ventas: ROE, margen operativo y margen neto.",
    porque: "Un buen negocio genera mucha ganancia con poco capital. Una rentabilidad alta y sostenida suele indicar una ventaja competitiva.",
    leer: [
      "ROE (ganancia / patrimonio): por encima de 12-15 % es bueno; ojo si es altísimo por un patrimonio muy chico (recompras o deuda).",
      "Margen operativo (resultado operativo / ventas): compará con empresas del mismo sector, no entre sectores.",
      "Margen neto: lo que queda de cada peso vendido después de todo, impuestos incluidos.",
    ],
    aca: a => `ROE ${nf1.format(a.d.roe * 100)} %; margen neto ${nf1.format(a.d.margenNeto * 100)} %.`,
  },
  solidez: {
    que: "La capacidad de la empresa de pagar sus deudas: liquidez corriente, capital de trabajo, deuda neta sobre EBITDA y cobertura de intereses.",
    porque: "Graham ponía la supervivencia primero: una empresa endeudada puede quebrar en una crisis aunque el negocio sea bueno. Por eso “Evitar” se decide con estos números.",
    leer: [
      "Liquidez corriente (activo corriente / pasivo corriente): Graham pedía 2 o más.",
      "Deuda neta / EBITDA: menos de 2 es cómodo; más de 4 es peligroso (el motor lo marca como fragilidad).",
      "Cobertura de intereses (resultado operativo / intereses): más de 5 es holgado; menos de 3 es frágil.",
      "En bancos y aseguradoras no aplican: la deuda es su materia prima.",
    ],
    aca: a => a.d.banco ? "Es una financiera: estos ratios no aplican." : `Liquidez ${a.d.liquidez === null ? "sin dato" : nf2.format(a.d.liquidez)}; deuda neta ${veces(a.d.deudaNetaEbitda)} el EBITDA; cobertura ${veces(a.d.cobertura)}.`,
  },
  caja: {
    que: "El flujo de caja libre: lo que genera la operación menos lo que se invierte en bienes de uso (capex), total y por acción.",
    porque: "La ganancia contable se puede maquillar; la caja no. Si la ganancia no se convierte en caja año tras año, algo no cierra.",
    leer: [
      "Caja / ganancia cerca de 1 o más: la ganancia es real. Muy por debajo: mucha inversión (puede ser crecimiento) o problemas de cobro.",
      "FCF yield (flujo libre / capitalización): comparalo con la tasa de un bono; cuanto más alto, más barata la acción.",
      `Si la caja es menos del ${Math.round(S.conversionMinima * 100)} % de la ganancia por una inversión récord, el motor valúa con ese porcentaje de la ganancia.`,
    ],
    aca: a => a.d.fcf === null ? "Sin dato de flujo de caja libre." : `Caja / ganancia ${a.d.conversion === null ? "no calculable" : nf2.format(a.d.conversion)}; FCF yield ${a.d.fcfYield === null ? "sin dato" : pct(a.d.fcfYield)}.`,
  },
  multiplos: {
    que: "Cuánto pagás por cada peso de ganancia, de patrimonio o de EBITDA: P/E, P/B, P/E × P/B y EV/EBITDA.",
    porque: "Son la forma más rápida de saber si una acción está cara o barata frente a su historia, a su sector y a los límites de Graham.",
    leer: [
      "P/E (precio / EPS promedio de 3 años): Graham pedía 15 o menos.",
      "P/B (precio / valor libro por acción): Graham pedía 1,5 o menos, o P/E × P/B ≤ 22,5.",
      "EV/EBITDA incluye la deuda en el precio: sirve para comparar empresas con distinto endeudamiento.",
      "Un múltiplo bajo no alcanza: puede ser barato porque el negocio empeora (trampa de valor).",
    ],
    aca: a => `P/E ${a.d.pe === null ? "negativo" : nf1.format(a.d.pe)}; P/B ${a.d.pb === null ? "sin dato" : nf2.format(a.d.pb)}.`,
  },
  senales: {
    que: "Las señales de calidad que usa el Sistema 1: cada una suma (verde) o resta (rojo) a un puntaje que se convierte en un porcentaje de calidad.",
    porque: "El precio dice si es barata; la calidad dice si vale la pena. Combinar ambas evita comprar negocios malos sólo porque cotizan bajo.",
    leer: [
      "La barra hacia la derecha suma calidad; hacia la izquierda, resta. El largo muestra cuánto pesa.",
      "Las ponderaciones están fijadas a mano (no calibradas con datos históricos): usalas como guía, no como verdad.",
      "Si la calidad es alta pero el veredicto es “Cara”, hay un choque de señales y el caso se escala al Sistema 2.",
    ],
    aca: a => `Calidad ${pct(a.s1.calidad)}.`,
  },
  sistema2: {
    que: "El razonamiento de Claude sobre este caso, a partir de los números ya calculados: veredicto, argumentos, riesgos y qué verificar.",
    porque: "El código no sabe en qué parte del ciclo está una empresa ni si su crecimiento justifica el precio. Para esos casos puntuales conviene razonar, y sólo para esos.",
    leer: [
      "Se sugiere cuando la confianza es baja, las señales chocan o la empresa es cíclica. Igual lo podés pedir siempre.",
      "Si coincide con el Sistema 1, la conclusión es más sólida; si lo corrige, leé los argumentos antes de decidir.",
      "“Qué verificar” lista datos que el motor no tiene: revisalos en el 10-K o en las noticias.",
    ],
    aca: a => a.s1.escalar.length ? `Escalado por ${a.s1.escalar.length} motivo(s).` : "No hizo falta escalarlo.",
  },
  traza: {
    que: "Qué hizo cada capa del motor con esta empresa y cuánto tardó.",
    porque: "Hace el análisis auditable: con los mismos datos, el código determinístico y el Sistema 1 dan siempre el mismo resultado (la simulación usa una semilla fija).",
    leer: [
      "“Capa fija”: cálculos exactos (ratios, criterios, valuaciones).",
      "“Sistema 1”: simulaciones y señales; la semilla permite reproducir el resultado.",
      "“Sistema 2”: si se consultó a Claude y qué concluyó.",
    ],
  },
  mapa: {
    que: "Las mayores empresas de EE. UU. agrupadas por sector. El tamaño de cada cuadro es su capitalización; el color, cuánto subió (verde) o bajó (rojo) en el día.",
    porque: "Da el panorama del mercado de un vistazo: qué sectores pesan más, qué empresas dominan y cómo se movieron hoy. Tocando un cuadro, pasás del precio al análisis del negocio.",
    leer: [
      "Rojo o verde intenso: movimientos de 3 % o más; gris: casi sin cambio.",
      "Un cuadro rayado es una empresa que EDGAR no permite analizar automáticamente (por ejemplo, reporta por clase de acción).",
      "Graham decía que el precio de un día es la opinión del “señor Mercado”: el color no dice si la empresa es buena o mala.",
    ],
  },
};

/** Botón “?” para un encabezado. */
export const botonAyuda = (id: string) =>
  `<button type="button" class="ayuda-btn" data-ayuda="${id}" aria-expanded="false" aria-controls="ay-${id}" title="Qué muestra, por qué importa y cómo leerlo" aria-label="Explicar este apartado">?</button>`;

/** Panel de explicación (oculto hasta que se toca el botón). */
export function panelAyuda(id: string, a?: Analisis): string {
  const h = AYUDAS[id];
  if (!h) return "";
  const aca = a && h.aca ? h.aca(a) : null;
  return `<div class="ayuda" id="ay-${id}" hidden>
    <div><h5>Qué muestra</h5><p>${esc(h.que)}</p></div>
    <div><h5>Por qué importa</h5><p>${esc(h.porque)}</p></div>
    <div><h5>Cómo leerlo</h5><ul>${h.leer.map(l => `<li>${esc(l)}</li>`).join("")}</ul></div>
    ${aca ? `<p class="ayuda-aca"><b>En esta empresa:</b> ${esc(aca)}</p>` : ""}
  </div>`;
}

/** Abre o cierra el panel asociado a un botón “?”. */
export function alternarAyuda(boton: HTMLElement) {
  const panel = document.getElementById("ay-" + boton.dataset.ayuda);
  if (!panel) return;
  panel.hidden = !panel.hidden;
  boton.setAttribute("aria-expanded", String(!panel.hidden));
}
