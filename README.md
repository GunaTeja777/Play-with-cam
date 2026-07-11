# RADIA — Cyberpunk Celebrity Look-Alike Fingertip Scanner

A high-performance, browser-based cyberpunk camera scanner that tracks your hand and face landmarks using **MediaPipe**, rendering dynamic glitched shaders and identifying your Indian celebrity look-alike from **170 famous actors & actresses** in real-time.

Built with **Three.js (WebGL)** and custom **GLSL Shaders**, it runs completely client-side at 60 FPS.

---

## Features

1. **Dynamic Fingertip Scan Polygon**:
   - Stretches a scanning reveal window between your index finger tips and thumb tips.
   - The scanner activates only when a valid polygon is formed (3 or 4 fingertips visible), cleanly rendering cyberpunk effects inside the boundary.

2. **Indian Celebrity Look-Alike Predictor**:
   - Measures your real-time facial proportions using a 14-dimensional geometric proportions vector (eye spacing, nose height/width, jaw contour width, lip heights, and chin ratios).
   - Runs a real-time Euclidean distance lookup against a pre-trained database of **170 Indian actors & actresses** (Bollywood, Tollywood, Kollywood).
   - Displays the matched celebrity and resemblance percentage (e.g. `ALIA BHATT - SIMILARITY: 91%`) in the top-left diagnostic HUD.

3. **Multi-Theme Cyberpunk Shaders**:
   - The scanning area features animated horizontal scanlines, chromatic aberration (time-based RGB offset glitches), and a digital sci-fi grid overlay.
   - The visual color theme shifts automatically depending on the matched celebrity:
     - **Cyan Matrix (A-G)**: Steel blue & neon cyan.
     - **Amber Gold (H-N)**: Royal golden-bronze & glowing amber.
     - **Volcanic Red (O-T)**: Volcanic red, orange, and charcoal black.
     - **Vibrant Neon (U-Z)**: Hot pink, purple, and neon violet.
   - Scanner outlines and fingertip handles glow in sync with the active color theme.

4. **Pinch-Triggered Edge Sketch**:
   - Pinching your thumb and index finger together triggers a real-time Sobel edge-detection sketch effect, replacing the video inside the polygon with neon cyan outlines on a deep blue background (and hiding the face points).

5. **Normal Background Feed**:
   - Displays the unmodified, full-brightness camera feed outside the scanning polygon, keeping the background room completely normal.

---


## Running the Application

Since camera access requires a secure context (HTTPS or localhost), serve the directory locally:

### Using Node.js:
```bash
npx serve .
```

### Using Python:
```bash
python -m http.server 3000
```

Open `http://localhost:3000` in your web browser, grant camera permissions, and stretch your fingertips to form the scanning window over your face!

---

## Training/Updating the Look-Alike Model

If you add new images or celebrities to the `dataset/` directory, you can retrain the model locally in under 30 seconds:

1. Run the dataset indexing script to update `dataset_list.json`:
   ```bash
   node list_dataset.js
   ```
2. Start the local database saver helper server:
   ```bash
   node save_server.js
   ```
3. Open `http://localhost:3000/train.html` in your web browser. 
   - The browser will use local GPU-acceleration to feed the images through MediaPipe Face Mesh, extract the proportions, and automatically save the new weights to `celebrity_db.json`.
   - The helper server will automatically log compilation completion and shut down.
