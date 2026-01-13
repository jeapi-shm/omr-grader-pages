let answerKey = Array(25).fill(1);
let allResults = []; // 누적(요약용)

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
      if(answerKey[i] === v) b.style.fontWeight = "700";
      b.onclick = () => { answerKey[i] = v; renderAnswers(); };
      div.appendChild(b);
    }
    grid.appendChild(div);
  }
}
renderAnswers();

// OpenCV 로딩 체크
function waitForOpenCV(){
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (typeof cv !== "undefined" && cv.Mat) {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

(async () => {
  await waitForOpenCV();
  document.getElementById("cvStatus").textContent = "OpenCV 로딩 완료 ✅";
  document.getElementById("gradeBtn").disabled = false;
})();

// 이미지 파일 -> HTMLImageElement
function fileToImage(file){
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = reject;
    img.src = url;
  });
}

// HTMLImageElement -> cv.Mat (BGR)
function imageToMat(img){
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return cv.matFromImageData(imgData); // RGBA
}

// TODO: 여기부터 핵심(마커 검출/정렬/ROI/��점)
function gradeMat(matRgba, answerKey){
  // 1) RGBA -> GRAY
  const gray = new cv.Mat();
  cv.cvtColor(matRgba, gray, cv.COLOR_RGBA2GRAY);

  // 2) 전처리(가볍게)
  cv.GaussianBlur(gray, gray, new cv.Size(3,3), 0);

  // 3) 마커 검출 → 원근보정 (TODO)
  // 4) ROI(25x5) 채움률 계산 (TODO)
  // 5) 채점 (TODO)

  gray.delete();
  return {
    status: "TODO",
    score: null,
    detected: null,
    needsReview: true,
    reviewItems: ["alignment/roi 미구현"]
  };
}

function updateSummary(){
  const summary = allResults.reduce((acc, r) => {
    acc[r.status] = (acc[r.status]||0)+1;
    return acc;
  }, {});
  document.getElementById("summary").textContent = JSON.stringify(summary, null, 2);
}

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
    const mat = imageToMat(img);

    const r = gradeMat(mat, answerKey);
    mat.delete();

    allResults.push({ filename: f.name, ...r });
    card.textContent = `${f.name} — ${r.status}` + (r.score != null ? ` / score=${r.score}` : "");
  }

  updateSummary();
};
