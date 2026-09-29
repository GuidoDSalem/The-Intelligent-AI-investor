import type { Empresa } from "./tipos.ts";

/** Una empresa en el mapa del mercado (tamaño = capitalización, color = variación del día). */
export interface CeldaMapa {
  ticker: string;
  nombre: string;
  sector: string;
  /** Capitalización en millones de USD. */
  cap: number;
  precio: number;
  /** Variación del día en %, o null si no se conoce. */
  variacion: number | null;
  /** false si EDGAR no permite analizarla automáticamente (ver `motivo`). */
  analizable: boolean;
  motivo?: string;
}

/** Lo que el build embebe en la página publicada (data/snapshot.json). */
export interface Snapshot {
  generado: string;
  criterio?: string;
  /** Tickers que la página muestra al abrir. */
  destacadas?: string[];
  /** Empresas con todos los datos para el motor. */
  empresas: Empresa[];
  mapa?: CeldaMapa[];
}
