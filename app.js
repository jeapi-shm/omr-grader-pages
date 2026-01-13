// ============================

// Config (템플릿 고정값, mm 기준)

// ============================



// A4 mm

const A4_W_MM = 210;

const A4_H_MM = 297;



// 템플릿 생성 규격(너가 만든 PDF와 동일한 가정)

const MARGIN_MM = 10;

const HEADER_H_MM = 30;

const ROW_GAP_MM = 8;



// 마커(코너 링) 위치: outer 10mm, offset 12mm → center = 12+5 = 17mm

const MARKER_CENTER_OFFSET_MM = 17;



// 버블 중심 x (PDF 기준): margin + [40,47,54,61,68]mm → 10+.. = [50,57,64,71,78]

const CHOICE_X_MM = [50, 57, 64, 71, 78];



// 버블 중심 y(상단 기준) 계산:

// PDF에서 bubble center from top = 38 + 8*i (i=1..25)  (이전 설계와 일치)

function qCenterYmm(qIdx1based){

  return 38 + (ROW_GAP_MM * qIdx1based);

}



// ROI 반쪽 크기(mm) (버블+덧칠 포함)

const ROI_HALF_MM = 4.0; // 8mm 박스(충분히 안정)



// 채움 판정 임계값 (샘플 사진 기���으로 시작점)

const TH_SELECT = 0.55;     // 선택으로 인정

const TH_BLANK  = 0.18;     // 무응답

const TH_REVIEW_LOW  = 0.35; // 애매(검토)

const TH_REVIEW_HIGH = 0.55; // 애매(검토) 상한(=선택임계)



const RESIZE_LONG_EDGE = 1800;  // 갤럭시 사진 브라우저 처리 안정값

const WARP_H = 1800;            // 정렬 이미지 높이(px)

const WARP_W = Math.round(WARP_H * (A4_W_MM / A4_H_MM)); // A4 비율



// ============================

// UI state

// ============================

let answerKey = Array(25).fill(1);

let allResults = []; // 누적 요약/CSV



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

      if(answerKey[i] === v) b.style.fontWeight = "800";

      b.onclick = () => { answerKey[i] = v; renderAnswers(); };

      div.appendChild(b);

    }

    grid.appendChild(div);

  }

}

renderAnswers();



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

// Helpers: file->image, resize, image->Mat

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

// Core: marker detection (ring marker)

// ============================



function detectRingMarkers(gray /*cv.Mat*/){

  // 1) threshold: black becomes white (INV)

  const th = new cv.Mat();

  cv.threshold(gray, th, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);



  // 2) find contours

  const contours = new cv.MatVector();

  const hierarchy = new cv.Mat();

  cv.findContours(th, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);



  const candidates = [];

  for(let i=0;i<contours.size();i++){

    const cnt = contours.get(i);



    const rect = cv.boundingRect(cnt);

    const area = rect.width * rect.height;

    if(area < (gray.cols * gray.rows) * 0.0005) { // 너무 작은 건 제외

      cnt.delete();

      continue;

    }



    const ratio = rect.width / rect.height;

    if(ratio < 0.80 || ratio > 1.20) {

      cnt.delete();

      continue;

    }



    // contour를 4각형으로 근사

    const peri = cv.arcLength(cnt, true);

    const approx = new cv.Mat();

    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);



    if(approx.rows < 4 || approx.rows > 8){

      approx.delete(); cnt.delete();

      continue;

    }



    // 내부 흰 영역 체크(링 마커인지)

    // rect 내부의 중앙 사각형 평균이 "밝아야" 함 (흰색)

    const x = rect.x, y = rect.y, w = rect.width, h = rect.height;

    const cx1 = Math.round(x + w*0.25), cy1 = Math.round(y + h*0.25);

    const cw  = Math.round(w*0.5),  ch  = Math.round(h*0.5);



    if(cx1 < 0 || cy1 < 0 || cx1+cw >= gray.cols || cy1+ch >= gray.rows){

      approx.delete(); cnt.delete();

      continue;

    }



    const innerRoi = gray.roi(new cv.Rect(cx1, cy1, cw, ch));

    const mean = cv.mean(innerRoi)[0];

    innerRoi.delete();



    // mean이 높으면(밝으면) 내부가 흰 영역일 가능성↑

    if(mean < 170) { // 샘플 기준 시작점(필요시 150~200 조정)

      approx.delete(); cnt.delete();

      continue;

    }



    const cx = x + w/2;

    const cy = y + h/2;

    candidates.push({cx, cy, rect, area});

    approx.delete(); cnt.delete();

  }



  contours.delete(); hierarchy.delete(); th.delete();



  if(candidates.length < 4) return null;



  // 상위 4개만 고르기(면적 큰 순)

  candidates.sort((a,b)=>b.area-a.area);

  const top = candidates.slice(0, 6); // 혹시 잡음 있으면 6개에서 코너 선택



  // 코너 4개 선정: (cx+cy), (cx-cy) 이용

  // TL 최소(cx+cy), BR 최대(cx+cy), TR 최대(cx-cy), BL 최소(cx-cy)

  const tl = top.reduce((best, p)=> (p.cx+p.cy < best.cx+best.cy ? p : best), top[0]);

  const br = top.reduce((best, p)=> (p.cx+p.cy > best.cx+best.cy ? p : best), top[0]);

  const tr = top.reduce((best, p)=> (p.cx-p.cy > best.cx-best.cy ? p : best), top[0]);

  const bl = top.reduce((best, p)=> (p.cx-p.cy < best.cx-best.cy ? p : best), top[0]);



  // 중복 방지(같은 점이 여러 역할이면 실패로 처리)

  const uniq = new Set([tl, tr, bl, br].map(o => `${Math.round(o.cx)}_${Math.round(o.cy)}`));

  if(uniq.size !== 4) return null;



  return {tl, tr, bl, br};

}



// ============================

// Core: warp perspective using marker centers

// ============================



function mmToPxX(mm){ return mm * (WARP_W / A4_W_MM); }

function mmToPxY(mm){ return mm * (WARP_H / A4_H_MM); }



function warpToA4(gray, markers){

  // src points: marker centers in the photo

  const src = cv.matFromArray(4, 1, cv.CV_32FC2, [

    markers.tl.cx, markers.tl.cy,

    markers.tr.cx, markers.tr.cy,

    markers.bl.cx, markers.bl.cy,

    markers.br.cx, markers.br.cy,

  ]);



  // dst points: marker centers in canonical A4 image

  const dst = cv.matFromArray(4, 1, cv.CV_32FC2, [

    mmToPxX(MARKER_CENTER_OFFSET_MM), mmToPxY(MARKER_CENTER_OFFSET_MM),

    mmToPxX(A4_W_MM - MARKER_CENTER_OFFSET_MM), mmToPxY(MARKER_CENTER_OFFSET_MM),

    mmToPxX(MARKER_CENTER_OFFSET_MM), mmToPxY(A4_H_MM - MARKER_CENTER_OFFSET_MM),

    mmToPxX(A4_W_MM - MARKER_CENTER_OFFSET_MM), mmToPxY(A4_H_MM - MARKER_CENTER_OFFSET_MM),

  ]);



  const M = cv.getPerspectiveTransform(src, dst);



  const warped = new cv.Mat();

  const dsize = new cv.Size(WARP_W, WARP_H);

  cv.warpPerspective(gray, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_REPLICATE);



  src.delete(); dst.delete(); M.delete();

  return warped;

}



// ============================

// Core: ROI and fill score

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

  // Adaptive threshold로 “어두운(연필)” 비율 계산

  const th = new cv.Mat();

  cv.adaptiveThreshold(grayRoi, th, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, 21, 7);



  // 중앙만 더 보수적으로 보고 싶으면(옵션): 마스크로 원형/중앙 사각만 계산 가능

  // MVP는 전체 ROI 평균으로 충분히 동작함.

  const mean = cv.mean(th)[0] / 255.0; // 0..1

  th.delete();

  return mean;

}



// ============================

// Debug draw: show warped + ROI overlay

// ============================



function drawDebug(warpedGray, answersDetected){

  const canvas = document.getElementById("debugCanvas");

  canvas.width = WARP_W;

  canvas.height = WARP_H;

  const ctx = canvas.getContext("2d");



  // gray -> ImageData

  const rgba = new cv.Mat();

  cv.cvtColor(warpedGray, rgba, cv.COLOR_GRAY2RGBA);



  const imgData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);

  ctx.putImageData(imgData, 0, 0);



  rgba.delete();



  // ROI overlay

  ctx.lineWidth = 2;

  for(let q=1;q<=25;q++){

    for(let c=1;c<=5;c++){

      const r = getRoiRectPx(q,c);

      ctx.strokeStyle = "rgba(0,0,0,0.08)";

      ctx.strokeRect(r.x, r.y, r.width, r.height);

    }

  }



  // detected highlight

  if(answersDetected){

    for(let q=1;q<=25;q++){

      const d = answersDetected[q-1];

      if(d && d.choice){

        const r = getRoiRectPx(q, d.choice);

        ctx.strokeStyle = d.flag === "CONFIDENT" ? "rgba(0,180,120,0.9)" : "rgba(255,140,0,0.9)";

        ctx.strokeRect(r.x, r.y, r.width, r.height);

      }

    }

  }

}



// ============================

// Grade one image (Mat RGBA input)

// ============================



function gradeOne(matRgba, answerKey){

  // 1) RGBA -> GRAY

  const gray = new cv.Mat();

  cv.cvtColor(matRgba, gray, cv.COLOR_RGBA2GRAY);



  // 2) light preprocess

  cv.GaussianBlur(gray, gray, new cv.Size(3,3), 0);



  // 3) detect markers

  const markers = detectRingMarkers(gray);

  if(!markers){

    gray.delete();

    return {

      status: "FAILED_MARKER",

      score: null,

      needsReview: true,

      reason: "마커 4개를 찾지 못함(잘림/흐림/너무 어두움)",

      detected: null

    };

  }



  // 4) warp to A4 canonical

  const warped = warpToA4(gray, markers);

  gray.delete();



  // 5) bubble scores

  const detected = []; // per question: {choice, scores[5], flag}

  let needsReview = false;

  let score = 0;

  let wrong = 0;



  for(let q=1;q<=25;q++){

    const scores = [];

    for(let c=1;c<=5;c++){

      const rect = getRoiRectPx(q,c);

      const roi = warped.roi(rect);

      const s = fillScore(roi);

      roi.delete();

      scores.push(s);

    }



    // pick best

    let bestIdx = 0;

    for(let i=1;i<5;i++) if(scores[i] > scores[bestIdx]) bestIdx = i;

    const bestScore = scores[bestIdx];



    // count how many exceed select threshold

    const over = scores.filter(v => v >= TH_SELECT).length;



    let flag = "CONFIDENT";

    let choice = null;



    if(scores.every(v => v < TH_BLANK)){

      flag = "BLANK";

      choice = null;

      needsReview = true;

    } else if(over >= 2){

      flag = "MULTI";

      choice = null;

      needsReview = true;

    } else if(bestScore >= TH_SELECT){

      flag = "CONFIDENT";

      choice = bestIdx + 1;

    } else if(bestScore >= TH_REVIEW_LOW && bestScore < TH_REVIEW_HIGH){

      flag = "REVIEW";

      choice = bestIdx + 1; // “가장 유력”만 제시, UI에서 검토

      needsReview = true;

    } else {

      // 그 외: 약하게 찍힌 경우

      flag = "REVIEW";

      choice = bestIdx + 1;

      needsReview = true;

    }



    detected.push({ choice, scores, flag });



    // grading

    const correct = answerKey[q-1];

    if(choice === null){

      // blank/multi -> 0점(정책은 바꿀 수 있음)

    } else if(choice === correct){

      score += 1;

    } else {

      wrong += 1;

    }

  }



  warped.delete();



  return {

    status: needsReview ? "NEEDS_REVIEW" : "GRADED",

    score,

    wrong,

    needsReview,

    detected

  };

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



  // 문항별 정답률 (detected가 있을 때만)

  const correctCnt = Array(25).fill(0);

  const totalCnt = Array(25).fill(0);



  for(const r of ok){

    if(!r.detected) continue;

    for(let i=0;i<25;i++){

      const d = r.detected[i];

      if(!d) continue;

      const chosen = d.choice;

      if(chosen == null) continue;

      totalCnt[i] += 1;

      if(chosen === answerKey[i]) correctCnt[i] += 1;

    }

  }



  const correctRate = correctCnt.map((c,i)=>{

    const t = totalCnt[i];

    return t ? (c/t) : null;

  });



  // 상태 집계

  const statusCount = results.reduce((acc, r) => {

    acc[r.status] = (acc[r.status]||0)+1;

    return acc;

  }, {});



  return { statusCount, n, avg, min, max, correctRate };

}



function toCSV(results){

  // 파일명,점수,상태,Q1..Q25

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



    const r = gradeOne(mat, answerKey);

    mat.delete();



    r.filename = f.name;

    allResults.push(r);



    const statusLabel = r.status === "GRADED"

      ? `<span class="ok">GRADED</span>`

      : (r.status === "NEEDS_REVIEW" ? `<span style="color:#f60;font-weight:800">NEEDS_REVIEW</span>` : `<span class="bad">${r.status}</span>`);



    card.innerHTML = `

      <div><b>${f.name}</b> — ${statusLabel}</div>

      <div class="small">score: ${r.score ?? "-"} / wrong: ${r.wrong ?? "-"}</div>

      ${r.reason ? `<div class="small bad">reason: ${r.reason}</div>` : ""}

    `;



    // 디버그: 마지막 처리된 것만 보여줌(느려지는 것 방지)

    if(r.detected && (r.status === "GRADED" || r.status === "NEEDS_REVIEW")){

      // 다시 워프해서 디버그 그리기(간단 MVP라 재계산)

      // 성능이 아쉬우면 gradeOne에서 warped를 반환하도록 구조 변경하면 됨.

      // 여기서는 최소 구현을 위해 생략하고 "검토용 오버레이"만 표시하지 않음.

      // => 대신 gradeOne 내부에서 warped를 drawDebug로 넘기는 형태로 바꾸면 됨.

    }

  }



  const summary = buildSummary(allResults);

  document.getElementById("summary").textContent = JSON.stringify(summary, null, 2);

};



document.getElementById("downloadCsvBtn").onclick = () => {

  const csv = toCSV(allResults);

  downloadText("omr_results.csv", csv);

};



// (선택) 디버그 캔버스: 실제로 보고 싶으면 gradeOne을 약간 수정해서 warped를 전달해야 함.

// 지금은 MVP 성능/단순성을 위해 결과만 출력.

