// ============================
// 템플릿/판독 설정 (OMR 25문항 템플릿 기준)
// ============================

// A4 mm
const A4_W_MM = 210;
const A4_H_MM = 297;

// 템플릿 규격
const ROW_GAP_MM = 8;

// 링 마커: outer 10mm, offset 12mm → center = 12+5 = 17mm
const MARKER_CENTER_OFFSET_MM = 17;

// 보기 버블 중심 X(mm): margin(10) + [40,47,54,61,68] = [50,57,64,71,78]
const CHOICE_X_MM = [50, 57, 64, 71, 78];

// 문항 버블 중심 Y(mm): top에서 38mm + 8mm*q
function qCenterYmm(qIdx1based){
  return 38 + (ROW_GAP_MM * qIdx1based);
}

// ROI 크기 (mm)
const ROI_HALF_MM = 4.0;

// “리뷰 캡처”는 한 문항의 1~5 전체를 보여줘야 하므로 폭을 넉넉히
const ROW_CROP_PAD_MM_X = 6.0;
const ROW_CROP_PAD_MM_Y = 5.0;

// 채움 임계값
const TH_SELECT = 0.55;
const TH_BLANK  = 0.18;
const TH_REVIEW_LOW  = 0.35;

// 갤���시 고해상도 사진 대비: 브라우저 처리 안정 리사이즈
const RESIZE_LONG_EDGE = 1800;

// 정렬(원근보정) 결과 크기(px)
const WARP_H = 1800;
const WARP_W = Math.round(WARP_H * (A4_W_MM / A4_H_MM));

// ============================
// UI state
// ============================
let answerKey = Array(25).fill(1);
let allResults = []; // 누적 요약/CSV

// ============================
// UI Helpers
// ============================
function renderAnswers(){
  const grid = document.getElementById("answerGrid");
  grid.innerHTML = "";
  for(let i=0;i<25;i++){
    const div = document.createElement("div");
    div.className = "row";
    div.innerHTML = `<b>${i+1}.</b> `;
    for(let v=1; v<=5; v++){
      const b = document.createElement("button");
      b.textContent = v;
      if(answerKey[i] === v) b.style.fontWeight = "900";
      b.onclick = () => { answerKey[i] = v; renderAnswers(); updateSummaryPanel(); };
      div.appendChild(b);
    }
    grid.appendChild(div);
  }
}
renderAnswers();

function pill(status){
  if(status === "GRADED") return `<span class="pill pill-ok">GRADED</span>`;
  if(status === "NEEDS_REVIEW") return `<span class="pill pill-warn">NEEDS_REVIEW</span>`;
  return `<span class="pill pill-bad">${status}</span>`;
}

function setDebugText(lines){
  const el = document.getElementById("debugText");
  if(!el) return;
  el.innerHTML = lines.map(s => `<div>${s}</div>`).join("");
}

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
// File/Image helpers
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
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

function canvasToMatRGBA(canvas){
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return cv.matFromImageData(imgData); // RGBA
}

// ============================
// Debug drawing (마커 후보/선택 표시)
// ============================
function drawMarkersOnCanvas(srcGray, candidates, picked){
  const canvas = document.getElementById("markerCanvas");
  if(!canvas) return;

  const maxW = 520;
  const scale = Math.min(1, maxW / srcGray.cols);
  canvas.width = Math.round(srcGray.cols * scale);
  canvas.height = Math.round(srcGray.rows * scale);

  const ctx = canvas.getContext("2d");

  const rgba = new cv.Mat();
  cv.cvtColor(srcGray, rgba, cv.COLOR_GRAY2RGBA);
  const imgData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);

  const tmp = document.createElement("canvas");
  tmp.width = rgba.cols;
  tmp.height = rgba.rows;
  tmp.getContext("2d").putImageData(imgData, 0, 0);

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  rgba.delete();

  // 후보(파란 박스)
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,120,255,0.85)";
  for(const p of (candidates || [])){
    const r = p.rect;
    ctx.strokeRect(r.x*scale, r.y*scale, r.width*scale, r.height*scale);
  }

  // 선택된 코너(TL/TR/BL/BR)
  if(picked){
    const map = [
      ["TL", picked.tl, "rgba(0,180,120,0.95)"],
      ["TR", picked.tr, "rgba(0,180,120,0.95)"],
      ["BL", picked.bl, "rgba(0,180,120,0.95)"],
      ["BR", picked.br, "rgba(0,180,120,0.95)"],
    ];
    for(const [label, p, color] of map){
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.cx*scale, p.cy*scale, 10, 0, Math.PI*2);
      ctx.stroke();

      ctx.font = "14px system-ui";
      ctx.fillText(label, p.cx*scale + 12, p.cy*scale - 12);
    }
  }
}

// ============================
// Core: marker detection (ring marker)
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

    candidates.push({
      cx: x + w/2,
      cy: y + h/2,
      rect,
      area,
      meanInner: Math.round(meanInner),
      meanOuter: Math.round(meanOuter)
    });

    cnt.delete();
  }

  contours.delete(); hierarchy.delete(); th.delete();

  if(candidates.length < 4){
    return { markers: null, candidates, debug: { reason: "candidates<4", count: candidates.length } };
  }

  candidates.sort((a,b)=>b.area-a.area);
  const top = candidates.slice(0, 8);

  const tl = top.reduce((best, p)=> (p.cx+p.cy < best.cx+best.cy ? p : best), top[0]);
  const br = top.reduce((best, p)=> (p.cx+p.cy > best.cx+best.cy ? p : best), top[0]);
  const tr = top.reduce((best, p)=> (p.cx-p.cy > best.cx-best.cy ? p : best), top[0]);
  const bl = top.reduce((best, p)=> (p.cx-p.cy < best.cx-best.cy ? p : best), top[0]);

  const uniq = new Set([tl, tr, bl, br].map(o => `${Math.round(o.cx)}_${Math.round(o.cy)}`));
  if(uniq.size !== 4){
    return { markers: null, candidates, debug: { reason: "duplicate-corners", count: candidates.length } };
  }

  return { markers: {tl, tr, bl, br}, candidates, debug: { reason: "ok", count: candidates.length } };
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

// warpedGray -> dataURL (리뷰 이미지 캡처용)
function warpedToDataURL(warpedGray){
  const rgba = new cv.Mat();
  cv.cvtColor(warpedGray, rgba, cv.COLOR_GRAY2RGBA);

  const canvas = document.createElement("canvas");
  canvas.width = rgba.cols;
  canvas.height = rgba.rows;
  const ctx = canvas.getContext("2d");
  const imgData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);
  ctx.putImageData(imgData, 0, 0);

  rgba.delete();
  return canvas.toDataURL("image/png");
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

// “한 문항(1~5 전체)” 캡처 영역(리뷰 이미지)
function getRowCropRectPx(qIdx1based){
  const yMm = qCenterYmm(qIdx1based);

  const leftMm  = CHOICE_X_MM[0] - ROI_HALF_MM - ROW_CROP_PAD_MM_X;
  const rightMm = CHOICE_X_MM[4] + ROI_HALF_MM + ROW_CROP_PAD_MM_X;

  const topMm    = yMm - ROI_HALF_MM - ROW_CROP_PAD_MM_Y;
  const bottomMm = yMm + ROI_HALF_MM + ROW_CROP_PAD_MM_Y;

  const x1 = Math.max(0, Math.round(mmToPxX(leftMm)));
  const x2 = Math.min(WARP_W-1, Math.round(mmToPxX(rightMm)));
  const y1 = Math.max(0, Math.round(mmToPxY(topMm)));
  const y2 = Math.min(WARP_H-1, Math.round(mmToPxY(bottomMm)));

  return { x: x1, y: y1, w: Math.max(1, x2-x1), h: Math.max(1, y2-y1) };
}

function fillScore(grayRoi){
  const th = new cv.Mat();
  cv.adaptiveThreshold(grayRoi, th, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 7);
  const mean = cv.mean(th)[0] / 255.0;
  th.delete();
  return mean;
}

// ============================
// Grading + manual override (리뷰 수정)
// ============================
function recalcScoreAndStatus(r){
  let score = 0;
  let wrong = 0;
  let needsReview = false;

  for(let i=0;i<25;i++){
    const d = r.detected[i];
    if(!d) continue;

    // 자동 플래그가 남아있으면 아직 리뷰 필요로 봄 (단, MANUAL이면 해결로 간주)
    if(d.flag === "REVIEW" || d.flag === "MULTI" || d.flag === "BLANK") needsReview = true;

    const c = d.choice;
    if(c == null) continue;

    if(c === answerKey[i]) score += 1;
    else wrong += 1;
  }

  r.score = score;
  r.wrong = wrong;
  r.needsReview = needsReview;

  // 리뷰 UI에서 전부 MANUAL로 바꾸면 GRADED로 떨어지게 하고 싶으면 아래를 사용:
  // r.status = needsReview ? "NEEDS_REVIEW" : "GRADED";
  r.status = needsReview ? "NEEDS_REVIEW" : "GRADED";
}

function flagLabel(flag){
  if(flag === "MULTI") return "복수마킹";
  if(flag === "BLANK") return "무응답";
  if(flag === "REVIEW") return "애매";
  if(flag === "MANUAL") return "수정됨";
  return flag;
}

// ============================
// Grade one image
// ============================
function gradeOne(matRgba){
  const gray = new cv.Mat();
  cv.cvtColor(matRgba, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, gray, new cv.Size(3,3), 0);

  const mr = detectRingMarkers(gray);

  const candInfo = (mr.candidates || []).slice(0, 8).map((c, idx) =>
    `cand${idx+1}: area=${Math.round(c.area)} inner=${c.meanInner} outer=${c.meanOuter}`
  );

  setDebugText([
    `reason: <b>${mr.debug.reason}</b>`,
    `candidates: <b>${mr.debug.count}</b>`,
    ...candInfo
  ]);

  drawMarkersOnCanvas(gray, mr.candidates || [], mr.markers || null);

  if(!mr.markers){
    gray.delete();
    return {
      status: "FAILED_MARKER",
      score: null,
      wrong: null,
      needsReview: true,
      reason: `marker fail: ${mr.debug.reason} (candidates=${mr.debug.count})`,
      detected: null,
      warpedDataUrl: null
    };
  }

  const warped = warpToA4(gray, mr.markers);
  gray.delete();

  // 리뷰용: 정렬 이미지 dataURL 저장
  const warpedDataUrl = warpedToDataURL(warped);

  const detected = [];
  let needsReview = false;

  for(let q=1;q<=25;q++){
    const scores = [];
    for(let c=1;c<=5;c++){
      const rect = getRoiRectPx(q,c);
      const roi = warped.roi(rect);
      const s = fillScore(roi);
      roi.delete();
      scores.push(s);
    }

    let bestIdx = 0;
    for(let i=1;i<5;i++) if(scores[i] > scores[bestIdx]) bestIdx = i;
    const bestScore = scores[bestIdx];
    const over = scores.filter(v => v >= TH_SELECT).length;

    let flag = "CONFIDENT";
    let choice = null;

    if(scores.every(v => v < TH_BLANK)){
      flag = "BLANK"; choice = null; needsReview = true;
    } else if(over >= 2){
      flag = "MULTI"; choice = null; needsReview = true;
    } else if(bestScore >= TH_SELECT){
      flag = "CONFIDENT"; choice = bestIdx + 1;
    } else if(bestScore >= TH_REVIEW_LOW){
      flag = "REVIEW"; choice = bestIdx + 1; needsReview = true;
    } else {
      flag = "REVIEW"; choice = bestIdx + 1; needsReview = true;
    }

    detected.push({ choice, scores, flag });
  }

  warped.delete();

  const r = {
    status: needsReview ? "NEEDS_REVIEW" : "GRADED",
    score: 0,
    wrong: 0,
    needsReview,
    reason: null,
    detected,
    warpedDataUrl
  };
  recalcScoreAndStatus(r);
  return r;
}

// ============================
// Review UI (이미지 캡처 + 버튼 수정)
// ============================
function renderReviewUI(result, containerEl, onUpdated){
  // 리뷰 대상 문항만
  const items = result.detected
    .map((d, i) => ({ q: i+1, ...d }))
    .filter(d => d.flag !== "CONFIDENT"); // CONFIDENT 제외

  const wrap = document.createElement("div");
  wrap.className = "review-wrap";
  wrap.innerHTML = `
    <div class="small">
      ⚠ 리뷰 필요 문항: <b>${items.length}</b>개
      <span class="muted">(각 문항 이미지(버블 1~5)를 보고 1~5/무응답 버튼으로 수정)</span>
    </div>
  `;

  if(!result.warpedDataUrl){
    const msg = document.createElement("div");
    msg.className = "small bad";
    msg.textContent = "리뷰 이미지를 만들 수 없습니다(정렬 이미지 없음).";
    wrap.appendChild(msg);
    containerEl.appendChild(wrap);
    return;
  }

  const img = new Image();
  img.src = result.warpedDataUrl;

  img.onload = () => {
    for(const it of items){
      const row = document.createElement("div");
      row.className = "review-item";

      // crop canvas
      const crop = document.createElement("canvas");
      crop.className = "review-crop";

      // 문항 라벨 + 상태
      const left = document.createElement("div");
      left.innerHTML = `
        <div><b>${it.q}번</b> <span class="warn">${flagLabel(it.flag)}</span></div>
        <div class="small muted">현재 선택: <b>${it.choice ?? "-"}</b></div>
      `;

      // 버튼 영역
      const right = document.createElement("div");
      right.className = "review-buttons";

      const btns = [];
      for(let v=1; v<=5; v++){
        const b = document.createElement("button");
        b.textContent = v;
        btns.push({v, b});
        right.appendChild(b);
      }
      const bBlank = document.createElement("button");
      bBlank.textContent = "무응답";
      right.appendChild(bBlank);

      // crop draw
      const rect = getRowCropRectPx(it.q);
      crop.width = rect.w;
      crop.height = rect.h;
      const ctx = crop.getContext("2d");
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

      // 버튼 스타일 업데이트
      function refreshButtons(){
        for(const {v, b} of btns){
          b.style.fontWeight = (result.detected[it.q-1].choice === v) ? "900" : "400";
        }
        bBlank.style.fontWeight = (result.detected[it.q-1].choice == null) ? "900" : "400";

        // 좌측 표시도 업데이트
        left.querySelector(".muted").innerHTML = `현재 선택: <b>${result.detected[it.q-1].choice ?? "-"}</b>`;
      }

      // 클릭 핸들러: choice 설정 + flag MANUAL + 재채점
      for(const {v, b} of btns){
        b.onclick = () => {
          result.detected[it.q-1].choice = v;
          result.detected[it.q-1].flag = "MANUAL"; // 해결 처리
          recalcScoreAndStatus(result);
          refreshButtons();
          onUpdated?.();
        };
      }
      bBlank.onclick = () => {
        result.detected[it.q-1].choice = null;
        result.detected[it.q-1].flag = "MANUAL";
        recalcScoreAndStatus(result);
        refreshButtons();
        onUpdated?.();
      };

      refreshButtons();

      row.appendChild(crop);
      const rightWrap = document.createElement("div");
      rightWrap.appendChild(left);
      rightWrap.appendChild(right);

      row.appendChild(rightWrap);
      wrap.appendChild(row);
    }
  };

  containerEl.appendChild(wrap);
}

// ============================
// Summary + CSV
// ============================
function buildSummary(results){
  const ok = results.filter(r => r.status === "GRADED" || r.status === "NEEDS_REVIEW");
  const scores = ok.map(r => r.score).filter(s => typeof s === "number");
  const n = scores.length;
  const avg = n ? (scores.reduce((a,b)=>a+b,0)/n) : 0;
  const min = n ? Math.min(...scores) : 0;
  const max = n ? Math.max(...scores) : 0;

  const statusCount = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status]||0)+1;
    return acc;
  }, {});

  // 문항별 정답률(선택값 있는 것만)
  const correctCnt = Array(25).fill(0);
  const totalCnt = Array(25).fill(0);

  for(const r of ok){
    if(!r.detected) continue;
    for(let i=0;i<25;i++){
      const d = r.detected[i];
      if(!d || d.choice == null) continue;
      totalCnt[i] += 1;
      if(d.choice === answerKey[i]) correctCnt[i] += 1;
    }
  }

  const correctRate = correctCnt.map((c,i)=>{
    const t = totalCnt[i];
    return t ? Number((c/t).toFixed(3)) : null;
  });

  return { statusCount, n, avg: Number(avg.toFixed(2)), min, max, correctRate };
}

function updateSummaryPanel(){
  const summary = buildSummary(allResults);
  document.getElementById("summary").textContent = JSON.stringify(summary, null, 2);
}

function toCSV(results){
  const header = ["filename","status","score", ...Array.from({length:25},(_,i)=>`Q${i+1}`)];
  const rows = [header];

  for(const r of results){
    const row = [r.filename, r.status, (r.score ?? "")];
    if(r.detected){
      for(let i=0;i<25;i++){
        row.push(r.detected[i]?.choice ?? "");
      }
    } else {
      for(let i=0;i<25;i++) row.push("");
    }
    rows.push(row);
  }

  return rows.map(cols =>
    cols.map(v => {
      const s = String(v ?? "");
      return /[,"\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
    }).join(",")
  ).join("\n");
}

function downloadText(filename, text){
  const blob = new Blob([text], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ============================
// Wire UI
// ============================
document.getElementById("gradeBtn").onclick = async () => {
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

    r.filename = f.name;
    allResults.push(r);

    // 결과 카드 렌더
    card.innerHTML = `
      <div><b>${f.name}</b> — ${pill(r.status)}</div>
      <div class="small">score: <b>${r.score ?? "-"}</b> / wrong: <b>${r.wrong ?? "-"}</b></div>
      ${r.reason ? `<div class="small"><span class="bad">reason:</span> ${r.reason}</div>` : ""}
    `;

    // 리뷰 UI(NEEDS_REVIEW인 경우만)
    if(r.status === "NEEDS_REVIEW" && r.detected){
      const reviewHost = document.createElement("div");
      card.appendChild(reviewHost);

      renderReviewUI(r, reviewHost, () => {
        // 수정 후 카드 상단 상태/점수 갱신
        card.querySelector(".small").innerHTML =
          `score: <b>${r.score ?? "-"}</b> / wrong: <b>${r.wrong ?? "-"}</b>`;
        card.querySelector("div").innerHTML =
          `<b>${f.name}</b> — ${pill(r.status)}`;

        updateSummaryPanel();
      });
    }

    updateSummaryPanel();
  }
};

document.getElementById("downloadCsvBtn").onclick = () => {
  const csv = toCSV(allResults);
  downloadText("omr_results.csv", csv);
};
