import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { verificarPassword } from "./auth";

// La tabla es chica (unos cuantos banners de anunciantes) — no hace falta
// paginación real, pero se pone un techo defensivo igual que en
// notasManual.ts para nunca dejar un .collect()/.take() sin límite.
const TECHO_LECTURA = 50;
// Techo por corrida del cron de limpieza de banners vencidos — igual de
// defensivo, no hay índice por expiraEn porque la tabla nunca debería tener
// más de unos cuantos banners.
const TECHO_LIMPIEZA_POR_CORRIDA = 200;

const bannerCreadoValidator = v.object({
  _id: v.id("banners"),
  imagenStorageId: v.id("_storage"),
  linkUrl: v.optional(v.string()),
  expiraEn: v.optional(v.string()),
  imagenUrl: v.union(v.string(), v.null()),
});

export const crearBanner = mutation({
  args: {
    password: v.string(),
    imagenStorageId: v.id("_storage"),
    linkUrl: v.optional(v.string()),
    diasVigencia: v.optional(v.number()),
  },
  returns: bannerCreadoValidator,
  handler: async (ctx, args) => {
    verificarPassword(args.password);

    const linkUrlLimpio = args.linkUrl?.trim() ? args.linkUrl.trim() : undefined;

    // Si diasVigencia no viene, o viene 0/negativo/no-finito, el banner
    // queda permanente (expiraEn: undefined) — mismo comportamiento que
    // antes de este campo.
    const expiraEn =
      args.diasVigencia !== undefined &&
      Number.isFinite(args.diasVigencia) &&
      args.diasVigencia > 0
        ? new Date(
            Date.now() + args.diasVigencia * 24 * 60 * 60 * 1000,
          ).toISOString()
        : undefined;

    const _id = await ctx.db.insert("banners", {
      imagenStorageId: args.imagenStorageId,
      linkUrl: linkUrlLimpio,
      expiraEn,
    });

    return {
      _id,
      imagenStorageId: args.imagenStorageId,
      linkUrl: linkUrlLimpio,
      expiraEn,
      imagenUrl: await ctx.storage.getUrl(args.imagenStorageId),
    };
  },
});

export const eliminarBanner = mutation({
  args: {
    password: v.string(),
    id: v.id("banners"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    verificarPassword(args.password);

    const banner = await ctx.db.get(args.id);
    if (!banner) {
      return null;
    }
    await ctx.storage.delete(banner.imagenStorageId);
    await ctx.db.delete(args.id);
    return null;
  },
});

const bannerPublicoValidator = v.object({
  id: v.string(),
  imagenUrl: v.string(),
  linkUrl: v.optional(v.string()),
  expiraEn: v.optional(v.string()),
});

export const listarBanners = query({
  args: {},
  returns: v.array(bannerPublicoValidator),
  handler: async (ctx) => {
    const banners = await ctx.db.query("banners").order("desc").take(TECHO_LECTURA);

    const ahora = new Date().toISOString();

    // ctx.storage.getUrl devuelve null si el storageId quedó huérfano
    // (archivo borrado por fuera). El frontend no espera imagenUrl: null,
    // así que esos banners se filtran en vez de mandarlos rotos. También se
    // filtran los banners ya vencidos (expiraEn pasado) aunque el cron de
    // limpieza todavía no haya corrido, para que dejen de mostrarse de
    // inmediato.
    const resultado: Array<{
      id: string;
      imagenUrl: string;
      linkUrl: string | undefined;
      expiraEn: string | undefined;
    }> = [];
    for (const banner of banners) {
      if (banner.expiraEn !== undefined && banner.expiraEn < ahora) continue;
      const imagenUrl = await ctx.storage.getUrl(banner.imagenStorageId);
      if (imagenUrl === null) continue;
      resultado.push({ id: banner._id, imagenUrl, linkUrl: banner.linkUrl, expiraEn: banner.expiraEn });
    }
    return resultado;
  },
});

// Housekeeping interno (invocado por el cron en convex/crons.ts). No exponer
// como función pública: borra filas y archivos de storage sin pasar por
// verificarPassword, así que solo debe llegar aquí desde el propio backend.
//
// listarBanners ya oculta los banners vencidos, pero no los borra de la
// tabla ni libera su imagen en storage — se quedarían ahí para siempre. Esto
// los borra de verdad, mismo patrón que notasManual.ts::limpiarNotasVencidas.
//
// La tabla es chica y no tiene índice por expiraEn, así que se hace una
// lectura simple acotada por TECHO_LIMPIEZA_POR_CORRIDA (techo defensivo, no
// debería haber más de unos cuantos banners nunca) y se filtra en memoria.
export const limpiarBannersVencidos = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const ahora = new Date().toISOString();

    const banners = await ctx.db.query("banners").take(TECHO_LIMPIEZA_POR_CORRIDA);

    for (const banner of banners) {
      if (banner.expiraEn === undefined || banner.expiraEn >= ahora) continue;
      await ctx.storage.delete(banner.imagenStorageId);
      await ctx.db.delete(banner._id);
    }

    return null;
  },
});
