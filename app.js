/**
 * ESCÁNER PRO A4 — MAIN APPLICATION LOGIC
 * ==========================================
 * Features:
 *  - Camera capture with auto document detection
 *  - Perspective correction (4-point transform)
 *  - Image filters (B&W, grayscale, enhance, magic)
 *  - Page management with thumbnails
 *  - Rotate, reorder pages
 *  - Export/Share as A4 PDF via jsPDF
 */

'use strict';

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────
const state = {
  pages: [],           // [{dataURL, rotation, filter}]
  currentCaptured: null,  // temp canvas for preview (processed)
  rawCapturedCanvas: null, // raw full frame for corner cropping
  currentCorners: null,    // {tl, tr, br, bl} normalized
  editingIndex: -1,    // which page is being edited in modal
  stream: null,
  facingMode: 'environment',
  flashEnabled: false,
  autoDetect: true,
  autoCapture: false,   // Auto-shoot when document is steady
  perspCorrect: true,
  scanMode: 'document', // 'whiteboard' | 'document' | 'card' | 'photo'
  pdfQuality: 0.8,
  detectionInterval: null,
  detectedRect: null,   // {x,y,w,h} relative to video
  detectedCorners: null, // {tl, tr, br, bl} normalized
  continuousMode: false, // fast continuous scan mode
};

// Auto-capture stability tracker
let stableCornerCount = 0;
let lastStableCorner = null;
let autoCaptureTriggered = false;

// A4 output dimensions (pixels at 150 DPI)
const A4_W = 1240;
const A4_H = 1754;

// ─────────────────────────────────────────
//  DOM REFS
// ─────────────────────────────────────────
const $ = id => document.getElementById(id);
const splash       = $('splash');
const app          = $('app');
const video        = $('video');
const overlayCanvas = $('overlayCanvas');
const overlayCtx   = overlayCanvas.getContext('2d');
const previewCanvas = $('previewCanvas');
const previewCtx   = previewCanvas.getContext('2d');
const modalCanvas  = $('modalCanvas');
const modalCtx     = modalCanvas.getContext('2d');

// Views
const cameraView   = $('cameraView');
const previewView  = $('previewView');
const pagesView    = $('pagesView');

// Buttons
const btnCapture    = $('btnCapture');
const btnFlash      = $('btnFlash');
const btnAutoCapture = $('btnAutoCapture');
const btnContinuous = $('btnContinuous');    // ← Fast continuous scan
const btnGallery    = $('btnGallery');
const btnViewPages  = $('btnViewPages');
const btnPages      = $('btnPages');
const btnSettings   = $('btnSettings');

const btnBackToCamera  = $('btnBackToCamera');
const btnConfirmPage   = $('btnConfirmPage');
const btnNextPage      = $('btnNextPage');      // ← "Siguiente Página"
const btnRotLeft       = $('btnRotLeft');
const btnRotRight      = $('btnRotRight');
const btnFilter        = $('btnFilter');
const btnBright        = $('btnBright');
const btnContrast      = $('btnContrast');
const btnCrop          = $('btnCrop');

const btnBackFromPages = $('btnBackFromPages');
const btnDeleteAll     = $('btnDeleteAll');
const btnAddMorePages  = $('btnAddMorePages');
const btnExportPDF     = $('btnExportPDF');
const btnExportJPG     = $('btnExportJPG');
const btnSharePDF      = $('btnSharePDF');

const filterPanel  = $('filterPanel');
const sliderPanel  = $('sliderPanel');
const adjSlider    = $('adjSlider');
const sliderVal    = $('sliderVal');
const sliderLabel  = $('sliderLabel');
const btnApplyAdj  = $('btnApplyAdj');
const btnResetAdj  = $('btnResetAdj');

// Mode buttons
const modeBtns = document.querySelectorAll('.mode-btn');

// Crop Modal Elements (OneDrive / Lens Corner Adjuster)
const cropModal          = $('cropModal');
const btnCloseCrop       = $('btnCloseCrop');
const btnResetCrop       = $('btnResetCrop');
const btnApplyCrop       = $('btnApplyCrop');
const cropCanvas         = $('cropCanvas');
const cropCtx            = cropCanvas ? cropCanvas.getContext('2d') : null;
const cropPolygon        = $('cropPolygon');
const cropEditorContainer = $('cropEditorContainer');
const magnifier          = $('magnifier');
const magnifierCanvas    = $('magnifierCanvas');
const magnifierCtx       = magnifierCanvas ? magnifierCanvas.getContext('2d') : null;
const pinTL              = $('pinTL');
const pinTR              = $('pinTR');
const pinBR              = $('pinBR');
const pinBL              = $('pinBL');

// Modal page edit
const pageEditModal = $('pageEditModal');
const btnCloseModal = $('btnCloseModal');
const mBtnRotL     = $('mBtnRotL');
const mBtnRotR     = $('mBtnRotR');
const mBtnDelete   = $('mBtnDelete');
const mBtnSave     = $('mBtnSave');
const modalPageNum = $('modalPageNum');

// Settings
const settingsModal  = $('settingsModal');
const btnCloseSettings = $('btnCloseSettings');
const pdfQualitySel  = $('pdfQuality');
const autoDetectToggle = $('autoDetectToggle');
const perspToggle    = $('perspToggle');

// Export overlay
const exportOverlay  = $('exportOverlay');
const exportMsg      = $('exportMsg');
const progressFill   = $('progressFill');

// Other
const thumbStrip   = $('thumbStrip');
const pagesGrid    = $('pagesGrid');
const pageCount    = $('pageCount');
const miniCount    = $('miniCount');
const totalPagesCount = $('totalPagesCount');
const fileNameInput = $('fileNameInput');
const galleryInput = $('galleryInput');
const hintText     = $('hintText');
const flashOverlay = $('flashOverlay');
const correctionBadge = $('correctionBadge');
const savedSoFarEl    = $('savedSoFar');
const previewPageNumEl = $('previewPageNum');
const cameraFrame     = $('cameraFrame');

// preview adjustments state
let previewRotation = 0;
let previewFilter   = 'original';
let previewBrightness = 0;
let previewContrast   = 0;
let currentAdjType  = null; // 'brightness' | 'contrast'

// ─────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────
async function init() {
  // Show splash for minimum 1.5s
  await new Promise(r => setTimeout(r, 1500));
  splash.classList.add('fade-out');
  await new Promise(r => setTimeout(r, 500));
  splash.style.display = 'none';
  app.classList.remove('hidden');

  await startCamera();
  setupEventListeners();
  updateUI();
}

// ─────────────────────────────────────────
//  CAMERA
// ─────────────────────────────────────────
async function startCamera() {
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
  }
  try {
    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { min: 1280, ideal: 1920, max: 3840 },
        height: { min: 720, ideal: 1080, max: 2160 },
        // Enhanced focus & exposure for documents/text
        focusMode: { ideal: 'continuous' },
        whiteBalanceMode: { ideal: 'continuous' },
        exposureMode: { ideal: 'continuous' }
      },
      audio: false,
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = state.stream;
    await video.play();

    // Apply continuous auto-focus if supported by the browser/hardware
    try {
      const track = state.stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities ? track.getCapabilities() : {};
      const advanced = [];
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' });
      }
      if (capabilities.whiteBalanceMode && capabilities.whiteBalanceMode.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' });
      }
      if (advanced.length > 0 && track.applyConstraints) {
        await track.applyConstraints({ advanced });
      }
    } catch (e) {
      console.log('Focus constraint note:', e);
    }

    syncOverlaySize();
    startAutoDetection();
  } catch (err) {
    showNoCameraMsg(err.message);
  }
}

function showNoCameraMsg(msg) {
  const wrap = document.querySelector('.camera-wrapper');
  wrap.innerHTML = `
    <div class="no-camera">
      <span>📷</span>
      <p>No se pudo acceder a la cámara.</p>
      <small>${msg}</small>
      <button class="action-btn secondary" style="margin-top:16px;max-width:200px" onclick="startCamera()">Reintentar</button>
    </div>`;
}

function getVideoRenderBox() {
  const vw = video.videoWidth || 1920;
  const vh = video.videoHeight || 1080;
  const cw = overlayCanvas.width || overlayCanvas.offsetWidth;
  const ch = overlayCanvas.height || overlayCanvas.offsetHeight;

  // Since #video uses object-fit: cover
  const scale = Math.max(cw / vw, ch / vh);
  const rw = vw * scale;
  const rh = vh * scale;
  const rx = (cw - rw) / 2;
  const ry = (ch - rh) / 2;

  return { rx, ry, rw, rh, vw, vh };
}

function syncOverlaySize() {
  const rect = overlayCanvas.getBoundingClientRect();
  overlayCanvas.width  = rect.width || window.innerWidth;
  overlayCanvas.height = rect.height || (window.innerHeight - 150);
}

video.addEventListener('loadedmetadata', syncOverlaySize);
window.addEventListener('resize', syncOverlaySize);

// ─────────────────────────────────────────
//  AUTO DOCUMENT DETECTION
// ─────────────────────────────────────────
let detectionTick = 0;
function startAutoDetection() {
  if (state.detectionInterval) clearInterval(state.detectionInterval);
  state.detectionInterval = setInterval(() => {
    if (!state.autoDetect) {
      clearOverlay();
      return;
    }
    if (video.readyState < 2) return;
    detectionTick++;
    detectDocument();
  }, 250);
}

function clearOverlay() {
  const ctx = overlayCtx;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
}

function detectDocument() {
  if (!video.videoWidth) return;
  const { rx, ry, rw, rh, vw, vh } = getVideoRenderBox();

  // Sample video frame into temp canvas for fast corner analysis
  const tmpW = 320, tmpH = Math.round(vh / vw * 320);
  const tmp = document.createElement('canvas');
  tmp.width = tmpW; tmp.height = tmpH;
  const tCtx = tmp.getContext('2d');
  tCtx.drawImage(video, 0, 0, tmpW, tmpH);

  const imageData = tCtx.getImageData(0, 0, tmpW, tmpH);
  const corners = findA4Corners(imageData, tmpW, tmpH);

  clearOverlay();
  if (corners) {
    // Normalized (0..1) relative to full camera sensor
    const normCorners = {
      tl: { x: corners.tl.x / tmpW, y: corners.tl.y / tmpH },
      tr: { x: corners.tr.x / tmpW, y: corners.tr.y / tmpH },
      br: { x: corners.br.x / tmpW, y: corners.br.y / tmpH },
      bl: { x: corners.bl.x / tmpW, y: corners.bl.y / tmpH }
    };

    // Screen coordinates mapped to exactly where video pixels appear on display
    const screenCorners = {
      tl: { x: rx + normCorners.tl.x * rw, y: ry + normCorners.tl.y * rh },
      tr: { x: rx + normCorners.tr.x * rw, y: ry + normCorners.tr.y * rh },
      br: { x: rx + normCorners.br.x * rw, y: ry + normCorners.br.y * rh },
      bl: { x: rx + normCorners.bl.x * rw, y: ry + normCorners.bl.y * rh }
    };

    // Draw polygon connecting all 4 detected corners directly over document
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
    overlayCtx.fillStyle = 'rgba(34, 197, 94, 0.15)';
    overlayCtx.lineWidth = 3;
    overlayCtx.beginPath();
    overlayCtx.moveTo(screenCorners.tl.x, screenCorners.tl.y);
    overlayCtx.lineTo(screenCorners.tr.x, screenCorners.tr.y);
    overlayCtx.lineTo(screenCorners.br.x, screenCorners.br.y);
    overlayCtx.lineTo(screenCorners.bl.x, screenCorners.bl.y);
    overlayCtx.closePath();
    overlayCtx.fill();
    overlayCtx.stroke();

    // Draw high-visibility corner target marks at each of the 4 corners
    const pts = [
      { p: screenCorners.tl, label: 'TL', dx: 1, dy: 1 },
      { p: screenCorners.tr, label: 'TR', dx: -1, dy: 1 },
      { p: screenCorners.br, label: 'BR', dx: -1, dy: -1 },
      { p: screenCorners.bl, label: 'BL', dx: 1, dy: -1 }
    ];

    pts.forEach(({ p, dx, dy }) => {
      // Circle at corner
      overlayCtx.beginPath();
      overlayCtx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
      overlayCtx.fillStyle = '#22c55e';
      overlayCtx.fill();
      overlayCtx.lineWidth = 2.5;
      overlayCtx.strokeStyle = '#ffffff';
      overlayCtx.stroke();

      // Corner bracket
      const bSize = 24;
      overlayCtx.beginPath();
      overlayCtx.lineWidth = 4;
      overlayCtx.strokeStyle = '#22c55e';
      overlayCtx.moveTo(p.x, p.y + dy * bSize);
      overlayCtx.lineTo(p.x, p.y);
      overlayCtx.lineTo(p.x + dx * bSize, p.y);
      overlayCtx.stroke();
    });

    overlayCtx.restore();

    state.detectedCorners = normCorners;
    hintText.textContent = state.autoCapture 
      ? '✓ Documento detectado: ¡Mantén quieto para auto-disparo!' 
      : '✓ 4 Esquinas Encuadradas — ¡Captura!';
    hintText.style.color = '#22c55e';

    // Auto-Capture logic: if corners remain stable for 4 consecutive detection ticks (~1 sec)
    if (state.autoCapture && !autoCaptureTriggered) {
      if (lastStableCorner) {
        const delta = Math.hypot(
          state.detectedCorners.tl.x - lastStableCorner.tl.x,
          state.detectedCorners.tl.y - lastStableCorner.tl.y
        );
        if (delta < 0.035) { // Very little camera shake
          stableCornerCount++;
          if (stableCornerCount >= 4) {
            autoCaptureTriggered = true;
            captureFrame();
            setTimeout(() => {
              autoCaptureTriggered = false;
              stableCornerCount = 0;
            }, 3000);
          }
        } else {
          stableCornerCount = 0;
        }
      }
      lastStableCorner = state.detectedCorners;
    }
  } else {
    state.detectedCorners = null;
    stableCornerCount = 0;
    lastStableCorner = null;
    hintText.textContent = state.scanMode === 'whiteboard'
      ? 'Alinea la pizarra en el visor'
      : state.scanMode === 'card'
      ? 'Alinea la tarjeta de presentación'
      : 'Alinea el documento en las 4 esquinas';
    hintText.style.color = '';
  }
}

/**
 * Precise 4-corner detector for vertical A4 document.
 * Analyzes contrast edges and finds the 4 extreme quad vertices of the paper.
 */
function findA4Corners(imageData, w, h) {
  const data = imageData.data;
  const n = w * h;

  // 1. Grayscale luminance
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const idx = i * 4;
    gray[i] = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) | 0;
  }

  // 2. Otsu thresholding
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;

  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * hist[i];

  let sumB = 0, wB = 0, varMax = 0, threshold = 125;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const vBetween = wB * wF * (mB - mF) * (mB - mF);
    if (vBetween > varMax) {
      varMax = vBetween;
      threshold = t;
    }
  }

  // Ensure reasonable threshold
  threshold = Math.max(70, Math.min(210, threshold));

  // 3. Collect all paper candidate pixels (bright region)
  const pts = [];
  const step = 2; // step for performance and noise reduction
  for (let y = 4; y < h - 4; y += step) {
    const rIdx = y * w;
    for (let x = 4; x < w - 4; x += step) {
      if (gray[rIdx + x] >= threshold) {
        pts.push({ x, y });
      }
    }
  }

  if (pts.length < (n / (step * step)) * 0.12) {
    return null; // Not enough paper detected
  }

  // 4. Find the 4 extreme vertices:
  // We use 4 directional projections (TL, TR, BR, BL)
  let tl = pts[0], tr = pts[0], br = pts[0], bl = pts[0];
  let minTL = Infinity, maxTR = -Infinity;
  let maxBR = -Infinity, minBL = Infinity;

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    // Top-Left: minimizes (x + y)
    const valTL = p.x + p.y * 1.0;
    if (valTL < minTL) { minTL = valTL; tl = p; }

    // Top-Right: maximizes (x - y)
    const valTR = p.x - p.y * 1.0;
    if (valTR > maxTR) { maxTR = valTR; tr = p; }

    // Bottom-Right: maximizes (x + y)
    const valBR = p.x + p.y * 1.0;
    if (valBR > maxBR) { maxBR = valBR; br = p; }

    // Bottom-Left: minimizes (x - y)
    const valBL = p.x - p.y * 1.0;
    if (valBL < minBL) { minBL = valBL; bl = p; }
  }

  // Check dimensions of the detected quad
  const topW = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const botW = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftH = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightH = Math.hypot(br.x - tr.x, br.y - tr.y);

  const avgW = (topW + botW) / 2;
  const avgH = (leftH + rightH) / 2;

  // Minimum size: paper must occupy at least 25% width & 25% height
  if (avgW < w * 0.25 || avgH < h * 0.25) {
    return null;
  }

  // Aspect ratio check (allow perspective angles and horizontal/vertical documents)
  const ratio = avgH / avgW;
  if (ratio < 0.45 || ratio > 2.8) {
    return null;
  }

  // Geometry validation: verify that points form a convex quad without crossing lines
  if (tl.x >= tr.x || bl.x >= br.x || tl.y >= bl.y || tr.y >= br.y) {
    return null;
  }

  return { tl, tr, br, bl };
}

// ─────────────────────────────────────────
//  CAPTURE & PERSPECTIVE RECTIFICATION
// ─────────────────────────────────────────
async function captureFrame() {
  if (!video.videoWidth) return;

  // Flash animation
  flashOverlay.classList.add('flash');
  btnCapture.classList.add('capturing');
  setTimeout(() => {
    flashOverlay.classList.remove('flash');
    btnCapture.classList.remove('capturing');
  }, 300);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const capCanvas = document.createElement('canvas');
  capCanvas.width = vw;
  capCanvas.height = vh;
  const capCtx = capCanvas.getContext('2d');
  capCtx.drawImage(video, 0, 0, vw, vh);

  let processedCanvas;
  let wasAutoCorrected = false;

  // Use currently detected corners or perform an instant high-res search on the captured frame
  let corners = state.detectedCorners;
  if (!corners) {
    // If corners were not locked yet, analyze the captured high-res frame
    const testW = 320, testH = Math.round(vh / vw * 320);
    const tmp = document.createElement('canvas');
    tmp.width = testW; tmp.height = testH;
    const tCtx = tmp.getContext('2d');
    tCtx.drawImage(capCanvas, 0, 0, testW, testH);
    const raw = findA4Corners(tCtx.getImageData(0, 0, testW, testH), testW, testH);
    if (raw) {
      corners = {
        tl: { x: raw.tl.x / testW, y: raw.tl.y / testH },
        tr: { x: raw.tr.x / testW, y: raw.tr.y / testH },
        br: { x: raw.br.x / testW, y: raw.br.y / testH },
        bl: { x: raw.bl.x / testW, y: raw.bl.y / testH }
      };
    }
  }

  if (state.perspCorrect && corners) {
    // Exact projective homography: extracts ONLY the A4 paper surface, flattening perspective
    processedCanvas = unwarp4CornersToA4(capCanvas, corners, vw, vh);
    wasAutoCorrected = true;
  } else {
    // Fallback: crop according to vertical guide frame
    processedCanvas = cropToA4Guide(capCanvas);
    wasAutoCorrected = true;
  }

  let defaultFilter = 'document';
  if (state.scanMode === 'whiteboard') defaultFilter = 'whiteboard';
  else if (state.scanMode === 'photo') defaultFilter = 'original';

  state.currentCaptured   = processedCanvas;
  state.rawCapturedCanvas = capCanvas;
  state.currentCorners    = corners || {
    tl: { x: 0.12, y: 0.08 },
    tr: { x: 0.88, y: 0.08 },
    br: { x: 0.88, y: 0.92 },
    bl: { x: 0.12, y: 0.92 }
  };

  previewRotation   = 0;
  previewFilter     = defaultFilter;
  previewBrightness = 0;
  previewContrast   = 0;

  // Sync active filter button in preview
  filterPanel.querySelectorAll('.filter-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === defaultFilter);
  });

  if (previewPageNumEl) previewPageNumEl.textContent = state.pages.length + 1;
  updateSavedCounter();

  // In CONTINUOUS MODE: auto-save and stay in camera view
  if (state.continuousMode) {
    saveCurrentPage();
    state.currentCaptured = null;
    state.rawCapturedCanvas = null;
    updateUI();
    showToast(`✓ Página ${state.pages.length} escaneada (${state.scanMode.toUpperCase()})`);
    return;
  }

  showView('previewView');
  renderPreview();

  if (wasAutoCorrected && correctionBadge) {
    correctionBadge.classList.remove('hidden');
    setTimeout(() => correctionBadge.classList.add('hidden'), 3200);
  }
}

/**
 * Fallback: crops the center A4 vertical rectangle matching the screen guide
 */
function cropToA4Guide(srcCanvas) {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  // A4 ratio = 1 / 1.414 = 0.707
  let targetW = sw * 0.76;
  let targetH = targetW * 1.414;

  if (targetH > sh * 0.88) {
    targetH = sh * 0.88;
    targetW = targetH / 1.414;
  }

  const sx = Math.max(0, Math.round((sw - targetW) / 2));
  const sy = Math.max(0, Math.round((sh - targetH) / 2));
  const cw = Math.min(sw - sx, Math.round(targetW));
  const ch = Math.min(sh - sy, Math.round(targetH));

  const out = document.createElement('canvas');
  out.width = A4_W;
  out.height = A4_H;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, A4_W, A4_H);
  ctx.drawImage(srcCanvas, sx, sy, cw, ch, 0, 0, A4_W, A4_H);
  return out;
}

/**
 * Calculates Projective Homography Matrix (3x3) mapping unit square [0,1]^2 to arbitrary quad.
 */
function getSquareToQuadTransform(x0, y0, x1, y1, x2, y2, x3, y3) {
  const dx1 = x1 - x2, dy1 = y1 - y2;
  const dx2 = x3 - x2, dy2 = y3 - y2;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  const g = (sx * dy2 - sy * dx2) / (dx1 * dy2 - dy1 * dx2);
  const h = (dx1 * sy - dy1 * sx) / (dx1 * dy2 - dy1 * dx2);

  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const c = x0;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  const f = y0;

  return [a, b, c, d, e, f, g, h, 1];
}

/**
 * Inverts a 3x3 matrix.
 */
function invertMatrix3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], k = m[8];

  const A =  (e * k - f * h);
  const B = -(d * k - f * g);
  const C =  (d * h - e * g);
  const det = a * A + b * B + c * C;

  if (Math.abs(det) < 1e-12) return null;
  const invDet = 1.0 / det;

  return [
     A * invDet,
    -(b * k - c * h) * invDet,
     (b * f - c * e) * invDet,
     B * invDet,
     (a * k - c * g) * invDet,
    -(a * f - c * d) * invDet,
     C * invDet,
    -(a * h - b * g) * invDet,
     (a * e - b * d) * invDet
  ];
}

/**
 * Precise 4-corner perspective unwarping into vertical A4 sheet (A4_W x A4_H).
 * Extracts ONLY the content within the 4 corners, flattening perspective completely.
 */
function unwarp4CornersToA4(srcCanvas, cornersNorm, vw, vh) {
  const outCanvas = document.createElement('canvas');
  outCanvas.width = A4_W;
  outCanvas.height = A4_H;
  const outCtx = outCanvas.getContext('2d');

  // Source quad coordinates (with safe clamping)
  const c = {
    tl: { x: Math.max(0, Math.min(vw - 1, cornersNorm.tl.x * vw)), y: Math.max(0, Math.min(vh - 1, cornersNorm.tl.y * vh)) },
    tr: { x: Math.max(0, Math.min(vw - 1, cornersNorm.tr.x * vw)), y: Math.max(0, Math.min(vh - 1, cornersNorm.tr.y * vh)) },
    br: { x: Math.max(0, Math.min(vw - 1, cornersNorm.br.x * vw)), y: Math.max(0, Math.min(vh - 1, cornersNorm.br.y * vh)) },
    bl: { x: Math.max(0, Math.min(vw - 1, cornersNorm.bl.x * vw)), y: Math.max(0, Math.min(vh - 1, cornersNorm.bl.y * vh)) }
  };

  // Matrix: [0, 1]x[0, 1] -> source quad
  const H = getSquareToQuadTransform(
    c.tl.x, c.tl.y,
    c.tr.x, c.tr.y,
    c.br.x, c.br.y,
    c.bl.x, c.bl.y
  );

  const srcCtx = srcCanvas.getContext('2d');
  const srcData = srcCtx.getImageData(0, 0, vw, vh);
  const outData = outCtx.createImageData(A4_W, A4_H);

  const sPixels = srcData.data;
  const dPixels = outData.data;

  const a = H[0], b = H[1], c0 = H[2];
  const d = H[3], e = H[4], f0 = H[5];
  const g = H[6], h = H[7];

  const invW = 1.0 / (A4_W - 1);
  const invH = 1.0 / (A4_H - 1);

  // Backward mapping interpolation
  for (let dy = 0; dy < A4_H; dy++) {
    const v = dy * invH;
    const rowOffset = dy * A4_W * 4;

    const bv = b * v + c0;
    const ev = e * v + f0;
    const hv = h * v + 1;

    for (let dx = 0; dx < A4_W; dx++) {
      const u = dx * invW;
      const wDenom = g * u + hv;
      const invDenom = 1.0 / wDenom;

      const fx = (a * u + bv) * invDenom;
      const fy = (d * u + ev) * invDenom;

      const dIndex = rowOffset + (dx << 2);

      if (fx >= 0 && fx < vw - 1 && fy >= 0 && fy < vh - 1) {
        // Bilinear interpolation for sharp, legible, non-pixelated letters
        const x0 = fx | 0;
        const y0 = fy | 0;
        const x1 = x0 + 1;
        const y1 = y0 + 1;

        const wx1 = fx - x0;
        const wx0 = 1.0 - wx1;
        const wy1 = fy - y0;
        const wy0 = 1.0 - wy1;

        const idx00 = (y0 * vw + x0) << 2;
        const idx10 = (y0 * vw + x1) << 2;
        const idx01 = (y1 * vw + x0) << 2;
        const idx11 = (y1 * vw + x1) << 2;

        for (let c = 0; c < 3; c++) {
          const top = wx0 * sPixels[idx00 + c] + wx1 * sPixels[idx10 + c];
          const bot = wx0 * sPixels[idx01 + c] + wx1 * sPixels[idx11 + c];
          dPixels[dIndex + c] = (wy0 * top + wy1 * bot) | 0;
        }
        dPixels[dIndex + 3] = 255;
      } else {
        dPixels[dIndex]     = 255;
        dPixels[dIndex + 1] = 255;
        dPixels[dIndex + 2] = 255;
        dPixels[dIndex + 3] = 255;
      }
    }
  }

  outCtx.putImageData(outData, 0, 0);
  return outCanvas;
}

/**
 * Flattens lighting, improves text contrast and sharpens letters for professional high-clarity A4 scan.
 */
function enhanceScannedDocument(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');

  // Draw original image
  ctx.drawImage(srcCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;
  const n = d.length;

  // Adaptive stretch to eliminate shadows and whiten page background
  for (let i = 0; i < n; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = (r * 0.299 + g * 0.587 + b * 0.114);

    if (lum > 135) {
      const boost = 1.0 + (lum - 135) / 120 * 0.35;
      d[i]     = Math.min(255, (r * boost) | 0);
      d[i + 1] = Math.min(255, (g * boost) | 0);
      d[i + 2] = Math.min(255, (b * boost) | 0);
    } else {
      const cut = 0.85;
      d[i]     = (r * cut) | 0;
      d[i + 1] = (g * cut) | 0;
      d[i + 2] = (b * cut) | 0;
    }
  }

  // Quick 3x3 sharpening pass to make text crystal clear & readable
  const copy = new Uint8ClampedArray(d);
  const stride = w * 4;
  for (let y = 1; y < h - 1; y++) {
    const yOffset = y * stride;
    for (let x = 1; x < w - 1; x++) {
      const idx = yOffset + (x << 2);
      for (let c = 0; c < 3; c++) {
        const center = copy[idx + c];
        const up     = copy[idx - stride + c];
        const down   = copy[idx + stride + c];
        const left   = copy[idx - 4 + c];
        const right  = copy[idx + 4 + c];

        // Unsharp mask kernel: center * 1.5 - (up+down+left+right) * 0.125
        const sharp = center * 1.5 - (up + down + left + right) * 0.125;
        d[idx + c] = Math.max(0, Math.min(255, sharp | 0));
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
  return out;
}

/**
 * Fallback: remove dark/black borders from scanned image.
 * Finds the bounding box of bright (non-dark) content.
 */
function autoCropWhiteBorders(srcCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const tmpW = 320, tmpH = Math.round(h / w * 320);
  const tmp = document.createElement('canvas');
  tmp.width = tmpW; tmp.height = tmpH;
  const tCtx = tmp.getContext('2d');
  tCtx.drawImage(srcCanvas, 0, 0, tmpW, tmpH);
  const d = tCtx.getImageData(0, 0, tmpW, tmpH).data;

  const THRESHOLD = 40; // below this = dark border
  let top = 0, bot = tmpH - 1, left = 0, right = tmpW - 1;

  // Find top
  outer: for (let y = 0; y < tmpH; y++) {
    for (let x = 0; x < tmpW; x++) {
      const i = (y * tmpW + x) * 4;
      if (d[i] > THRESHOLD || d[i+1] > THRESHOLD || d[i+2] > THRESHOLD) { top = y; break outer; }
    }
  }
  // Find bottom
  outer: for (let y = tmpH - 1; y >= 0; y--) {
    for (let x = 0; x < tmpW; x++) {
      const i = (y * tmpW + x) * 4;
      if (d[i] > THRESHOLD || d[i+1] > THRESHOLD || d[i+2] > THRESHOLD) { bot = y; break outer; }
    }
  }
  // Find left
  outer: for (let x = 0; x < tmpW; x++) {
    for (let y = 0; y < tmpH; y++) {
      const i = (y * tmpW + x) * 4;
      if (d[i] > THRESHOLD || d[i+1] > THRESHOLD || d[i+2] > THRESHOLD) { left = x; break outer; }
    }
  }
  // Find right
  outer: for (let x = tmpW - 1; x >= 0; x--) {
    for (let y = 0; y < tmpH; y++) {
      const i = (y * tmpW + x) * 4;
      if (d[i] > THRESHOLD || d[i+1] > THRESHOLD || d[i+2] > THRESHOLD) { right = x; break outer; }
    }
  }

  const cropW = right - left;
  const cropH = bot - top;
  // Only crop if we found meaningful borders (>3% inset)
  if (cropW < tmpW * 0.94 && cropH < tmpH * 0.94 && cropW > 0 && cropH > 0) {
    const scaleX = w / tmpW;
    const scaleY = h / tmpH;
    const rx = Math.round(left * scaleX);
    const ry = Math.round(top  * scaleY);
    const rw = Math.round(cropW * scaleX);
    const rh = Math.round(cropH * scaleY);
    const out = document.createElement('canvas');
    out.width = rw; out.height = rh;
    out.getContext('2d').drawImage(srcCanvas, rx, ry, rw, rh, 0, 0, rw, rh);
    return out;
  }
  return srcCanvas; // no borders found → return original
}

function resizeToA4(srcCanvas) {
  const a4 = document.createElement('canvas');
  a4.width = A4_W;
  a4.height = A4_H;
  const ctx = a4.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, A4_W, A4_H);

  // Fit image covering the full A4 (cover mode, centered)
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const scale = Math.min(A4_W / sw, A4_H / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (A4_W - dw) / 2;
  const dy = (A4_H - dh) / 2;
  ctx.drawImage(srcCanvas, dx, dy, dw, dh);
  return a4;
}


// ─────────────────────────────────────────
//  IMAGE PROCESSING
// ─────────────────────────────────────────
function applyFilter(srcCanvas, filter, brightness = 0, contrast = 0) {
  const out = document.createElement('canvas');
  out.width = srcCanvas.width;
  out.height = srcCanvas.height;
  const ctx = out.getContext('2d');

  // Brightness + Contrast via CSS filter
  const bVal = brightness !== 0 ? (1 + brightness / 100).toFixed(2) : 1;
  const cVal = contrast   !== 0 ? (1 + contrast   / 100).toFixed(2) : 1;
  ctx.filter = `brightness(${bVal}) contrast(${cVal})`;
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.filter = 'none';

  if (filter === 'original') return out;

  const imgData = ctx.getImageData(0, 0, out.width, out.height);
  const d = imgData.data;

  switch (filter) {
    case 'document':
      // OneDrive Document Filter: cleans dark backgrounds, whitens page, sharpens text
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i+1], b = d[i+2];
        const lum = (r * 0.299 + g * 0.587 + b * 0.114);
        if (lum > 135) {
          // Push page background to crisp paper white
          const factor = 1.0 + (lum - 135) / 120 * 0.45;
          d[i]   = Math.min(255, (r * factor) | 0);
          d[i+1] = Math.min(255, (g * factor) | 0);
          d[i+2] = Math.min(255, (b * factor) | 0);
        } else {
          // Darken ink / text
          const ink = 0.82;
          d[i]   = (r * ink) | 0;
          d[i+1] = (g * ink) | 0;
          d[i+2] = (b * ink) | 0;
        }
      }
      break;

    case 'whiteboard':
      // OneDrive Whiteboard Filter: removes specular reflections/shadows, boosts colored markers
      for (let i = 0; i < d.length; i += 4) {
        let r = d[i], g = d[i+1], b = d[i+2];
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        const lum = (r * 0.299 + g * 0.587 + b * 0.114);

        if (sat > 0.18) {
          // Color marker on board: preserve and boost marker saturation
          d[i]   = clamp(r * 1.35);
          d[i+1] = clamp(g * 1.35);
          d[i+2] = clamp(b * 1.35);
        } else if (lum > 125) {
          // Whiteboard background: pure clean white
          d[i] = d[i+1] = d[i+2] = 255;
        } else {
          // Black marker: deep solid black
          d[i] = d[i+1] = d[i+2] = clamp(lum * 0.45);
        }
      }
      break;

    case 'grayscale':
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        d[i] = d[i+1] = d[i+2] = g;
      }
      break;

    case 'bw':
      // High contrast pure B&W
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        const bw = g > 132 ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = bw;
      }
      break;

    case 'enhance':
      for (let i = 0; i < d.length; i += 4) {
        d[i]   = clamp(((d[i]   - 128) * 1.4) + 140);
        d[i+1] = clamp(((d[i+1] - 128) * 1.4) + 140);
        d[i+2] = clamp(((d[i+2] - 128) * 1.4) + 140);
      }
      break;

    case 'magic':
      // Adaptive thresholding style
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        const enhanced = g > 175 ? 255 : g > 95 ? clamp((g - 95) * 1.55 + 95) : clamp(g * 0.55);
        d[i] = d[i+1] = d[i+2] = enhanced;
      }
      break;
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

function clamp(v) { return Math.max(0, Math.min(255, v)); }

function rotateCanvas(srcCanvas, degrees) {
  const rad = degrees * Math.PI / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const nw = srcCanvas.width * cos + srcCanvas.height * sin;
  const nh = srcCanvas.width * sin + srcCanvas.height * cos;

  const out = document.createElement('canvas');
  out.width = Math.round(nw);
  out.height = Math.round(nh);
  const ctx = out.getContext('2d');
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
  return out;
}

// ─────────────────────────────────────────
//  RENDER PREVIEW
// ─────────────────────────────────────────
function renderPreview() {
  if (!state.currentCaptured) return;
  const rotated = rotateCanvas(state.currentCaptured, previewRotation);
  const filtered = applyFilter(rotated, previewFilter, previewBrightness, previewContrast);

  previewCanvas.width  = filtered.width;
  previewCanvas.height = filtered.height;
  previewCtx.drawImage(filtered, 0, 0);
}

// ─────────────────────────────────────────
//  PAGE MANAGEMENT
// ─────────────────────────────────────────
/**
 * Save current page and go back to pages view (classic save)
 */
function confirmPage() {
  if (!state.currentCaptured) return;
  saveCurrentPage();
  state.currentCaptured = null;
  updateUI();
  showView('cameraView');
}

/**
 * ★ SIGUIENTE PÁGINA ★
 * Save current page and immediately return to camera for next scan.
 * This is the PRIMARY action for high-volume scanning.
 */
function nextPage() {
  if (!state.currentCaptured) return;

  // Visual feedback on the button
  btnNextPage.classList.add('tapped');
  setTimeout(() => btnNextPage.classList.remove('tapped'), 260);

  saveCurrentPage();
  state.currentCaptured = null;
  updateUI();

  // Go straight back to camera — ready for next shot
  showView('cameraView');

  // Brief success toast on camera view
  showToast(`✓ Página ${state.pages.length} guardada`);
}

/**
 * Shared save logic: processes current canvas and pushes to pages array.
 */
function saveCurrentPage() {
  const rotated  = rotateCanvas(state.currentCaptured, previewRotation);
  const filtered = applyFilter(rotated, previewFilter, previewBrightness, previewContrast);
  const finalA4  = resizeToA4(filtered);
  state.pages.push({
    canvas: finalA4,
    dataURL: finalA4.toDataURL('image/jpeg', 0.92),
  });
}

/**
 * Update the "X páginas guardadas" counter in the preview bar
 */
function updateSavedCounter() {
  if (savedSoFarEl) {
    const n = state.pages.length;
    savedSoFarEl.textContent = n === 0
      ? 'Primera página'
      : `${n} página${n > 1 ? 's' : ''} ya guardada${n > 1 ? 's' : ''}`;
  }
}

/**
 * Show a brief floating toast message on the camera view
 */
function showToast(msg) {
  let toast = document.getElementById('toastMsg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastMsg';
    toast.style.cssText = `
      position:fixed; bottom:100px; left:50%; transform:translateX(-50%);
      background:rgba(34,197,94,0.95); color:#fff;
      padding:8px 20px; border-radius:20px; font-size:0.88rem;
      font-weight:600; z-index:999; pointer-events:none;
      white-space:nowrap; transition:opacity 0.4s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 1800);
}

function deletePage(idx) {
  if (idx < 0 || idx >= state.pages.length) return;
  state.pages.splice(idx, 1);
  updateUI();
  renderPagesGrid();
}

// ─────────────────────────────────────────
//  UI UPDATE
// ─────────────────────────────────────────
function updateUI() {
  const count = state.pages.length;
  pageCount.textContent = count;
  miniCount.textContent = count;
  totalPagesCount.textContent = count;
  renderThumbStrip();
}

function renderThumbStrip() {
  thumbStrip.innerHTML = '';
  if (state.pages.length === 0) {
    thumbStrip.innerHTML = '<div class="thumb-empty">Sin páginas aún</div>';
    return;
  }
  state.pages.forEach((pg, i) => {
    const item = document.createElement('div');
    item.className = 'thumb-item';
    item.innerHTML = `<img src="${pg.dataURL}" alt="Página ${i+1}" /><span class="thumb-num">${i+1}</span>`;
    item.addEventListener('click', () => openPageEditor(i));
    thumbStrip.appendChild(item);
  });
  // Scroll to last
  thumbStrip.scrollLeft = thumbStrip.scrollWidth;
}

function renderPagesGrid() {
  pagesGrid.innerHTML = '';
  if (state.pages.length === 0) {
    pagesGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text-dim);padding:40px">Sin páginas. Vuelve a escanear.</div>';
    return;
  }
  state.pages.forEach((pg, i) => {
    const card = document.createElement('div');
    card.className = 'page-card';
    card.draggable = true;
    card.dataset.index = i;
    card.innerHTML = `
      <img src="${pg.dataURL}" alt="P${i+1}" />
      <span class="page-card-num">${i+1}</span>
      <button class="page-card-del" title="Eliminar">✕</button>`;
    card.querySelector('.page-card-del').addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`¿Eliminar página ${i+1}?`)) {
        deletePage(i);
      }
    });
    card.addEventListener('click', () => openPageEditor(i));
    setupDragDrop(card, i);
    pagesGrid.appendChild(card);
  });
}

// ─────────────────────────────────────────
//  DRAG & DROP REORDER
// ─────────────────────────────────────────
let dragSrcIdx = -1;
function setupDragDrop(card, idx) {
  card.addEventListener('dragstart', () => { dragSrcIdx = idx; card.style.opacity = '0.5'; });
  card.addEventListener('dragend', () => { card.style.opacity = '1'; });
  card.addEventListener('dragover', e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    if (dragSrcIdx === idx) return;
    const moved = state.pages.splice(dragSrcIdx, 1)[0];
    state.pages.splice(idx, 0, moved);
    updateUI();
    renderPagesGrid();
  });
}

// ─────────────────────────────────────────
//  PAGE EDITOR MODAL
// ─────────────────────────────────────────
let modalRotation = 0;
let modalFilter   = 'original';
let modalOrigCanvas = null;

function openPageEditor(idx) {
  state.editingIndex = idx;
  modalPageNum.textContent = idx + 1;
  modalRotation = 0;
  modalFilter = 'original';
  modalOrigCanvas = state.pages[idx].canvas;
  renderModal();
  pageEditModal.classList.remove('hidden');
}

function renderModal() {
  const rotated  = rotateCanvas(modalOrigCanvas, modalRotation);
  const filtered = applyFilter(rotated, modalFilter);
  modalCanvas.width  = filtered.width;
  modalCanvas.height = filtered.height;
  modalCtx.drawImage(filtered, 0, 0);
}

function saveModalEdit() {
  const rotated  = rotateCanvas(modalOrigCanvas, modalRotation);
  const filtered = applyFilter(rotated, modalFilter);
  const finalA4  = resizeToA4(filtered);
  state.pages[state.editingIndex] = {
    canvas: finalA4,
    dataURL: finalA4.toDataURL('image/jpeg', 0.92),
  };
  updateUI();
  renderPagesGrid();
  pageEditModal.classList.add('hidden');
}

// ─────────────────────────────────────────
//  VIEWS
// ─────────────────────────────────────────
function showView(name) {
  [cameraView, previewView, pagesView].forEach(v => v.classList.remove('active'));
  const map = { cameraView, previewView, pagesView };
  if (map[name]) map[name].classList.add('active');

  if (name === 'pagesView') {
    renderPagesGrid();
    totalPagesCount.textContent = state.pages.length;
  }
}

// ─────────────────────────────────────────
//  PDF EXPORT
// ─────────────────────────────────────────
async function exportPDF(download = true) {
  if (state.pages.length === 0) {
    alert('No hay páginas para exportar. Escanea algún documento primero.');
    return null;
  }

  // Show overlay
  exportOverlay.classList.remove('hidden');
  progressFill.style.width = '0%';
  exportMsg.textContent = 'Preparando PDF...';

  await sleep(100);

  // A4 in mm
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const quality = parseFloat(pdfQualitySel.value) || 0.8;

  for (let i = 0; i < state.pages.length; i++) {
    if (i > 0) pdf.addPage('a4', 'portrait');

    exportMsg.textContent = `Procesando página ${i+1} de ${state.pages.length}...`;
    progressFill.style.width = `${Math.round((i / state.pages.length) * 90)}%`;
    await sleep(30);

    const pg = state.pages[i];
    // Get JPEG data URL
    const imgData = pg.canvas
      ? pg.canvas.toDataURL('image/jpeg', quality)
      : pg.dataURL;

    // A4 = 210 x 297 mm
    pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
  }

  progressFill.style.width = '100%';
  exportMsg.textContent = '¡Listo!';
  await sleep(400);
  exportOverlay.classList.add('hidden');

  return pdf;
}

async function downloadPDF() {
  const pdf = await exportPDF(true);
  if (!pdf) return;
  const name = (fileNameInput.value.trim() || 'Escaneado') + '.pdf';
  pdf.save(name);
}

/**
 * Export all pages as individual JPG files
 */
async function exportJPGs() {
  if (state.pages.length === 0) {
    alert('No hay páginas para guardar.');
    return;
  }
  const baseName = fileNameInput.value.trim() || 'Escaneado';
  state.pages.forEach((pg, i) => {
    const a = document.createElement('a');
    a.href = pg.dataURL;
    a.download = `${baseName}_p${i + 1}.jpg`;
    a.click();
  });
  showToast(`✓ ${state.pages.length} imágenes JPG descargadas`);
}

async function sharePDF() {
  const pdf = await exportPDF(false);
  if (!pdf) return;
  const name = (fileNameInput.value.trim() || 'Escaneado') + '.pdf';

  try {
    const blob = pdf.output('blob');
    const file = new File([blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
    } else {
      // Fallback: download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  } catch (err) {
    if (err.name !== 'AbortError') alert('Error al compartir: ' + err.message);
  }
}

// ─────────────────────────────────────────
//  GALLERY / FILE IMPORT
// ─────────────────────────────────────────
async function importFromGallery(files) {
  for (const file of files) {
    const dataURL = await readFileAsDataURL(file);
    const img = await loadImage(dataURL);
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width; srcCanvas.height = img.height;
    srcCanvas.getContext('2d').drawImage(img, 0, 0);
    const a4 = resizeToA4(srcCanvas);
    state.pages.push({
      canvas: a4,
      dataURL: a4.toDataURL('image/jpeg', 0.92),
    });
  }
  updateUI();
  showView('pagesView');
}

function readFileAsDataURL(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = e => res(e.target.result);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────
//  ONEDRIVE CORNER ADJUSTMENT & LUPA
// ─────────────────────────────────────────
let cropScale = 1;
let cropOffset = { x: 0, y: 0 };
let activePin = null;
let currentCropCorners = { tl: {x: 0, y: 0}, tr: {x: 0, y: 0}, br: {x: 0, y: 0}, bl: {x: 0, y: 0} };

function openCropModal() {
  if (!state.rawCapturedCanvas) return;
  const raw = state.rawCapturedCanvas;
  cropCanvas.width = raw.width;
  cropCanvas.height = raw.height;
  cropCtx.drawImage(raw, 0, 0);

  // Initialize corners from state.currentCorners or fallback to 10% inset
  currentCropCorners = JSON.parse(JSON.stringify(state.currentCorners || {
    tl: { x: 0.1, y: 0.1 },
    tr: { x: 0.9, y: 0.1 },
    br: { x: 0.9, y: 0.9 },
    bl: { x: 0.1, y: 0.9 }
  }));

  cropModal.classList.remove('hidden');
  requestAnimationFrame(updateCropUI);
}

function updateCropUI() {
  if (!cropEditorContainer || !cropCanvas) return;
  const rect = cropCanvas.getBoundingClientRect();
  const contRect = cropEditorContainer.getBoundingClientRect();

  const cLeft = rect.left - contRect.left;
  const cTop  = rect.top - contRect.top;
  const cW    = rect.width;
  const cH    = rect.height;

  // Map normalized (0..1) corners to editor container pixels
  const pTL = { x: cLeft + currentCropCorners.tl.x * cW, y: cTop + currentCropCorners.tl.y * cH };
  const pTR = { x: cLeft + currentCropCorners.tr.x * cW, y: cTop + currentCropCorners.tr.y * cH };
  const pBR = { x: cLeft + currentCropCorners.br.x * cW, y: cTop + currentCropCorners.br.y * cH };
  const pBL = { x: cLeft + currentCropCorners.bl.x * cW, y: cTop + currentCropCorners.bl.y * cH };

  // Position pins
  pinTL.style.left = `${pTL.x}px`; pinTL.style.top = `${pTL.y}px`;
  pinTR.style.left = `${pTR.x}px`; pinTR.style.top = `${pTR.y}px`;
  pinBR.style.left = `${pBR.x}px`; pinBR.style.top = `${pBR.y}px`;
  pinBL.style.left = `${pBL.x}px`; pinBL.style.top = `${pBL.y}px`;

  // Update SVG polygon
  cropPolygon.setAttribute('points', `${pTL.x},${pTL.y} ${pTR.x},${pTR.y} ${pBR.x},${pBR.y} ${pBL.x},${pBL.y}`);
}

function setupCropInteractions() {
  const pins = [
    { el: pinTL, key: 'tl' },
    { el: pinTR, key: 'tr' },
    { el: pinBR, key: 'br' },
    { el: pinBL, key: 'bl' }
  ];

  let isDragging = false;
  let dragCornerKey = null;

  pins.forEach(({ el, key }) => {
    const startDrag = (clientX, clientY) => {
      isDragging = true;
      dragCornerKey = key;
      magnifier.classList.remove('hidden');
      updateMagnifier(clientX, clientY, key);
    };

    el.addEventListener('mousedown', e => {
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    });

    el.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    }, { passive: false });
  });

  const onMove = (clientX, clientY) => {
    if (!isDragging || !dragCornerKey) return;
    const rect = cropCanvas.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

    currentCropCorners[dragCornerKey] = { x: nx, y: ny };
    updateCropUI();
    updateMagnifier(clientX, clientY, dragCornerKey);
  };

  const onEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    dragCornerKey = null;
    magnifier.classList.add('hidden');
  };

  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  window.addEventListener('touchmove', e => {
    if (isDragging) {
      const t = e.touches[0];
      onMove(t.clientX, t.clientY);
    }
  }, { passive: false });

  window.addEventListener('mouseup', onEnd);
  window.addEventListener('touchend', onEnd);

  // Resize listener for crop UI
  window.addEventListener('resize', () => {
    if (!cropModal.classList.contains('hidden')) {
      updateCropUI();
    }
  });

  // Reset button in crop modal
  btnResetCrop.addEventListener('click', () => {
    currentCropCorners = {
      tl: { x: 0.08, y: 0.08 },
      tr: { x: 0.92, y: 0.08 },
      br: { x: 0.92, y: 0.92 },
      bl: { x: 0.08, y: 0.92 }
    };
    updateCropUI();
  });

  // Apply button in crop modal
  btnApplyCrop.addEventListener('click', () => {
    state.currentCorners = currentCropCorners;
    const raw = state.rawCapturedCanvas;
    const rectified = unwarp4CornersToA4(raw, state.currentCorners, raw.width, raw.height);
    state.currentCaptured = enhanceScannedDocument(rectified);
    cropModal.classList.add('hidden');
    renderPreview();
    showToast('✓ Esquinas ajustadas con éxito');
  });

  btnCloseCrop.addEventListener('click', () => {
    cropModal.classList.add('hidden');
  });
}

function updateMagnifier(clientX, clientY, cornerKey) {
  if (!magnifier || !magnifierCanvas || !state.rawCapturedCanvas) return;
  const contRect = cropEditorContainer.getBoundingClientRect();
  const raw = state.rawCapturedCanvas;

  // Position magnifier above touch finger / mouse
  const magX = clientX - contRect.left;
  const magY = clientY - contRect.top - 80;
  magnifier.style.left = `${Math.max(10, Math.min(contRect.width - 130, magX - 60))}px`;
  magnifier.style.top  = `${Math.max(10, Math.min(contRect.height - 130, magY))}px`;

  // Draw 2.5x zoomed view into magnifierCanvas
  const corner = currentCropCorners[cornerKey];
  const srcX = corner.x * raw.width;
  const srcY = corner.y * raw.height;
  const zoomW = 80;
  const zoomH = 80;

  magnifierCtx.clearRect(0, 0, 130, 130);
  magnifierCtx.drawImage(
    raw,
    srcX - zoomW / 2, srcY - zoomH / 2, zoomW, zoomH,
    0, 0, 130, 130
  );
}

// ─────────────────────────────────────────
//  TORCH / FLASH CONTROL
// ─────────────────────────────────────────
async function toggleFlash() {
  if (!state.stream) return;
  const track = state.stream.getVideoTracks()[0];
  if (!track) return;
  const capabilities = track.getCapabilities ? track.getCapabilities() : {};
  if (!capabilities.torch) {
    showToast('Flash/Linterna no disponible en este dispositivo');
    return;
  }
  state.flashEnabled = !state.flashEnabled;
  try {
    await track.applyConstraints({
      advanced: [{ torch: state.flashEnabled }]
    });
    btnFlash.classList.toggle('active-flash', state.flashEnabled);
    showToast(state.flashEnabled ? '⚡ Flash encendido' : 'Flash apagado');
  } catch (err) {
    showToast('No se pudo activar el flash');
  }
}

// ─────────────────────────────────────────
//  EVENT LISTENERS
// ─────────────────────────────────────────
function setupEventListeners() {
  // Capture
  btnCapture.addEventListener('click', captureFrame);

  // Flash toggle
  if (btnFlash) {
    btnFlash.addEventListener('click', toggleFlash);
  }

  // Auto-Capture toggle
  if (btnAutoCapture) {
    btnAutoCapture.addEventListener('click', () => {
      state.autoCapture = !state.autoCapture;
      btnAutoCapture.classList.toggle('active', state.autoCapture);
      if (state.autoCapture) {
        showToast('🎯 Auto-Disparo ACTIVADO — Mantén quieto el celular');
      } else {
        showToast('Auto-Disparo desactivado');
      }
    });
  }

  // OneDrive Scan Modes (Document, Whiteboard, Card, Photo)
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.scanMode = btn.dataset.mode;
      const modeNames = {
        document: 'DOCUMENTO',
        whiteboard: 'PIZARRA',
        card: 'TARJETA',
        photo: 'FOTO'
      };
      showToast(`Modo: ${modeNames[state.scanMode]}`);
    });
  });

  // Preview view buttons
  if (btnBackToCamera) {
    btnBackToCamera.addEventListener('click', () => {
      state.currentCaptured = null;
      showView('cameraView');
    });
  }
  if (btnConfirmPage) {
    btnConfirmPage.addEventListener('click', confirmPage);
  }
  if (btnNextPage) {
    btnNextPage.addEventListener('click', nextPage); // ★ SIGUIENTE PÁGINA ★
  }

  if (btnRotLeft) {
    btnRotLeft.addEventListener('click', () => {
      previewRotation = (previewRotation - 90 + 360) % 360;
      renderPreview();
    });
  }
  if (btnRotRight) {
    btnRotRight.addEventListener('click', () => {
      previewRotation = (previewRotation + 90) % 360;
      renderPreview();
    });
  }

  // Filters toggle & selection
  if (btnFilter) {
    btnFilter.addEventListener('click', () => {
      const isVisible = !filterPanel.classList.contains('hidden');
      filterPanel.classList.toggle('hidden', isVisible);
      sliderPanel.classList.add('hidden');
    });
  }

  filterPanel.querySelectorAll('.filter-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      filterPanel.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      previewFilter = btn.dataset.filter;
      renderPreview();
    });
  });

  // Brightness / Contrast
  if (btnBright) {
    btnBright.addEventListener('click', () => {
      currentAdjType = 'brightness';
      sliderLabel.textContent = 'Brillo';
      adjSlider.value = previewBrightness;
      sliderVal.textContent = previewBrightness;
      sliderPanel.classList.remove('hidden');
      filterPanel.classList.add('hidden');
    });
  }
  if (btnContrast) {
    btnContrast.addEventListener('click', () => {
      currentAdjType = 'contrast';
      sliderLabel.textContent = 'Contraste';
      adjSlider.value = previewContrast;
      sliderVal.textContent = previewContrast;
      sliderPanel.classList.remove('hidden');
      filterPanel.classList.add('hidden');
    });
  }
  if (adjSlider) {
    adjSlider.addEventListener('input', () => {
      const v = parseInt(adjSlider.value);
      sliderVal.textContent = v;
      if (currentAdjType === 'brightness') previewBrightness = v;
      else previewContrast = v;
      renderPreview();
    });
  }
  if (btnApplyAdj) {
    btnApplyAdj.addEventListener('click', () => {
      sliderPanel.classList.add('hidden');
      renderPreview();
    });
  }
  if (btnResetAdj) {
    btnResetAdj.addEventListener('click', () => {
      adjSlider.value = 0;
      sliderVal.textContent = 0;
      if (currentAdjType === 'brightness') previewBrightness = 0;
      else previewContrast = 0;
      renderPreview();
    });
  }

  // Crop / Adjust corners button (OneDrive style interactive 4-corner editor)
  btnCrop.addEventListener('click', openCropModal);
  setupCropInteractions();

  // Pages view
  btnBackFromPages.addEventListener('click', () => showView('cameraView'));
  btnAddMorePages.addEventListener('click', () => showView('cameraView'));
  btnDeleteAll.addEventListener('click', () => {
    if (state.pages.length === 0) return;
    if (confirm('¿Borrar todas las páginas?')) {
      state.pages = [];
      updateUI();
      renderPagesGrid();
    }
  });
  btnExportPDF.addEventListener('click', downloadPDF);
  if (btnExportJPG) btnExportJPG.addEventListener('click', exportJPGs);
  btnSharePDF.addEventListener('click', sharePDF);

  // Thumb strip click -> pages view
  thumbStrip.addEventListener('click', e => {
    if (e.target.closest('.thumb-item')) showView('pagesView');
  });

  // Page Edit Modal
  btnCloseModal.addEventListener('click', () => pageEditModal.classList.add('hidden'));
  mBtnRotL.addEventListener('click', () => {
    modalRotation = (modalRotation - 90 + 360) % 360;
    renderModal();
  });
  mBtnRotR.addEventListener('click', () => {
    modalRotation = (modalRotation + 90) % 360;
    renderModal();
  });
  mBtnDelete.addEventListener('click', () => {
    if (confirm(`¿Eliminar página ${state.editingIndex + 1}?`)) {
      deletePage(state.editingIndex);
      pageEditModal.classList.add('hidden');
    }
  });
  mBtnSave.addEventListener('click', saveModalEdit);

  // Modal filters
  pageEditModal.querySelectorAll('[data-mfilter]').forEach(btn => {
    btn.addEventListener('click', () => {
      pageEditModal.querySelectorAll('[data-mfilter]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      modalFilter = btn.dataset.mfilter;
      renderModal();
    });
  });

  // Close modals on backdrop click
  [settingsModal, exportOverlay].forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) m.classList.add('hidden');
    });
  });

  // Handle window resize
  window.addEventListener('resize', syncOverlaySize);
}

// ─────────────────────────────────────────
//  BOOT
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
