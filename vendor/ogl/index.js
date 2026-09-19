// Barrel local — solo lo que panel-aurora.js usa, a diferencia del
// index.js real de ogl (reexporta toda la librería: GLTFLoader, Text,
// Skin, Animation... nada de eso hace falta para el fondo aurora).
export { Renderer } from './core/Renderer.js';
export { Program } from './core/Program.js';
export { Mesh } from './core/Mesh.js';
export { Color } from './math/Color.js';
export { Triangle } from './extras/Triangle.js';
