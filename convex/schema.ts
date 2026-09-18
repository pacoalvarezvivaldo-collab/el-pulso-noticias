import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  notasManual: defineTable({
    categoria: v.union(
      v.literal("nacional"),
      v.literal("internacional"),
      v.literal("trending"),
    ),
    titulo: v.string(),
    resumen: v.string(),
    cuerpo: v.string(),
    fuente: v.string(),
    imagenStorageId: v.optional(v.id("_storage")),
    fecha: v.string(),
  })
    .index("by_categoria", ["categoria"])
    .index("by_fecha", ["fecha"]),

  banners: defineTable({
    imagenStorageId: v.id("_storage"),
    linkUrl: v.optional(v.string()),
    // Fecha ISO 8601 en la que el banner expira solo. Opcional: si no viene,
    // el banner no expira (comportamiento actual, se borra solo a mano).
    expiraEn: v.optional(v.string()),
  }),
});
