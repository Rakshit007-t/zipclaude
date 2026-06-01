import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

let poseLandmarker: PoseLandmarker | null = null;

export const initPoseLandmarker = async () => {
  if (poseLandmarker) return poseLandmarker;
  
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "IMAGE",
      numPoses: 1,
    });
    return poseLandmarker;
  } catch (error) {
    console.error("Error initializing MediaPipe Pose:", error);
    throw error;
  }
};

const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

const round1 = (value: number) => Math.round(value * 10) / 10;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toPx = (lm: any, img: HTMLImageElement) => ({
  x: lm.x * img.width,
  y: lm.y * img.height
});

const pickHeadPoint = (pose: any[], img: HTMLImageElement) => {
  const headLandmarks = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    .map(index => pose[index])
    .filter((landmark): landmark is { x: number; y: number; visibility?: number } => {
      return Boolean(landmark) && (landmark.visibility ?? 1) >= 0.4;
    });

  if (headLandmarks.length === 0) {
    return null;
  }

  const highestHeadLandmark = headLandmarks.reduce((best, current) => {
    return current.y < best.y ? current : best;
  });

  return toPx(highestHeadLandmark, img);
};

const getVisiblePoint = (pose: any[], index: number, img: HTMLImageElement) => {
  const landmark = pose[index];
  if (!landmark || (landmark.visibility ?? 1) < 0.4) {
    return null;
  }
  return toPx(landmark, img);
};

const assertBelievableMeasurement = (value: number, min: number, max: number, label: string) => {
  if (!isFiniteNumber(value) || value < min || value > max) {
    throw new Error(`Could not calculate a believable ${label}. Please retake the photos.`);
  }
};

export const estimateMeasurements = async (
  frontImageBase64: string, 
  sideImageBase64: string, 
  userHeightCm: number
) => {
  const landmarker = await initPoseLandmarker();

  const loadImg = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

  const frontImg = await loadImg(frontImageBase64);
  const sideImg = await loadImg(sideImageBase64);

  const frontResult = landmarker.detect(frontImg);
  const sideResult = landmarker.detect(sideImg);

  if (!frontResult.landmarks || frontResult.landmarks.length === 0 || !sideResult.landmarks || sideResult.landmarks.length === 0) {
    throw new Error("Could not detect full body in one or both images. Please ensure you are standing straight and fully visible.");
  }

  const frontPose = frontResult.landmarks[0];
  const sidePose = sideResult.landmarks[0]; // We use side pose to validate but derive depth from robust heuristics below if side joints overlap

  if (!isFiniteNumber(userHeightCm) || userHeightCm < 120 || userHeightCm > 240) {
    throw new Error("Could not calculate believable measurements from the supplied height. Please retake the photos.");
  }

  const headPoint = pickHeadPoint(frontPose, frontImg);
  const leftShoulder = getVisiblePoint(frontPose, 11, frontImg);
  const rightShoulder = getVisiblePoint(frontPose, 12, frontImg);
  const leftHip = getVisiblePoint(frontPose, 23, frontImg);
  const rightHip = getVisiblePoint(frontPose, 24, frontImg);
  const leftElbow = getVisiblePoint(frontPose, 13, frontImg);
  const leftWrist = getVisiblePoint(frontPose, 15, frontImg);
  const leftKnee = getVisiblePoint(frontPose, 25, frontImg);
  const leftAnkle = getVisiblePoint(frontPose, 27, frontImg);
  const rightAnkle = getVisiblePoint(frontPose, 28, frontImg);

  if (
    !headPoint ||
    !leftShoulder ||
    !rightShoulder ||
    !leftHip ||
    !rightHip ||
    !leftElbow ||
    !leftWrist ||
    !leftKnee ||
    !leftAnkle ||
    !rightAnkle
  ) {
    throw new Error("Could not detect a complete body pose. Please retake the photos.");
  }

  const anklePoint = {
    x: (leftAnkle.x + rightAnkle.x) / 2,
    y: (leftAnkle.y + rightAnkle.y) / 2
  };

  const pixelHeight = getDistance(headPoint, anklePoint);
  if (!isFiniteNumber(pixelHeight) || pixelHeight <= 0) {
    throw new Error("Could not calculate a valid body scale. Please retake the photos.");
  }

  const scale = userHeightCm / pixelHeight;

  let shoulderWidth = getDistance(leftShoulder, rightShoulder) * scale;
  const hipWidth = getDistance(leftHip, rightHip) * scale;
  const chestBase = shoulderWidth * 2.1;
  const waistBase = hipWidth * 1.85;
  const armsBase = (getDistance(leftShoulder, leftElbow) + getDistance(leftElbow, leftWrist)) * scale;
  const legsBase = (getDistance(leftHip, leftKnee) + getDistance(leftKnee, leftAnkle)) * scale;
  const torsoBase = getDistance(leftShoulder, leftHip) * scale;

  let chest = chestBase;
  let waist = waistBase;
  let arms = armsBase;
  let legs = legsBase;
  let torso = torsoBase;

  if (waist < chest * 0.65) {
    waist = chest * 0.68;
  }

  if (chest > userHeightCm * 0.75) {
    chest = userHeightCm * 0.72;
  }

  chest = clamp(chest, 80, 130);
  waist = clamp(waist, 65, 110);
  shoulderWidth = clamp(shoulderWidth, 35, 60);
  arms = clamp(arms, userHeightCm * 0.32, userHeightCm * 0.48);
  legs = clamp(legs, userHeightCm * 0.40, userHeightCm * 0.58);
  torso = clamp(torso, userHeightCm * 0.24, userHeightCm * 0.42);

  const frontHeight = getDistance(headPoint, anklePoint);
  const sideHeadPoint = pickHeadPoint(sidePose, sideImg);
  const sideLeftAnkle = getVisiblePoint(sidePose, 27, sideImg) ?? getVisiblePoint(sidePose, 28, sideImg);

  if (sideHeadPoint && sideLeftAnkle) {
    const sideHeight = getDistance(sideHeadPoint, sideLeftAnkle);
    if (!isFiniteNumber(sideHeight) || sideHeight <= 0) {
      throw new Error("Could not calculate believable measurements from the side view. Please retake the photos.");
    }

    const heightDelta = Math.abs(sideHeight - frontHeight) / frontHeight;
    if (heightDelta > 0.25) {
      throw new Error("Body pose looks inconsistent between photos. Please retake the photos.");
    }
  }

  assertBelievableMeasurement(chest, 80, 130, "chest");
  assertBelievableMeasurement(waist, 65, 110, "waist");
  assertBelievableMeasurement(shoulderWidth, 35, 60, "shoulders");
  assertBelievableMeasurement(arms, userHeightCm * 0.30, userHeightCm * 0.55, "arms");
  assertBelievableMeasurement(legs, userHeightCm * 0.40, userHeightCm * 0.65, "legs");
  assertBelievableMeasurement(torso, userHeightCm * 0.22, userHeightCm * 0.45, "torso");

  return {
    chest: round1(chest),
    waist: round1(waist),
    shoulders: round1(shoulderWidth),
    arms: round1(arms),
    legs: round1(legs),
    torso: round1(torso)
  };
};
