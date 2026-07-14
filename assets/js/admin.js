const hostOwner = location.hostname.split('.')[0];
const pathSegments = location.pathname.split('/').filter(Boolean);
const isGitHubPagesHost = location.hostname.endsWith('.github.io');
const OWNER = isGitHubPagesHost ? hostOwner : 'equazin';
const REPO = isGitHubPagesHost && pathSegments[0] && !/\.html?$/.test(pathSegments[0])
  ? pathSegments[0]
  : 'sophia-maseda-portfolio';
const BRANCH = 'main';
const API = 'https://api.github.com';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MIN_CLIP_SECONDS = 0.25;
const MAX_CLIP_SECONDS = 30;
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const $ = id => document.getElementById(id);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

let accessToken = '';
let draftMedia = [];

localStorage.removeItem('gh_token');

const encodeBase64 = value => btoa(unescape(encodeURIComponent(value)));
const decodeBase64 = value => decodeURIComponent(escape(atob(value.replace(/\s/g, ''))));
const bufferToBase64 = buffer => btoa(String.fromCharCode(...new Uint8Array(buffer)));
const base64ToBuffer = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
const slugify = value => (value || 'proyecto').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/(^-|-$)/g, '')
  .slice(0, 40) || 'proyecto';
const categoryName = category => ({ personajes:'Personajes', '3d':'3D', splash:'Splash Arts', diseno:'Diseño' }[category] || category);

const setStatus = (element, message, type='') => {
  element.className = `status${type ? ` ${type}` : ''}`;
  element.textContent = message;
};

const readJsonResponse = async response => {
  const data = await response.json().catch(() => ({}));
  if(!response.ok) throw new Error(data.message || `GitHub respondió con el código ${response.status}.`);
  return data;
};

const githubRequest = (path, options={}) => fetch(`${API}${path}`, {
  ...options,
  headers: {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  },
});

const blobToBase64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result.split(',')[1]);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const compressImage = async (file, maxSide=1800) => {
  try{
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const webpBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if(webpBlob && (webpBlob.size < file.size || scale < 1)) return { blob:webpBlob, extension:'webp' };
    return { blob:file, extension:(file.name.split('.').pop() || 'jpg').toLowerCase() };
  }catch{
    return { blob:file, extension:(file.name.split('.').pop() || 'jpg').toLowerCase() };
  }
};

const getProjects = async () => {
  const response = await githubRequest(`/repos/${OWNER}/${REPO}/contents/obras.json?ref=${BRANCH}&t=${Date.now()}`);
  if(response.status === 404) return [];
  const data = await readJsonResponse(response);
  const projects = JSON.parse(decodeBase64(data.content));
  return Array.isArray(projects) ? projects : [];
};

const getContent = async () => {
  const response = await githubRequest(`/repos/${OWNER}/${REPO}/contents/contenido.json?ref=${BRANCH}&t=${Date.now()}`);
  if(response.status === 404) return { data:{}, sha:null };
  const payload = await readJsonResponse(response);
  return { data:JSON.parse(decodeBase64(payload.content)), sha:payload.sha };
};

const putFile = (path, content, message, sha) => {
  const body = { message, content, branch:BRANCH };
  if(sha) body.sha = sha;
  return githubRequest(`/repos/${OWNER}/${REPO}/contents/${path}`, { method:'PUT', body:JSON.stringify(body) });
};

const createBlob = async contentBase64 => {
  const response = await githubRequest(`/repos/${OWNER}/${REPO}/git/blobs`, {
    method:'POST',
    body:JSON.stringify({ content:contentBase64, encoding:'base64' }),
  });
  return readJsonResponse(response);
};

const commitChanges = async (changes, message, onProgress=()=>{}) => {
  const ref = await readJsonResponse(await githubRequest(`/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`));
  const parentSha = ref.object.sha;
  const parentCommit = await readJsonResponse(await githubRequest(`/repos/${OWNER}/${REPO}/git/commits/${parentSha}`));
  const treeEntries = [];
  let completed = 0;

  for(const change of changes){
    if(change.contentBase64 === null){
      treeEntries.push({ path:change.path, mode:'100644', type:'blob', sha:null });
    }else{
      const blob = await createBlob(change.contentBase64);
      treeEntries.push({ path:change.path, mode:'100644', type:'blob', sha:blob.sha });
    }
    completed += 1;
    onProgress(completed, changes.length);
  }

  const tree = await readJsonResponse(await githubRequest(`/repos/${OWNER}/${REPO}/git/trees`, {
    method:'POST',
    body:JSON.stringify({ base_tree:parentCommit.tree.sha, tree:treeEntries }),
  }));
  const commit = await readJsonResponse(await githubRequest(`/repos/${OWNER}/${REPO}/git/commits`, {
    method:'POST',
    body:JSON.stringify({ message, tree:tree.sha, parents:[parentSha] }),
  }));
  await readJsonResponse(await githubRequest(`/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    method:'PATCH',
    body:JSON.stringify({ sha:commit.sha, force:false }),
  }));
};

const deriveKey = async (pin, salt) => {
  const baseKey = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations:250000, hash:'SHA-256' },
    baseKey,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const encryptToken = async (token, pin) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const ciphertext = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, encoder.encode(token));
  return { salt:bufferToBase64(salt), iv:bufferToBase64(iv), ciphertext:bufferToBase64(ciphertext) };
};

const decryptToken = async (encrypted, pin) => {
  const key = await deriveKey(pin, base64ToBuffer(encrypted.salt));
  const plaintext = await crypto.subtle.decrypt(
    { name:'AES-GCM', iv:base64ToBuffer(encrypted.iv) },
    key,
    base64ToBuffer(encrypted.ciphertext || encrypted.ct),
  );
  return decoder.decode(plaintext);
};

const showLogin = () => {
  $('app').classList.add('hidden');
  $('helpPanel').classList.remove('hidden');
  const hasStoredAccess = Boolean(localStorage.getItem('gh_enc'));
  $('setupPanel').classList.toggle('hidden', hasStoredAccess);
  $('unlockPanel').classList.toggle('hidden', !hasStoredAccess);
  if(hasStoredAccess) setTimeout(() => $('pin').focus(), 50);
};

const showApp = () => {
  $('setupPanel').classList.add('hidden');
  $('unlockPanel').classList.add('hidden');
  $('helpPanel').classList.add('hidden');
  $('app').classList.remove('hidden');
  loadProjectList();
  loadAbout();
};

const handleSetup = async () => {
  const token = $('token').value.trim();
  const pin = $('newPin').value;
  const repeatedPin = $('repeatedPin').value;
  if(!token) return setStatus($('setupStatus'), 'Pegá tu token de GitHub.', 'err');
  if(pin.length < 6) return setStatus($('setupStatus'), 'El PIN debe tener al menos seis caracteres.', 'err');
  if(pin !== repeatedPin) return setStatus($('setupStatus'), 'Los PIN no coinciden.', 'err');

  try{
    accessToken = token;
    setStatus($('setupStatus'), 'Verificando el acceso…');
    await readJsonResponse(await githubRequest(`/repos/${OWNER}/${REPO}`));
    const encrypted = await encryptToken(token, pin);
    localStorage.setItem('gh_enc', JSON.stringify(encrypted));
    $('token').value = '';
    $('newPin').value = '';
    $('repeatedPin').value = '';
    showApp();
  }catch(error){
    accessToken = '';
    setStatus($('setupStatus'), `No se pudo guardar el acceso: ${error.message}`, 'err');
  }
};

let failedUnlocks = 0;
const handleUnlock = async () => {
  const pin = $('pin').value;
  if(!pin) return;
  try{
    setStatus($('unlockStatus'), 'Verificando…');
    accessToken = await decryptToken(JSON.parse(localStorage.getItem('gh_enc')), pin);
    failedUnlocks = 0;
    $('pin').value = '';
    showApp();
  }catch{
    accessToken = '';
    failedUnlocks += 1;
    setStatus($('unlockStatus'), 'El PIN es incorrecto.', 'err');
    if(failedUnlocks >= 3){
      $('unlockBtn').disabled = true;
      setTimeout(() => { $('unlockBtn').disabled = false; }, 4000);
    }
  }
};

const handleReset = () => {
  if(!confirm('Esto borra el acceso guardado en este navegador. ¿Querés continuar?')) return;
  localStorage.removeItem('gh_enc');
  accessToken = '';
  failedUnlocks = 0;
  showLogin();
};

const handleLogout = () => {
  accessToken = '';
  showLogin();
};

const loadAbout = async () => {
  try{
    const { data } = await getContent();
    const about = data.about || {};
    $('aboutTitle').value = about.titulo || 'Sobre mí';
    $('aboutText').value = (about.parrafos || []).join('\n\n');
  }catch(error){
    setStatus($('aboutStatus'), `No se pudo cargar: ${error.message}`, 'err');
  }
};

const saveAbout = async () => {
  $('aboutSaveBtn').disabled = true;
  try{
    setStatus($('aboutStatus'), 'Guardando…');
    const { data, sha } = await getContent();
    data.about = {
      titulo:$('aboutTitle').value.trim() || 'Sobre mí',
      parrafos:$('aboutText').value.split(/\n\s*\n/).map(value => value.trim()).filter(Boolean),
    };
    await readJsonResponse(await putFile('contenido.json', encodeBase64(JSON.stringify(data, null, 2)), 'Actualizar Sobre mí', sha));
    setStatus($('aboutStatus'), 'Guardado. Se publicará en aproximadamente un minuto.', 'ok');
  }catch(error){
    setStatus($('aboutStatus'), `No se pudo guardar: ${error.message}`, 'err');
  }finally{
    $('aboutSaveBtn').disabled = false;
  }
};

const createElement = (tagName, className='', text='') => {
  const element = document.createElement(tagName);
  if(className) element.className = className;
  if(text) element.textContent = text;
  return element;
};

const updateDraft = (id, changes) => {
  const item = draftMedia.find(media => media.id === id);
  if(item) Object.assign(item, changes);
};

const moveDraft = (id, offset) => {
  const fromIndex = draftMedia.findIndex(media => media.id === id);
  const toIndex = fromIndex + offset;
  if(fromIndex < 0 || toIndex < 0 || toIndex >= draftMedia.length) return;
  [draftMedia[fromIndex], draftMedia[toIndex]] = [draftMedia[toIndex], draftMedia[fromIndex]];
  renderMediaEditor();
};

const removeDraft = id => {
  const item = draftMedia.find(media => media.id === id);
  if(item) URL.revokeObjectURL(item.previewUrl);
  const removedCover = item?.isCover;
  draftMedia = draftMedia.filter(media => media.id !== id);
  if(removedCover){
    const nextImage = draftMedia.find(media => media.tipo === 'imagen');
    if(nextImage) nextImage.isCover = true;
  }
  renderMediaEditor();
};

const makeButton = (label, onClick, className='ghost') => {
  const button = createElement('button', className, label);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
};

const createField = (labelText, input) => {
  const field = createElement('div', 'field');
  const label = createElement('label', '', labelText);
  label.htmlFor = input.id;
  field.append(label, input);
  return field;
};

const renderVideoTrim = (item, preview) => {
  const trim = createElement('div', 'trim-editor');
  const durationText = createElement('p', 'hint', `Duración original: ${item.duration.toFixed(2)} s. El clip puede durar hasta ${MAX_CLIP_SECONDS} s.`);
  const controls = createElement('div', 'trim-grid');

  for(const [key, labelText] of [['inicio', 'Inicio (segundos)'], ['fin', 'Fin (segundos)']]){
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.01';
    input.min = key === 'inicio' ? '0' : String(MIN_CLIP_SECONDS);
    input.max = String(item.duration);
    input.value = item[key].toFixed(2);
    input.id = `${key}-${item.id}`;
    input.addEventListener('input', () => updateDraft(item.id, { [key]:Number(input.value) }));
    const field = createField(labelText, input);
    field.appendChild(makeButton('Usar posición actual', () => {
      updateDraft(item.id, { [key]:Number(preview.currentTime.toFixed(2)) });
      renderMediaEditor();
    }, 'mini'));
    controls.appendChild(field);
  }

  trim.append(durationText, controls);
  return trim;
};

const renderMediaEditor = () => {
  const container = $('mediaEditor');
  container.replaceChildren();
  if(!draftMedia.length){
    container.appendChild(createElement('p', 'empty-state', 'Todavía no seleccionaste archivos.'));
    return;
  }

  draftMedia.forEach((item, index) => {
    const card = createElement('article', 'media-card');
    const top = createElement('div', 'media-card__top');
    const order = createElement('span', 'media-card__order', String(index + 1));
    const preview = item.tipo === 'video' ? document.createElement('video') : document.createElement('img');
    preview.className = 'media-card__preview';
    preview.src = item.previewUrl;
    if(item.tipo === 'video'){
      preview.controls = true;
      preview.muted = true;
      preview.playsInline = true;
      preview.preload = 'metadata';
    }else{
      preview.alt = '';
    }
    const actions = createElement('div', 'media-card__actions');
    const up = makeButton('↑', () => moveDraft(item.id, -1), 'icon-button');
    up.disabled = index === 0;
    up.setAttribute('aria-label', 'Mover medio hacia arriba');
    const down = makeButton('↓', () => moveDraft(item.id, 1), 'icon-button');
    down.disabled = index === draftMedia.length - 1;
    down.setAttribute('aria-label', 'Mover medio hacia abajo');
    actions.append(up, down, makeButton('Quitar', () => removeDraft(item.id), 'danger mini'));
    top.append(order, preview, actions);

    const fields = createElement('div', 'media-card__fields');
    const titleInput = document.createElement('input');
    titleInput.id = `media-title-${item.id}`;
    titleInput.value = item.titulo;
    titleInput.placeholder = item.tipo === 'video' ? 'Ej.: Turntable final' : 'Ej.: Vista lateral';
    titleInput.addEventListener('input', () => updateDraft(item.id, { titulo:titleInput.value }));
    const descriptionInput = document.createElement('textarea');
    descriptionInput.id = `media-description-${item.id}`;
    descriptionInput.value = item.descripcion;
    descriptionInput.placeholder = 'Explicá esta etapa o vista…';
    descriptionInput.addEventListener('input', () => updateDraft(item.id, { descripcion:descriptionInput.value }));
    fields.append(createField('Título del medio', titleInput), createField('Descripción', descriptionInput));

    if(item.tipo === 'imagen'){
      const coverLabel = createElement('label', 'cover-choice');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'cover';
      radio.checked = item.isCover;
      radio.addEventListener('change', () => {
        draftMedia.forEach(media => { media.isCover = media.id === item.id; });
        renderMediaEditor();
      });
      coverLabel.append(radio, document.createTextNode(' Usar como portada del proyecto'));
      fields.appendChild(coverLabel);
    }else{
      fields.appendChild(renderVideoTrim(item, preview));
    }

    card.append(top, fields);
    container.appendChild(card);
  });
};

const readVideoMetadata = item => new Promise((resolve, reject) => {
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.onloadedmetadata = () => {
    item.duration = Number(video.duration.toFixed(2));
    item.inicio = 0;
    item.fin = Math.min(item.duration, 6);
    resolve();
  };
  video.onerror = () => reject(new Error(`No se pudo leer el video “${item.file.name}”.`));
  video.src = item.previewUrl;
});

const handleFiles = async event => {
  const selectedFiles = Array.from(event.target.files || []);
  setStatus($('projectStatus'), '');

  try{
    for(const file of selectedFiles){
      const isImage = acceptedImageTypes.has(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name);
      const isVideo = file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
      if(!isImage && !isVideo) throw new Error(`“${file.name}” no es una imagen compatible ni un MP4.`);
      if(isImage && file.size > MAX_IMAGE_BYTES) throw new Error(`“${file.name}” supera el límite de 20 MiB.`);
      if(isVideo && file.size > MAX_VIDEO_BYTES) throw new Error(`“${file.name}” supera el límite de 50 MiB.`);

      const item = {
        id:crypto.randomUUID(),
        file,
        tipo:isVideo ? 'video' : 'imagen',
        previewUrl:URL.createObjectURL(file),
        titulo:'',
        descripcion:'',
        isCover:false,
        duration:0,
        inicio:0,
        fin:0,
      };
      if(isVideo) await readVideoMetadata(item);
      if(isImage && !draftMedia.some(media => media.isCover)) item.isCover = true;
      draftMedia.push(item);
    }
    renderMediaEditor();
  }catch(error){
    setStatus($('projectStatus'), error.message, 'err');
  }finally{
    event.target.value = '';
  }
};

const validateDraft = () => {
  if(!draftMedia.length) throw new Error('Seleccioná al menos un archivo.');
  if(!draftMedia.some(item => item.tipo === 'imagen' && item.isCover)) throw new Error('Elegí una imagen como portada.');
  for(const item of draftMedia){
    if(item.tipo !== 'video') continue;
    const clipDuration = item.fin - item.inicio;
    if(!Number.isFinite(clipDuration) || item.inicio < 0 || item.fin > item.duration || clipDuration < MIN_CLIP_SECONDS || clipDuration > MAX_CLIP_SECONDS){
      throw new Error(`El recorte de “${item.file.name}” debe durar entre ${MIN_CLIP_SECONDS} y ${MAX_CLIP_SECONDS} segundos.`);
    }
  }
};

const prepareProjectChanges = async projectId => {
  const changes = [];
  const mediaRecords = [];
  let coverPath = '';

  for(let index = 0; index < draftMedia.length; index += 1){
    const item = draftMedia[index];
    const order = String(index + 1).padStart(2, '0');
    const baseName = slugify(item.titulo || item.file.name.replace(/\.[^.]+$/, ''));

    if(item.tipo === 'imagen'){
      const { blob, extension } = await compressImage(item.file);
      const path = `assets/proyectos/${projectId}/${order}-${baseName}.${extension}`;
      changes.push({ path, contentBase64:await blobToBase64(blob) });
      mediaRecords.push({ tipo:'imagen', src:path, titulo:item.titulo.trim(), descripcion:item.descripcion.trim(), esPortada:item.isCover });
      if(item.isCover) coverPath = path;
    }else{
      const original = `assets/proyectos/${projectId}/original/${order}-${baseName}.mp4`;
      const output = `assets/proyectos/${projectId}/${order}-${baseName}-loop.mp4`;
      changes.push({ path:original, contentBase64:await blobToBase64(item.file) });
      mediaRecords.push({
        tipo:'video', original, src:output,
        titulo:item.titulo.trim(), descripcion:item.descripcion.trim(),
        inicio:Number(item.inicio.toFixed(2)), fin:Number(item.fin.toFixed(2)),
      });
    }
  }

  return { changes, mediaRecords, coverPath };
};

const resetProjectForm = () => {
  draftMedia.forEach(item => URL.revokeObjectURL(item.previewUrl));
  draftMedia = [];
  $('projectForm').reset();
  renderMediaEditor();
};

const publishProject = async event => {
  event.preventDefault();
  const title = $('projectTitle').value.trim();
  if(!title) return setStatus($('projectStatus'), 'Escribí el título del proyecto.', 'err');

  $('publishBtn').disabled = true;
  try{
    validateDraft();
    const projectId = `${slugify(title)}-${Date.now()}`;
    setStatus($('projectStatus'), 'Preparando imágenes y videos…');
    const { changes, mediaRecords, coverPath } = await prepareProjectChanges(projectId);
    const projects = await getProjects();
    projects.unshift({
      id:projectId,
      titulo:title,
      categoria:$('projectCategory').value,
      descripcion:$('projectDescription').value.trim(),
      portada:coverPath,
      img:coverPath,
      emoji:'',
      pos:'50% 50%',
      medios:mediaRecords,
    });
    changes.push({ path:'obras.json', contentBase64:encodeBase64(JSON.stringify(projects, null, 2)) });

    await commitChanges(changes, `Proyecto: ${title}`, (completed, total) => {
      setStatus($('projectStatus'), `Subiendo archivo ${completed} de ${total}…`);
    });
    setStatus($('projectStatus'), 'Proyecto publicado. El video estará optimizado cuando termine el despliegue.', 'ok');
    resetProjectForm();
    loadProjectList();
  }catch(error){
    setStatus($('projectStatus'), `No se pudo publicar: ${error.message}`, 'err');
  }finally{
    $('publishBtn').disabled = false;
  }
};

const getTrackedProjectPaths = project => {
  const paths = new Set();
  if(project.img) paths.add(project.img);
  if(project.portada) paths.add(project.portada);
  for(const media of Array.isArray(project.medios) ? project.medios : []){
    if(media.tipo === 'imagen' && media.src) paths.add(media.src);
    if(media.tipo === 'video' && media.original) paths.add(media.original);
  }
  return [...paths].filter(path => path.startsWith('assets/'));
};

const deleteProject = async projectId => {
  if(!confirm('¿Querés borrar este proyecto y todos sus archivos? Esta acción no se puede deshacer.')) return;
  try{
    setStatus($('listStatus'), 'Borrando el proyecto…');
    const projects = await getProjects();
    const project = projects.find(item => item.id === projectId);
    if(!project) throw new Error('El proyecto ya no existe.');
    const nextProjects = projects.filter(item => item.id !== projectId);
    const changes = getTrackedProjectPaths(project).map(path => ({ path, contentBase64:null }));
    changes.push({ path:'obras.json', contentBase64:encodeBase64(JSON.stringify(nextProjects, null, 2)) });
    await commitChanges(changes, `Borrar proyecto: ${project.titulo || project.id}`);
    setStatus($('listStatus'), 'Proyecto borrado.', 'ok');
    loadProjectList();
  }catch(error){
    setStatus($('listStatus'), `No se pudo borrar: ${error.message}`, 'err');
  }
};

const loadProjectList = async () => {
  setStatus($('listStatus'), 'Cargando…');
  const list = $('projectList');
  list.replaceChildren();
  try{
    const projects = await getProjects();
    if(!projects.length){
      setStatus($('listStatus'), 'Todavía no hay proyectos.');
      return;
    }
    setStatus($('listStatus'), '');
    for(const project of projects){
      const item = createElement('article', 'project-item');
      const cover = project.portada || project.img;
      const thumb = createElement('div', 'project-thumb');
      if(cover) thumb.style.backgroundImage = `url("${cover.replace(/["\\]/g, '')}?t=${Date.now()}")`;
      else thumb.textContent = project.emoji || '◇';
      const meta = createElement('div', 'project-item__meta');
      meta.append(createElement('strong', '', project.titulo || 'Proyecto sin título'));
      const mediaCount = Array.isArray(project.medios) ? project.medios.length : (project.img ? 1 : 0);
      meta.append(createElement('small', '', `${categoryName(project.categoria)} · ${mediaCount} ${mediaCount === 1 ? 'medio' : 'medios'}`));
      const actions = createElement('div', 'project-item__actions');
      const view = createElement('a', 'mini ghost', 'Ver');
      view.href = `proyecto.html?id=${encodeURIComponent(project.id)}`;
      view.target = '_blank';
      view.rel = 'noopener';
      actions.append(view, makeButton('Borrar', () => deleteProject(project.id), 'danger mini'));
      item.append(thumb, meta, actions);
      list.appendChild(item);
    }
  }catch(error){
    setStatus($('listStatus'), `No se pudo cargar: ${error.message}`, 'err');
  }
};

$('repoName').textContent = REPO;
$('setupBtn').addEventListener('click', handleSetup);
$('unlockBtn').addEventListener('click', handleUnlock);
$('resetBtn').addEventListener('click', handleReset);
$('logoutBtn').addEventListener('click', handleLogout);
$('aboutSaveBtn').addEventListener('click', saveAbout);
$('files').addEventListener('change', handleFiles);
$('projectForm').addEventListener('submit', publishProject);
$('pin').addEventListener('keydown', event => { if(event.key === 'Enter') handleUnlock(); });
$('repeatedPin').addEventListener('keydown', event => { if(event.key === 'Enter') handleSetup(); });

renderMediaEditor();
showLogin();
