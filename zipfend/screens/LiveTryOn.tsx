import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { categoryToClothType, type ClothType } from '../services/tryonService';
import { demoProducts } from '../services/demoProducts';
import { useAppNavigation } from '../utils/useAppNavigation';

// Landmark indices (MediaPipe Pose)
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_ELBOW = 13;
const R_ELBOW = 14;
const L_WRIST = 15;
const R_WRIST = 16;
const L_PINKY = 17;
const R_PINKY = 18;
const L_INDEX = 19;
const R_INDEX = 20;
const L_THUMB = 21;
const R_THUMB = 22;
const L_HIP = 23;
const R_HIP = 24;
const L_ANKLE = 27;
const R_ANKLE = 28;

const SMOOTHING = 0.35; // EMA factor: higher = snappier, lower = smoother
const MAX_POSE_FPS = 30;
const MIN_POSE_INTERVAL_MS = 1000 / MAX_POSE_FPS;
const MAX_GARMENT_SPRITE_DIMENSION = 1536;
const MEDIAPIPE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

interface Anchor {
  cx: number;
  cy: number;
  width: number;
  height: number;
  angle: number;
}

interface Point2D {
  x: number;
  y: number;
}

interface Point3D {
  x: number;
  y: number;
  z: number;
  v?: number;
}

type SmoothedArmLandmarks = Record<number, Point3D>;

interface ArmOcclusionState {
  isOccluding: boolean;
  path: Path2D | null;
  zDiff: number | null;
}

interface ArmOcclusionResult {
  leftArm: ArmOcclusionState;
  rightArm: ArmOcclusionState;
}

function pointInPoly(px: number, py: number, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function segmentIntersectsPoly(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  poly: Point2D[],
  radius = 0
): boolean {
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const qx = ax + (bx - ax) * t;
    const qy = ay + (by - ay) * t;
    if (pointInPoly(qx, qy, poly)) return true;
    if (radius > 0) {
      for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
        if (distToSegment(qx, qy, poly[j].x, poly[j].y, poly[k].x, poly[k].y) <= radius) {
          return true;
        }
      }
    }
  }
  return false;
}

function buildArmPath(
  elbow: Point3D,
  wrist: Point3D,
  pinky: Point3D | null,
  index: Point3D | null,
  thumb: Point3D | null,
  shoulderWidth: number
): Path2D {
  const path = new Path2D();

  const dx = wrist.x - elbow.x;
  const dy = wrist.y - elbow.y;
  const fLen = Math.hypot(dx, dy);
  if (fLen < 2) return path;

  const ux = dx / fLen;
  const uy = dy / fLen;
  const nx = -uy;
  const ny = ux;

  // Snug radii calibrated to prevent halos around arms
  const rElbow = shoulderWidth * 0.088;
  const rWrist = shoulderWidth * 0.062;

  const eL = { x: elbow.x + nx * rElbow, y: elbow.y + ny * rElbow };
  const eR = { x: elbow.x - nx * rElbow, y: elbow.y - ny * rElbow };
  const wL = { x: wrist.x + nx * rWrist, y: wrist.y + ny * rWrist };
  const wR = { x: wrist.x - nx * rWrist, y: wrist.y - ny * rWrist };

  const hasHandLandmarks =
    pinky &&
    index &&
    thumb &&
    (pinky.v ?? 1) > 0.35 &&
    (index.v ?? 1) > 0.35 &&
    (thumb.v ?? 1) > 0.35;

  path.moveTo(eL.x, eL.y);
  path.lineTo(wL.x, wL.y);

  if (hasHandLandmarks) {
    const hMid = {
      x: (pinky.x + index.x + thumb.x) / 3,
      y: (pinky.y + index.y + thumb.y) / 3,
    };
    const hdx = hMid.x - wrist.x;
    const hdy = hMid.y - wrist.y;
    const hLen = Math.max(Math.hypot(hdx, hdy), 1);
    const hux = hdx / hLen;
    const huy = hdy / hLen;

    const tipExt = hLen * 0.18;
    const tipIndex = { x: index.x + hux * tipExt, y: index.y + huy * tipExt };
    const tipPinky = { x: pinky.x + hux * tipExt, y: pinky.y + huy * tipExt };
    const tipThumb = { x: thumb.x + hux * tipExt * 0.7, y: thumb.y + huy * tipExt * 0.7 };

    const cross = nx * (thumb.x - wrist.x) + ny * (thumb.y - wrist.y);
    if (cross >= 0) {
      path.quadraticCurveTo(thumb.x, thumb.y, tipThumb.x, tipThumb.y);
      path.lineTo(tipIndex.x, tipIndex.y);
      path.lineTo(tipPinky.x, tipPinky.y);
      path.quadraticCurveTo(pinky.x, pinky.y, wR.x, wR.y);
    } else {
      path.quadraticCurveTo(pinky.x, pinky.y, tipPinky.x, tipPinky.y);
      path.lineTo(tipIndex.x, tipIndex.y);
      path.lineTo(tipThumb.x, tipThumb.y);
      path.quadraticCurveTo(thumb.x, thumb.y, wR.x, wR.y);
    }
  } else {
    const handLen = shoulderWidth * 0.28;
    const rHand = shoulderWidth * 0.07;
    const hTipL = { x: wL.x + ux * handLen, y: wL.y + uy * handLen };
    const hTipR = { x: wR.x + ux * handLen, y: wR.y + uy * handLen };
    path.lineTo(hTipL.x, hTipL.y);
    path.arcTo(
      wrist.x + ux * (handLen + rHand),
      wrist.y + uy * (handLen + rHand),
      hTipR.x,
      hTipR.y,
      rHand
    );
    path.lineTo(wR.x, wR.y);
  }

  path.lineTo(eR.x, eR.y);
  path.arcTo(
    elbow.x - ux * rElbow * 0.8,
    elbow.y - uy * rElbow * 0.8,
    eL.x,
    eL.y,
    rElbow
  );
  path.closePath();

  return path;
}

function computeArmOcclusion(
  lm: any[],
  w: number,
  h: number,
  smoothedArmsRef: React.MutableRefObject<SmoothedArmLandmarks | null>
): ArmOcclusionResult {
  const empty: ArmOcclusionState = { isOccluding: false, path: null, zDiff: null };
  if (!lm) return { leftArm: empty, rightArm: empty };

  const visible = (i: number) => lm[i] && (lm[i].visibility ?? 1) > 0.4;
  if (!visible(L_SHOULDER) || !visible(R_SHOULDER)) {
    smoothedArmsRef.current = null;
    return { leftArm: empty, rightArm: empty };
  }

  const mirrored = (x: number) => 1 - x;
  const mix = (a: number, b: number) => a + (b - a) * SMOOTHING;

  // Temporal EMA smoothing for arm landmarks
  const prevSmoothed = smoothedArmsRef.current || {};
  const currentSmoothed: SmoothedArmLandmarks = {};

  const indicesToSmooth = [
    L_SHOULDER,
    R_SHOULDER,
    L_ELBOW,
    R_ELBOW,
    L_WRIST,
    R_WRIST,
    L_PINKY,
    R_PINKY,
    L_INDEX,
    R_INDEX,
    L_THUMB,
    R_THUMB,
    L_HIP,
    R_HIP,
  ];

  for (const idx of indicesToSmooth) {
    if (visible(idx)) {
      const rawX = mirrored(lm[idx].x) * w;
      const rawY = lm[idx].y * h;
      const rawZ = lm[idx].z ?? 0;
      const prev = prevSmoothed[idx];
      if (prev) {
        currentSmoothed[idx] = {
          x: mix(prev.x, rawX),
          y: mix(prev.y, rawY),
          z: mix(prev.z, rawZ),
          v: lm[idx].visibility ?? 1,
        };
      } else {
        currentSmoothed[idx] = {
          x: rawX,
          y: rawY,
          z: rawZ,
          v: lm[idx].visibility ?? 1,
        };
      }
    }
  }
  smoothedArmsRef.current = currentSmoothed;

  const ls = currentSmoothed[L_SHOULDER];
  const rs = currentSmoothed[R_SHOULDER];
  if (!ls || !rs) return { leftArm: empty, rightArm: empty };

  const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y);

  // Torso polygon where garment rests
  const hasHips = visible(L_HIP) && visible(R_HIP) && currentSmoothed[L_HIP] && currentSmoothed[R_HIP];
  const lh = hasHips
    ? currentSmoothed[L_HIP]!
    : { x: ls.x, y: ls.y + shoulderWidth * 1.5, z: ls.z, v: 0.5 };
  const rh = hasHips
    ? currentSmoothed[R_HIP]!
    : { x: rs.x, y: rs.y + shoulderWidth * 1.5, z: rs.z, v: 0.5 };

  const torsoPad = shoulderWidth * 0.08;
  const torsoPoly: Point2D[] = [
    { x: ls.x + torsoPad, y: ls.y - torsoPad },
    { x: rs.x - torsoPad, y: rs.y - torsoPad },
    { x: rh.x - torsoPad, y: rh.y + torsoPad * 1.5 },
    { x: lh.x + torsoPad, y: lh.y + torsoPad * 1.5 },
  ];

  let torsoZ = (ls.z + rs.z) / 2;
  if (hasHips) {
    torsoZ = (torsoZ + (lh.z + rh.z) / 2) / 2;
  }

  const Z_FRONT_THRESHOLD = -0.04;

  function evaluateArm(
    elbowIdx: number,
    wristIdx: number,
    pinkyIdx: number,
    indexIdx: number,
    thumbIdx: number
  ): ArmOcclusionState {
    const elbow = currentSmoothed[elbowIdx];
    const wrist = currentSmoothed[wristIdx];
    if (!elbow || !wrist) return empty;

    const pinky = currentSmoothed[pinkyIdx] || null;
    const index = currentSmoothed[indexIdx] || null;
    const thumb = currentSmoothed[thumbIdx] || null;

    const handZ = pinky && index && thumb ? (pinky.z + index.z + thumb.z) / 3 : wrist.z;
    const minArmZ = Math.min(wrist.z, handZ, elbow.z);
    const zDiff = minArmZ - torsoZ;

    // Depth check: arm must be in front of the torso plane
    const isInFrontOfTorso = zDiff < Z_FRONT_THRESHOLD;
    if (!isInFrontOfTorso) return { isOccluding: false, path: null, zDiff };

    // Check if forearm or hand overlaps the torso polygon
    const armRadius = shoulderWidth * 0.08;
    const overlapsTorso =
      pointInPoly(wrist.x, wrist.y, torsoPoly) ||
      (pinky && pointInPoly(pinky.x, pinky.y, torsoPoly)) ||
      (index && pointInPoly(index.x, index.y, torsoPoly)) ||
      (thumb && pointInPoly(thumb.x, thumb.y, torsoPoly)) ||
      segmentIntersectsPoly(elbow.x, elbow.y, wrist.x, wrist.y, torsoPoly, armRadius);

    if (!overlapsTorso) return { isOccluding: false, path: null, zDiff };

    const path = buildArmPath(elbow, wrist, pinky, index, thumb, shoulderWidth);
    return { isOccluding: true, path, zDiff };
  }

  const leftArm = evaluateArm(L_ELBOW, L_WRIST, L_PINKY, L_INDEX, L_THUMB);
  const rightArm = evaluateArm(R_ELBOW, R_WRIST, R_PINKY, R_INDEX, R_THUMB);

  return { leftArm, rightArm };
}

function renderArmOcclusion(
  ctx: CanvasRenderingContext2D,
  videoSource: HTMLVideoElement,
  occlusion: ArmOcclusionResult
): void {
  const { leftArm, rightArm } = occlusion;
  if (!leftArm.isOccluding && !rightArm.isOccluding) return;

  const combinedPath = new Path2D();
  if (leftArm.isOccluding && leftArm.path) {
    combinedPath.addPath(leftArm.path);
  }
  if (rightArm.isOccluding && rightArm.path) {
    combinedPath.addPath(rightArm.path);
  }

  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  ctx.save();
  ctx.clip(combinedPath);

  // Redraw the camera frame identically aligned in mirrored space
  ctx.setTransform(-1, 0, 0, 1, width, 0);
  ctx.drawImage(videoSource, 0, 0, width, height);
  ctx.restore();
}

const GRID_COLS = 5;
const GRID_ROWS = 5;

interface WarpMesh {
  vertexData: Float32Array;
  positions: Array<{ x: number; y: number; u: number; v: number }>;
  cols: number;
  rows: number;
  kPersp: number;
}

interface SmoothedMeshControlPoints {
  T0: Point2D;
  B0: Point2D;
  Cchest: Point2D;
  shoulderWidth: number;
  hipWidth: number;
  uShoulder: Point2D;
  kPersp: number;
}

interface WarpMeshRenderer {
  canvas: HTMLCanvasElement;
  renderWarpMesh: (warpMesh: WarpMesh, opacity?: number, destWidth?: number, destHeight?: number) => void;
  destroy: () => void;
  isWebGL: boolean;
}

function computeWarpMesh(
  lm: any[],
  w: number,
  h: number,
  anchor: Anchor,
  smoothedMeshRef: React.MutableRefObject<SmoothedMeshControlPoints | null>,
  clothType?: ClothType
): WarpMesh | null {
  if (clothType === 'lower_body') return null;
  if (!lm || !anchor) return null;

  const visible = (i: number) => lm[i] && (lm[i].visibility ?? 1) > 0.4;
  if (!visible(L_SHOULDER) || !visible(R_SHOULDER)) {
    smoothedMeshRef.current = null;
    return null;
  }

  const mirrored = (x: number) => 1 - x;
  const mix = (a: number, b: number) => a + (b - a) * SMOOTHING;

  const rawLs = { x: mirrored(lm[L_SHOULDER].x) * w, y: lm[L_SHOULDER].y * h, z: lm[L_SHOULDER].z ?? 0 };
  const rawRs = { x: mirrored(lm[R_SHOULDER].x) * w, y: lm[R_SHOULDER].y * h, z: lm[R_SHOULDER].z ?? 0 };
  const rawSw = Math.hypot(rawRs.x - rawLs.x, rawRs.y - rawLs.y);

  const hasHips = visible(L_HIP) && visible(R_HIP);
  const rawLh = hasHips
    ? { x: mirrored(lm[L_HIP].x) * w, y: lm[L_HIP].y * h, z: lm[L_HIP].z ?? 0 }
    : { x: rawLs.x - (rawRs.y - rawLs.y) * 1.5, y: rawLs.y + (rawRs.x - rawLs.x) * 1.5, z: rawLs.z };
  const rawRh = hasHips
    ? { x: mirrored(lm[R_HIP].x) * w, y: lm[R_HIP].y * h, z: lm[R_HIP].z ?? 0 }
    : { x: rawRs.x - (rawRs.y - rawLs.y) * 1.5, y: rawRs.y + (rawRs.x - rawLs.x) * 1.5, z: rawRs.z };
  const rawHw = Math.hypot(rawRh.x - rawLh.x, rawRh.y - rawLh.y);

  const rawT0 = { x: (rawLs.x + rawRs.x) / 2, y: (rawLs.y + rawRs.y) / 2 };
  const rawB0 = { x: (rawLh.x + rawRh.x) / 2, y: (rawLh.y + rawRh.y) / 2 };
  const rawC0 = { x: (rawT0.x + rawB0.x) / 2, y: (rawT0.y + rawB0.y) / 2 };

  const rawZDiff = rawRs.z - rawLs.z;
  const rawKPersp = Math.max(-0.25, Math.min(0.25, rawZDiff * 0.32));

  const swLen = Math.max(rawSw, 1);
  const rawUShoulder = { x: (rawRs.x - rawLs.x) / swLen, y: (rawRs.y - rawLs.y) / swLen };
  const rawChestShift = {
    x: rawUShoulder.x * (rawKPersp * rawSw * 0.4),
    y: rawUShoulder.y * (rawKPersp * rawSw * 0.4),
  };
  const rawCchest = { x: rawC0.x + rawChestShift.x, y: rawC0.y + rawChestShift.y };

  // Temporal EMA Smoothing for mesh spine and perspective control points
  let smoothed = smoothedMeshRef.current;
  if (!smoothed) {
    smoothed = {
      T0: rawT0,
      B0: rawB0,
      Cchest: rawCchest,
      shoulderWidth: rawSw,
      hipWidth: rawHw,
      uShoulder: rawUShoulder,
      kPersp: rawKPersp,
    };
  } else {
    smoothed = {
      T0: { x: mix(smoothed.T0.x, rawT0.x), y: mix(smoothed.T0.y, rawT0.y) },
      B0: { x: mix(smoothed.B0.x, rawB0.x), y: mix(smoothed.B0.y, rawB0.y) },
      Cchest: { x: mix(smoothed.Cchest.x, rawCchest.x), y: mix(smoothed.Cchest.y, rawCchest.y) },
      shoulderWidth: mix(smoothed.shoulderWidth, rawSw),
      hipWidth: mix(smoothed.hipWidth, rawHw),
      uShoulder: { x: mix(smoothed.uShoulder.x, rawUShoulder.x), y: mix(smoothed.uShoulder.y, rawUShoulder.y) },
      kPersp: mix(smoothed.kPersp, rawKPersp),
    };
  }
  smoothedMeshRef.current = smoothed;

  const { T0, B0, Cchest, shoulderWidth, hipWidth, uShoulder, kPersp } = smoothed;
  const garmentWidth = anchor.width;
  const garmentHeight = anchor.height;

  const vertices: number[] = [];
  const positions: Array<{ x: number; y: number; u: number; v: number }> = [];

  for (let r = 0; r < GRID_ROWS; r++) {
    const v = r / (GRID_ROWS - 1);

    const b0 = (1 - v) * (1 - v);
    const b1 = 2 * (1 - v) * v;
    const b2 = v * v;
    const spineX = b0 * T0.x + b1 * Cchest.x + b2 * B0.x;
    const spineY = b0 * T0.y + b1 * Cchest.y + b2 * B0.y;

    const tx = 2 * (1 - v) * (Cchest.x - T0.x) + 2 * v * (B0.x - Cchest.x);
    const ty = 2 * (1 - v) * (Cchest.y - T0.y) + 2 * v * (B0.y - Cchest.y);
    const tLen = Math.max(Math.hypot(tx, ty), 0.001);

    let nx = -ty / tLen;
    let ny = tx / tLen;
    if (nx * uShoulder.x + ny * uShoulder.y < 0) {
      nx = -nx;
      ny = -ny;
    }

    const widthRatio = (1 - v) + v * (Math.max(hipWidth, 1) / Math.max(shoulderWidth, 1));
    const rowGarmentWidth = garmentWidth * (0.88 + 0.12 * Math.min(widthRatio, 1.25));

    const collarLift = (1 - v) * (garmentHeight * 0.12);
    const pX = spineX - (tx / tLen) * collarLift;
    const pY = spineY - (ty / tLen) * collarLift;

    for (let c = 0; c < GRID_COLS; c++) {
      const u = c / (GRID_COLS - 1);
      const du = u - 0.5;

      const uWarped = du + kPersp * (1 - 4 * du * du) * 0.35;

      const vx = pX + nx * (uWarped * rowGarmentWidth);
      const vy = pY + ny * (uWarped * rowGarmentWidth);

      vertices.push(vx, vy, u, v);
      positions.push({ x: vx, y: vy, u, v });
    }
  }

  return {
    vertexData: new Float32Array(vertices),
    positions,
    cols: GRID_COLS,
    rows: GRID_ROWS,
    kPersp,
  };
}

function createWarpMeshRenderer(
  width: number,
  height: number,
  garmentImage: HTMLImageElement | HTMLCanvasElement
): WarpMeshRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);

  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let positionBuffer: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  let indexCount = 0;
  let useFallback = false;

  try {
    gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL context not supported');

    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      uniform vec2 u_resolution;
      varying vec2 v_texCoord;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 zeroToTwo = zeroToOne * 2.0;
        vec2 clipSpace = zeroToTwo - 1.0;
        gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    const fsSource = `
      precision mediump float;
      uniform sampler2D u_image;
      uniform float u_opacity;
      varying vec2 v_texCoord;
      void main() {
        vec4 color = texture2D(u_image, v_texCoord);
        gl_FragColor = vec4(color.rgb, color.a * u_opacity);
      }
    `;

    const createShader = (type: number, source: string) => {
      const shader = gl!.createShader(type);
      if (!shader) throw new Error('Shader creation failed');
      gl!.shaderSource(shader, source);
      gl!.compileShader(shader);
      if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        const info = gl!.getShaderInfoLog(shader);
        gl!.deleteShader(shader);
        throw new Error('Shader compile failed: ' + info);
      }
      return shader;
    };

    const vs = createShader(gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl.FRAGMENT_SHADER, fsSource);
    program = gl.createProgram();
    if (!program) throw new Error('Program creation failed');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(program));
    }

    const indices: number[] = [];
    for (let r = 0; r < GRID_ROWS - 1; r++) {
      for (let c = 0; c < GRID_COLS - 1; c++) {
        const i0 = r * GRID_COLS + c;
        const i1 = i0 + 1;
        const i2 = (r + 1) * GRID_COLS + c;
        const i3 = i2 + 1;
        indices.push(i0, i1, i2);
        indices.push(i1, i3, i2);
      }
    }
    indexCount = indices.length;

    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, GRID_ROWS * GRID_COLS * 4 * 4, gl.DYNAMIC_DRAW);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, garmentImage);
  } catch (err) {
    console.warn('WebGL warp renderer unavailable; falling back to 2D canvas.', err);
    useFallback = true;
  }

  function renderWarpMesh(warpMesh: WarpMesh, opacity = 1.0, destWidth?: number, destHeight?: number) {
    if (!warpMesh) return;

    if (destWidth && destHeight && (canvas.width !== destWidth || canvas.height !== destHeight)) {
      canvas.width = destWidth;
      canvas.height = destHeight;
    }

    if (useFallback || !gl || !program) {
      renderCanvas2DFallback(canvas, garmentImage, warpMesh, opacity);
      return;
    }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    const uResolution = gl.getUniformLocation(program, 'u_resolution');
    gl.uniform2f(uResolution, canvas.width, canvas.height);

    const uOpacity = gl.getUniformLocation(program, 'u_opacity');
    gl.uniform1f(uOpacity, opacity);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, warpMesh.vertexData);

    const FSIZE = Float32Array.BYTES_PER_ELEMENT;
    const aPosition = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, FSIZE * 4, 0);

    const aTexCoord = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, FSIZE * 4, FSIZE * 2);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
  }

  function destroy() {
    if (gl) {
      if (texture) gl.deleteTexture(texture);
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      if (program) gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  return {
    canvas,
    renderWarpMesh,
    destroy,
    isWebGL: !useFallback,
  };
}

function renderCanvas2DFallback(
  destCanvas: HTMLCanvasElement,
  image: HTMLImageElement | HTMLCanvasElement,
  warpMesh: WarpMesh,
  opacity: number
) {
  const ctx = destCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, destCanvas.width, destCanvas.height);
  ctx.save();
  ctx.globalAlpha = opacity;

  const positions = warpMesh.positions;
  const imgW = image.width;
  const imgH = image.height;

  for (let r = 0; r < GRID_ROWS - 1; r++) {
    for (let c = 0; c < GRID_COLS - 1; c++) {
      const i0 = r * GRID_COLS + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * GRID_COLS + c;
      const i3 = i2 + 1;

      const p0 = positions[i0];
      const p1 = positions[i1];
      const p2 = positions[i2];
      const p3 = positions[i3];

      drawTriangle(
        ctx, image,
        p0.u * imgW, p0.v * imgH,
        p1.u * imgW, p1.v * imgH,
        p2.u * imgW, p2.v * imgH,
        p0.x, p0.y, p1.x, p1.y, p2.x, p2.y
      );

      drawTriangle(
        ctx, image,
        p1.u * imgW, p1.v * imgH,
        p3.u * imgW, p3.v * imgH,
        p2.u * imgW, p2.v * imgH,
        p1.x, p1.y, p3.x, p3.y, p2.x, p2.y
      );
    }
  }
  ctx.restore();
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  im: HTMLImageElement | HTMLCanvasElement,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx0, sy0);
  ctx.lineTo(sx1, sy1);
  ctx.lineTo(sx2, sy2);
  ctx.closePath();
  ctx.clip();

  const denom = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (denom === 0) {
    ctx.restore();
    return;
  }

  const m11 = -(y0 * (sx1 - sx2) - y1 * sx0 + y2 * sx0 + (y1 - y2) * sx0) / denom;
  const m12 = (y1 * sy0 - y2 * sy0 + y0 * (sy1 - sy2) - (y1 - y2) * sy0) / denom;
  const m21 = (x0 * (sx1 - sx2) - x1 * sx0 + x2 * sx0 + (x1 - x2) * sx0) / denom;
  const m22 = -(x1 * sy0 - x2 * sy0 + x0 * (sy1 - sy2) - (x1 - x2) * sy0) / denom;
  const dx = (x0 * (y2 * sx1 - y1 * sx2) + y0 * (x1 * sx2 - x2 * sx1) + (x2 * y1 - x1 * y2) * sx0) / denom;
  const dy = (x0 * (y2 * sy1 - y1 * sy2) + y0 * (x1 * sy2 - x2 * sy1) + (x2 * y1 - x1 * y2) * sy0) / denom;

  ctx.transform(m11, m12, m21, m22, dx, dy);
  ctx.drawImage(im, 0, 0);
  ctx.restore();
}

/** Remove a near-white studio background so the garment composites cleanly. */
function prepareGarmentSprite(image: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const canvas = document.createElement('canvas');
  const sourceWidth = Math.max(image.naturalWidth, 1);
  const sourceHeight = Math.max(image.naturalHeight, 1);
  const scale = Math.min(1, MAX_GARMENT_SPRITE_DIMENSION / Math.max(sourceWidth, sourceHeight));
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  // This one-time preprocessing reads pixels back to the CPU. Avoid a GPU
  // readback stall and retain enough detail for the 1280px render target.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return image;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i];
      const g = px[i + 1];
      const b = px[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (min > 232 && max - min < 18) {
        px[i + 3] = 0;
      }
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  } catch {
    // Canvas tainted by a non-CORS product image; use it as-is.
    return image;
  }
}

const LiveTryOn: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // Garment catalog integration: check navigation state, URL params, or canonical catalog
  const incomingProduct = location.state?.product;
  const initialCatalogProduct = (() => {
    if (incomingProduct) return incomingProduct;
    const searchParams = new URLSearchParams(location.search);
    const paramId = searchParams.get('id') || searchParams.get('productId');
    if (paramId) {
      const found = demoProducts.find(p => p.id === paramId);
      if (found) return found;
    }
    // Default to canonical catalog apparel item
    return demoProducts.find(p => p.type === 'shirt' || p.type === 'tshirt' || p.type === 'jacket') || demoProducts[0];
  })();

  const [product, setProduct] = useState<any>(initialCatalogProduct);
  const garmentUrl: string | undefined = product?.image;
  const clothType: ClothType = categoryToClothType(product?.category || product?.type);

  const productRef = useRef(product);
  const clothTypeRef = useRef(clothType);
  const spriteRef = useRef<HTMLCanvasElement | HTMLImageElement | null>(null);
  const spriteRatioRef = useRef<number>(1.3);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const videoFrameCallbackRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const renderContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  const smoothedArmLandmarksRef = useRef<SmoothedArmLandmarks | null>(null);
  const smoothedMeshRef = useRef<SmoothedMeshControlPoints | null>(null);
  const warpRendererRef = useRef<WarpMeshRenderer | null>(null);
  const opacityRef = useRef(0.92);

  const [status, setStatus] = useState<'loading' | 'tracking' | 'no-person' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [opacity, setOpacity] = useState(0.92);
  const [fps, setFps] = useState(0);
  const statusRef = useRef(status);

  useEffect(() => {
    productRef.current = product;
    clothTypeRef.current = categoryToClothType(product?.category || product?.type);
  }, [product]);

  useEffect(() => {
    opacityRef.current = opacity;
  }, [opacity]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const loadGarmentSprite = (url: string): Promise<{ sprite: HTMLCanvasElement | HTMLImageElement; ratio: number }> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const sprite = prepareGarmentSprite(img);
        const ratio = img.naturalHeight / Math.max(img.naturalWidth, 1);
        resolve({ sprite, ratio });
      };
      img.onerror = () => {
        const plain = new Image();
        plain.decoding = 'async';
        plain.onload = () => {
          const ratio = plain.naturalHeight / Math.max(plain.naturalWidth, 1);
          resolve({ sprite: plain, ratio });
        };
        plain.onerror = () => reject(new Error('Could not load the garment image.'));
        plain.src = url;
      };
      img.src = url;
    });

  // Hot-swap garment texture when user selects another catalog item
  useEffect(() => {
    if (!garmentUrl) return;
    let cancelled = false;
    loadGarmentSprite(garmentUrl)
      .then(({ sprite, ratio }) => {
        if (cancelled) return;
        spriteRef.current = sprite;
        spriteRatioRef.current = ratio;
        const canvas = canvasRef.current;
        if (canvas && canvas.width && canvas.height) {
          warpRendererRef.current?.destroy();
          warpRendererRef.current = createWarpMeshRenderer(canvas.width, canvas.height, sprite);
        }
      })
      .catch((err) => {
        console.warn('Live try-on garment sprite swap warning:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [garmentUrl]);

  useEffect(() => {
    let landmarker: PoseLandmarker | null = null;
    let stream: MediaStream | null = null;
    let cancelled = false;
    let lastVideoTime = -1;
    let lastPoseInferenceAt = Number.NEGATIVE_INFINITY;
    let lastLandmarks: any[] | null = null;
    let frameCount = 0;
    let fpsWindowStart = performance.now();

    anchorRef.current = null;
    smoothedMeshRef.current = null;

    const setTrackerStatus = (next: 'tracking' | 'no-person') => {
      if (statusRef.current === next) return;
      statusRef.current = next;
      setStatus(next);
    };

    const syncCanvasSize = (canvas: HTMLCanvasElement, video: HTMLVideoElement) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height || (canvas.width === width && canvas.height === height)) return;

      canvas.width = width;
      canvas.height = height;
      if (warpRendererRef.current && warpRendererRef.current.canvas) {
        warpRendererRef.current.canvas.width = width;
        warpRendererRef.current.canvas.height = height;
      }
      const context = renderContextRef.current;
      if (context) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
      }
    };

    const cancelScheduledFrame = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      const video = videoRef.current;
      if (video && videoFrameCallbackRef.current !== null && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(videoFrameCallbackRef.current);
        videoFrameCallbackRef.current = null;
      }
    };

    const setup = async () => {
      try {
        if (!spriteRef.current && garmentUrl) {
          try {
            const { sprite, ratio } = await loadGarmentSprite(garmentUrl);
            spriteRef.current = sprite;
            spriteRatioRef.current = ratio;
          } catch (e) {
            console.warn('Initial garment load warning:', e);
          }
        }
        if (cancelled) return;

        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
        if (cancelled) return;

        const createLandmarker = (delegate: 'GPU' | 'CPU') =>
          PoseLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numPoses: 1,
          });

        try {
          landmarker = await createLandmarker('GPU');
        } catch (gpuError) {
          if (cancelled) return;
          console.warn('Live try-on GPU tracker unavailable; using CPU fallback.', gpuError);
          landmarker = await createLandmarker('CPU');
        }
        if (cancelled) {
          landmarker?.close();
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        const video = videoRef.current;
        if (!video) {
          throw new Error('Camera preview is unavailable.');
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) {
          throw new Error('Try-on canvas is unavailable.');
        }
        const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
        if (!context) throw new Error('Canvas rendering is unavailable.');
        renderContextRef.current = context;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        syncCanvasSize(canvas, video);

        if (spriteRef.current) {
          warpRendererRef.current = createWarpMeshRenderer(canvas.width, canvas.height, spriteRef.current);
        }

        statusRef.current = 'tracking';
        setStatus('tracking');
        scheduleNextFrame();
      } catch (error: any) {
        console.error('Live try-on setup failed:', error);
        if (!cancelled) {
          stream?.getTracks().forEach(track => track.stop());
          landmarker?.close();
          landmarker = null;
          if (videoRef.current) videoRef.current.srcObject = null;
          setStatus('error');
          setErrorMessage(
            error?.name === 'NotAllowedError'
              ? 'Camera access was denied. Allow camera permission and retry.'
              : error?.message || 'Could not start the live try-on.'
          );
        }
      }
    };

    const mirrored = (x: number) => 1 - x;

    const computeAnchor = (lm: any[], w: number, h: number): Anchor | null => {
      const visible = (i: number) => lm[i] && (lm[i].visibility ?? 1) > 0.4;
      if (!visible(L_SHOULDER) || !visible(R_SHOULDER)) return null;

      const ls = { x: mirrored(lm[L_SHOULDER].x) * w, y: lm[L_SHOULDER].y * h };
      const rs = { x: mirrored(lm[R_SHOULDER].x) * w, y: lm[R_SHOULDER].y * h };
      const shoulderWidth = Math.hypot(rs.x - ls.x, rs.y - ls.y);
      const angle = Math.atan2(rs.y - ls.y, rs.x - ls.x);
      const midX = (ls.x + rs.x) / 2;
      const midY = (ls.y + rs.y) / 2;

      const currentClothType = clothTypeRef.current;
      const currentSpriteRatio = spriteRatioRef.current;

      if (currentClothType === 'lower_body') {
        if (!visible(L_HIP) || !visible(R_HIP)) return null;
        const lh = { x: mirrored(lm[L_HIP].x) * w, y: lm[L_HIP].y * h };
        const rh = { x: mirrored(lm[R_HIP].x) * w, y: lm[R_HIP].y * h };
        const hipY = (lh.y + rh.y) / 2;
        const hipX = (lh.x + rh.x) / 2;
        const ankleY = visible(L_ANKLE) && visible(R_ANKLE)
          ? (lm[L_ANKLE].y * h + lm[R_ANKLE].y * h) / 2
          : hipY + shoulderWidth * 2.6;
        const height = Math.max(ankleY - hipY, 1) * 1.08;
        const width = Math.hypot(rh.x - lh.x, rh.y - lh.y) * 2.4;
        return { cx: hipX, cy: hipY + height * 0.48, width, height, angle };
      }

      if (currentClothType === 'dress') {
        const ankleY = visible(L_ANKLE) && visible(R_ANKLE)
          ? (lm[L_ANKLE].y * h + lm[R_ANKLE].y * h) / 2
          : midY + shoulderWidth * 4;
        const height = Math.max(ankleY - midY, 1) * 1.05;
        return { cx: midX, cy: midY + height * 0.46, width: shoulderWidth * 2.3, height, angle };
      }

      // upper_body / auto: hang from the shoulders
      const width = shoulderWidth * 2.25;
      const height = width * currentSpriteRatio;
      return { cx: midX, cy: midY + height * 0.38, width, height, angle };
    };

    const smooth = (next: Anchor): Anchor => {
      const prev = anchorRef.current;
      if (!prev) return next;
      const mix = (a: number, b: number) => a + (b - a) * SMOOTHING;
      let angleDelta = next.angle - prev.angle;
      if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
      if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
      return {
        cx: mix(prev.cx, next.cx),
        cy: mix(prev.cy, next.cy),
        width: mix(prev.width, next.width),
        height: mix(prev.height, next.height),
        angle: prev.angle + angleDelta * SMOOTHING,
      };
    };

    function scheduleNextFrame() {
      if (cancelled || document.visibilityState !== 'visible') return;

      const video = videoRef.current;
      if (video && 'requestVideoFrameCallback' in video) {
        videoFrameCallbackRef.current = video.requestVideoFrameCallback((now) => {
          videoFrameCallbackRef.current = null;
          renderLoop(now);
        });
        return;
      }

      rafRef.current = requestAnimationFrame(renderLoop);
    }

    function renderLoop(now: number) {
      if (cancelled || document.visibilityState !== 'visible') return;

      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = renderContextRef.current;
      if (!video || !canvas || !ctx || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        cancelScheduledFrame();
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          renderLoop(performance.now());
        }, 100);
        return;
      }

      syncCanvasSize(canvas, video);
      if (!canvas.width || !canvas.height) {
        cancelScheduledFrame();
        timeoutRef.current = window.setTimeout(() => {
          timeoutRef.current = null;
          renderLoop(performance.now());
        }, 100);
        return;
      }

      // Mirrored selfie view. setTransform avoids save/restore work on every frame.
      ctx.setTransform(-1, 0, 0, 1, canvas.width, 0);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      ctx.setTransform(1, 0, 0, 1, 0, 0);

      const hasNewVideoFrame = video.currentTime !== lastVideoTime;
      if (landmarker && hasNewVideoFrame && now - lastPoseInferenceAt >= MIN_POSE_INTERVAL_MS) {
        lastVideoTime = video.currentTime;
        lastPoseInferenceAt = now;
        const result = landmarker.detectForVideo(video, now);
        lastLandmarks = result.landmarks?.[0] ?? null;
      }

      const sprite = spriteRef.current;
      if (lastLandmarks && sprite) {
        const target = computeAnchor(lastLandmarks, canvas.width, canvas.height);
        if (target) {
          const anchor = smooth(target);
          anchorRef.current = anchor;
          if (anchor.width > 0 && anchor.height > 0 && Number.isFinite(anchor.width) && Number.isFinite(anchor.height) && Number.isFinite(anchor.angle) && Number.isFinite(anchor.cx) && Number.isFinite(anchor.cy)) {
            // Non-rigid garment warp mesh calculation:
            const warpMesh = computeWarpMesh(
              lastLandmarks,
              canvas.width,
              canvas.height,
              anchor,
              smoothedMeshRef,
              clothTypeRef.current
            );

            if (warpMesh && warpRendererRef.current) {
              warpRendererRef.current.renderWarpMesh(warpMesh, opacityRef.current, canvas.width, canvas.height);
              ctx.drawImage(warpRendererRef.current.canvas, 0, 0);
            } else {
              ctx.save();
              ctx.globalAlpha = opacityRef.current;
              ctx.translate(anchor.cx, anchor.cy);
              ctx.rotate(anchor.angle);
              ctx.drawImage(sprite, -anchor.width / 2, -anchor.height / 2, anchor.width, anchor.height);
              ctx.restore();
            }

            // Arm Occlusion: composite foreground arms and hands in front of the garment
            const occlusion = computeArmOcclusion(
              lastLandmarks,
              canvas.width,
              canvas.height,
              smoothedArmLandmarksRef
            );
            renderArmOcclusion(ctx, video, occlusion);
          }
          setTrackerStatus('tracking');
        } else {
          anchorRef.current = null;
          smoothedArmLandmarksRef.current = null;
          smoothedMeshRef.current = null;
          setTrackerStatus('no-person');
        }
      } else if (!lastLandmarks) {
        anchorRef.current = null;
        smoothedArmLandmarksRef.current = null;
        smoothedMeshRef.current = null;
        setTrackerStatus('no-person');
      }

      frameCount += 1;
      if (now - fpsWindowStart >= 1000) {
        setFps(Math.round((frameCount * 1000) / (now - fpsWindowStart)));
        frameCount = 0;
        fpsWindowStart = now;
      }

      scheduleNextFrame();
    }

    const handleVisibilityChange = () => {
      cancelScheduledFrame();
      if (!cancelled && document.visibilityState === 'visible') {
        lastVideoTime = -1;
        scheduleNextFrame();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    setup();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cancelScheduledFrame();
      stream?.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      landmarker?.close();
      renderContextRef.current = null;
      spriteRef.current = null;
      smoothedArmLandmarksRef.current = null;
      smoothedMeshRef.current = null;
      warpRendererRef.current?.destroy();
      warpRendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-screen w-full bg-black text-white overflow-hidden font-sans select-none">
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full object-cover" />

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/70 to-transparent">
        <button
          aria-label="Go back"
          onClick={() => navigate(-1)}
          className="h-10 w-10 flex items-center justify-center rounded-full bg-black/40 border border-white/10 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px] text-brand">arrow_back</span>
        </button>
        <div className="flex flex-col items-center max-w-[200px]">
          <span className="text-[11px] font-bold text-gray-300">{product?.brand || 'ZipRIGHT'}</span>
          <span className="text-[11px] font-bold tracking-tight text-white truncate text-center">
            {product?.title || 'Live Try-On'}
          </span>
        </div>
        <div className="h-10 px-3 flex items-center justify-center rounded-full bg-black/40 border border-white/10">
          <span className="text-[12px] font-bold text-brand">{fps} FPS</span>
        </div>
      </div>

      {/* Status overlays */}
      {status === 'loading' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/80">
          <div className="h-12 w-12 rounded-full border-2 border-brand border-t-transparent animate-spin"></div>
          <span className="text-[12px] font-bold text-brand">Starting camera & tracker</span>
        </div>
      )}
      {status === 'no-person' && (
        <div className="absolute top-24 left-0 right-0 z-40 flex justify-center">
          <div className="px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
            <span className="text-[12px] font-bold text-white/80">Step back so your upper body is visible</span>
          </div>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-black/90 p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-red-500">videocam_off</span>
          <p className="text-sm text-white/80 max-w-xs">{errorMessage}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-2 px-8 py-3 bg-brand text-white font-bold text-xs rounded-xl active:scale-95 transition-all"
          >
            Go Back
          </button>
        </div>
      )}

      {/* Bottom controls */}
      {status === 'tracking' || status === 'no-person' ? (
        <div className="absolute bottom-0 left-0 right-0 z-50 p-4 sm:p-6 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-3">
          {/* Real ZipRIGHT Catalog Garment Selector */}
          <div className="max-w-md mx-auto w-full">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {demoProducts
                .filter((p) => p.image && (p.category === 'Men' || p.category === 'Women' || p.type === 'shirt' || p.type === 'tshirt' || p.type === 'jacket' || p.type === 'kurta' || p.type === 'jeans'))
                .map((item) => {
                  const isSelected = item.id === product?.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setProduct(item)}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all shrink-0 active:scale-95 ${
                        isSelected
                          ? 'bg-brand/25 border-brand text-white shadow-glow'
                          : 'bg-black/50 border-white/10 text-gray-300 hover:text-white hover:border-white/30'
                      }`}
                    >
                      <img src={item.image} alt={item.title} className="w-5 h-5 rounded-full object-cover shrink-0" />
                      <span className="text-[11px] font-medium whitespace-nowrap">{item.title}</span>
                    </button>
                  );
                })}
            </div>
          </div>

          {/* Opacity slider */}
          <div className="max-w-md mx-auto w-full flex items-center gap-4">
            <span className="material-symbols-outlined text-[18px] text-brand shrink-0">opacity</span>
            <input
              type="range"
              min={0.4}
              max={1}
              step={0.02}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="flex-1 accent-brand"
            />
            <span className="text-[11px] font-mono text-gray-400 w-8 text-right">{Math.round(opacity * 100)}%</span>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LiveTryOn;
