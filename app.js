// ============================
// OMR 25×5 (O/X/V 표기) - 최소 UI 버전
// ============================

// A4 mm
const A4_W_MM = 210;
const A4_H_MM = 297;

// 템플릿 규격
const ROW_GAP_MM = 8;

// 링 마커: outer 10mm, offset 12mm → center = 12+5 = 17mm
const MARKER_CENTER_OFFSET_MM = 17;

// 보기 버블 중심 X(mm)
const CHOICE_X_MM = [50, 57, 64, 71, 78];

// 문항 버블 중심 Y(mm)
function qCenterYmm(qIdx1based){
  return 38 + (ROW_GAP_MM * qIdx1based);
}

// ROI(mm)
const ROI_HALF_MM = 4.0;

// “애매 제거”: 빈칸만 null 처리
const TH_BLANK  = 0.16;

// 안정 리사이즈
const RESIZE_LONG_EDGE = 1800;

// 워프 크기(px)
const WARP_H = 1800;
const WARP_W = Math.round(WARP_H * (A4_W_MM / A4_H_MM));

// ============================
// UI state
// ============================
let answerKey = Array(25).fill(null);
let answerBlocks = ["", "", "", "", ""];

// ============================
// OpenCV ready
// ============================
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

(async () => {
  await waitForOpenCV();
  document.getElementById("cvStatus").innerHTML = `<span class="ok">OpenCV 로딩 완료 ✅</span>`;
  document.getElementById("gradeBtn").disabled = false;
})();

// ============================
// Answer input (5문항 단위)
// ============================
function isValidBlockText(s){
  if(!s) return true;
  if(s.length !== 5) return false;
  return /^[1-5]{5}$/.test(s);
}

function rebuildAnswerKeyFromBlocks(){
  const key = [];
  let ok = true;

  for(let b=0;b<5;b++){
    const s = (answerBlocks[b] || "").trim();
    if(!s){ ok = false; for(let i=0;i<5;i++) key.push(null); continue; }
    if(!isValidBlockText(s)){ ok = false; for(let i=0;i<5;i++) key.push(null); continue; }
    for(let i=0;i<5;i++) key.push(parseInt(s[i], 10));
  }

  answerKey = key;

  const shown = answerKey.map(v => v == null ? "-" : String(v)).join("");
  document.getElementById("answerKeyText").textContent = shown;
  document.getElementById("answerKeyValid").innerHTML =
    ok ? ` <span class="ok">✅ 입력 완료</span>` : ` <span class="warn">⚠ 미입력/형식 오류 있음</span>`;

  return ok;
}

function renderAnswerBlocks(){
  const host = document.getElementById("answerBlocks");
  host.innerHTML = "";

  const ranges = ["1~5", "6~10", "11~15", "16~20", "21~25"];

  ranges.forEach((label, idx) => {
    const row = document.createElement("div");
    row.className = "answer-block";

    const l = document.createElement("div");
    l.className = "answer-label";
    l.textContent = `${label} :`;
    row.appendChild(l);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "예) 23213";
    input.maxLength = 5;
    input.value = answerBlocks[idx];

    const status = document.createElement("span");
    status.className = "small";

    function refreshStatus(){
      const v = input.value.trim();
      if(!v) status.innerHTML = `<span class="warn">미입력</span>`;
      else if(isValidBlockText(v)) status.innerHTML = `<span class="ok">OK</span>`;
      else status.innerHTML = `<span class="warn">형식오류</span> (5자리, 1~5만)`;
    }

    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^0-9]/g, "").slice(0,5);
      answerBlocks[idx] = input.value.trim();
      refreshStatus();
      rebuildAnswerKeyFromBlocks();
    });

    refreshStatus();

    row.appendChild(input);
    row.appendChild(status);
    host.appendChild(row);
  });

  rebuildAnswerKeyFromBlocks();
}
renderAnswerBlocks();

// ============================
// Image helpers
// ============================
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
  return cv.matFromImageData(imgData); // RGBA
}

// ============================
// Marker detection (ring marker)
// ============================
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

// ============================
// Warp helpers
// ============================
function mmToPxX(mm){ return mm * (WARP_W / A4_W_MM); }
function mmToPxY(mm){ return mm * (WARP_H / A4_H_MM); }

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

// ============================
// ROI + fill score
// ============================
function getRoiRectPx(qIdx1based, choiceIdx1based){
  const xMm = CHOICE_X_MM[choiceIdx1based - 1];
  const yMm = qCenterYmm(qIdx1based);

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

// ============================
// O/X/V annotate (warp 위에 직접 표기)
// ============================
function drawOXVOnWarped(warpedGray, detectedChoices){
  const out = new cv.Mat();
  cv.cvtColor(warpedGray, out, cv.COLOR_GRAY2RGBA);

  const BLUE  = new cv.Scalar(31, 111, 235, 255);
  const RED   = new cv.Scalar(209, 36, 47, 255);
  const GREEN = new cv.Scalar(20, 160, 80, 255);

  const font = cv.FONT_HERSHEY_SIMPLEX;
  const fontScale = 0.9;
  const thickness = 2;

  for(let q=1;q<=25;q++){
    const correct = answerKey[q-1];
    const chosen = detectedChoices[q-1];

    const y = Math.round(mmToPxY(qCenterYmm(q)) + 6);

    if(correct != null){
      const xV = Math.round(mmToPxX(CHOICE_X_MM[correct-1]) - 8);
      cv.putText(out, "V", new cv.Point(xV, y), font, fontScale, GREEN, thickness);
    }

    if(chosen != null){
      const isCorrect = (correct != null) ? (chosen === correct) : false;
      const xM = Math.round(mmToPxX(CHOICE_X_MM[chosen-1]) - 10);
      cv.putText(out, isCorrect ? "O" : "X", new cv.Point(xM, y), font, fontScale, isCorrect ? BLUE : RED, thickness);
    }
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

// ============================
// grade one (애매 없음)
// ============================
function gradeOne(matRgba){
  const gray = new cv.Mat();
  cv.cvtColor(matRgba, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(3,3), 0);

  const markers = detectRingMarkers(gray);
  if(!markers){
    gray.delete();
    return { status: "FAILED_MARKER", score: null, wrong: null, annotatedDataUrl: null };
  }

  const warped = warpToA4(gray, markers);
  gray.delete();

  const detectedChoices = Array(25).fill(null);

  for(let q=1;q<=25;q++){
    const scores = [];
    for(let c=1;c<=5;c++){
      const rect = getRoiRectPx(q,c);
      const roi = warped.roi(rect);
      const s = fillScore(roi);
      roi.delete();
      scores.push(s);
    }

    if(scores.every(v => v < TH_BLANK)){
      detectedChoices[q-1] = null;
      continue;
    }

    let bestIdx = 0;
    for(let i=1;i<5;i++) if(scores[i] > scores[bestIdx]) bestIdx = i;
    detectedChoices[q-1] = bestIdx + 1;
  }

  const keyReady = answerKey.every(v => v != null);
  let score = null, wrong = null;
  if(keyReady){
    score = 0; wrong = 0;
    for(let i=0;i<25;i++){
      const c = detectedChoices[i];
      if(c == null) continue;
      if(c === answerKey[i]) score++;
      else wrong++;
    }
  }

  const annotatedDataUrl = drawOXVOnWarped(warped, detectedChoices);
  warped.delete();

  return { status: "GRADED", score, wrong, annotatedDataUrl };
}

// ============================
// download helper
// ============================
function downloadDataUrl(filename, dataUrl){
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ============================
// Wire UI
// ============================
document.getElementById("gradeBtn").onclick = async () => {
  rebuildAnswerKeyFromBlocks();

  const files = document.getElementById("files").files;
  if(!files.length) return;

  const resultsBox = document.getElementById("results");
  resultsBox.innerHTML = "";

  for(const f of files){
    const card = document.createElement("div");
    card.className = "card";
    card.textContent = `${f.name} 처리 중…`;
    resultsBox.appendChild(card);

    const img = await fileToImage(f);
    const resizedCanvas = drawImageResizedToCanvas(img, RESIZE_LONG_EDGE);
    const mat = canvasToMatRGBA(resizedCanvas);

    const r = gradeOne(mat);
    mat.delete();

    if(r.status !== "GRADED"){
      card.innerHTML = `
        <div><b>${f.name}</b> — <span class="pill pill-bad">FAILED</span></div>
        <div class="small">마커 인식 실패(사진 각도/빛 반사/마커 훼손 확인)</div>
      `;
      continue;
    }

    card.innerHTML = `
      <div><b>${f.name}</b> — <span class="pill pill-ok">GRADED</span></div>
      <div class="small">score: <b>${r.score ?? "-"}</b> / wrong: <b>${r.wrong ?? "-"}</b></div>
      <div class="small">표기: 학생답 O(정답)/X(오답), 정답 위치 V</div>
      ${r.annotatedDataUrl ? `<img src="${r.annotatedDataUrl}" alt="annotated">` : ""}
      <div style="margin-top:8px;">
        <button class="dlImg">표기된 이미지 다운로드</button>
      </div>
    `;

    card.querySelector(".dlImg").onclick = () => {
      const base = f.name.replace(/\.[^.]+$/, "");
      downloadDataUrl(`${base}_OXV.png`, r.annotatedDataUrl);
    };
  }
};
