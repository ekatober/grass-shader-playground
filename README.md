# Grass Shader playground for Three.js

**Try it:** https://ekatober.github.io/grass-shader-playground/

Compare painted grass cards with geometric blades in the same live preview. Switch between perspective and isometric cameras, tune shape, color and wind, and export settings for your game. Each method retains its settings while you switch; the patch diameter and camera stay shared.

| Method | Representation | Grass draw calls |
| --- | --- | --- |
| Painted cards | Subdivided planes, 20 original masks in five atlases, cutout edges with alpha-to-coverage | One per used atlas, up to five |
| Geometric blades | Tapered strips, seven vertices and five triangles per blade; no silhouette texture | One |

The blade topology matches Flock's basic blade. This playground uses a simpler WebGL implementation; it does not include Flock's WebGPU compute, camera-local streaming, terrain lighting, grazing, or trampling systems.

## Open the preview

The hosted version runs at https://ekatober.github.io/grass-shader-playground/. To run it locally, serve this folder over HTTP, for example:

```sh
git clone https://github.com/ekatober/grass-shader-playground.git
cd grass-shader-playground
python3 -m http.server 8766 --bind 127.0.0.1
```

Open http://127.0.0.1:8766/. The demo imports Three.js 0.186.1 and OrbitControls from jsDelivr, so its first load needs an internet connection. Opening the HTML directly as a file is not supported.

Choose **Painted cards** or **Geometric blades**. The preview opens in perspective; drag to orbit. Switch to isometric to see the grass from a top-down game camera; there, drag to pan. Scroll or pinch to zoom. **Reset** restores defaults for the selected method. **Export settings** saves the selected method, its parameters, ground color and camera type; **Import settings** restores that file. No settings are uploaded or saved remotely.

Counts refer to cards or individual mesh blades, respectively. A card can depict multiple blades, so equal counts are not equal visual density. FPS is a live preview reading, not a universal performance comparison.

## Other techniques

`techniques/` has three small standalone pages for methods the playground does not compare, using the same cameras and colors: painted terrain (`painted-terrain.html`, a tiling texture with directional marks), shell texturing (`shells.html`, 24 stacked layers with noise cutouts) and raymarched grass (`raymarch.html`, signed-distance blades in a fullscreen quad). They are deliberately simple illustrations, not production implementations. Add `?view=isometric` to open them in the isometric camera.

## Use the module

Use Three.js 0.186.1 with `WebGLRenderer`; GLSL `ShaderMaterial` does not run in `WebGPURenderer`. The demo and module use the same shaders and geometry.

```js
import { GrassSystem, BLADE_SETTINGS } from './GrassSystem.js';

const grass = new GrassSystem(scene, {
  ...BLADE_SETTINGS,
  getTerrainHeight: (x, z) => terrainHeightAt(x, z),
});
await grass.init();

// Pass elapsed seconds from your existing animation loop.
grass.update(elapsedSeconds);
```

For painted cards, omit `BLADE_SETTINGS` and supply `texturePath` if the `textures/` directory is elsewhere. Use an antialiased renderer for smoother cutout edges:

```js
const renderer = new THREE.WebGLRenderer({ antialias: true });
const grass = new GrassSystem(scene, { texturePath: './textures/' });
await grass.init();
```

Apply an exported settings file:

```js
const preset = await fetch('./grass-settings.json').then(response => response.json());
const grass = new GrassSystem(scene, {
  ...preset.grass,
  texturePath: './textures/',
  getTerrainHeight: (x, z) => terrainHeightAt(x, z),
});
await grass.init();
```

`preset.preview` contains ground color and camera type; your game controls its own ground and camera. The terrain callback is code, so it is not included in JSON.

## Update and clean up

```js
grass.set('windStrength', 0);
grass.set('colorBase', '#52713a');
grass.configure({ density: 12000, bladeHeight: 0.7 });
await grass.setMode('blades');
await grass.setMode('cards');
grass.set('enabledVariants', [0, 4, 9]);
grass.setLight(directionTowardSun, sunColor);
grass.dispose();
```

`setMode` keeps the current numerical settings. The preview supplies separate defaults for each method. `enabledVariants` affects cards only; an empty array produces an empty card field. Legacy constructor options `enabledAtlases` and `enabledQuadrants` remain supported.

- `density` is the instance count; `area` is the patch diameter in scene units.
- Height, width, lean, wind and colors update without rebuilding geometry.
- Count, area, height variation, method, variant selection and terrain callback rebuild the patch with the same deterministic placement sequence.
- Strength zero stops all animated wind, including turbulence. Shared lean remains.
- Color values accept a Three.js Color, a numeric hex value, or a six-digit hex string. Directions accept a Vector3 or a three-number array.
- Terrain height is sampled at each root when building. The module does not calculate terrain normals or update roots automatically when the terrain moves.
- Lighting is a stylized approximation with explicit sun and ambient colors. It does not automatically read scene lights or receive/cast scene shadows.
- This is a bounded preview patch, without distance LOD or patch culling. Large counts still need profiling in the target game.
- `dispose()` removes the meshes and releases their geometry, materials and loaded textures. Loading errors reject `init()` with the failing path.

`GrassSystem.js` is the shader source of truth. Files under `shaders/` are matching reference copies, not additional runtime dependencies. In geometric mode, `init()` loads no mask textures; switching to cards loads them on demand.

## Assets and references

The 20 card masks in `textures/` are generated by `tools/make_masks.py` (Python with Pillow and numpy). Every shape is drawn from code; no source images are used. The generated masks are released under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/): use them for anything, no credit needed. To regenerate them, or to change the shapes:

```sh
python3 tools/make_masks.py --sheet
```

`--sheet` also writes `tools/mask_sheet.png`, a preview of all 20 shapes. Each atlas is 2048×2048 grayscale with four 1024×1024 quadrants; keep the 14 px empty gutter inside each quadrant so linear filtering does not bleed between shapes.

Three.js material documentation: https://threejs.org/docs/pages/Material.html
Three.js custom shader documentation: https://threejs.org/docs/pages/ShaderMaterial.html

## License

Code: MIT, see `LICENSE`. Card masks in `textures/`: CC0 1.0.
