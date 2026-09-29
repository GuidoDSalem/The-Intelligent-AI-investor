/**
 * Datos de una empresa tal como los consume el motor.
 * Montos en millones (de la moneda del balance), acciones en millones,
 * `eps` y `precio` por acción. Lo que no aplica (p. ej. liquidez en un banco) va en `null`.
 */
export interface Empresa {
  ticker: string;
  nombre: string;
  sector: string;
  precio: number;
  acciones: number;
  /** Ganancia por acción de los últimos años, del más viejo al más nuevo (idealmente 10). */
  eps: number[];
  /** Año de cierre de cada valor de `eps` (opcional, para los gráficos). */
  anios?: number[];
  ventas: number;
  patrimonio: number;
  activoCorriente: number | null;
  pasivoCorriente: number | null;
  caja: number | null;
  deudaTotal: number | null;
  deudaLP: number | null;
  ebit: number | null;
  depreciaciones: number | null;
  intereses: number | null;
  flujoOperativo: number | null;
  capex: number | null;
  /** Años seguidos con dividendos, contando hacia atrás desde el último ejercicio. */
  aniosDividendos: number;
  /** Años con datos disponibles para contar dividendos (EDGAR/XBRL sólo cubre ~2009 en adelante). */
  aniosDividendosDisponibles?: number;
  /** Bancos, aseguradoras y otras financieras: liquidez y deuda no aplican. */
  banco?: boolean;
  ciclica?: boolean;
  fuente?: Fuente;
}

export interface Fuente {
  tipo: "edgar" | "manual" | "ejemplo";
  cik?: string;
  /** Fecha de cierre del último ejercicio usado (AAAA-MM-DD). */
  cierre?: string;
  /** Formulario y fecha de presentación del último balance usado. */
  formulario?: string;
  presentado?: string;
  url?: string;
  precioFuente?: string;
  precioFecha?: string;
  moneda?: string;
  /** Advertencias de la extracción (datos faltantes, ajustes por split, etc.). */
  avisos?: string[];
}

export type VeredictoId = "comprar" | "justo" | "cara" | "evitar";
