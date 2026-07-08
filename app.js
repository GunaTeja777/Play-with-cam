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
  uTime: { value: 0 },
  
  // Polygon uniforms
  uPolygon: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  uNumPolygonPoints: { value: 0 },
  uPolygonActive: { value: 0 },

  // Effect selector: 0.0 = X-Ray, 1.0 = Edge Sketch
  uEffectType: { value: 0 },

  // Movie theme: 0 = Chitti, 1 = Baahubali, 2 = Pushpa Raj, 3 = Chulbul Pandey
  uMovieTheme: { value: 0.0 }
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

  // Polygon uniforms
  uniform vec2 uPolygon[4];
  uniform float uNumPolygonPoints;
  uniform float uPolygonActive;

  // Effect selector
  uniform float uEffectType;

  // Movie theme
  uniform float uMovieTheme;

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

  // Point-in-polygon ray-casting test
  bool isInsidePolygon(vec2 p) {
    if (uNumPolygonPoints < 3.0) return false;
    bool inside = false;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uNumPolygonPoints) break;
      vec2 p1 = uPolygon[i];
      vec2 p2 = uPolygon[0];
      if (i + 1 < 4) {
        if (float(i + 1) < uNumPolygonPoints) {
          p2 = uPolygon[i + 1];
        }
      }
      if (((p1.y > p.y) != (p2.y > p.y)) &&
          (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
        inside = !inside;
      }
    }
    return inside;
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

    // The world outside the scan is the normal color of the camera feed
    vec3 dim = normalColor;

    // Cyberpunk dynamic movie themes: Chromatic aberration + dynamic tritone color mapping
    vec2 shift = vec2(0.006 * sin(uTime * 8.0), 0.003 * cos(uTime * 12.0));
    float r = texture2D(uVideo, uv + shift).r;
    float g = texture2D(uVideo, uv).g;
    float b = texture2D(uVideo, uv - shift).b;
    vec3 glitchColor = vec3(r, g, b);
    
    float glitchLum = luminance(glitchColor);
    
    vec3 darkColor;
    vec3 midColor;
    vec3 brightColor;
    
    if (uMovieTheme < 0.5) {
      // Chitti 2.0 (Robotic Cyan / Neutral)
      darkColor = vec3(0.02, 0.05, 0.2);
      midColor = vec3(0.0, 0.6, 0.85);
      brightColor = vec3(0.0, 1.0, 0.95);
    } else if (uMovieTheme < 1.5) {
      // Baahubali (Golden Royal / Surprised)
      darkColor = vec3(0.12, 0.04, 0.0);
      midColor = vec3(0.9, 0.45, 0.0);
      brightColor = vec3(1.0, 0.85, 0.4);
    } else if (uMovieTheme < 2.5) {
      // Pushpa Raj (Fiery Red / Angry)
      darkColor = vec3(0.05, 0.0, 0.0);
      midColor = vec3(0.95, 0.0, 0.1);
      brightColor = vec3(1.0, 0.7, 0.0);
    } else {
      // Chulbul Pandey (Vibrant Pink Bollywood / Happy)
      darkColor = vec3(0.1, 0.0, 0.15);
      midColor = vec3(1.0, 0.0, 0.6);
      brightColor = vec3(1.0, 0.9, 0.1);
    }
    
    vec3 movieThemeColor = mix(darkColor, midColor, smoothstep(0.1, 0.5, glitchLum));
    movieThemeColor = mix(movieThemeColor, brightColor, smoothstep(0.5, 0.9, glitchLum));
    
    // Add horizontal scrolling scanlines
    float scanline = sin(uv.y * 240.0 + uTime * 20.0) * 0.08;
    movieThemeColor += scanline * brightColor;
    
    // Add digital grid
    if (uPolygonActive > 0.5) {
      float gridVal = max(cos(vUv.x * 120.0), cos(vUv.y * 120.0));
      float grid = smoothstep(0.95, 0.98, gridVal);
      movieThemeColor += grid * brightColor * 0.25;
    }

    // Distance-based reveal mask inside the polygon scanning area
    float mask = 0.0;
    
    if (uPolygonActive > 0.5) {
      if (isInsidePolygon(vUv)) {
        mask = 1.0;
      }
    }

    vec3 finalColor = dim;

    if (mask > 0.5) {
      if (uEffectType > 0.5) {
        // Sobel edge-detection sketch filter (Image 2 style)
        vec2 stepSize = 1.0 / uVideoResolution;
        
        float t00 = luminance(texture2D(uVideo, uv + vec2(-1.0, -1.0) * stepSize).rgb);
        float t10 = luminance(texture2D(uVideo, uv + vec2( 0.0, -1.0) * stepSize).rgb);
        float t20 = luminance(texture2D(uVideo, uv + vec2( 1.0, -1.0) * stepSize).rgb);
        
        float t01 = luminance(texture2D(uVideo, uv + vec2(-1.0,  0.0) * stepSize).rgb);
        float t21 = luminance(texture2D(uVideo, uv + vec2( 1.0,  0.0) * stepSize).rgb);
        
        float t02 = luminance(texture2D(uVideo, uv + vec2(-1.0,  1.0) * stepSize).rgb);
        float t12 = luminance(texture2D(uVideo, uv + vec2( 0.0,  1.0) * stepSize).rgb);
        float t22 = luminance(texture2D(uVideo, uv + vec2( 1.0,  1.0) * stepSize).rgb);
        
        float gx = -1.0 * t00 - 2.0 * t01 - 1.0 * t02 + 1.0 * t20 + 2.0 * t21 + 1.0 * t22;
        float gy = -1.0 * t00 - 2.0 * t10 - 1.0 * t20 + 1.0 * t02 + 2.0 * t12 + 1.0 * t22;
        
        float edge = sqrt(gx * gx + gy * gy);
        edge = smoothstep(0.06, 0.18, edge);
        
        vec3 bg = vec3(0.03, 0.12, 0.42); // deep blue background
        vec3 glowCyan = vec3(0.1, 0.9, 1.0); // glowing cyan
        
        finalColor = mix(bg, glowCyan, edge);
      } else {
        // Movie theme scan (Chitti, Baahubali, Pushpa, Chulbul)
        finalColor = movieThemeColor;
      }
    }

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

const maskedMaterials = [];

function createMaskedMaterial(color, opacity, isPoints = false) {
  const uniforms = {
    uColor: { value: new THREE.Color(color) },
    uOpacity: { value: opacity },
    uPolygon: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uNumPolygonPoints: { value: 0 },
    uPolygonActive: { value: 0 }
  };

  const vertexShader = `
    varying vec2 vUv;
    attribute vec3 color;
    varying vec3 vColor;
    void main() {
      vUv = (position.xy + 1.0) / 2.0;
      vColor = color;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform vec2 uPolygon[4];
    uniform float uNumPolygonPoints;
    uniform float uPolygonActive;
    varying vec2 vUv;
    varying vec3 vColor;

    bool isInsidePolygon(vec2 p) {
      if (uNumPolygonPoints < 3.0) return false;
      bool inside = false;
      for (int i = 0; i < 4; i++) {
        if (float(i) >= uNumPolygonPoints) break;
        vec2 p1 = uPolygon[i];
        vec2 p2 = uPolygon[0];
        if (i + 1 < 4) {
          if (float(i + 1) < uNumPolygonPoints) {
            p2 = uPolygon[i + 1];
          }
        }
        if (((p1.y > p.y) != (p2.y > p.y)) &&
            (p.x < (p2.x - p1.x) * (p.y - p1.y) / (p2.y - p1.y) + p1.x)) {
          inside = !inside;
        }
      }
      return inside;
    }

    void main() {
      if (uPolygonActive > 0.5 && !isInsidePolygon(vUv)) {
        discard;
      }
      vec3 finalColor = ${isPoints ? 'vColor' : 'uColor'};
      gl_FragColor = vec4(finalColor, uOpacity);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  maskedMaterials.push(mat);
  return mat;
}

function makeLineSet(maxLines, color, opacity) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxLines * 2 * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  
  // Use our custom masked material
  const material = createMaskedMaterial(color, opacity, false);
  
  const lines = new THREE.LineSegments(geometry, material);
  overlayGroup.add(lines);
  return lines;
}

// (Hand skeleton lines and face contour lines removed)

/* ---------------------------------------------------------------------
   Additional scan overlays (digital face points, polygon boundaries, handles)
--------------------------------------------------------------------- */
// Face points cloud (468 points)
const facePointsGeo = new THREE.BufferGeometry();
const facePointsPositions = new Float32Array(468 * 3);
facePointsGeo.setAttribute('position', new THREE.BufferAttribute(facePointsPositions, 3));

// Multi-color digital vertex colors (white, cyan, magenta, blue)
const facePointsColors = new Float32Array(468 * 3);
for (let idx = 0; idx < 468; idx++) {
  let r = 0.5, g = 0.9, b = 1.0;
  const rand = Math.random();
  if (rand < 0.2) { // white
    r = 1.0; g = 1.0; b = 1.0;
  } else if (rand < 0.4) { // magenta
    r = 0.9; g = 0.4; b = 1.0;
  } else if (rand < 0.6) { // deep blue
    r = 0.2; g = 0.5; b = 1.0;
  }
  facePointsColors[idx * 3] = r;
  facePointsColors[idx * 3 + 1] = g;
  facePointsColors[idx * 3 + 2] = b;
}
facePointsGeo.setAttribute('color', new THREE.BufferAttribute(facePointsColors, 3));

const facePointsMat = createMaskedMaterial(0xffffff, 0.8, true);
const facePointsObj = new THREE.Points(facePointsGeo, facePointsMat);
overlayGroup.add(facePointsObj);

// Fingertip polygon boundary lines
const polygonLine = makeLineSet(5, 0x00ffcc, 0.95);
console.log('polygonLine material:', polygonLine.material);
console.log('polygonLine material uniforms:', polygonLine.material.uniforms);

// Fingertip green square handles (Drawn on top without masking)
const handleGeometry = new THREE.BufferGeometry();
const handlePositions = new Float32Array(4 * 3); // max 4 handles
handleGeometry.setAttribute('position', new THREE.BufferAttribute(handlePositions, 3));
const handleMaterial = new THREE.PointsMaterial({
  color: 0x00ffcc,
  size: 14.0,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});
const handlePointsObj = new THREE.Points(handleGeometry, handleMaterial);
scene.add(handlePointsObj);

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
let latestFaceRaw = null; // raw [x,y,z] from face mesh in [0,1]

function centroid(points, indices) {
  let x = 0, y = 0;
  for (const i of indices) { x += points[i][0]; y += points[i][1]; }
  return [x / indices.length, y / indices.length];
}

function distNDC(pt1, pt2) {
  const dx = pt1[0] - pt2[0];
  const dy = pt1[1] - pt2[1];
  return Math.sqrt(dx * dx + dy * dy);
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
    latestFaceRaw = faces[0].map((p) => [p.x, p.y, p.z]);
    statFaceEl.textContent = 'TRACKING';
  } else {
    latestFace = null;
    latestFaceRaw = null;
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

function extractFaceProportions(points) {
  const forehead = points[10];
  const chin = points[152];
  const cheekLeft = points[234];
  const cheekRight = points[454];
  const eyeLeft = points[33];
  const eyeRight = points[263];
  const noseTop = points[168];
  const noseBottom = points[1];
  const nostrilLeft = points[98];
  const nostrilRight = points[327];
  const lipLeft = points[61];
  const lipRight = points[291];
  const lipTop = points[0];
  const lipBottom = points[17];
  const eyebrowLeft = points[105];
  const eyebrowRight = points[295];
  const jawLeft1 = points[58];
  const jawRight1 = points[288];
  const jawLeft2 = points[136];
  const jawRight2 = points[365];
  const jawLeft3 = points[150];
  const jawRight3 = points[379];
  const foreheadCenter = points[9];

  function dist(p1, p2) {
    const dx = p1[0] - p2[0];
    const dy = p1[1] - p2[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  const faceHeight = dist(forehead, chin);
  if (faceHeight === 0) return null;

  return [
    dist(cheekLeft, cheekRight) / faceHeight, // 0: Face Width
    dist(eyeLeft, eyeRight) / faceHeight,     // 1: Pupil Distance
    dist(noseTop, noseBottom) / faceHeight,   // 2: Nose Length
    dist(nostrilLeft, nostrilRight) / faceHeight, // 3: Nose Width
    dist(lipLeft, lipRight) / faceHeight,     // 4: Mouth Width
    dist(lipTop, lipBottom) / faceHeight,     // 5: Mouth Height
    dist(lipBottom, chin) / faceHeight,       // 6: Chin Height
    dist(foreheadCenter, forehead) / faceHeight, // 7: Forehead Height
    dist(eyebrowLeft, eyeLeft) / faceHeight,   // 8: Left Eyebrow height
    dist(eyebrowRight, eyeRight) / faceHeight, // 9: Right Eyebrow height
    dist(jawLeft1, jawRight1) / faceHeight,   // 10: Upper Jaw Width
    dist(jawLeft2, jawRight2) / faceHeight,   // 11: Mid Jaw Width
    dist(jawLeft3, jawRight3) / faceHeight,   // 12: Lower Jaw Width
    dist(noseBottom, lipTop) / faceHeight     // 13: Philtrum length
  ];
}

function getThemeForCelebrity(name) {
  const firstChar = name.toUpperCase().charAt(0);
  if (firstChar >= 'A' && firstChar <= 'G') {
    return {
      themeId: 0.0,
      activeColor: '#00fff2', // Cyan
      shadowColor: 'rgba(0, 255, 242, 0.4)',
      status: 'MATCH DETECTED: CYAN SHADER'
    };
  } else if (firstChar >= 'H' && firstChar <= 'N') {
    return {
      themeId: 1.0,
      activeColor: '#ffbb00', // Gold
      shadowColor: 'rgba(255, 187, 0, 0.4)',
      status: 'MATCH DETECTED: AMBER SHADER'
    };
  } else if (firstChar >= 'O' && firstChar <= 'T') {
    return {
      themeId: 2.0,
      activeColor: '#ff2200', // Red
      shadowColor: 'rgba(255, 34, 0, 0.4)',
      status: 'MATCH DETECTED: VOLCANIC SHADER'
    };
  } else {
    return {
      themeId: 3.0,
      activeColor: '#ff0cc5', // Pink
      shadowColor: 'rgba(255, 12, 197, 0.4)',
      status: 'MATCH DETECTED: VIBRANT SHADER'
    };
  }
}

let celebrityDatabase = null;
async function loadCelebrityDatabase() {
  try {
    const res = await fetch('celebrity_db.json');
    celebrityDatabase = await res.json();
    console.log('Celebrity database successfully loaded.');
  } catch (err) {
    console.error('Failed to load celebrity look-alike database:', err);
  }
}
loadCelebrityDatabase();

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
let smoothedFaceRaw = null;
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

  if (latestFaceRaw) {
    if (!smoothedFaceRaw) {
      smoothedFaceRaw = latestFaceRaw.map(pt => [...pt]);
    } else {
      for (let j = 0; j < latestFaceRaw.length; j++) {
        if (!smoothedFaceRaw[j]) smoothedFaceRaw[j] = [...latestFaceRaw[j]];
        smoothedFaceRaw[j][0] += (latestFaceRaw[j][0] - smoothedFaceRaw[j][0]) * LERP_FACTOR;
        smoothedFaceRaw[j][1] += (latestFaceRaw[j][1] - smoothedFaceRaw[j][1]) * LERP_FACTOR;
        smoothedFaceRaw[j][2] += (latestFaceRaw[j][2] - smoothedFaceRaw[j][2]) * LERP_FACTOR;
      }
    }
  } else {
    smoothedFaceRaw = null;
  }

  // Gather active vertices (Index Tips and Thumb Tips) from both hands for the polygon
  const activePoints = [];
  for (let i = 0; i < 2; i++) {
    if (smoothedHands[i]) {
      // 8 is Index Tip, 4 is Thumb Tip
      if (smoothedHands[i][8]) activePoints.push(smoothedHands[i][8]);
      if (smoothedHands[i][4]) activePoints.push(smoothedHands[i][4]);
    }
  }

  // If we have 3 or 4 points, sort them counter-clockwise to form a simple polygon
  if (activePoints.length >= 3) {
    let cx = 0, cy = 0;
    for (const pt of activePoints) {
      cx += pt[0];
      cy += pt[1];
    }
    cx /= activePoints.length;
    cy /= activePoints.length;

    activePoints.sort((a, b) => {
      const angleA = Math.atan2(a[1] - cy, a[0] - cx);
      const angleB = Math.atan2(b[1] - cy, b[0] - cx);
      return angleA - angleB;
    });
  }

  // Sync polygon tracking uniforms
  const polygonActive = (activePoints.length >= 3) ? 1.0 : 0.0;
  const polyPoints = [
    new THREE.Vector2(),
    new THREE.Vector2(),
    new THREE.Vector2(),
    new THREE.Vector2()
  ];
  for (let k = 0; k < activePoints.length && k < 4; k++) {
    // Map NDC [-1, 1] to UV [0, 1] screen UV space
    polyPoints[k].set((activePoints[k][0] + 1) / 2, (activePoints[k][1] + 1) / 2);
  }

  // Detect pinch gesture (index tip and thumb tip touching on either hand)
  let isPinched = false;
  for (let i = 0; i < 2; i++) {
    if (smoothedHands[i]) {
      const thumbTip = smoothedHands[i][4];
      const indexTip = smoothedHands[i][8];
      if (thumbTip && indexTip) {
        const dx = thumbTip[0] - indexTip[0];
        const dy = thumbTip[1] - indexTip[1];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.15) {
          isPinched = true;
          break;
        }
      }
    }
  }

  // Set uniforms on fragment shader plane material
  uniforms.uPolygonActive.value = polygonActive;
  uniforms.uNumPolygonPoints.value = activePoints.length;
  uniforms.uEffectType.value = isPinched ? 1.0 : 0.0;
  for (let k = 0; k < 4; k++) {
    uniforms.uPolygon.value[k].copy(polyPoints[k]);
  }

  // Toggle visibility of face points cloud (hide in sketch mode)
  if (smoothedFace && !isPinched) {
    facePointsObj.visible = true;
  } else {
    facePointsObj.visible = false;
  }

  // Real-time Celebrity Look-Alike & HUD Tag update
  const faceTagEl = document.getElementById('face-tag');
  let activeColor = '#00fff2'; // default cyan border
  let themeId = 0.0;

  if (smoothedFace && smoothedFaceRaw && polygonActive > 0.5 && celebrityDatabase) {
    const userVector = extractFaceProportions(smoothedFaceRaw);
    if (userVector) {
      let bestMatch = null;
      let minDistance = Infinity;

      for (const [name, targetVector] of Object.entries(celebrityDatabase)) {
        let distSum = 0;
        for (let i = 0; i < userVector.length; i++) {
          const diff = userVector[i] - targetVector[i];
          distSum += diff * diff;
        }
        const distance = Math.sqrt(distSum);
        if (distance < minDistance) {
          minDistance = distance;
          bestMatch = name;
        }
      }

      if (bestMatch) {
        // Map matched name alphabetically to theme parameters
        const theme = getThemeForCelebrity(bestMatch);
        themeId = theme.themeId;
        activeColor = theme.activeColor;

        // Similarity percentage math: map distance range [0.0, 0.25] to [100%, 0%]
        const matchPercent = Math.max(0, Math.min(100, Math.round((1.0 - minDistance / 0.25) * 100)));

        // Update HTML text elements
        const nameFormatted = bestMatch.replace(/_/g, ' ').toUpperCase();
        document.getElementById('tag-hero').textContent = nameFormatted;
        document.getElementById('tag-movie').textContent = `SIMILARITY: ${matchPercent}%`;
        document.getElementById('tag-status').textContent = `STATUS: ${theme.status}`;

        // Dynamic colors and shadows
        faceTagEl.style.borderColor = theme.activeColor;
        faceTagEl.style.boxShadow = `0 0 15px ${theme.shadowColor}`;
        faceTagEl.style.color = theme.activeColor;

        faceTagEl.classList.remove('hidden');
      } else {
        faceTagEl.classList.add('hidden');
      }
    } else {
      faceTagEl.classList.add('hidden');
    }
  } else {
    faceTagEl.classList.add('hidden');
  }

  // Update uniforms and dynamic line/handle colors to match the theme
  uniforms.uMovieTheme.value = themeId;
  try {
    if (polygonLine && polygonLine.material && polygonLine.material.uniforms && polygonLine.material.uniforms.uColor) {
      polygonLine.material.uniforms.uColor.value.set(new THREE.Color(activeColor));
    } else {
      console.warn('polygonLine material or uniforms or uColor is not fully initialized:', polygonLine);
    }
  } catch (e) {
    console.error('Error setting polygonLine color:', e, polygonLine?.material?.uniforms);
  }
  
  try {
    if (handlePointsObj && handlePointsObj.material && handlePointsObj.material.color) {
      handlePointsObj.material.color.set(new THREE.Color(activeColor));
    } else {
      console.warn('handlePointsObj material or color is not fully initialized:', handlePointsObj);
    }
  } catch (e) {
    console.error('Error setting handlePointsObj color:', e, handlePointsObj?.material);
  }

  // Set uniforms on all masked line/point materials
  for (const mat of maskedMaterials) {
    mat.uniforms.uPolygonActive.value = polygonActive;
    mat.uniforms.uNumPolygonPoints.value = activePoints.length;
    for (let k = 0; k < 4; k++) {
      mat.uniforms.uPolygon.value[k].copy(polyPoints[k]);
    }
  }

  // Update green squares/handles at vertices
  const handlePosAttr = handleGeometry.attributes.position;
  const handleArr = handlePosAttr.array;
  if (polygonActive > 0.5) {
    let hIdx = 0;
    for (let k = 0; k < activePoints.length && k < 4; k++) {
      handleArr[hIdx++] = activePoints[k][0];
      handleArr[hIdx++] = activePoints[k][1];
      handleArr[hIdx++] = 0.02; // slightly in front of lines
    }
    handleGeometry.setDrawRange(0, activePoints.length);
  } else {
    handleGeometry.setDrawRange(0, 0);
  }
  handlePosAttr.needsUpdate = true;

  // Update polygon boundary outline lines
  if (polygonActive > 0.5) {
    const connections = [];
    for (let k = 0; k < activePoints.length; k++) {
      connections.push([k, (k + 1) % activePoints.length]);
    }
    updateLineSet(polygonLine, activePoints, connections, connections.length);
  } else {
    polygonLine.geometry.setDrawRange(0, 0);
  }

  // Update hand mask centers (support up to 2 hands for circular fallback)
  for (let i = 0; i < 2; i++) {
    if (smoothedHands[i]) {
      const c = centroid(smoothedHands[i], [0, 5, 9, 13, 17]);
      uniforms.uHandCenters.value[i].set((c[0] + 1) / 2, (c[1] + 1) / 2);
      uniforms.uHandActive.value[i] = 1;
    } else {
      uniforms.uHandActive.value[i] = 0;
    }
  }

  // Update face mask center (for circular fallback)
  if (smoothedFace) {
    const c = centroid(smoothedFace, [10, 152, 234, 454]);
    uniforms.uFaceCenter.value.set((c[0] + 1) / 2, (c[1] + 1) / 2);
    uniforms.uFaceActive.value = 1;
  } else {
    uniforms.uFaceActive.value = 0;
  }

  // Update face digital point cloud positions inside polygon
  if (smoothedFace) {
    const pAttr = facePointsGeo.attributes.position;
    const arr = pAttr.array;
    let idx = 0;
    for (let j = 0; j < smoothedFace.length; j++) {
      arr[idx++] = smoothedFace[j][0];
      arr[idx++] = smoothedFace[j][1];
      arr[idx++] = 0.015;
    }
    facePointsGeo.setDrawRange(0, smoothedFace.length);
    pAttr.needsUpdate = true;
  } else {
    facePointsGeo.setDrawRange(0, 0);
  }

  if (uniforms.uVideoResolution.value.x !== (videoEl.videoWidth || 0) && videoEl.videoWidth) {
    uniforms.uVideoResolution.value.set(videoEl.videoWidth, videoEl.videoHeight);
  }

  renderer.render(scene, camera);
}

animate();
startCamera();
