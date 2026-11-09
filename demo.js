import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GrassSystem, DEFAULT_SETTINGS, BLADE_SETTINGS, ATLAS_FILES } from './GrassSystem.js';

const $ = id => document.getElementById(id);
const preview = $('preview');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#16211b');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
preview.prepend(renderer.domElement);

const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
const isometric = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 500);
let camera = isometric;
let controls;
let view = 'isometric';
let measuredFPS = 0;
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(1, 96).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: $('groundColor').value }),
);
ground.position.y = -0.01;
scene.add(ground);
const grass = new GrassSystem(scene);
const modeSettings = { cards: { ...DEFAULT_SETTINGS }, blades: { ...BLADE_SETTINGS } };
const inputDefinitions = [
  ['shape-controls', 'density', 'Grass count', 0, 200000, 500],
  ['shape-controls', 'area', 'Patch diameter', 4, 40, 1],
  ['shape-controls', 'bladeHeight', 'Height', 0, 3, 0.05],
  ['shape-controls', 'bladeWidth', 'Width', 0, 2, 0.01],
  ['shape-controls', 'heightVariation', 'Height variation', 0, 1, 0.05],
  ['shape-controls', 'lean', 'Shared lean', 0, 1.5, 0.05],
  ['light-controls', 'translucency', 'Translucency', 0, 1, 0.05],
  ['light-controls', 'aoStrength', 'Root shading', 0, 1, 0.05],
  ['wind-controls', 'windSpeed', 'Speed', 0, 3, 0.05],
  ['wind-controls', 'windStrength', 'Strength', 0, 1, 0.02],
  ['wind-controls', 'turbulence', 'Turbulence', 0, 1, 0.05],
];

function resize() {
  const width = preview.clientWidth, height = preview.clientHeight;
  renderer.setSize(width, height);
  perspective.aspect = width / height;
  perspective.updateProjectionMatrix();
  const span = grass.config.area * 0.68;
  isometric.left = -span * width / height;
  isometric.right = span * width / height;
  isometric.top = span;
  isometric.bottom = -span;
  isometric.updateProjectionMatrix();
}

function setView(next) {
  view = next;
  camera = view === 'isometric' ? isometric : perspective;
  controls?.dispose();
  const area = grass.config.area;
  camera.position.set(area * 0.85, area * (view === 'isometric' ? 0.85 : 0.55) + 0.4, area * 0.85);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.4, 0);
  controls.enableDamping = true;
  controls.enableRotate = view === 'perspective';
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.minDistance = 2;
  controls.maxDistance = 160;
  controls.minZoom = 0.3;
  controls.maxZoom = 6;
  if (view === 'isometric') {
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.touches.ONE = THREE.TOUCH.PAN;
  }
  controls.update();
  for (const name of ['perspective', 'isometric']) $(name).setAttribute('aria-pressed', String(view === name));
  $('camera-help').textContent = view === 'isometric' ? 'Scroll to zoom · drag to pan' : 'Drag to orbit · scroll to zoom';
  resize();
}

function syncControls() {
  const settings = grass.getSettings();
  $('card-shapes').hidden = settings.mode !== 'cards';
  for (const mode of ['cards', 'blades']) $('mode-' + mode).setAttribute('aria-pressed', String(settings.mode === mode));
  $('method-description').textContent = settings.mode === 'cards'
    ? 'Painted clumps on small planes. Each card can suggest several blades.'
    : 'Tapered mesh blades. Each blade has its own solid silhouette and bend.';
  for (const [, key, , min, max, step] of inputDefinitions) {
    $(key).min = Math.min(min, settings[key]);
    $(key).max = Math.max(max, settings[key]);
    $(key).step = step;
    $(key).value = settings[key];
    if (Number($(key).value) !== settings[key]) {
      $(key).step = 'any';
      $(key).value = settings[key];
    }
    $('value-' + key).textContent = step >= 1 ? settings[key].toLocaleString() : settings[key].toFixed(2);
  }
  for (const key of ['colorBase', 'colorTip']) $(key).value = settings[key];
  document.querySelectorAll('.variant').forEach(button => {
    button.setAttribute('aria-pressed', String(settings.enabledVariants.includes(Number(button.dataset.variant))));
  });
  $('selection-count').textContent = settings.enabledVariants.length
    ? settings.enabledVariants.length + ' of 20 shapes selected'
    : 'No shapes selected. Choose a shape to grow grass.';
  $('select-all').textContent = settings.enabledVariants.length === 20 ? 'Clear all' : 'Select all';
  ground.scale.setScalar(settings.area / 2);
  updateStats();
}

function updateStats() {
  $('stats').textContent = grass.count.toLocaleString() + ' ' + grass.config.mode
    + ' · ' + grass.meshes.length + (grass.meshes.length === 1 ? ' grass draw' : ' grass draws')
    + (measuredFPS ? ' · ' + measuredFPS + ' FPS' : '');
}

for (const mode of ['cards', 'blades']) $('mode-' + mode).onclick = async () => {
  if (grass.config.mode === mode) return;
  modeSettings[grass.config.mode] = grass.getSettings();
  $('settings').disabled = true;
  try {
    const area = grass.config.area;
    await grass.setMode(mode);
    grass.configure({ ...modeSettings[mode], area });
    syncControls();
    $('notice').textContent = '';
  } catch (error) {
    $('notice').textContent = error.message;
  } finally {
    $('settings').disabled = false;
  }
};

for (const [section, key, label, min, max, step] of inputDefinitions) {
  const row = document.createElement('label');
  row.className = 'control';
  row.htmlFor = key;
  row.innerHTML = '<span>' + label + '</span><output id="value-' + key + '" for="' + key + '"></output>'
    + '<input id="' + key + '" type="range" min="' + min + '" max="' + max + '" step="' + step + '">';
  $(section).append(row);
  $(key).addEventListener('input', () => {
    grass.set(key, Number($(key).value));
    syncControls();
    if (key === 'area') resize();
  });
}

for (let variant = 0; variant < 20; variant++) {
  const atlas = Math.floor(variant / 4), quadrant = variant % 4;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'variant';
  button.dataset.variant = variant;
  button.setAttribute('aria-label', 'Grass shape ' + (variant + 1));
  button.title = 'Grass shape ' + (variant + 1);
  const thumbnail = document.createElement('span');
  thumbnail.style.backgroundImage = 'url("./textures/' + ATLAS_FILES[atlas] + '")';
  thumbnail.style.backgroundPosition = (quadrant % 2) * 100 + '% ' + (1 - Math.floor(quadrant / 2)) * 100 + '%';
  button.append(thumbnail);
  button.addEventListener('click', () => {
    const selected = new Set(grass.config.enabledVariants);
    if (selected.has(variant)) selected.delete(variant);
    else selected.add(variant);
    grass.set('enabledVariants', [...selected].sort((a, b) => a - b));
    syncControls();
  });
  $('variants').append(button);
}

for (const key of ['colorBase', 'colorTip']) $(key).addEventListener('input', () => grass.set(key, $(key).value));
$('groundColor').addEventListener('input', () => ground.material.color.set($('groundColor').value));
$('select-all').onclick = () => {
  grass.set('enabledVariants', grass.config.enabledVariants.length === 20 ? [] : Array.from({ length: 20 }, (_, i) => i));
  syncControls();
};
for (const name of ['perspective', 'isometric']) $(name).onclick = () => setView(name);
$('reset').onclick = () => {
  grass.configure(grass.config.mode === 'cards' ? DEFAULT_SETTINGS : BLADE_SETTINGS);
  $('groundColor').value = '#667c46';
  ground.material.color.set($('groundColor').value);
  syncControls();
  setView('isometric');
  $('notice').textContent = 'Defaults restored for this method.';
};
$('export').onclick = () => {
  const preset = { version: 1, grass: grass.getSettings(), preview: { groundColor: $('groundColor').value, view } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(preset, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'grass-settings.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('notice').textContent = 'Settings exported. Pass preset.grass to GrassSystem in your game.';
};
$('import').onclick = () => $('import-file').click();
$('import-file').onchange = async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const preset = JSON.parse(await file.text());
    if (preset.version !== 1 || !preset.grass || Object.keys(DEFAULT_SETTINGS).some(key => !(key in preset.grass))) {
      throw new Error('Choose a settings file exported by this tool.');
    }
    const color = preset.preview?.groundColor ?? '#667c46';
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('The ground color is invalid.');
    const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(key => [key, preset.grass[key]]));
    new GrassSystem(scene, settings);
    modeSettings[grass.config.mode] = grass.getSettings();
    await grass.setMode(settings.mode);
    grass.configure(settings);
    $('groundColor').value = color;
    ground.material.color.set(color);
    syncControls();
    setView(preset.preview?.view === 'perspective' ? 'perspective' : 'isometric');
    $('notice').textContent = 'Settings imported.';
  } catch (error) {
    $('notice').textContent = 'Could not import settings. ' + error.message;
  }
  event.target.value = '';
};

syncControls();
setView('isometric');
new ResizeObserver(resize).observe(preview);
await grass.init();
syncControls();
$('loading').hidden = true;
$('settings').disabled = false;
let previous = performance.now(), sampleStart = previous, elapsed = 0, frames = 0;
renderer.setAnimationLoop(now => {
  elapsed += Math.min((now - previous) / 1000, 0.1);
  previous = now;
  grass.update(elapsed);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  if (now - sampleStart >= 750) {
    measuredFPS = Math.round(frames * 1000 / (now - sampleStart));
    updateStats();
    frames = 0;
    sampleStart = now;
  }
});
document.addEventListener('visibilitychange', () => {
  previous = performance.now();
  sampleStart = previous;
  frames = 0;
});
