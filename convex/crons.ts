import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Borra notas manuales vencidas (>DIAS_VIGENCIA días) y su imagen en storage.
// listarNotasPublicas solo las oculta del sitio; sin este cron la tabla
// notasManual y el storage asociado crecen sin límite para siempre.
crons.interval(
  "limpiar notas manuales vencidas",
  { hours: 24 },
  internal.notasManual.limpiarNotasVencidas,
  {},
);

export default crons;
