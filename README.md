# RADIA — Real-Time AI X-Ray Hand & Face Effect

A browser-based "X-ray scanner" effect. It uses your webcam, tracks your hands
and face with **MediaPipe**, and uses **Three.js/WebGL** to reveal a glowing
X-ray-style view that follows your hand as it passes over the frame.

No installs, no build step — just static HTML/CSS/JS pulling MediaPipe and
Three.js from a CDN at runtime.

## Folder contents

```
xray-hand-effect/
├── index.html   # page shell, HUD markup, script/CDN includes
├── style.css    # dark "medical scanner" HUD styling + scanline sweep
├── app.js       # MediaPipe Hands/FaceMesh setup + Three.js shader & skeleton
└── README.md
```

## How it works

- **Tracking**: `@mediapipe/hands` gives 21 hand landmarks per hand (up to 2
  hands); `@mediapipe/face_mesh` gives face landmarks. Both run on every
  webcam frame via `@mediapipe/camera_utils`.
- **Reveal effect**: the webcam feed is drawn on a full-screen Three.js plane
  with a custom GLSL fragment shader. Outside your hand/face, the shader shows
  a dimmed, normal-color image. Inside a soft circular mask centered on your
  hand (or face), it swaps in an inverted-luminance, cyan-tinted "X-ray" look,
  with a bright glowing ring at the mask edge.
- **Skeleton overlay**: hand joints are connected with glowing cyan line
  segments (`THREE.LineSegments`, additive blending) so it reads like a bone
  scan. A curated set of face contours (oval, eyes, brows, nose, lips) does
  the same for the face, without the visual noise of the full 468-point mesh.
- **HUD**: pure CSS — corner brackets, a scanline sweep animation, and a
  live stats panel (hands detected / face tracked / FPS).

## Running it

Camera access requires **HTTPS or localhost** — opening `index.html` directly
as a `file://` URL will not work in most browsers. Serve the folder locally:

```bash
cd xray-hand-effect
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

or, with Node installed:

```bash
npx serve .
```

Grant camera permission when prompted. Move your hand into frame — a circular
X-ray reveal should track it, with the skeletal overlay following your
fingers. Face tracking activates automatically when a face is visible.

## Notes & tips

- **Performance**: two MediaPipe models running per frame is demanding on
  low-power laptops/phones. If FPS is low, try lowering `modelComplexity` for
  Hands (in `app.js`, `hands.setOptions`) from `1` to `0`, or disable Face
  Mesh entirely by commenting out its `faceMesh.send(...)` call.
- **Mask size**: change `uniforms.uRadius.value` in `app.js` (default `0.22`)
  to make the X-ray reveal circle bigger or smaller.
- **Colors**: the X-ray tint and HUD palette are both easy to retheme — the
  tint lives in the fragment shader (`xrayColor`), the HUD palette is defined
  as CSS variables at the top of `style.css`.
- **Browser support**: any recent Chrome, Edge, or Firefox with WebGL2 and
  `getUserMedia` support. Safari works but MediaPipe's WASM backend can be
  slower.
- **Privacy**: everything runs locally in the browser — no video frame is
  ever sent to a server.
