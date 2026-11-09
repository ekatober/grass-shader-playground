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
}
