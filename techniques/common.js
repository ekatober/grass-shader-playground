// Shared scene, cameras and controls for the technique demos.
// Camera placement, framing and controls copy demo.js so screenshots line up
// with the playground's perspective and isometric views.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const AREA = 20;                      // patch diameter, as in the playground
export const COLORS = {
  background: '#16211b', ground: '#667c46', base: '#52713a', tip: '#b3bf64',
};

export function setup({ ground = true } = {}) {
  const $ = id => document.getElementById(id);
  const preview = $('preview');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  preview.prepend(renderer.domElement);

  const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  const isometric = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 500);
  const state = { camera: perspective, controls: null, view: 'perspective' };

  if (ground) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(AREA / 2, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: COLORS.ground }),
    );
    disc.position.y = -0.01;
    scene.add(disc);
  }

  function resize() {
    const width = preview.clientWidth, height = preview.clientHeight;
    renderer.setSize(width, height);
    perspective.aspect = width / height;
    perspective.updateProjectionMatrix();
    const span = AREA * 0.68;
    isometric.left = -span * width / height;
    isometric.right = span * width / height;
    isometric.top = span;
    isometric.bottom = -span;
    isometric.updateProjectionMatrix();
  }

  function setView(next) {
    state.view = next;
    const camera = state.camera = next === 'isometric' ? isometric : perspective;
    state.controls?.dispose();
    camera.position.set(AREA * 0.85, AREA * (next === 'isometric' ? 0.85 : 0.55) + 0.4, AREA * 0.85);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    const controls = state.controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.4, 0);
    controls.enableDamping = true;
    controls.enableRotate = next === 'perspective';
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 2;
    controls.maxDistance = 160;
    controls.minZoom = 0.3;
    controls.maxZoom = 6;
    if (next === 'isometric') {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.touches.ONE = THREE.TOUCH.PAN;
    }
    controls.update();
    for (const name of ['perspective', 'isometric']) $(name).setAttribute('aria-pressed', String(next === name));
    $('camera-help').textContent = next === 'isometric' ? 'Scroll to zoom · drag to pan' : 'Drag to orbit · scroll to zoom';
    resize();
  }

  for (const name of ['perspective', 'isometric']) $(name).onclick = () => setView(name);
  new ResizeObserver(resize).observe(preview);
  setView(new URLSearchParams(location.search).get('view') === 'isometric' ? 'isometric' : 'perspective');

  const callbacks = [];
  let previous = performance.now(), elapsed = 0, frames = 0, sampleStart = previous;
  renderer.setAnimationLoop(now => {
    elapsed += Math.min((now - previous) / 1000, 0.1);
    previous = now;
    state.controls.update();
    for (const cb of callbacks) cb(elapsed, state.camera);
    renderer.render(scene, state.camera);
    frames++;
    if (now - sampleStart >= 750) {
      $('fps').textContent = Math.round(frames * 1000 / (now - sampleStart)) + ' FPS';
      frames = 0;
      sampleStart = now;
    }
  });
  $('loading')?.remove();

  return { scene, renderer, state, onFrame: cb => callbacks.push(cb) };
}
