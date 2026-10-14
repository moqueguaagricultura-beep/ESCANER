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
  currentCaptured: null,  // temp canvas for preview
  editingIndex: -1,    // which page is being edited in modal
  stream: null,
  facingMode: 'environment',
  flashEnabled: false,
  autoDetect: true,
  perspCorrect: true,
  pdfQuality: 0.8,
  detectionInterval: null,
  detectedRect: null,   // {x,y,w,h} relative to video
  continuousMode: false, // fast continuous scan mode
};

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
const btnAutoDetect = $('btnAutoDetect');
const btnContinuous = $('btnContinuous');    // ← NEW: Fast continuous scan
const btnSwitchCam  = $('btnSwitchCam');
const btnGallery    = $('btnGallery');
const btnViewPages  = $('btnViewPages');
const btnPages      = $('btnPages');
const btnSettings   = $('btnSettings');

const btnBackToCamera  = $('btnBackToCamera');
const btnConfirmPage   = $('btnConfirmPage');
const btnNextPage      = $('btnNextPage');      // ← NEW: "Siguiente Página"
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
const btnSharePDF      = $('btnSharePDF');

const filterPanel  = $('filterPanel');
const sliderPanel  = $('sliderPanel');
const adjSlider    = $('adjSlider');
const sliderVal    = $('sliderVal');
const sliderLabel  = $('sliderLabel');
const btnApplyAdj  = $('btnApplyAdj');
const btnResetAdj  = $('btnResetAdj');

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
const correctionBadge = $('correctionBadge');  // ← NEW
const savedSoFarEl    = $('savedSoFar');        // ← NEW
const previewPageNumEl = $('previewPageNum');   // ← NEW

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
        facingMode: { ideal: state.facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = state.stream;
    await video.play();
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

function syncOverlaySize() {
  overlayCanvas.width  = video.videoWidth  || overlayCanvas.offsetWidth;
  overlayCanvas.height = video.videoHeight || overlayCanvas.offsetHeight;
}

video.addEventListener('loadedmetadata', syncOverlaySize);

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
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  overlayCanvas.width = vw;
  overlayCanvas.height = vh;

  // Sample the video frame into a small temp canvas for analysis
  const tmpW = 320, tmpH = Math.round(vh / vw * 320);
  const tmp = document.createElement('canvas');
  tmp.width = tmpW; tmp.height = tmpH;
  const tCtx = tmp.getContext('2d');
  tCtx.drawImage(video, 0, 0, tmpW, tmpH);

  const imageData = tCtx.getImageData(0, 0, tmpW, tmpH);
  const rect = findDocumentRect(imageData, tmpW, tmpH);

  clearOverlay();
  if (rect) {
    // Scale rect back to full video size
    const scaleX = vw / tmpW;
    const scaleY = vh / tmpH;
    const rx = rect.x * scaleX;
    const ry = rect.y * scaleY;
    const rw = rect.w * scaleX;
    const rh = rect.h * scaleY;

    // Draw guide overlay
    overlayCtx.save();
    overlayCtx.strokeStyle = 'rgba(34,197,94,0.9)';
    overlayCtx.lineWidth = 3;
    overlayCtx.setLineDash([]);
    overlayCtx.strokeRect(rx, ry, rw, rh);

    // Corners
    const cSize = 20;
    overlayCtx.lineWidth = 4;
    [[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].forEach(([cx,cy],i) => {
      const xd = i % 2 === 0 ? 1 : -1;
      const yd = i < 2 ? 1 : -1;
      overlayCtx.beginPath();
      overlayCtx.moveTo(cx, cy + yd * cSize);
      overlayCtx.lineTo(cx, cy);
      overlayCtx.lineTo(cx + xd * cSize, cy);
      overlayCtx.stroke();
    });
    overlayCtx.restore();

    state.detectedRect = { x: rx/vw, y: ry/vh, w: rw/vw, h: rh/vh };
    hintText.textContent = '✓ Documento detectado — ¡Captura!';
    hintText.style.color = '#22c55e';
  } else {
    state.detectedRect = null;
    hintText.textContent = 'Apunta a un documento A4';
    hintText.style.color = '';
  }
}

/**
 * Enhanced document detector specifically tuned for A4 pages in folders/binders.
 * Uses Otsu auto-thresholding + edge contrast + A4 aspect ratio verification.
 */
function findDocumentRect(imageData, w, h) {
  const data = imageData.data;
  const n = w * h;

  // Grayscale conversion
  const gray = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] = (data[i*4] * 0.299 + data[i*4+1] * 0.587 + data[i*4+2] * 0.114) | 0;
  }

  // 1. Otsu threshold to separate page from folder background
  const hist = new Int32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;

  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0, wB = 0, wF = 0, varMax = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = t;
    }
  }

  // 2. Scan lines to find bounds of the bright (document) region
  // Horizontal bounds (left/right)
  const colCounts = new Int32Array(w);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (gray[y * w + x] > threshold) colCounts[x]++;
    }
  }

  // Vertical bounds (top/bottom)
  const rowCounts = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] > threshold) rowCounts[y]++;
    }
  }

  // Need at least 25% of column to be considered document
  const minCol = Math.round(h * 0.25);
  const minRow = Math.round(w * 0.25);

  let left = 0, right = w - 1, top = 0, bot = h - 1;

  for (let x = 0; x < w; x++) {
    if (colCounts[x] > minCol) { left = x; break; }
  }
  for (let x = w - 1; x >= 0; x--) {
    if (colCounts[x] > minCol) { right = x; break; }
  }
  for (let y = 0; y < h; y++) {
    if (rowCounts[y] > minRow) { top = y; break; }
  }
  for (let y = h - 1; y >= 0; y--) {
    if (rowCounts[y] > minRow) { bot = y; break; }
  }

  const rectW = right - left;
  const rectH = bot - top;

  // Validation: document must occupy at least 35% of frame
  if (rectW < w * 0.35 || rectH < h * 0.35) return null;

  // Check aspect ratio (A4 portrait = 1.414; landscape = 0.707; accept 0.65 - 2.1)
  const ratio = rectH / rectW;
  if (ratio < 0.65 || ratio > 2.2) return null;

  return { x: left, y: top, w: rectW, h: rectH };
}

// ─────────────────────────────────────────
//  CAPTURE
// ─────────────────────────────────────────
async function captureFrame() {
  if (!video.videoWidth) return;

  // Flash effect
  flashOverlay.classList.add('flash');
  btnCapture.classList.add('capturing');
  setTimeout(() => {
    flashOverlay.classList.remove('flash');
    btnCapture.classList.remove('capturing');
  }, 300);

  // Grab full frame
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const capCanvas = document.createElement('canvas');
  capCanvas.width = vw;
  capCanvas.height = vh;
  const capCtx = capCanvas.getContext('2d');
  capCtx.drawImage(video, 0, 0, vw, vh);

  let processedCanvas;
  let wasAutoCorrected = false;

  if (state.perspCorrect && state.detectedRect) {
    processedCanvas = cropAndCorrect(capCanvas, state.detectedRect, vw, vh);
    wasAutoCorrected = true;
  } else {
    // Even without detected rect, try an aggressive auto-crop
    processedCanvas = autoCropWhiteBorders(capCanvas);
    wasAutoCorrected = processedCanvas !== capCanvas;
  }

  // Resize to A4
  const a4Canvas = resizeToA4(processedCanvas);
  state.currentCaptured = a4Canvas;
  previewRotation   = 0;
  previewFilter     = 'original';
  previewBrightness = 0;
  previewContrast   = 0;

  // Update preview page number (will be page N+1)
  if (previewPageNumEl) previewPageNumEl.textContent = state.pages.length + 1;

  // Update saved counter
  updateSavedCounter();

  // In CONTINUOUS MODE: auto-save and stay in camera view (lightning fast for 100+ pages)
  if (state.continuousMode) {
    saveCurrentPage();
    state.currentCaptured = null;
    updateUI();
    showToast(`✓ Página ${state.pages.length} escaneada`);
    return; // Stay in camera!
  }

  showView('previewView');
  renderPreview();

  // Show correction badge
  if (wasAutoCorrected && correctionBadge) {
    correctionBadge.classList.remove('hidden');
    // Remove after animation completes (3s)
    setTimeout(() => correctionBadge.classList.add('hidden'), 3200);
  }
}

/**
 * Crop the image to the detected rectangle and output as A4 canvas
 */
function cropAndCorrect(srcCanvas, rect, vw, vh) {
  const x = Math.round(rect.x * vw);
  const y = Math.round(rect.y * vh);
  const w = Math.round(rect.w * vw);
  const h = Math.round(rect.h * vh);

  // Add a small padding so we don't cut edges
  const padX = Math.round(w * 0.01);
  const padY = Math.round(h * 0.01);
  const cx = Math.max(0, x - padX);
  const cy = Math.max(0, y - padY);
  const cw = Math.min(vw - cx, w + padX * 2);
  const ch = Math.min(vh - cy, h + padY * 2);

  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const ctx = out.getContext('2d');
  ctx.drawImage(srcCanvas, cx, cy, cw, ch, 0, 0, cw, ch);
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
    case 'grayscale':
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        d[i] = d[i+1] = d[i+2] = g;
      }
      break;
    case 'bw':
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        const bw = g > 128 ? 255 : 0;
        d[i] = d[i+1] = d[i+2] = bw;
      }
      break;
    case 'enhance':
      // Increase contrast and clarity
      for (let i = 0; i < d.length; i += 4) {
        d[i]   = clamp(((d[i]   - 128) * 1.4) + 140);
        d[i+1] = clamp(((d[i+1] - 128) * 1.4) + 140);
        d[i+2] = clamp(((d[i+2] - 128) * 1.4) + 140);
      }
      break;
    case 'magic':
      // Adaptive thresholding style (whitens background, darkens text)
      for (let i = 0; i < d.length; i += 4) {
        const g = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114;
        const enhanced = g > 180 ? 255 : g > 100 ? clamp((g - 100) * 1.5 + 100) : clamp(g * 0.6);
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
//  EVENT LISTENERS
// ─────────────────────────────────────────
function setupEventListeners() {
  // Capture
  btnCapture.addEventListener('click', captureFrame);

  // Flash
  btnFlash.addEventListener('click', async () => {
    state.flashEnabled = !state.flashEnabled;
    btnFlash.classList.toggle('active', state.flashEnabled);
    if (state.stream) {
      const track = state.stream.getVideoTracks()[0];
      if (track && track.applyConstraints) {
        try {
          await track.applyConstraints({ advanced: [{ torch: state.flashEnabled }] });
        } catch(e) {
          // torch not supported
          btnFlash.style.opacity = '0.5';
        }
      }
    }
  });

  // Auto detect toggle
  btnAutoDetect.addEventListener('click', () => {
    state.autoDetect = !state.autoDetect;
    btnAutoDetect.classList.toggle('active', state.autoDetect);
    autoDetectToggle.checked = state.autoDetect;
    if (!state.autoDetect) clearOverlay();
  });

  // Continuous / Fast scan mode toggle
  btnContinuous.addEventListener('click', () => {
    state.continuousMode = !state.continuousMode;
    btnContinuous.classList.toggle('active', state.continuousMode);
    if (state.continuousMode) {
      showToast('⚡ Modo Rápido ACTIVADO — Dispara sin parar');
    } else {
      showToast('Modo Normal — Revisión activada');
    }
  });

  // Switch camera
  btnSwitchCam.addEventListener('click', () => {
    state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
    startCamera();
  });

  // Gallery
  btnGallery.addEventListener('click', () => galleryInput.click());
  galleryInput.addEventListener('change', e => {
    if (e.target.files.length) importFromGallery([...e.target.files]);
    galleryInput.value = '';
  });

  // View pages from camera
  btnViewPages.addEventListener('click', () => showView('pagesView'));
  btnPages.addEventListener('click', () => showView('pagesView'));

  // Settings
  btnSettings.addEventListener('click', () => settingsModal.classList.remove('hidden'));
  btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
  pdfQualitySel.addEventListener('change', () => state.pdfQuality = parseFloat(pdfQualitySel.value));
  autoDetectToggle.addEventListener('change', () => {
    state.autoDetect = autoDetectToggle.checked;
    btnAutoDetect.classList.toggle('active', state.autoDetect);
  });
  perspToggle.addEventListener('change', () => state.perspCorrect = perspToggle.checked);

  // Preview view
  btnBackToCamera.addEventListener('click', () => {
    state.currentCaptured = null;
    showView('cameraView');
  });
  btnConfirmPage.addEventListener('click', confirmPage);
  btnNextPage.addEventListener('click', nextPage); // ★ SIGUIENTE PÁGINA ★

  btnRotLeft.addEventListener('click', () => {
    previewRotation = (previewRotation - 90 + 360) % 360;
    renderPreview();
  });
  btnRotRight.addEventListener('click', () => {
    previewRotation = (previewRotation + 90) % 360;
    renderPreview();
  });

  // Filters
  btnFilter.addEventListener('click', () => {
    const isVisible = !filterPanel.classList.contains('hidden');
    filterPanel.classList.toggle('hidden', isVisible);
    sliderPanel.classList.add('hidden');
  });

  filterPanel.querySelectorAll('.filter-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      filterPanel.querySelectorAll('.filter-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      previewFilter = btn.dataset.filter;
      renderPreview();
    });
  });

  // Brightness / Contrast
  btnBright.addEventListener('click', () => {
    currentAdjType = 'brightness';
    sliderLabel.textContent = 'Brillo';
    adjSlider.value = previewBrightness;
    sliderVal.textContent = previewBrightness;
    sliderPanel.classList.remove('hidden');
    filterPanel.classList.add('hidden');
  });
  btnContrast.addEventListener('click', () => {
    currentAdjType = 'contrast';
    sliderLabel.textContent = 'Contraste';
    adjSlider.value = previewContrast;
    sliderVal.textContent = previewContrast;
    sliderPanel.classList.remove('hidden');
    filterPanel.classList.add('hidden');
  });
  adjSlider.addEventListener('input', () => {
    const v = parseInt(adjSlider.value);
    sliderVal.textContent = v;
    if (currentAdjType === 'brightness') previewBrightness = v;
    else previewContrast = v;
    renderPreview();
  });
  btnApplyAdj.addEventListener('click', () => {
    sliderPanel.classList.add('hidden');
    renderPreview();
  });
  btnResetAdj.addEventListener('click', () => {
    adjSlider.value = 0;
    sliderVal.textContent = 0;
    if (currentAdjType === 'brightness') previewBrightness = 0;
    else previewContrast = 0;
    renderPreview();
  });

  // Crop btn (basic — trims 5% all sides)
  btnCrop.addEventListener('click', () => {
    if (!state.currentCaptured) return;
    const s = state.currentCaptured;
    const margin = 0.05;
    const x = Math.round(s.width * margin);
    const y = Math.round(s.height * margin);
    const w = Math.round(s.width  * (1 - 2*margin));
    const h = Math.round(s.height * (1 - 2*margin));
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(s, x, y, w, h, 0, 0, w, h);
    state.currentCaptured = tmp;
    renderPreview();
  });

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
