// The map drawn smaller than the original's (zoom under 1x, the world view): every sprite sampled
// "nearest" would drop whole rows and columns of its pixels, so objects broke up and shimmered as the
// map moved (2026-10-31: "the textures for map objects scale down terribly when zooming out").
// Instead the map layer renders through a filter at 1/zoom resolution, which is the original's own
// pixel size (pixel-exact, nearest, no seams between tiles), and the filter averages each screen
// pixel's footprint (a box filter, like a mipmap level): smooth and steady. At 1x and above nothing
// changes: no filter, crisp pixels. On a desktop the canvas has the screen's own pixels (ui/screen.ts), so the
// map at 0.5x there is mostly drawn pixel for pixel and only averaged where the screen has fewer pixels than art.
import { Filter, GlProgram, defaultFilterVert, type Container } from "pixi.js";

const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
// (highp as in the vertex shader: a precision mismatch fails to link and the map would vanish.)
uniform highp vec4 uInputSize;
uniform highp vec4 uInputClamp;
uniform float uK;
void main(void) {
  // The screen pixel covers uK x uK input pixels: 4 x 4 taps spread evenly over them.
  vec2 span = uInputSize.zw * uK;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 4; i++)
    for (int j = 0; j < 4; j++) {
      vec2 o = (vec2(float(i), float(j)) + 0.5) / 4.0 - 0.5;
      sum += texture(uTexture, clamp(vTextureCoord + o * span, uInputClamp.xy, uInputClamp.zw));
    }
  finalColor = sum / 16.0;
}`;

/** How far the map is supersampled at most (2: the wheel's smallest zoom, 0.5x, is exact; the world view's 0.25x half way). */
const MAX_K = 2;

let filter: Filter | null = null;
function boxFilter(): Filter {
  return (filter ??= new Filter({
    glProgram: GlProgram.from({ vertex: defaultFilterVert, fragment, name: "map-zoom-box" }),
    resources: { boxUniforms: { uK: { value: 1, type: "f32" } } },
    antialias: false,
  }));
}

/**
 * Set the map layer's smoothing for this zoom (called on every camera move; cheap when unchanged). `res`: the
 * canvas's pixels per game pixel (desktops draw at the screen's own pixels, ui/screen.ts): the original's pixel
 * then covers zoom x res canvas pixels, and only under one of them is anything averaged.
 */
export function smoothZoom(root: Container, zoom: number, res = 1) {
  const k = Math.min(MAX_K, 1 / (zoom * res));
  if (k <= 1.001) {
    if (root.filters?.length) root.filters = [];
    return;
  }
  const f = boxFilter();
  // (The filter's resolution is the input's pixels per game pixel: the original's own pixel size, 1 / zoom.)
  if (f.resolution !== k * res) {
    f.resolution = k * res;
    f.resources.boxUniforms.uniforms.uK = k;
  }
  if (root.filters?.[0] !== f) root.filters = [f];
}
