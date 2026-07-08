/* ==========================================================================
   RADIA — real-time webcam X-ray hand/face effect
   MediaPipe Hands + Face Mesh for landmark tracking
   Three.js (WebGL) for the video shader + glowing skeletal overlay
   ========================================================================== */

const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('scene');
const loadingEl = document.getElementById('loading');
const permissionErrorEl = document.getElementById('permission-error');
const statHandsEl = document.getElementById('stat-hands');
const statFaceEl = document.getElementById('stat-face');
const statFpsEl = document.getElementById('stat-fps');

const MAX_HANDS = 2;

/* ---------------------------------------------------------------------
   Three.js setup
--------------------------------------------------------------------- */
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

let videoTexture = null;

const uniforms = {
  uVideo: { value: null },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uVideoResolution: { value: new THREE.Vector2(1, 1) },
  uHandCenters: { value: [new THREE.Vector2(-2, -2), new THREE.Vector2(-2, -2)] },
  uHandActive: { value: [0, 0] },
  uFaceCenter: { value: new THREE.Vector2(-2, -2) },
  uFaceActive: { value: 0 },
  uRadius: { value: 0.22 },
  uTime: { value: 0 }
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uVideo;
  uniform vec2 uResolution;
  uniform vec2 uVideoResolution;
  uniform vec2 uHandCenters[2];
  uniform float uHandActive[2];
  uniform vec2 uFaceCenter;
  uniform float uFaceActive;
  uniform float uRadius;
  uniform float uTime;

  // Map screen UV -> video UV so the feed is cropped like CSS "cover"
  vec2 coverUV(vec2 uv) {
    float screenAspect = uResolution.x / uResolution.y;
    float videoAspect = uVideoResolution.x / uVideoResolution.y;
    vec2 res = uv;
    if (screenAspect > videoAspect) {
      float factor = videoAspect / screenAspect;
      res.y = (uv.y - 0.5) * factor + 0.5;
    } else {
      float factor = screenAspect / videoAspect;
      res.x = (uv.x - 0.5) * factor + 0.5;
    }
    return res;
  }

  float luminance(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec2 uv = coverUV(vUv);
    // mirror for a natural selfie view
    uv.x = 1.0 - uv.x;

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
      return;
    }

    vec3 normalColor = texture2D(uVideo, uv).rgb;

    // Slightly darken / desaturate the "visible light" world outside the scan
    vec3 dim = mix(vec3(luminance(normalColor)), normalColor, 0.35) * 0.55;

    // X-ray look: inverted luminance, cool cyan tint, boosted contrast at edges
    float lum = luminance(normalColor);
    float inv = 1.0 - lum;
    inv = pow(inv, 1.6);
    vec3 xrayColor = inv * vec3(0.55, 0.95, 1.05);
    xrayColor += pow(inv, 4.0) * vec3(0.4, 0.9, 1.0); // hot highlight on bone-dense (bright) areas

    // Distance-based reveal mask around each tracked hand + face (in aspect-corrected space)
    float mask = 0.0;
    vec2 aspectFix = vec2(uResolution.x / uResolution.y, 1.0);

    for (int i = 0; i < 2; i++) {
      if (uHandActive[i] > 0.5) {
        vec2 d = (uv - uHandCenters[i]) * aspectFix;
        float dist = length(d);
        float edge = smoothstep(uRadius, uRadius * 0.35, dist);
        mask = max(mask, edge);
      }
    }
    if (uFaceActive > 0.5) {
      vec2 d = (uv - uFaceCenter) * aspectFix;
      float dist = length(d);
      float edge = smoothstep(uRadius * 1.35, uRadius * 0.5, dist);
      mask = max(mask, edge);
    }

    vec3 finalColor = mix(dim, xrayColor, mask);

    // subtle scan ring at the mask boundary
    float ring = 0.0;
    for (int i = 0; i < 2; i++) {
      if (uHandActive[i] > 0.5) {
        vec2 d = (uv - uHandCenters[i]) * aspectFix;
        float dist = length(d);
        ring += smoothstep(uRadius + 0.006, uRadius, dist) * (1.0 - smoothstep(uRadius - 0.01, uRadius - 0.016, dist));
      }
    }
    finalColor += ring * vec3(0.6, 1.0, 1.0) * 0.9;

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const planeGeo = new THREE.PlaneGeometry(2, 2);
const planeMat = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader });
const plane = new THREE.Mesh(planeGeo, planeMat);
scene.add(plane);

/* ---------------------------------------------------------------------
   Skeleton overlay (hands + face contour) drawn as glowing line segments
--------------------------------------------------------------------- */
const overlayGroup = new THREE.Group();
scene.add(overlayGroup);

function makeLineSet(maxLines, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxLines * 2 * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const lines = new THREE.LineSegments(geometry, material);
  overlayGroup.add(lines);
  return lines;
}

// glow: a wider, dimmer line underneath a thin, bright line
const handGlows = [
  makeLineSet(200, 0x8fe9ff, 0.18),
  makeLineSet(200, 0x8fe9ff, 0.18)
];
const handCores = [
  makeLineSet(200, 0xdffbff, 0.9),
  makeLineSet(200, 0xdffbff, 0.9)
];
const faceLines = makeLineSet(1200, 0x8fe9ff, 0.35);

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

// A curated, lightweight set of face contours (oval, eyes, brows, nose, lips)
// so the "skull scan" reads clearly without the full 468-point tesselation.
const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
const LEFT_EYE = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33];
const RIGHT_EYE = [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466,263];
const LEFT_BROW = [70,63,105,66,107];
const RIGHT_BROW = [336,296,334,293,300];
const NOSE = [168,6,197,195,5,4,45,220,115,48,64,98,97,2,326,327,294,278,344,440,275,4];
const LIPS = [61,146,91,181,84,17,314,405,321,375,291,308,324,318,402,317,14,87,178,88,95,61];

function contourToPairs(arr) {
  const pairs = [];
  for (let i = 0; i < arr.length - 1; i++) pairs.push([arr[i], arr[i + 1]]);
  return pairs;
}
const FACE_CONNECTIONS = [
  ...contourToPairs(FACE_OVAL),
  ...contourToPairs(LEFT_EYE),
  ...contourToPairs(RIGHT_EYE),
  ...contourToPairs(LEFT_BROW),
  ...contourToPairs(RIGHT_BROW),
  ...contourToPairs(NOSE),
  ...contourToPairs(LIPS)
];

/* ---------------------------------------------------------------------
   Coordinate mapping: MediaPipe normalized landmark -> screen NDC,
   matching the shader's mirrored "cover" transform of the video.
--------------------------------------------------------------------- */
function landmarkToNDC(lx, ly) {
  const mx = 1.0 - lx; // mirror to match shader
  const my = ly;

  const screenAspect = uniforms.uResolution.value.x / uniforms.uResolution.value.y;
  const videoAspect = uniforms.uVideoResolution.value.x / uniforms.uVideoResolution.value.y;

  let sx = mx;
  let sy = my;

  if (screenAspect > videoAspect) {
    const factor = videoAspect / screenAspect;
    sy = (my - 0.5) / factor + 0.5;
  } else {
    const factor = screenAspect / videoAspect;
    sx = (mx - 0.5) / factor + 0.5;
  }

  return [sx * 2 - 1, -(sy * 2 - 1)];
}

function updateLineSet(lineObj, points, connections, count) {
  const posAttr = lineObj.geometry.attributes.position;
  const arr = posAttr.array;
  let idx = 0;
  const n = Math.min(connections.length, count);
  for (let i = 0; i < n; i++) {
    const [a, b] = connections[i];
    if (!points[a] || !points[b]) continue;
    arr[idx++] = points[a][0]; arr[idx++] = points[a][1]; arr[idx++] = 0.01;
    arr[idx++] = points[b][0]; arr[idx++] = points[b][1]; arr[idx++] = 0.01;
  }
  posAttr.needsUpdate = true;
  lineObj.geometry.setDrawRange(0, idx / 3);
}

/* ---------------------------------------------------------------------
   Tracking state
--------------------------------------------------------------------- */
let latestHands = []; // array of {points: [[x,y],...]}
let latestFace = null; // {points: [[x,y],...]}

function centroid(points, indices) {
  let x = 0, y = 0;
  for (const i of indices) { x += points[i][0]; y += points[i][1]; }
  return [x / indices.length, y / indices.length];
}

/* ---------------------------------------------------------------------
   MediaPipe Hands
--------------------------------------------------------------------- */
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});
hands.setOptions({
  maxNumHands: MAX_HANDS,
  modelComplexity: 0,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
hands.onResults((results) => {
  latestHands = (results.multiHandLandmarks || []).map((lm) =>
    lm.map((p) => landmarkToNDC(p.x, p.y))
  );
  statHandsEl.textContent = String(latestHands.length);
});

/* ---------------------------------------------------------------------
   MediaPipe Face Mesh
--------------------------------------------------------------------- */
const faceMesh = new FaceMesh({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});
faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
faceMesh.onResults((results) => {
  const faces = results.multiFaceLandmarks;
  if (faces && faces.length > 0) {
    latestFace = faces[0].map((p) => landmarkToNDC(p.x, p.y));
    statFaceEl.textContent = 'TRACKING';
  } else {
    latestFace = null;
    statFaceEl.textContent = '--';
  }
});

/* ---------------------------------------------------------------------
   Camera feed
--------------------------------------------------------------------- */
/* ---------------------------------------------------------------------
   Offscreen canvas for downscaling input to MediaPipe
--------------------------------------------------------------------- */
const offscreenCanvas = document.createElement('canvas');
const offscreenCtx = offscreenCanvas.getContext('2d');
let isDetecting = false;
let frameCount = 0;

async function runDetections() {
  try {
    // Interleave detections: Hands run 2/3 of the time, FaceMesh runs 1/3.
    // Exactly one detection model runs per frame to keep CPU load uniform.
    if (frameCount % 3 === 2) {
      await faceMesh.send({ image: offscreenCanvas });
    } else {
      await hands.send({ image: offscreenCanvas });
    }
    frameCount++;
  } catch (err) {
    console.error('Detection error:', err);
  }
}

function processVideoFrame() {
  if (videoEl.paused || videoEl.ended) {
    requestAnimationFrame(processVideoFrame);
    return;
  }

  if (!isDetecting && videoEl.readyState >= videoEl.HAVE_CURRENT_DATA) {
    isDetecting = true;
    
    // Draw current frame scaled down to offscreen canvas
    offscreenCtx.drawImage(videoEl, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    
    runDetections().finally(() => {
      isDetecting = false;
    });
  }

  requestAnimationFrame(processVideoFrame);
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' },
      audio: false
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    videoTexture = new THREE.VideoTexture(videoEl);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    uniforms.uVideo.value = videoTexture;
    
    const vw = videoEl.videoWidth || 1280;
    const vh = videoEl.videoHeight || 720;
    uniforms.uVideoResolution.value.set(vw, vh);

    // Setup offscreen canvas size dynamically matching aspect ratio
    const targetWidth = 360;
    offscreenCanvas.width = targetWidth;
    offscreenCanvas.height = Math.round(targetWidth * (vh / vw));

    // Start background detection loop
    requestAnimationFrame(processVideoFrame);

    loadingEl.classList.add('hidden');
  } catch (err) {
    console.error('Camera error:', err);
    loadingEl.classList.add('hidden');
    permissionErrorEl.classList.remove('hidden');
  }
}

/* ---------------------------------------------------------------------
   Resize
--------------------------------------------------------------------- */
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  uniforms.uResolution.value.set(w, h);
}
window.addEventListener('resize', onResize);
onResize();

/* ---------------------------------------------------------------------
   Render loop
--------------------------------------------------------------------- */
let lastFrameTime = performance.now();
let fpsAccum = 0;
let fpsFrames = 0;

let smoothedHands = [null, null];
let smoothedFace = null;
const LERP_FACTOR = 0.2;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = now - lastFrameTime;
  lastFrameTime = now;
  fpsAccum += dt;
  fpsFrames++;
  if (fpsAccum >= 500) {
    statFpsEl.textContent = Math.round((fpsFrames * 1000) / fpsAccum);
    fpsAccum = 0;
    fpsFrames = 0;
  }

  uniforms.uTime.value = now / 1000;

  // Apply linear interpolation (lerp) for smooth movements
  for (let i = 0; i < 2; i++) {
    if (latestHands[i]) {
      if (!smoothedHands[i]) {
        smoothedHands[i] = latestHands[i].map(pt => [...pt]);
      } else {
        for (let j = 0; j < latestHands[i].length; j++) {
          if (!smoothedHands[i][j]) smoothedHands[i][j] = [...latestHands[i][j]];
          smoothedHands[i][j][0] += (latestHands[i][j][0] - smoothedHands[i][j][0]) * LERP_FACTOR;
          smoothedHands[i][j][1] += (latestHands[i][j][1] - smoothedHands[i][j][1]) * LERP_FACTOR;
        }
      }
    } else {
      smoothedHands[i] = null;
    }
  }

  if (latestFace) {
    if (!smoothedFace) {
      smoothedFace = latestFace.map(pt => [...pt]);
    } else {
      for (let j = 0; j < latestFace.length; j++) {
        if (!smoothedFace[j]) smoothedFace[j] = [...latestFace[j]];
        smoothedFace[j][0] += (latestFace[j][0] - smoothedFace[j][0]) * LERP_FACTOR;
        smoothedFace[j][1] += (latestFace[j][1] - smoothedFace[j][1]) * LERP_FACTOR;
      }
    }
  } else {
    smoothedFace = null;
  }

  // Update hand mask centers (support up to 2 hands)
  for (let i = 0; i < 2; i++) {
    if (smoothedHands[i]) {
      const c = centroid(smoothedHands[i], [0, 5, 9, 13, 17]);
      uniforms.uHandCenters.value[i].set((c[0] + 1) / 2, (c[1] + 1) / 2);
      uniforms.uHandActive.value[i] = 1;
    } else {
      uniforms.uHandActive.value[i] = 0;
    }
  }

  // Update face mask center
  if (smoothedFace) {
    const c = centroid(smoothedFace, [10, 152, 234, 454]);
    uniforms.uFaceCenter.value.set((c[0] + 1) / 2, (c[1] + 1) / 2);
    uniforms.uFaceActive.value = 1;
  } else {
    uniforms.uFaceActive.value = 0;
  }

  // Update skeleton overlays for both hands
  for (let i = 0; i < 2; i++) {
    if (smoothedHands[i]) {
      updateLineSet(handGlows[i], smoothedHands[i], HAND_CONNECTIONS, HAND_CONNECTIONS.length);
      updateLineSet(handCores[i], smoothedHands[i], HAND_CONNECTIONS, HAND_CONNECTIONS.length);
    } else {
      handGlows[i].geometry.setDrawRange(0, 0);
      handCores[i].geometry.setDrawRange(0, 0);
    }
  }

  if (smoothedFace) {
    updateLineSet(faceLines, smoothedFace, FACE_CONNECTIONS, FACE_CONNECTIONS.length);
  } else {
    faceLines.geometry.setDrawRange(0, 0);
  }

  if (uniforms.uVideoResolution.value.x !== (videoEl.videoWidth || 0) && videoEl.videoWidth) {
    uniforms.uVideoResolution.value.set(videoEl.videoWidth, videoEl.videoHeight);
  }

  renderer.render(scene, camera);
}

animate();
startCamera();
