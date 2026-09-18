import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { verificarPassword } from "./auth";

const categoriaValidator = v.union(
  v.literal("nacional"),
  v.literal("internacional"),
  v.literal("trending"),
);

const FUENTE_DEFAULT = "El Pulso Noticias";

// Ventana de recorte: debe coincidir con pipeline/noticias.py::trim_news
// (dias=4, max_por_categoria=20) para que las notas manuales se comporten
// igual que las automáticas al expirar/limitarse.
const DIAS_VIGENCIA = 4;
const MAX_POR_CATEGORIA = 20;
// Techo defensivo de lectura: la ventana de 4 días ya acota el volumen real,
// esto solo evita un .collect()/.take() sin límite si algún día se sube en
// volumen. Muy por debajo del límite de ~16k lecturas de Convex.
const TECHO_LECTURA = 1000;
// Techo por corrida del cron de limpieza: si algún día hay más de 500 notas
// vencidas en una sola corrida, el resto se limpia en la corrida del día
// siguiente — no es crítico que sea instantáneo.
const TECHO_LIMPIEZA_POR_CORRIDA = 500;

const notaCreadaValidator = v.object({
  _id: v.id("notasManual"),
  categoria: categoriaValidator,
  titulo: v.string(),
  resumen: v.string(),
  cuerpo: v.string(),
  fuente: v.string(),
  imagenStorageId: v.optional(v.id("_storage")),
  fecha: v.string(),
});

export const crearNota = mutation({
  args: {
    password: v.string(),
    categoria: categoriaValidator,
    titulo: v.string(),
    resumen: v.string(),
    cuerpo: v.string(),
    fuente: v.optional(v.string()),
    imagenStorageId: v.optional(v.id("_storage")),
  },
  returns: notaCreadaValidator,
  handler: async (ctx, args) => {
    verificarPassword(args.password);

    const titulo = args.titulo.trim();
    const resumen = args.resumen.trim();
    const cuerpo = args.cuerpo.trim();
    if (!titulo || !resumen || !cuerpo) {
      throw new Error(
        "400: titulo, resumen y cuerpo son obligatorios y no pueden estar vacíos",
      );
    }
    const fuente = args.fuente?.trim() ? args.fuente.trim() : FUENTE_DEFAULT;

    const fecha = new Date().toISOString();
    const _id = await ctx.db.insert("notasManual", {
      categoria: args.categoria,
      titulo,
      resumen,
      cuerpo,
      fuente,
      imagenStorageId: args.imagenStorageId,
      fecha,
    });

    return {
      _id,
      categoria: args.categoria,
      titulo,
      resumen,
      cuerpo,
      fuente,
      imagenStorageId: args.imagenStorageId,
      fecha,
    };
  },
});

export const generarUrlSubidaImagen = mutation({
  args: { password: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    verificarPassword(args.password);
    return await ctx.storage.generateUploadUrl();
  },
});

const notaPublicaValidator = v.object({
  id: v.string(),
  categoria: categoriaValidator,
  titulo: v.string(),
  resumen: v.string(),
  cuerpo: v.string(),
  fuente: v.string(),
  link: v.null(),
  fecha: v.string(),
  imagenUrl: v.union(v.string(), v.null()),
});

export const listarNotasPublicas = query({
  args: {},
  returns: v.array(notaPublicaValidator),
  handler: async (ctx) => {
    const limite = new Date(
      Date.now() - DIAS_VIGENCIA * 24 * 60 * 60 * 1000,
    ).toISOString();

    const vigentes = await ctx.db
      .query("notasManual")
      .withIndex("by_fecha", (q) => q.gte("fecha", limite))
      .order("desc")
      .take(TECHO_LECTURA);

    // Mismo criterio que trim_news: como máximo MAX_POR_CATEGORIA notas por
    // categoría, quedándose con las más recientes de cada una.
    const porCategoria = new Map<string, typeof vigentes>();
    for (const nota of vigentes) {
      const grupo = porCategoria.get(nota.categoria);
      if (grupo) {
        grupo.push(nota);
      } else {
        porCategoria.set(nota.categoria, [nota]);
      }
    }

    const limitadas = [];
    for (const grupo of porCategoria.values()) {
      limitadas.push(...grupo.slice(0, MAX_POR_CATEGORIA));
    }

    return await Promise.all(
      limitadas.map(async (nota) => ({
        id: nota._id,
        categoria: nota.categoria,
        titulo: nota.titulo,
        resumen: nota.resumen,
        cuerpo: nota.cuerpo,
        fuente: nota.fuente,
        link: null,
        fecha: nota.fecha,
        imagenUrl: nota.imagenStorageId
          ? await ctx.storage.getUrl(nota.imagenStorageId)
          : null,
      })),
    );
  },
});

// Housekeeping interno (invocado por el cron en convex/crons.ts). No exponer
// como función pública: borra filas y archivos de storage sin pasar por
// verificarPassword, así que solo debe llegar aquí desde el propio backend.
//
// listarNotasPublicas ya oculta las notas más viejas que DIAS_VIGENCIA, pero
// nunca las borraba de la tabla ni liberaba su imagen en storage — se
// quedaban ahí creciendo para siempre. Esto las borra de verdad, igual que
// pipeline/noticias.py::trim_news hace con news.json.
export const limpiarNotasVencidas = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const limite = new Date(
      Date.now() - DIAS_VIGENCIA * 24 * 60 * 60 * 1000,
    ).toISOString();

    const vencidas = await ctx.db
      .query("notasManual")
      .withIndex("by_fecha", (q) => q.lt("fecha", limite))
      .take(TECHO_LIMPIEZA_POR_CORRIDA);

    for (const nota of vencidas) {
      if (nota.imagenStorageId) {
        await ctx.storage.delete(nota.imagenStorageId);
      }
      await ctx.db.delete(nota._id);
    }

    return null;
  },
});
