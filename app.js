// ============================
// 1단계: 정답 입력 UI (MC 30 + SA 10)
// ============================

const MC_Q = 30;
const SA_Q = 10;

// 상태
let mcKey = Array(MC_Q).fill(null); // 1~5 or null
let saKey = Array(SA_Q).fill(null); // string or null

// MC 입력 블록(5문항씩 6개)
const mcBlocks = Array(6).fill(""); // each is 0~5 chars

// SA 입력(문항별)
const saInputs = Array(SA_Q).fill("");

// localStorage key
const LS_KEY = "omr_answer_key_v1";

// ---------- Validation ----------
function sanitizeMCBlock(raw){
  // only digits 1-5, max 5
  const s = (raw || "").replace(/[^1-5]/g, "").slice(0, 5);
  return s;
}

// 허용: 정수, 소수(1.23), 분수(1/3), + 간단한 공백 제거
// - 음수는 일단 불허(원하면 허용 가능)
function sanitizeSA(raw){
  const s = (raw || "").trim().replace(/\s+/g, "");
  return s;
}
function isValidSA(s){
  if(!s) return true; // empty allowed
  // integer: 123
  if(/^\d+$/.test(s)) return true;
  // decimal: 12.34 (앞뒤 최소 1자리)
  if(/^\d+\.\d+$/.test(s)) return true;
  // fraction: 1/3 (0 허용은 일단 허용)
  if(/^\d+\/\d+$/.test(s)) return true;
  return false;
}

// ---------- State rebuild ----------
function rebuildMCKey(){
  const out = [];
  for(let b=0;b<6;b++){
    const s = mcBlocks[b];
    for(let i=0;i<5;i++){
      const ch = s[i];
      out.push(ch ? parseInt(ch, 10) : null);
    }
  }
  mcKey = out.slice(0, MC_Q);
}

function rebuildSAKey(){
  const out = [];
  for(let i=0;i<SA_Q;i++){
    const s = sanitizeSA(saInputs[i]);
    out.push(s ? s : null);
  }
  saKey = out;
}

function updateUI(){
  rebuildMCKey();
  rebuildSAKey();

  // MC key text
  const mcText = mcKey.map(v => v == null ? "-" : String(v)).join("");
  document.getElementById("mcKeyText").textContent = mcText;

  // MC status: "완성"은 30개 모두 채웠을 때만
  const mcFilled = mcKey.filter(v => v != null).length;
  const mcStatus = document.getElementById("mcStatus");
  if(mcFilled === 0) {
    mcStatus.className = "pill warn";
    mcStatus.textContent = "미입력";
  } else if(mcFilled < MC_Q) {
    mcStatus.className = "pill warn";
    mcStatus.textContent = `부분입력 (${mcFilled}/30)`;
  } else {
    mcStatus.className = "pill ok";
    mcStatus.textContent = "완성(30/30)";
  }

  // SA key text
  const saShown = saKey.map(v => v == null ? "-" : v).join(" | ");
  document.getElementById("saKeyText").textContent = saShown;

  // SA status
  const saInvalidCount = saInputs
    .map(sanitizeSA)
    .filter(s => s && !isValidSA(s)).length;

  const saFilled = saKey.filter(v => v != null).length;
  const saStatus = document.getElementById("saStatus");
  if(saInvalidCount > 0){
    saStatus.className = "pill bad";
    saStatus.textContent = `형식오류 ${saInvalidCount}개`;
  } else if(saFilled === 0) {
    saStatus.className = "pill warn";
    saStatus.textContent = "미입력";
  } else if(saFilled < SA_Q) {
    saStatus.className = "pill warn";
    saStatus.textContent = `부분입력 (${saFilled}/10)`;
  } else {
    saStatus.className = "pill ok";
    saStatus.textContent = "완성(10/10)";
  }

  // JSON view
  const state = {
    mcKey,
    saKey
  };
  document.getElementById("stateJson").textContent = JSON.stringify(state, null, 2);
}

// ---------- Render MC blocks ----------
function renderMCBlocks(){
  const host = document.getElementById("mcBlocks");
  host.innerHTML = "";

  const ranges = ["1~5","6~10","11~15","16~20","21~25","26~30"];

  ranges.forEach((label, idx) => {
    const row = document.createElement("div");
    row.className = "row";

    const l = document.createElement("div");
    l.className = "label";
    l.textContent = `${label} :`;
    row.appendChild(l);

    const input = document.createElement("input");
    input.value = mcBlocks[idx];
    input.placeholder = "예) 23213";
    input.maxLength = 5;
    input.inputMode = "numeric";
    input.pattern = "[0-9]*";
    input.style.width = "220px";

    const tip = document.createElement("span");
    tip.className = "small";

    function refreshTip(){
      const v = mcBlocks[idx];
      if(!v) tip.textContent = "미입력";
      else if(v.length < 5) tip.textContent = `${v.length}/5`;
      else tip.textContent = "OK";
    }

    input.addEventListener("input", () => {
      const s = sanitizeMCBlock(input.value);
      input.value = s;
      mcBlocks[idx] = s;
      refreshTip();
      updateUI();

      // 5개 채우면 자동 다음칸
      if(s.length === 5){
        const next = host.querySelector(`[data-mc-idx="${idx+1}"]`);
        if(next) next.focus();
      }
    });

    input.setAttribute("data-mc-idx", String(idx));
    refreshTip();

    row.appendChild(input);
    row.appendChild(tip);
    host.appendChild(row);
  });
}

// ---------- Render SA table ----------
function renderSATable(){
  const table = document.getElementById("saTable");
  table.innerHTML = "";

  for(let i=0;i<SA_Q;i++){
    const tr = document.createElement("tr");

    const tdNo = document.createElement("td");
    tdNo.className = "sa-no";
    tdNo.textContent = String(i+1);
    tr.appendChild(tdNo);

    const tdIn = document.createElement("td");
    const input = document.createElement("input");
    input.className = "sa-input";
    input.placeholder = "예) 12 / 3.14 / 1/3";
    input.value = saInputs[i];
    input.inputMode = "text";

    const msg = document.createElement("div");
    msg.className = "small";

    function refresh(){
      const s = sanitizeSA(input.value);
      saInputs[i] = s;
      const ok = isValidSA(s);
      if(!s) msg.textContent = "미입력";
      else if(ok) msg.textContent = "OK";
      else msg.textContent = "형식오류 (정수/소수/분수만)";
    }

    input.addEventListener("input", () => {
      // 입력값은 그대로 두되, 공백만 제거해서 상태에 저장
      refresh();
      updateUI();
    });

    refresh();
    tdIn.appendChild(input);
    tdIn.appendChild(msg);
    tr.appendChild(tdIn);

    table.appendChild(tr);
  }
}

// ---------- Save/Load ----------
function saveToLocal(){
  const state = { mcBlocks, saInputs };
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function loadFromLocal(){
  const raw = localStorage.getItem(LS_KEY);
  if(!raw) return;

  try{
    const s = JSON.parse(raw);
    if(Array.isArray(s.mcBlocks)){
      for(let i=0;i<6;i++) mcBlocks[i] = (s.mcBlocks[i] || "");
    }
    if(Array.isArray(s.saInputs)){
      for(let i=0;i<SA_Q;i++) saInputs[i] = (s.saInputs[i] || "");
    }
  } catch(e){
    // ignore
  }
}

// ---------- Boot ----------
function boot(){
  loadFromLocal();
  renderMCBlocks();
  renderSATable();

  // 렌더 후 값을 input에 반영(간단히 재렌더)
  renderMCBlocks();
  renderSATable();

  updateUI();

  document.getElementById("saveBtn").addEventListener("click", () => {
    updateUI();
    saveToLocal();
    alert("정답을 저장했습니다.");
  });

  document.getElementById("clearBtn").addEventListener("click", () => {
    if(!confirm("정답 입력을 초기화할까요?")) return;
    for(let i=0;i<6;i++) mcBlocks[i] = "";
    for(let i=0;i<SA_Q;i++) saInputs[i] = "";
    saveToLocal();
    renderMCBlocks();
    renderSATable();
    updateUI();
  });
}

document.addEventListener("DOMContentLoaded", boot);
