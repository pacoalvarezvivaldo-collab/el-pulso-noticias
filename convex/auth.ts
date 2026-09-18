/** Compara dos strings en tiempo constante (mismo costo sin importar en qué
 * posición difieren), para no filtrar por timing cuánto del password acertó
 * un intento. Longitud distinta ya de por sí no es constante, pero eso solo
 * revela el largo del password, no su contenido. */
export function compararEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Lanza si `password` no coincide con la variable de entorno PANEL_PASSWORD. */
export function verificarPassword(password: string): void {
  const esperado = process.env.PANEL_PASSWORD;
  if (!esperado) {
    throw new Error(
      "500: PANEL_PASSWORD no está configurada en el deployment de Convex",
    );
  }
  if (!compararEnTiempoConstante(password, esperado)) {
    throw new Error("401: contraseña incorrecta");
  }
}
