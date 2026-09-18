import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// Panel y sitio (GitHub Pages) viven en un dominio distinto al deployment
// de Convex, y el frontend es HTML/JS plano sin el SDK de Convex — todo
// fetch() normal con JSON. Por eso CORS abierto en todas las rutas.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function preflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Los errores de negocio (password inválida, campos vacíos, etc.) se lanzan
// como `Error("401: ...")` / `Error("400: ...")` en convex/notasManual.ts.
// Aquí se traduce ese prefijo al status HTTP real en vez de responder 500
// genérico para cualquier fallo.
function errorResponse(err: unknown): Response {
  const mensaje = err instanceof Error ? err.message : String(err);
  // ctx.runMutation()/ctx.runQuery() envuelven el error de la función
  // interna como `Uncaught Error: <mensaje original>\n    at ...` (stack
  // incluido) — no como `<mensaje original>` a secas. Por eso se busca el
  // prefijo "NNN: " dentro de la primera línea en vez de anclarlo al inicio.
  const primeraLinea = mensaje.split("\n")[0];
  const match = primeraLinea.match(/(\d{3}):\s*(.+)$/);
  if (match) {
    return jsonResponse({ error: match[2] }, Number(match[1]));
  }
  // Un imagenStorageId mal formado o de otra tabla dispara
  // ArgumentValidationError al validar los args de la mutation: eso es un
  // error del cliente (400), no una falla del servidor (500).
  if (mensaje.includes("ArgumentValidationError")) {
    return jsonResponse({ error: "Datos inválidos" }, 400);
  }
  return jsonResponse({ error: "Error interno del servidor" }, 500);
}

const http = httpRouter();

http.route({
  path: "/api/notas",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const notas = await ctx.runQuery(api.notasManual.listarNotasPublicas, {});
    return jsonResponse(notas, 200);
  }),
});

http.route({
  path: "/api/notas",
  method: "OPTIONS",
  handler: httpAction(async () => preflightResponse()),
});

http.route({
  path: "/api/notas",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Body inválido: se esperaba JSON" }, 400);
    }

    const camposTexto = ["password", "categoria", "titulo", "resumen", "cuerpo"];
    for (const campo of camposTexto) {
      if (typeof body[campo] !== "string") {
        return jsonResponse(
          { error: `Falta el campo obligatorio o no es texto: ${campo}` },
          400,
        );
      }
    }
    if (
      body.categoria !== "nacional" &&
      body.categoria !== "internacional" &&
      body.categoria !== "trending"
    ) {
      return jsonResponse(
        { error: "categoria debe ser nacional, internacional o trending" },
        400,
      );
    }
    if (body.fuente !== undefined && typeof body.fuente !== "string") {
      return jsonResponse({ error: "fuente debe ser texto" }, 400);
    }
    if (
      body.imagenStorageId !== undefined &&
      body.imagenStorageId !== null &&
      typeof body.imagenStorageId !== "string"
    ) {
      return jsonResponse({ error: "imagenStorageId debe ser texto" }, 400);
    }

    try {
      const nota = await ctx.runMutation(api.notasManual.crearNota, {
        password: body.password as string,
        categoria: body.categoria as "nacional" | "internacional" | "trending",
        titulo: body.titulo as string,
        resumen: body.resumen as string,
        cuerpo: body.cuerpo as string,
        fuente: body.fuente as string | undefined,
        imagenStorageId: (body.imagenStorageId ?? undefined) as
          | Id<"_storage">
          | undefined,
      });
      return jsonResponse(nota, 201);
    } catch (err) {
      return errorResponse(err);
    }
  }),
});

http.route({
  path: "/api/subir-imagen-url",
  method: "OPTIONS",
  handler: httpAction(async () => preflightResponse()),
});

http.route({
  path: "/api/subir-imagen-url",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Body inválido: se esperaba JSON" }, 400);
    }
    if (typeof body.password !== "string") {
      return jsonResponse({ error: "Falta el campo password" }, 400);
    }

    try {
      const uploadUrl = await ctx.runMutation(
        api.notasManual.generarUrlSubidaImagen,
        { password: body.password },
      );
      return jsonResponse({ uploadUrl }, 200);
    } catch (err) {
      return errorResponse(err);
    }
  }),
});

http.route({
  path: "/api/banners",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const banners = await ctx.runQuery(api.banners.listarBanners, {});
    return jsonResponse(banners, 200);
  }),
});

http.route({
  path: "/api/banners",
  method: "OPTIONS",
  handler: httpAction(async () => preflightResponse()),
});

http.route({
  path: "/api/banners",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Body inválido: se esperaba JSON" }, 400);
    }

    if (typeof body.password !== "string") {
      return jsonResponse({ error: "Falta el campo password" }, 400);
    }
    if (typeof body.imagenStorageId !== "string") {
      return jsonResponse(
        { error: "Falta el campo obligatorio o no es texto: imagenStorageId" },
        400,
      );
    }
    if (body.linkUrl !== undefined && typeof body.linkUrl !== "string") {
      return jsonResponse({ error: "linkUrl debe ser texto" }, 400);
    }

    try {
      const banner = await ctx.runMutation(api.banners.crearBanner, {
        password: body.password,
        imagenStorageId: body.imagenStorageId as Id<"_storage">,
        linkUrl: body.linkUrl as string | undefined,
      });
      return jsonResponse(banner, 201);
    } catch (err) {
      return errorResponse(err);
    }
  }),
});

http.route({
  path: "/api/banners/eliminar",
  method: "OPTIONS",
  handler: httpAction(async () => preflightResponse()),
});

http.route({
  path: "/api/banners/eliminar",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Body inválido: se esperaba JSON" }, 400);
    }

    if (typeof body.password !== "string") {
      return jsonResponse({ error: "Falta el campo password" }, 400);
    }
    if (typeof body.id !== "string") {
      return jsonResponse(
        { error: "Falta el campo obligatorio o no es texto: id" },
        400,
      );
    }

    try {
      await ctx.runMutation(api.banners.eliminarBanner, {
        password: body.password,
        id: body.id as Id<"banners">,
      });
      return jsonResponse({ ok: true }, 200);
    } catch (err) {
      return errorResponse(err);
    }
  }),
});

export default http;
