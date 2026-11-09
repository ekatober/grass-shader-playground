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
}
