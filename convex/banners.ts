import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verificarPassword } from "./auth";

// La tabla es chica (unos cuantos banners de anunciantes) — no hace falta
// paginación real, pero se pone un techo defensivo igual que en
// notasManual.ts para nunca dejar un .collect()/.take() sin límite.
const TECHO_LECTURA = 50;

const bannerCreadoValidator = v.object({
  _id: v.id("banners"),
  imagenStorageId: v.id("_storage"),
  linkUrl: v.optional(v.string()),
  imagenUrl: v.union(v.string(), v.null()),
});

export const crearBanner = mutation({
  args: {
    password: v.string(),
    imagenStorageId: v.id("_storage"),
    linkUrl: v.optional(v.string()),
  },
  returns: bannerCreadoValidator,
  handler: async (ctx, args) => {
    verificarPassword(args.password);

    const linkUrlLimpio = args.linkUrl?.trim() ? args.linkUrl.trim() : undefined;

    const _id = await ctx.db.insert("banners", {
      imagenStorageId: args.imagenStorageId,
      linkUrl: linkUrlLimpio,
    });

    return {
      _id,
      imagenStorageId: args.imagenStorageId,
      linkUrl: linkUrlLimpio,
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
});

export const listarBanners = query({
  args: {},
  returns: v.array(bannerPublicoValidator),
  handler: async (ctx) => {
    const banners = await ctx.db.query("banners").order("desc").take(TECHO_LECTURA);

    // ctx.storage.getUrl devuelve null si el storageId quedó huérfano
    // (archivo borrado por fuera). El frontend no espera imagenUrl: null,
    // así que esos banners se filtran en vez de mandarlos rotos.
    const resultado: Array<{
      id: string;
      imagenUrl: string;
      linkUrl: string | undefined;
    }> = [];
    for (const banner of banners) {
      const imagenUrl = await ctx.storage.getUrl(banner.imagenStorageId);
      if (imagenUrl === null) continue;
      resultado.push({ id: banner._id, imagenUrl, linkUrl: banner.linkUrl });
    }
    return resultado;
  },
});
