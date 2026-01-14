// ============================
// grade.js - OMR v3 SAFE 채점 + 주관식 OCR(숫자/소수/분수)
// - 분수는 가급적 1/5 형태 권장
// - 세로 분수/오인식(1\n5, 1 5, 1|5, 1-5 등)은 후처리로 1/5로 보정
// ============================

const LS_KEY = "omr_answer_key_v1";

// ---- A4 / Warp ----
const A4_W_MM = 210;
const A4_H_MM = 297;

const WARP_H = 1800;
const WARP_W = Math.round(WARP_H * (A4_W_MM / A4_H_MM));

// Marker
const MARKER_CENTER_OFFSET_MM = 17;

// MC params
const MC_ROWS = 30;
const CHOICE_X_MM = [50, 57, 64, 71, 78];
const ROI_HALF_MM = 4.0;
const TH_BLANK = 0.16;

// image resize
const RESIZE_LONG_EDGE = 1800;

// ===== v3 SAFE layout derived constants =====
const PAGE_MARGIN_MM = 14;
const USABLE_W_MM = A4_W_MM - 2 * PAGE_MARGIN_MM; // 182
const SPLIT_X_MM = PAGE_MARGIN_MM + USABLE_W_MM * 0.58; // 119.56
const TABLE_X0_MM = SPLIT_X_MM + 4; // 123.56
const TABLE_X1_MM = A4_W_MM - PAGE_MARGIN_MM; // 196
const NUM_COL_W_MM = 14;

const middle_top_from_top_mm = 68;
const middle_bottom_from_bottom_mm = 64;

const MIDDLE_TOP_BOTTOM_MM = A4_H_MM - middle_top_from_top_mm; // 229
const MIDDLE_BOTTOM_BOTTOM_MM = middle_bottom_from_bottom_mm;  // 64

const AVAILABLE_H_MM = MIDDLE_TOP_BOTTOM_MM - MIDDLE_BOTTOM_BOTTOM_MM; // 165
const LINE_GAP_MM = AVAILABLE_H_MM / (MC_ROWS + 1);
const START_Y_BOTTOM_MM = MIDDLE_TOP_BOTTOM_MM - LINE_GAP_MM;

// SA
const SA_ROWS = 10;
const SA_ROW_H_MM = (MIDDLE_TOP_BOTTOM_MM - MIDDLE_BOTTOM_BOTTOM_MM) / SA_ROWS; // 16.5

function mmToPxX(mm){ return mm * (WARP_W / A4_W_MM); }
function mmToPxY(mm){ return mm * (WARP_H / A4_H_MM); }

// MC row center Y (Top-mm)
function mcCenterYTopMm(q1based){
  const i = q1based - 1;
  const y_bottom_mm = START_Y_BOTTOM_MM - i * LINE_GAP_MM;
  return A4_H_MM - y_bottom_mm;
}

// SA row center Y (Top-mm)
function saRowCenterYTopMm(i0){
  const y_top_bottom_mm = MIDDLE_TOP_BOTTOM_MM - i0 * SA_ROW_H_MM;
  const y_center_bottom_mm = y_top_bottom_mm - SA_ROW_H_MM / 2;
  return A4_H_MM - y_center_bottom_mm;
}

// SA answer rect (Top-mm)
function saAnswerRectTopMm(i0){
  const y_top_bottom_mm = MIDDLE_TOP_BOTTOM_MM - i0 * SA_ROW_H_MM;
  const y_bot_bottom_mm = y_top_bottom_mm - SA_ROW_H_MM;

  const y_top_mm = A4_H_MM - y_top_bottom_mm;
  const y_bot_mm = A4_H_MM - y_bot_bottom_mm;

  const pad = 2.5;
  const x0 = TABLE_X0_MM + NUM_COL_W_MM + pad;
  const x1 = TABLE_X1_MM - pad;

  const y0 = y_top_mm + pad;
  const y1 = y_bot_mm - pad;

  return { x0, y0, x1, y1 };
}

// ---- Answer keys ----
let mcKey = Array(30).fill(null);
let saKey = Array(10).fill(null);

function loadAnswerKey(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw){
    mcKey = Array(30).fill(null);
    saKey = Array(10).fill(null);
    updateKeyStatus();
    return;
  }

  try{
    const s = JSON.parse(raw);
    const mcBlocks = Array.isArray(s.mcBlocks) ? s.mcBlocks : [];
    const saInputs = Array.isArray(s.saInputs) ? s.saInputs : [];

    const out = [];
    for(let b=0;b<6;b++){
      const block = String(mcBlocks[b] || "");
      for(let i=0;i<5;i++){
        const ch = block[i];
        out.push(ch ? parseInt(ch,10) : null);
      }
    }
    mcKey = out.slice(0,30).map(v => (v>=1 && v<=5) ? v : null);

    saKey = [];
    for(let i=0;i<10;i++){
      const t = String(saInputs[i] || "").trim().replace(/\s+/g,"");
      saKey.push(t ? t : null);
    }
  } catch(e){
    mcKey = Array(30).fill(null);
    saKey = Array(10).fill(null);
  }

  updateKeyStatus();
}

function updateKeyStatus(){
  const mcCnt = mcKey.filter(v => v != null).length;
  const saCnt = saKey.filter(v => v != null).length;
  document.getElementById("mcKeyCount").textContent = String(mcCnt);
  document.getElementById("saKeyCount").textContent = String(saCnt);

  const el = document.getElementById("keyStatus");
  if(mcCnt === 0 && saCnt === 0){
    el.className = "pill bad";
    el.textContent = "정답 없음";
  } else if(mcCnt < 30 || saCnt < 10){
    el.className = "pill warn";
    el.textContent = "부분 정답";
  } else {
    el.className = "pill ok";
    el.textContent = "정답 완비";
  }
}

// ---- OpenCV ready ----
function waitForOpenCV(){
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (typeof cv !== "undefined" && cv.Mat && cv.getBuildInformation) {
        clearInterval(timer);
        resolve();
      }
    }, 80);
  });
}

// ---- OCR ready ----
function waitForTesseract(){
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (typeof Tesseract !== "undefined" && Tesseract.createWorker) {
        clearInterval(timer);
        resolve();
      }
    }, 80);
  });
}

let ocrWorker = null;

async function initOCRWorker(){
  if(ocrWorker) return ocrWorker;

  ocrWorker = await Tesseract.createWorker({ logger: () => {} });
  await ocrWorker.loadLanguage("eng");
  await ocrWorker.initialize("eng");

  await ocrWorker.setParameters({
    tessedit_char_whitelist: "0123456789./",
    tessedit_pageseg_mode: "7" // single line
  });

  return ocrWorker;
}

(async () => {
  await waitForOpenCV();
  document.getElementById("cvStatus").innerHTML = `<span class="pill ok">OpenCV 준비됨</span>`;

  await waitForTesseract();
  document.getElementById("ocrStatus").innerHTML = `<span class="pill ok">OCR 준비됨</span>`;

  await initOCRWorker();
  document.getElementById("gradeBtn").disabled = false;
})();

// ---- image helpers ----
function fileToImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

function drawImageResizedToCanvas(img, longEdge){
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  const scale = longEdge / Math.max(w0, h0);
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToMatRGBA(canvas){
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return cv.matFromImageData(imgData);
}

// ---- marker detection ----
function detectRingMarkers(gray){
  const th = new cv.Mat();
  cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(th, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const candidates = [];
  const imgArea = gray.cols * gray.rows;

  for(let i=0;i<contours.size();i++){
    const cnt = contours.get(i);
    const rect = cv.boundingRect(cnt);
    const area = rect.width * rect.height;

    if(area < imgArea * 0.00035) { cnt.delete(); continue; }

    const ratio = rect.width / rect.height;
    if(ratio < 0.80 || ratio > 1.20) { cnt.delete(); continue; }

    const x = rect.x, y = rect.y, w = rect.width, h = rect.height;
    const cx1 = Math.round(x + w*0.25), cy1 = Math.round(y + h*0.25);
    const cw  = Math.round(w*0.5),  ch  = Math.round(h*0.5);

    if(cx1 < 0 || cy1 < 0 || cx1+cw >= gray.cols || cy1+ch >= gray.rows){
      cnt.delete(); continue;
    }

    const rectRoi = gray.roi(new cv.Rect(x, y, w, h));
    const innerRoi = gray.roi(new cv.Rect(cx1, cy1, cw, ch));
    const meanRect  = cv.mean(rectRoi)[0];
    const meanInner = cv.mean(innerRoi)[0];

    const areaRect = w*h;
    const areaInner = cw*ch;
    const meanOuter = (meanRect*areaRect - meanInner*areaInner) / Math.max(1, (areaRect - areaInner));

    rectRoi.delete();
    innerRoi.delete();

    if(meanInner < 125 || (meanInner - meanOuter) < 28){
      cnt.delete(); continue;
    }

    candidates.push({ cx: x + w/2, cy: y + h/2, area });
    cnt.delete();
  }

  contours.delete(); hierarchy.delete(); th.delete();
  if(candidates.length < 4) return null;

  candidates.sort((a,b)=>b.area-a.area);
  const top = candidates.slice(0, 8);

  const tl = top.reduce((best, p)=> (p.cx+p.cy < best.cx+best.cy ? p : best), top[0]);
  const br = top.reduce((best, p)=> (p.cx+p.cy > best.cx+best.cy ? p : best), top[0]);
  const tr = top.reduce((best, p)=> (p.cx-p.cy > best.cx-best.cy ? p : best), top[0]);
  const bl = top.reduce((best, p)=> (p.cx-p.cy < best.cx-best.cy ? p : best), top[0]);

  const uniq = new Set([tl, tr, bl, br].map(o => `${Math.round(o.cx)}_${Math.round(o.cy)}`));
  if(uniq.size !== 4) return null;

  return {tl, tr, bl, br};
}

// ---- warp ----
function warpToA4(gray, m){
  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [
    m.tl.cx, m.tl.cy,
    m.tr.cx, m.tr.cy,
    m.bl.cx, m.bl.cy,
    m.br.cx, m.br.cy,
  ]);

  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [
    mmToPxX(MARKER_CENTER_OFFSET_MM), mmToPxY(MARKER_CENTER_OFFSET_MM),
    mmToPxX(A4_W_MM - MARKER_CENTER_OFFSET_MM), mmToPxY(MARKER_CENTER_OFFSET_MM),
    mmToPxX(MARKER_CENTER_OFFSET_MM), mmToPxY(A4_H_MM - MARKER_CENTER_OFFSET_MM),
    mmToPxX(A4_W_MM - MARKER_CENTER_OFFSET_MM), mmToPxY(A4_H_MM - MARKER_CENTER_OFFSET_MM),
  ]);

  const M = cv.getPerspectiveTransform(src, dst);
  const warped = new cv.Mat();
  cv.warpPerspective(gray, warped, M, new cv.Size(WARP_W, WARP_H), cv.INTER_LINEAR, cv.BORDER_REPLICATE);

  src.delete(); dst.delete(); M.delete();
  return warped;
}

// ---- MC ROI + fill ----
function getMcRoiRectPx(q1based, choice1based){
  const xMm = CHOICE_X_MM[choice1based - 1];
  const yMm = mcCenterYTopMm(q1based);

  const cx = mmToPxX(xMm);
  const cy = mmToPxY(yMm);

  const halfW = mmToPxX(ROI_HALF_MM);
  const halfH = mmToPxY(ROI_HALF_MM);

  const x1 = Math.max(0, Math.round(cx - halfW));
  const y1 = Math.max(0, Math.round(cy - halfH));
  const x2 = Math.min(WARP_W-1, Math.round(cx + halfW));
  const y2 = Math.min(WARP_H-1, Math.round(cy + halfH));

  return new cv.Rect(x1, y1, Math.max(1, x2-x1), Math.max(1, y2-y1));
}

function fillScore(grayRoi){
  const th = new cv.Mat();
  cv.adaptiveThreshold(grayRoi, th, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 7);
  const mean = cv.mean(th)[0] / 255.0;
  th.delete();
  return mean;
}

// ---- fraction & numeric normalization ----
function gcd(a,b){ while(b){ const t=a%b; a=b; b=t; } return a; }

/**
 * 세로 분수/오인식 보정:
 * - "1\n5" / "1 5" → "1/5"
 * - "1|5" "1:5" "1-5" → "1/5"
 * - 기타 공백/줄바꿈 제거
 */
function fixVerticalFraction(raw){
  if(!raw) return raw;
  let t = String(raw).trim();

  // 줄바꿈을 공백으로 통일
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  t = t.replace(/\n+/g, " ").trim();

  // 흔한 구분자 오인식 → '/'
  t = t.replace(/[|:]/g, "/").replace(/-/g, "/");

  // "12 7" 같은 경우 → "12/7"
  const parts = t.split(/\s+/).filter(Boolean);
  if(parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1])){
    return `${parts[0]}/${parts[1]}`;
  }

  return t;
}

function normalizeAnswer(s){
  if(s == null) return null;
  let t = String(s).trim().replace(/\s+/g,"");
  if(!t) return null;

  t = t.replace(/,/g, ".");          // just in case
  t = t.replace(/[^0-9./]/g, "");    // hard filter

  // fraction
  if(t.includes("/")){
    const [aRaw,bRaw] = t.split("/");
    if(!aRaw || !bRaw) return t;
    let a = aRaw.replace(/^0+(?=\d)/, "");
    let b = bRaw.replace(/^0+(?=\d)/, "");
    if(a === "") a = "0";
    if(b === "") b = "0";
    const ai = parseInt(a,10), bi = parseInt(b,10);
    if(Number.isFinite(ai) && Number.isFinite(bi) && bi !== 0){
      const g = gcd(Math.abs(ai), Math.abs(bi));
      return `${ai/g}/${bi/g}`;
    }
    return `${a}/${b}`;
  }

  // decimal
  if(t.includes(".")){
    let [ip, fp] = t.split(".");
    if(ip == null) ip = "0";
    if(fp == null) fp = "";
    ip = ip.replace(/^0+(?=\d)/, "");
    if(ip === "") ip = "0";
    fp = fp.replace(/0+$/, "");
    if(fp === "") return ip;
    return `${ip}.${fp}`;
  }

  // integer
  t = t.replace(/^0+(?=\d)/, "");
  if(t === "") t = "0";
  return t;
}

// ---- OCR preprocessing ----
function matToCanvas(matGray){
  const rgba = new cv.Mat();
  cv.cvtColor(matGray, rgba, cv.COLOR_GRAY2RGBA);

  const canvas = document.createElement("canvas");
  canvas.width = rgba.cols;
  canvas.height = rgba.rows;

  const ctx = canvas.getContext("2d");
  const imgData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
  ctx.putImageData(imgData, 0, 0);

  rgba.delete();
  return canvas;
}

function preprocessForOCR(roiGray){
  const work = new cv.Mat();
  roiGray.copyTo(work);

  cv.GaussianBlur(work, work, new cv.Size(3,3), 0);

  const th = new cv.Mat();
  // 글씨는 검정(0)에 가까움 → THRESH_BINARY로 배경/글씨 분리 후 반전해서 글씨를 흰색으로
  cv.adaptiveThreshold(work, th, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, 21, 8);
  cv.bitwise_not(th, th);

  const up = new cv.Mat();
  cv.resize(th, up, new cv.Size(), 3, 3, cv.INTER_LINEAR);

  work.delete(); th.delete();
  return up;
}

async function ocrOneCanvas(canvas){
  const worker = await initOCRWorker();
  const { data } = await worker.recognize(canvas);
  return {
    text: (data.text || "").trim(),
    conf: (typeof data.confidence === "number") ? data.confidence : null
  };
}

// ---- annotate ----
function annotateAllOnWarped(warpedGray, mcDetectedChoices, saResults){
  const out = new cv.Mat();
  cv.cvtColor(warpedGray, out, cv.COLOR_GRAY2RGBA);

  const BLUE  = new cv.Scalar(31, 111, 235, 255);
  const RED   = new cv.Scalar(209, 36, 47, 255);
  const GREEN = new cv.Scalar(20, 160, 80, 255);

  const font = cv.FONT_HERSHEY_SIMPLEX;
  const fontScale = 0.9;
  const thickness = 2;

  // MC
  for(let q=1;q<=30;q++){
    const correct = mcKey[q-1];
    const chosen = mcDetectedChoices[q-1];
    const y = Math.round(mmToPxY(mcCenterYTopMm(q)) + 6);

    if(correct != null){
      const xV = Math.round(mmToPxX(CHOICE_X_MM[correct-1]) - 8);
      cv.putText(out, "V", new cv.Point(xV, y), font, fontScale, GREEN, thickness);
    }
    if(chosen != null && correct != null){
      const xM = Math.round(mmToPxX(CHOICE_X_MM[chosen-1]) - 10);
      cv.putText(out, (chosen === correct) ? "O" : "X", new cv.Point(xM, y), font, fontScale, (chosen === correct) ? BLUE : RED, thickness);
    }
  }

  // SA: 정답 있는 항목만 O/X (번호칸 근처)
  for(let i=0;i<10;i++){
    const expected = normalizeAnswer(saKey[i]);
    if(!expected) continue;

    const got = normalizeAnswer(saResults[i]?.textNorm ?? null);
    const ok = (got != null && got === expected);

    const x = Math.round(mmToPxX(TABLE_X0_MM + 4));
    const y = Math.round(mmToPxY(saRowCenterYTopMm(i)) + 6);

    cv.putText(out, ok ? "O" : "X", new cv.Point(x, y), font, fontScale, ok ? BLUE : RED, thickness);
  }

  const canvas = document.createElement("canvas");
  canvas.width = out.cols;
  canvas.height = out.rows;
  const ctx = canvas.getContext("2d");
  const imgData = new ImageData(new Uint8ClampedArray(out.data), out.cols, out.rows);
  ctx.putImageData(imgData, 0, 0);

  out.delete();
  return canvas.toDataURL("image/png");
}

// ---- grade one ----
async function gradeOne(matRgba){
  const gray = new cv.Mat();
  cv.cvtColor(matRgba, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(3,3), 0);

  const markers = detectRingMarkers(gray);
  if(!markers){
    gray.delete();
    return { status: "FAILED_MARKER" };
  }

  const warped = warpToA4(gray, markers);
  gray.delete();

  // 1) MC detect
  const mcDetectedChoices = Array(30).fill(null);
  for(let q=1;q<=30;q++){
    const scores = [];
    for(let c=1;c<=5;c++){
      const rect = getMcRoiRectPx(q,c);
      const roi = warped.roi(rect);
      const s = fillScore(roi);
      roi.delete();
      scores.push(s);
    }

    if(scores.every(v => v < TH_BLANK)){
      mcDetectedChoices[q-1] = null;
      continue;
    }

    let bestIdx = 0;
    for(let i=1;i<5;i++) if(scores[i] > scores[bestIdx]) bestIdx = i;
    mcDetectedChoices[q-1] = bestIdx + 1;
  }

  // 2) SA OCR
  const saResults = [];
  for(let i=0;i<10;i++){
    const rectMm = saAnswerRectTopMm(i);
    const x = Math.round(mmToPxX(rectMm.x0));
    const y = Math.round(mmToPxY(rectMm.y0));
    const w = Math.round(mmToPxX(rectMm.x1 - rectMm.x0));
    const h = Math.round(mmToPxY(rectMm.y1 - rectMm.y0));

    const roiRect = new cv.Rect(
      Math.max(0, x),
      Math.max(0, y),
      Math.max(1, Math.min(WARP_W - x, w)),
      Math.max(1, Math.min(WARP_H - y, h))
    );

    const roi = warped.roi(roiRect);
    const pre = preprocessForOCR(roi);
    roi.delete();

    const canvas = matToCanvas(pre);
    pre.delete();

    const o = await ocrOneCanvas(canvas);

    // raw cleanup + vertical fraction fix
    const raw0 = (o.text || "").trim();
    const raw1 = raw0
      .replace(/\s+/g, " ")
      .replace(/O/g, "0")
      .replace(/I/g, "1")
      .replace(/l/g, "1");

    const fixed = fixVerticalFraction(raw1);
    const norm = normalizeAnswer(fixed);

    saResults.push({
      idx: i+1,
      rawText: raw1,
      fixedText: fixed,
      textNorm: norm,
      conf: o.conf
    });
  }

  // 3) scoring
  let mcTotalKeyed = 0, mcCorrect = 0, mcWrong = 0;
  for(let i=0;i<30;i++){
    if(mcKey[i] == null) continue;
    mcTotalKeyed++;
    const chosen = mcDetectedChoices[i];
    if(chosen == null) continue;
    if(chosen === mcKey[i]) mcCorrect++;
    else mcWrong++;
  }

  let saTotalKeyed = 0, saCorrect = 0, saWrong = 0;
  for(let i=0;i<10;i++){
    const expected = normalizeAnswer(saKey[i]);
    if(!expected) continue;
    saTotalKeyed++;

    const got = saResults[i].textNorm;
    if(got != null && got === expected) saCorrect++;
    else saWrong++;
  }

  // 4) annotate
  const annotatedDataUrl = annotateAllOnWarped(warped, mcDetectedChoices, saResults);
  warped.delete();

  return {
    status: "GRADED",
    mc: { totalKeyed: mcTotalKeyed, correct: mcCorrect, wrong: mcWrong },
    sa: { totalKeyed: saTotalKeyed, correct: saCorrect, wrong: saWrong, details: saResults },
    annotatedDataUrl
  };
}

// ---- download ----
function downloadDataUrl(filename, dataUrl){
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---- UI wiring ----
document.addEventListener("DOMContentLoaded", () => {
  loadAnswerKey();

  document.getElementById("reloadKeyBtn").addEventListener("click", () => {
    loadAnswerKey();
    alert("정답을 다시 불러왔습니다.");
  });

  document.getElementById("gradeBtn").addEventListener("click", async () => {
    loadAnswerKey();

    const files = document.getElementById("files").files;
    if(!files.length){
      alert("사진을 업로드해줘.");
      return;
    }

    const resultsBox = document.getElementById("results");
    resultsBox.innerHTML = "";

    for(const f of files){
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<div class="result-title">${f.name}</div><div class="small">처리 중…(OCR 포함)</div>`;
      resultsBox.appendChild(card);

      const img = await fileToImage(f);
      const resizedCanvas = drawImageResizedToCanvas(img, RESIZE_LONG_EDGE);
      const mat = canvasToMatRGBA(resizedCanvas);

      const r = await gradeOne(mat);
      mat.delete();

      if(r.status !== "GRADED"){
        card.innerHTML = `
          <div class="result-title">${f.name} <span class="pill bad">FAILED</span></div>
          <div class="small">마커 인식 실패(각도/반사/마커 훼손/해상도 확인)</div>
        `;
        continue;
      }

      const saItemsHtml = r.sa.details.map(d => {
        const expected = normalizeAnswer(saKey[d.idx-1]);
        const ok = expected && d.textNorm === expected;
        return `
          <div class="sa-item">
            <div><b>${d.idx}</b>
              <span class="${ok ? "good":"badTxt"}">${ok ? "O":"X"}</span>
              <span class="small muted">conf: ${d.conf ?? "-"}</span>
            </div>
            <div class="small">정답: <span class="mono">${expected ?? "-"}</span></div>
            <div class="small">OCR raw: <span class="mono">${d.rawText || "-"}</span></div>
            <div class="small">보정: <span class="mono">${d.fixedText || "-"}</span></div>
            <div class="small">정규화: <span class="mono">${d.textNorm ?? "-"}</span></div>
          </div>
        `;
      }).join("");

      card.innerHTML = `
        <div class="result-title">${f.name} <span class="pill ok">GRADED</span></div>

        <div class="small">
          객관식: <b>${r.mc.correct}</b> / ${r.mc.totalKeyed} <span class="muted">(오답 ${r.mc.wrong})</span><br/>
          주관식(OCR): <b>${r.sa.correct}</b> / ${r.sa.totalKeyed} <span class="muted">(오답 ${r.sa.wrong})</span>
        </div>

        <div class="small muted" style="margin-top:6px;">
          분수는 가급적 <span class="mono">1/5</span>로 작성(세로 분수 일부 자동 보정)
        </div>

        ${r.annotatedDataUrl ? `<img src="${r.annotatedDataUrl}" alt="annotated">` : ""}

        <div class="row" style="margin-top:10px;">
          <button class="dlBtn">표기 이미지 다운로드</button>
        </div>

        <div class="small" style="margin-top:10px;"><b>주관식 OCR 결과</b> (1~10)</div>
        <div class="sa-grid">${saItemsHtml}</div>
      `;

      card.querySelector(".dlBtn").addEventListener("click", () => {
        const base = f.name.replace(/\.[^.]+$/, "");
        downloadDataUrl(`${base}_graded_ocr.png`, r.annotatedDataUrl);
      });
    }
  });
});
