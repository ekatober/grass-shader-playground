import * as THREE from 'three';

export const ATLAS_FILES = [
  'grass4_mask_01.png', 'grass4_mask_01_02.png', 'grass4_mask_02.png',
  'grass4_mask_03.png', 'grass4_mask_04.png',
];

export const DEFAULT_SETTINGS = {
  mode: 'cards',
  density: 8000, area: 20, bladeHeight: 0.85, bladeWidth: 0.6,
  heightVariation: 0.4, lean: 0.35,
  colorBase: '#52713a', colorTip: '#b3bf64',
  windSpeed: 1, windStrength: 0.22, turbulence: 0.4,
  windDirection: [1, 0, 0.3], lightDirection: [0.5, 0.8, 0.3],
  lightColor: '#fff2d5', ambientColor: '#b1bca2',
  translucency: 0.35, aoStrength: 0.35,
  enabledVariants: [0, 1, 2, 3, 4, 5, 8, 9, 12, 13, 16, 17],
};

export const BLADE_SETTINGS = {
  ...DEFAULT_SETTINGS, mode: 'blades', density: 40000,
  bladeHeight: 0.65, bladeWidth: 0.12, lean: 0.65,
};

const numericLimits = {
  density: [0, 200000], area: [0.1, 200], bladeHeight: [0, 10],
  bladeWidth: [0, 10], heightVariation: [0, 1], lean: [0, 2],
  windSpeed: [0, 10], windStrength: [0, 2], turbulence: [0, 2],
  translucency: [0, 2], aoStrength: [0, 1],
};
const uniformKeys = {
  bladeHeight: 'uBladeHeight', bladeWidth: 'uBladeWidth', lean: 'uLean',
  windSpeed: 'uWindSpeed', windStrength: 'uWindStrength', turbulence: 'uTurbulence',
  windDirection: 'uWindDirection', colorBase: 'uColorBase', colorTip: 'uColorTip',
  lightDirection: 'uLightDir', lightColor: 'uLightColor', ambientColor: 'uAmbientColor',
  translucency: 'uTranslucency', aoStrength: 'uAOStrength',
};
const rebuildKeys = ['mode', 'density', 'area', 'heightVariation', 'enabledVariants', 'getTerrainHeight'];

export const grassVertexShader = `
attribute vec3 offset;
attribute float rotation;
attribute float aScale;
attribute vec2 quadrant;
uniform float uTime, uWindSpeed, uWindStrength, uTurbulence, uBladeHeight, uBladeWidth, uLean;
uniform vec3 uWindDirection;
varying vec2 vUv;
varying float vHeight;
varying vec3 vWorldPos, vNormal;
varying float vVariation;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vHeight = uv.y;
  vUv = mix(vec2(0.025), vec2(0.475), uv) + quadrant * 0.5;
  float height = uBladeHeight * aScale;
  vec3 pos = vec3(position.x * uBladeWidth, position.y * height, 0.0);
  pos.xz = vec2(pos.x * cos(rotation), pos.x * sin(rotation));
  float t = uTime * uWindSpeed;
  float wave = sin(t - dot(offset.xz, uWindDirection.xz) * 0.5);
  float gust = sin(t * 0.7 - offset.x * 0.25) * sin(t * 1.3 - offset.z * 0.3);
  float turbulence = noise(offset.xz * 0.4 - uWindDirection.xz * t * 0.35) * 2.0 - 1.0;
  float bend = uLean + uWindStrength * (wave * 0.5 + gust * 0.25 + turbulence * uTurbulence);
  float displacement = bend * height * vHeight * vHeight;
  pos.xz += displacement * uWindDirection.xz;
  pos.y -= min(abs(displacement) * 0.25, pos.y * 0.45);
  vec4 world = modelMatrix * vec4(pos + offset, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * vec3(-bend * uWindDirection.x, 1.0, -bend * uWindDirection.z));
  vVariation = 0.92 + hash(offset.xz) * 0.16;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

export const grassFragmentShader = `
uniform sampler2D uAtlas;
uniform vec3 uColorBase, uColorTip, uLightDir, uLightColor, uAmbientColor;
uniform float uTranslucency, uAOStrength;
varying vec2 vUv;
varying float vHeight;
varying vec3 vWorldPos, vNormal;
varying float vVariation;
void main() {
  float alpha = 1.0;
  #ifdef GRASS_CARDS
    float mask = texture2D(uAtlas, vUv).r;
    #ifdef ALPHA_TO_COVERAGE
      float edge = max(fwidth(mask), 0.001);
      alpha = smoothstep(0.25 - edge, 0.25 + edge, mask);
      if (alpha <= 0.0) discard;
    #else
      if (mask < 0.25) discard;
    #endif
  #endif
  vec3 col = mix(uColorBase, uColorTip, smoothstep(0.0, 1.0, vHeight)) * vVariation;
  vec3 normal = normalize(vNormal);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float diffuse = max(dot(normal, uLightDir), 0.0);
  float backlight = pow(max(dot(viewDir, -uLightDir), 0.0), 2.0);
  float transmission = (0.12 + backlight) * uTranslucency * vHeight;
  float ao = mix(1.0 - uAOStrength, 1.0, smoothstep(0.0, 0.7, vHeight));
  vec3 lighting = uAmbientColor * 0.65 + uLightColor * (diffuse * 0.65 + transmission);
  gl_FragColor = vec4(col * lighting * ao, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function normalizeConfig(options) {
  const config = { texturePath: './textures/', getTerrainHeight: null, ...DEFAULT_SETTINGS, ...options };
  if (!['cards', 'blades'].includes(config.mode)) throw new Error('Choose cards or blades.');
  if (typeof config.texturePath !== 'string') throw new Error('texturePath must be a string.');
  for (const [key, [min, max]] of Object.entries(numericLimits)) {
    if (typeof config[key] !== 'number' || !Number.isFinite(config[key]) || config[key] < min || config[key] > max) {
      throw new Error(key + ' must be between ' + min + ' and ' + max + '.');
    }
  }
  config.density = Math.floor(config.density);
  for (const key of ['colorBase', 'colorTip', 'lightColor', 'ambientColor']) {
    const value = config[key];
    if (!value?.isColor && !(typeof value === 'number' || /^#[0-9a-f]{6}$/i.test(value))) {
      throw new Error(key + ' must be a Three.js Color, a number, or a six-digit hex color.');
    }
    config[key] = new THREE.Color(value);
  }
  for (const key of ['windDirection', 'lightDirection']) {
    const value = config[key];
    const components = value?.isVector3 ? value.toArray() : value;
    if (!Array.isArray(components) || components.length !== 3 || !components.every(Number.isFinite)) {
      throw new Error(key + ' must contain three finite numbers.');
    }
    config[key] = new THREE.Vector3(...components);
    if (key === 'windDirection') config[key].y = 0;
    if (config[key].lengthSq() === 0) throw new Error(key + ' must have a direction.');
    config[key].normalize();
  }
  if (!Array.isArray(config.enabledVariants) || config.enabledVariants.some(v => !Number.isInteger(v) || v < 0 || v >= 20)) {
    throw new Error('enabledVariants must contain indices from 0 to 19.');
  }
  config.enabledVariants = [...new Set(config.enabledVariants)];
  if (config.getTerrainHeight !== null && typeof config.getTerrainHeight !== 'function') {
    throw new Error('getTerrainHeight must be a function.');
  }
  return config;
}

export class GrassSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.meshes = [];
    this.textures = [];
    this.loaded = false;
    this.count = 0;
    this.elapsed = 0;
    this.generation = 0;
    if (!options.enabledVariants && (options.enabledAtlases || options.enabledQuadrants)) {
      options = { ...options, enabledVariants: (options.enabledAtlases ?? [0, 1, 2, 3, 4])
        .flatMap(a => (options.enabledQuadrants ?? [0, 1, 2, 3]).map(q => a * 4 + q)) };
    }
    this.config = normalizeConfig(options);
  }

  async init() {
    if (this.loaded) return this;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (this.config.mode === 'cards') await this.loadTextures();
      this.loaded = true;
      this.rebuild();
      return this;
    })();
    try { return await this.loading; }
    finally { this.loading = null; }
  }

  async loadTextures() {
    if (this.textures.length) return;
    if (this.textureLoading) return this.textureLoading;
    const generation = this.generation;
    this.textureLoading = (async () => {
      const loader = new THREE.TextureLoader();
      const path = this.config.texturePath.replace(/\/?$/, '/');
      const results = await Promise.allSettled(ATLAS_FILES.map(async file => {
        try {
          const texture = await loader.loadAsync(path + file);
          texture.generateMipmaps = false;
          texture.minFilter = THREE.LinearFilter;
          texture.colorSpace = THREE.NoColorSpace;
          return texture;
        } catch {
          throw new Error('Could not load ' + path + file + '. Serve the folder over HTTP and check the texture path.');
        }
      }));
      const failed = results.find(r => r.status === 'rejected');
      const textures = results.filter(r => r.status === 'fulfilled').map(r => r.value);
      if (failed || generation !== this.generation) {
        textures.forEach(t => t.dispose());
        throw failed?.reason ?? new Error('Grass loading was cancelled.');
      }
      this.textures = textures;
    })();
    try { await this.textureLoading; }
    finally { this.textureLoading = null; }
  }

  async setMode(mode) {
    if (!['cards', 'blades'].includes(mode)) throw new Error('Choose cards or blades.');
    if (mode === 'cards') await this.loadTextures();
    return this.configure({ mode });
  }

  rebuild() {
    if (!this.loaded) return;
    this.clearMeshes();
    const { mode, density, area, heightVariation, enabledVariants, getTerrainHeight } = this.config;
    const variants = mode === 'cards' ? enabledVariants : [0];
    if (!variants.length || !density) return;
    let seed = 137;
    const random = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const buckets = Array.from({ length: 5 }, () => []);
    for (let i = 0; i < density; i++) {
      const variant = variants[Math.floor(random() * variants.length)];
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * area / 2;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      const y = getTerrainHeight?.(x, z) ?? 0;
      if (!Number.isFinite(y)) throw new Error('getTerrainHeight must return a finite height.');
      buckets[Math.floor(variant / 4)].push({
        x, y, z, rotation: random() * Math.PI * 2,
        scale: 1 + (random() - 0.5) * heightVariation, quadrant: variant % 4,
      });
    }
    buckets.forEach((instances, atlas) => {
      if (!instances.length) return;
      const blade = mode === 'cards'
        ? new THREE.PlaneGeometry(1, 1, 1, 4).translate(0, 0.5, 0)
        : new THREE.BufferGeometry();
      if (mode === 'blades') {
        blade.setAttribute('position', new THREE.Float32BufferAttribute([
          -0.5, 0, 0, 0.5, 0, 0, -0.34, 0.42, 0, 0.34, 0.42, 0,
          -0.18, 0.75, 0, 0.18, 0.75, 0, 0, 1, 0,
        ], 3));
        blade.setAttribute('uv', new THREE.Float32BufferAttribute([
          0, 0, 1, 0, 0, 0.42, 1, 0.42, 0, 0.75, 1, 0.75, 0.5, 1,
        ], 2));
        blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5, 4, 5, 6]);
      }
      const geometry = new THREE.InstancedBufferGeometry();
      geometry.setIndex(blade.index.clone());
      geometry.setAttribute('position', blade.attributes.position.clone());
      geometry.setAttribute('uv', blade.attributes.uv.clone());
      blade.dispose();
      geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(new Float32Array(instances.flatMap(i => [i.x, i.y, i.z])), 3));
      geometry.setAttribute('rotation', new THREE.InstancedBufferAttribute(new Float32Array(instances.map(i => i.rotation)), 1));
      geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(instances.map(i => i.scale)), 1));
      geometry.setAttribute('quadrant', new THREE.InstancedBufferAttribute(new Float32Array(instances.flatMap(i => [i.quadrant % 2, Math.floor(i.quadrant / 2)])), 2));
      geometry.instanceCount = instances.length;
      const uniforms = { uAtlas: { value: this.textures[atlas] ?? null }, uTime: { value: this.elapsed } };
      for (const [key, name] of Object.entries(uniformKeys)) uniforms[name] = { value: this.config[key] };
      const material = new THREE.ShaderMaterial({
        vertexShader: grassVertexShader, fragmentShader: grassFragmentShader, uniforms,
        defines: mode === 'cards' ? { GRASS_CARDS: 1 } : {},
        side: THREE.DoubleSide, alphaToCoverage: mode === 'cards', depthWrite: true,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.count += instances.length;
    });
  }

  update(elapsed) {
    this.elapsed = elapsed;
    for (const mesh of this.meshes) mesh.material.uniforms.uTime.value = elapsed;
  }

  configure(options) {
    const next = normalizeConfig({ ...this.config, ...options });
    if (this.loaded && next.mode === 'cards' && !this.textures.length) {
      throw new Error('Use await grass.setMode("cards") to load the card textures first.');
    }
    if (next.texturePath !== this.config.texturePath && (this.loaded || this.textures.length)) {
      throw new Error('Set texturePath when constructing GrassSystem.');
    }
    this.config = next;
    if (rebuildKeys.some(key => key in options)) this.rebuild();
    else for (const mesh of this.meshes) {
      for (const [key, name] of Object.entries(uniformKeys)) mesh.material.uniforms[name].value = next[key];
    }
    return this;
  }

  set(key, value) {
    if (key === 'mode') return this.setMode(value);
    if (key === 'enabledAtlases' || key === 'enabledQuadrants') {
      const atlases = key === 'enabledAtlases' ? value : this.config.enabledAtlases ?? [0, 1, 2, 3, 4];
      const quadrants = key === 'enabledQuadrants' ? value : this.config.enabledQuadrants ?? [0, 1, 2, 3];
      return this.configure({ [key]: value, enabledVariants: atlases.flatMap(a => quadrants.map(q => a * 4 + q)) });
    }
    if (!(key in this.config)) throw new Error('Unknown grass setting: ' + key);
    return this.configure({ [key]: value });
  }

  setLight(direction, color) {
    return this.configure({
      ...(direction ? { lightDirection: direction } : {}),
      ...(color ? { lightColor: color } : {}),
    });
  }

  getSettings() {
    const settings = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = this.config[key];
      settings[key] = value?.isColor ? '#' + value.getHexString()
        : value?.isVector3 ? value.toArray() : Array.isArray(value) ? [...value] : value;
    }
    return settings;
  }

  clearMeshes() {
    for (const mesh of this.meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes = [];
    this.count = 0;
  }

  dispose() {
    this.generation++;
    this.clearMeshes();
    this.textures.forEach(texture => texture.dispose());
    this.textures = [];
    this.loaded = false;
  }
}

export default GrassSystem;
