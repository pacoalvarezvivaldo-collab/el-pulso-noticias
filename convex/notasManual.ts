import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

/** Lanza si `password` no coincide con la variable de entorno PANEL_PASSWORD. */
function verificarPassword(password: string): void {
  const esperado = process.env.PANEL_PASSWORD;
  if (!esperado) {
    throw new Error(
      "500: PANEL_PASSWORD no está configurada en el deployment de Convex",
    );
  }
  if (password !== esperado) {
    throw new Error("401: contraseña incorrecta");
  }
}

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
