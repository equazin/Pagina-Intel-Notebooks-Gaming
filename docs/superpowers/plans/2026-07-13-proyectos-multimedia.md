# Proyectos multimedia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir cada obra en un proyecto compartible con una secuencia vertical de imágenes y videos MP4 recortados y optimizados.

**Architecture:** `obras.json` continúa siendo la fuente canónica y suma un arreglo `medios`, compatible con los registros actuales. `proyecto.html?id=...` presenta el detalle; el panel crea todos los blobs y actualiza `main` con un único commit; el workflow copia el sitio, procesa los videos con FFmpeg y despliega el resultado.

**Tech Stack:** HTML, CSS y JavaScript sin framework; GitHub Git Data API; Node.js para validación; FFmpeg provisto por `ubuntu-latest`; GitHub Pages.

## Global Constraints

- Mantener el sitio público sin dependencias de runtime.
- Mantener compatibilidad con los registros actuales de `obras.json`.
- Mostrar videos como MP4 silenciosos, en loop y con controles.
- La secuencia del proyecto debe ser vertical y responsive.
- Todo control debe ser operable con teclado y tener un nombre accesible.
- Límite de video original: 50 MiB; duración seleccionada: entre 0,25 y 30 segundos.
- Publicar cada proyecto con un solo commit para evitar estados parciales.

---

### Task 1: Contrato de datos y procesamiento de video

**Files:**
- Create: `scripts/process-media.mjs`
- Create: `tests/process-media.test.mjs`
- Create: `package.json`

**Interfaces:**
- Consumes: `obras.json` y archivos indicados por `medio.original`.
- Produces: `collectVideoJobs(projects, rootDir)` y `buildFfmpegArgs(job)`; genera `medio.src`.

- [ ] **Step 1: Escribir pruebas fallidas para el contrato de video**

```js
test('collectVideoJobs ignores images and maps videos', () => {
  const jobs = collectVideoJobs([{ id: 'demo', medios: [{ tipo: 'video', original: 'source.mp4', src: 'loop.mp4', inicio: 1.25, fin: 4.75 }] }], '.');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].duration, 3.5);
});

test('buildFfmpegArgs creates a silent looping web MP4', () => {
  assert.deepEqual(buildFfmpegArgs(job), expectArgs);
});
```

- [ ] **Step 2: Ejecutar la prueba y confirmar el fallo**

Run: `npm test`

Expected: FAIL porque `scripts/process-media.mjs` todavía no existe.

- [ ] **Step 3: Implementar funciones puras y CLI**

```js
export const buildFfmpegArgs = ({ input, output, start, duration }) => [
  '-y', '-i', input, '-ss', String(start), '-t', String(duration),
  '-an', '-vf', 'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
  '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
  '-movflags', '+faststart', '-pix_fmt', 'yuv420p', output,
];
```

- [ ] **Step 4: Ejecutar las pruebas**

Run: `npm test`

Expected: PASS.

### Task 2: Vista pública compartible

**Files:**
- Create: `proyecto.html`
- Modify: `index.html`

**Interfaces:**
- Consumes: parámetro `id` y registros de `obras.json`.
- Produces: portada, metadatos y una secuencia semántica de `<figure>`.

- [ ] **Step 1: Crear la estructura accesible del detalle**

```html
<main id="project" class="project" aria-live="polite"></main>
<template id="mediaTemplate">
  <figure class="project-media"><div class="project-media__asset"></div><figcaption></figcaption></figure>
</template>
```

- [ ] **Step 2: Normalizar proyectos antiguos al cargar**

```js
const getProjectMedia = project => Array.isArray(project.medios) && project.medios.length
  ? project.medios
  : project.img ? [{ tipo: 'imagen', src: project.img, titulo: project.titulo, descripcion: project.descripcion }] : [];
```

- [ ] **Step 3: Renderizar imágenes y videos sin `innerHTML` de datos externos**

```js
const video = document.createElement('video');
video.src = media.src || media.original;
video.loop = true;
video.muted = true;
video.autoplay = true;
video.playsInline = true;
video.controls = true;
```

- [ ] **Step 4: Convertir cada tarjeta de la galería en enlace al proyecto**

```js
const href = `proyecto.html?id=${encodeURIComponent(project.id)}`;
card.setAttribute('href', href);
```

- [ ] **Step 5: Verificar URL inexistente, proyecto legado y proyecto multimedia**

Run: `python -m http.server 8000`

Expected: la galería navega, el botón Atrás vuelve y un ID desconocido muestra un mensaje recuperable.

### Task 3: Editor administrativo de medios

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: selección múltiple de JPEG, PNG, WebP y MP4.
- Produces: estado `draftMedia[]` con `tipo`, `file`, `titulo`, `descripcion`, `inicio`, `fin`, `isCover` y posición.

- [ ] **Step 1: Reemplazar el input único por selección múltiple**

```html
<input type="file" id="files" accept="image/jpeg,image/png,image/webp,video/mp4" multiple required>
<div id="mediaEditor" class="media-editor" aria-live="polite"></div>
```

- [ ] **Step 2: Crear una fila editable por archivo**

```js
const draft = {
  id: crypto.randomUUID(), file, tipo: file.type === 'video/mp4' ? 'video' : 'imagen',
  titulo: '', descripcion: '', inicio: 0, fin: 0, isCover: false,
};
```

- [ ] **Step 3: Incorporar orden y selección de portada**

```js
const moveMedia = (id, offset) => {
  const from = draftMedia.findIndex(item => item.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= draftMedia.length) return;
  [draftMedia[from], draftMedia[to]] = [draftMedia[to], draftMedia[from]];
  renderMediaEditor();
};
```

- [ ] **Step 4: Incorporar recorte temporal exacto**

```js
const setTrimPoint = (id, key, currentTime) => {
  const media = draftMedia.find(item => item.id === id);
  if (!media || media.tipo !== 'video') return;
  media[key] = Number(currentTime.toFixed(2));
  renderMediaEditor();
};
```

- [ ] **Step 5: Validar antes de publicar**

```js
if (!draftMedia.some(item => item.tipo === 'imagen' && item.isCover)) throw new Error('Elegí una imagen de portada.');
if (draftMedia.some(item => item.tipo === 'video' && (item.fin - item.inicio < 0.25 || item.fin - item.inicio > 30))) throw new Error('Cada clip debe durar entre 0,25 y 30 segundos.');
```

### Task 4: Publicación atómica mediante Git Data API

**Files:**
- Modify: `admin.html`

**Interfaces:**
- Consumes: lista de cambios `{ path, contentBase64|null }`.
- Produces: un blob por archivo, un tree, un commit y una actualización de `refs/heads/main`.

- [ ] **Step 1: Implementar `commitChanges`**

```js
const commitChanges = async (changes, message) => {
  const ref = await gh(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`).then(readJson);
  const parent = ref.object.sha;
  const commit = await gh(`/repos/${OWNER}/${REPO}/git/commits/${parent}`).then(readJson);
  const tree = await createTree(commit.tree.sha, changes);
  const next = await createCommit(message, tree.sha, parent);
  return gh(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: next.sha }) });
};
```

- [ ] **Step 2: Publicar medios y JSON juntos**

```js
changes.push({ path: 'obras.json', contentBase64: b64encode(JSON.stringify(projects, null, 2)) });
await commitChanges(changes, `Proyecto: ${title}`);
```

- [ ] **Step 3: Borrar JSON y activos en un solo commit**

```js
const removals = getProjectPaths(project).map(path => ({ path, contentBase64: null }));
await commitChanges([...removals, jsonChange], `Borrar proyecto: ${project.id}`);
```

### Task 5: Procesamiento y despliegue

**Files:**
- Modify: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: checkout y `scripts/process-media.mjs`.
- Produces: `_site` sin originales y con los loops optimizados.

- [ ] **Step 1: Preparar el directorio publicable**

```yaml
- name: Preparar sitio
  run: |
    mkdir _site
    rsync -a --exclude='.git' --exclude='_site' --exclude='tests' --exclude='docs' ./ _site/
```

- [ ] **Step 2: Procesar videos**

```yaml
- name: Optimizar loops de video
  run: node scripts/process-media.mjs --root _site
```

- [ ] **Step 3: Desplegar `_site`**

```yaml
with:
  path: _site
```

### Task 6: Verificación integral

**Files:**
- Test: `tests/process-media.test.mjs`

- [ ] **Step 1: Ejecutar pruebas automatizadas**

Run: `npm test`

Expected: todas las pruebas pasan.

- [ ] **Step 2: Probar escritorio y móvil**

Expected: sin overflow, secuencia a una columna, videos con controles y tarjetas accesibles.

- [ ] **Step 3: Probar teclado**

Expected: se puede abrir un proyecto, recorrer medios y volver sin usar mouse.

- [ ] **Step 4: Revisar cambios y working tree**

Run: `git diff --check && git status --short`

Expected: sin errores de whitespace; solo archivos intencionales modificados.
