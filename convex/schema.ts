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
  }),
});
