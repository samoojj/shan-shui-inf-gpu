import { bufferSize, hashSeed } from "../options.js";
import type { LandscapeOptions } from "../options.js";
import type { LandscapeCanvas } from "../types.js";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "../shaders.js";

/** A complete linked program: partial construction never escapes this module. */
export interface LandscapeProgram {
  draw(options: Readonly<LandscapeOptions>): void;
  dispose(): void;
}

// Binding knowledge stays beside the draw that consumes it, private to WebGL.
const uniformNames = [
  "uResolution", "uView", "uOffset", "uSeed", "uLayers", "uRoughness",
  "uInkDensity", "uMist", "uVegetation", "uWater", "uPaper", "uInk",
] as const;

export function createLandscapeProgram(gl: WebGL2RenderingContext, canvas: LandscapeCanvas): LandscapeProgram {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    // Deleting a bound program only marks it for deletion; unbind it first.
    gl.useProgram(null);
    gl.bindVertexArray(null);
    if (vao) gl.deleteVertexArray(vao);
    if (program) gl.deleteProgram(program);
  }

  function compile(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to allocate landscape shader.");
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`Landscape shader compilation failed: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  try {
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    program = gl.createProgram();
    if (!program) throw new Error("Unable to allocate landscape program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Landscape shader linking failed: ${gl.getProgramInfoLog(program)}`);
    }
    vao = gl.createVertexArray();
    if (!vao) throw new Error("Unable to allocate landscape vertex array.");

    const linkedProgram = program;
    const uniforms = Object.fromEntries(uniformNames.map(name => {
      const location = gl.getUniformLocation(linkedProgram, name);
      if (location === null) throw new Error(`Missing landscape uniform: ${name}`);
      return [name, location];
    })) as Record<typeof uniformNames[number], WebGLUniformLocation>;
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const maxDimension = Math.min(8192, viewport[0], viewport[1], gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number);

    return {
      draw(options) {
        if (disposed) throw new Error("Landscape program has been disposed.");
        const [width, height] = bufferSize(options, maxDimension);
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.uniform2f(uniforms.uResolution, width, height);
        const viewHeight = 1000 / options.zoom;
        gl.uniform2f(uniforms.uView, viewHeight * options.width / options.height, viewHeight);
        gl.uniform2f(uniforms.uOffset, options.cameraX, options.cameraY);
        gl.uniform1ui(uniforms.uSeed, hashSeed(options.seed));
        gl.uniform1i(uniforms.uLayers, options.layers);
        gl.uniform1f(uniforms.uRoughness, options.roughness);
        gl.uniform1f(uniforms.uInkDensity, options.inkDensity);
        gl.uniform1f(uniforms.uMist, options.mist);
        gl.uniform1f(uniforms.uVegetation, options.vegetation);
        gl.uniform1f(uniforms.uWater, options.water);
        gl.uniform3f(uniforms.uPaper, ...options.paper);
        gl.uniform3f(uniforms.uInk, ...options.ink);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  } finally {
    for (const shader of shaders) {
      if (program && !disposed) gl.detachShader(program, shader);
      gl.deleteShader(shader);
    }
  }
}
