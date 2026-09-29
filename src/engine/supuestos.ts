/** Supuestos del motor: todo número que no viene del balance vive acá. */
export const SUPUESTOS = {
  version: "3",
  simulaciones: 4000,
  /** Rendimiento exigido r ~ U(a, b). */
  tasa: [0.09, 0.12] as [number, number],
  crecimientoTerminal: [0.015, 0.03] as [number, number],
  /** Años de crecimiento explícito antes del valor terminal. */
  horizonte: 5,
  crecimientoLimites: [-0.05, 0.18] as [number, number],
  /** "Tamaño adecuado": ventas mínimas, en millones. */
  ventasMinimas: 1000,
  /** Valor mediano ≥ 1,5 × precio: margen de seguridad de un tercio. */
  umbralComprar: 1.5,
  /** Valor mediano < 0,85 × precio: cara. */
  umbralCara: 0.85,
  /**
   * Si el flujo de caja libre es menos que esta fracción de la ganancia (p. ej. por inversión récord),
   * la base de la valuación pasa a ser esta fracción de la ganancia: Graham valuaba por ganancias.
   */
  conversionMinima: 0.6,
  /** Debajo de esta confianza el caso se escala al Sistema 2. */
  confianzaMinima: 0.35,
};
export type Supuestos = typeof SUPUESTOS;
