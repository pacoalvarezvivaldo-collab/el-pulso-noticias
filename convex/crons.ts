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

// Borra banners publicitarios vencidos (expiraEn pasado, campo opcional) y
// su imagen en storage. listarBanners solo los oculta del sitio; sin este
// cron los banners con vigencia vencida se quedarían en la tabla y en
// storage para siempre. Los banners sin expiraEn (permanentes) no los toca.
crons.interval(
  "limpiar banners vencidos",
  { hours: 24 },
  internal.banners.limpiarBannersVencidos,
  {},
);

export default crons;
