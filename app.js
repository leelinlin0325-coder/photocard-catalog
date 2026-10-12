const DB_NAME = "photocard-catalog-db";
const DB_VERSION = 1;
const STORE = "cards";
let db;
let currentDetailId = null;
let currentPhotoPreviewUrl = null;

const $ = id => document.getElementById(id);
const fields = ["cardId","cardName","cardSeries","cardNumber","cardQuantity","cardPhotoFilename","cardNotes"];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("group", "group", { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(mode="readonly") { return db.transaction(STORE, mode).objectStore(STORE); }
function getAll() {
  return new Promise((resolve, reject) => {
    const req = tx().getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
function getOne(id) {
  return new Promise((resolve, reject) => {
    const req = tx().get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function saveCard(card) {
  return new Promise((resolve, reject) => {
    const req = tx("readwrite").put(card);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function deleteCard(id) {
  return new Promise((resolve, reject) => {
    const req = tx("readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
function message(text, error=false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function esc(value="") {
  return String(value).replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
}
function blobUrl(blob) { return blob ? URL.createObjectURL(blob) : ""; }
function cleanUrl(url) { if (url) URL.revokeObjectURL(url); }
function collectionLabel(quantity) {
  const n = Math.max(0, Number.parseInt(quantity ?? 0, 10) || 0);
  if (n === 0) return "想收";
  if (n === 1) return "已收";
  return "重複卡";
}
function makeCardId() { return "CARD" + Date.now().toString().slice(-8); }

async function render() {
  const cards = await getAll();
  cards.sort((a,b) => (a.id || "").localeCompare(b.id || "", "zh-Hant", { numeric:true }));
  const query = $("searchInput").value.trim().toLowerCase();
  const status = $("collectionFilter").value;
  const group = $("groupFilter").value;
  const groups = [...new Set(cards.map(c => c.series).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-Hant"));
  const groupSelect = $("groupFilter");
  const oldGroup = groupSelect.value;
  groupSelect.innerHTML = '<option value="">全部分類</option>' + groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join("");
  if (groups.includes(oldGroup)) groupSelect.value = oldGroup;

  const filtered = cards.filter(c => {
    const derivedTag = collectionLabel(c.quantity);
    const haystack = [c.id,c.name,c.series,c.cardNo,derivedTag,c.notes,c.photoFilename].join(" ").toLowerCase();
    return (!query || haystack.includes(query)) &&
      (!status || derivedTag === status) &&
      (!group || c.series === group);
  });
  $("totalCount").textContent = cards.length;
  $("ownedCount").textContent = cards.filter(c=>Number(c.quantity ?? 0) >= 1).length;
  $("wantedCount").textContent = cards.filter(c=>Number(c.quantity ?? 0) === 0).length;
  $("resultCount").textContent = `${filtered.length} 張`;
  $("emptyState").classList.toggle("visible", filtered.length === 0);
  $("cardGrid").innerHTML = filtered.map(c => {
    const src = c.photo ? blobUrl(c.photo) : "";
    const title = c.name || c.id;
    const image = src ? `<img src="${src}" alt="${esc(title)}" loading="lazy">` : '<span class="no-image">▧</span>';
    return `<article class="card" data-id="${esc(c.id)}" tabindex="0" role="button" aria-label="查看 ${esc(title)}">
      <div class="card-image">${image}</div>
      <div class="card-body"><div class="card-title">${esc(title)}</div>
      <div class="card-meta">${esc(c.series || c.cardNo || c.id)}</div>
      <span class="tag">${collectionLabel(c.quantity)}</span>
      ${Number(c.quantity ?? 0) >= 2
        ? `<small class="quantity">持有 ${Number(c.quantity ?? 0)} 張</small>`
        : `<small class="quantity">${Number(c.quantity ?? 0)} 張</small>`}
      </div></article>`;
  }).join("");
  $("cardGrid").querySelectorAll(".card").forEach(el => {
    el.addEventListener("click", () => openDetail(el.dataset.id));
    el.addEventListener("keydown", e => { if(e.key==="Enter"||e.key===" ") { e.preventDefault(); openDetail(el.dataset.id); } });
  });
  // Revoke old URLs after images have been assigned to elements.
  document.querySelectorAll(".card img").forEach(img => img.addEventListener("load", () => {}, {once:true}));
}

function readForm() {
  return {
    id: $("cardId").value.trim(),
    name: $("cardName").value.trim(),
    series: $("cardSeries").value.trim(),
    cardNo: $("cardNumber").value.trim(),
    notes: $("cardNotes").value.trim(),
    quantity: Math.max(0, Number.parseInt($("cardQuantity").value || "0", 10) || 0),
    photoFilename: $("cardPhotoFilename").value.trim()
  };
}
function clearForm() {
  $("cardForm").reset();
  $("editOriginalId").value = "";
  $("currentPhotoPreview").innerHTML = "";
  $("deleteCardBtn").classList.add("hidden");
  if (currentPhotoPreviewUrl) cleanUrl(currentPhotoPreviewUrl);
  currentPhotoPreviewUrl = null;
}
async function openEditor(id=null) {
  clearForm();
  if (id) {
    const c = await getOne(id);
    if (!c) return;
    $("dialogTitle").textContent = "編輯小卡";
    $("editOriginalId").value = c.id;
    $("cardId").value = c.id;
    $("cardId").readOnly = true;
    $("cardName").value = c.name || "";
    $("cardSeries").value = c.series || "";
    $("cardNumber").value = c.cardNo || "";
    $("cardQuantity").value = c.quantity ?? 0;
    $("cardPhotoFilename").value = c.photoFilename || "";
    $("cardNotes").value = c.notes || "";
    $("deleteCardBtn").classList.remove("hidden");
    if (c.photo) {
      currentPhotoPreviewUrl = blobUrl(c.photo);
      $("currentPhotoPreview").innerHTML = `<img src="${currentPhotoPreviewUrl}" alt="目前照片">`;
    }
  } else {
    $("dialogTitle").textContent = "新增小卡";
    $("cardId").readOnly = false;
    $("cardId").value = makeCardId();
  }
  $("cardDialog").showModal();
}
async function saveFromForm(e) {
  e.preventDefault();
  const c = readForm();
  if (!c.id) { message("請填寫卡片編號。", true); return; }
  const originalId = $("editOriginalId").value;
  const existing = await getOne(originalId || c.id);
  if (!originalId && await getOne(c.id)) { message("這個卡片編號已存在，請使用不同編號。", true); return; }
  c.photo = existing?.photo || null;
  if ($("cardPhoto").files[0]) c.photo = $("cardPhoto").files[0];
  await saveCard(c);
  $("cardDialog").close();
  message("小卡已儲存。");
  await render();
}
async function openDetail(id) {
  const c = await getOne(id);
  if (!c) return;
  currentDetailId = id;
  const src = c.photo ? blobUrl(c.photo) : "";
  $("detailContent").innerHTML = `${src ? `<img class="detail-image" src="${src}" alt="${esc(c.name || c.id)}">` : '<div class="empty-state visible">尚未加入照片</div>'}
    <h3>${esc(c.name || c.id)}</h3>
    <span class="tag">${collectionLabel(c.quantity)}</span>
    <dl class="detail-list">
      <dt>唯一識別碼</dt><dd>${esc(c.id)}</dd>
      <dt>系列</dt><dd>${esc(c.series)}</dd>
      <dt>卡片編號</dt><dd>${esc(c.cardNo)}</dd>
      <dt>收藏標記</dt><dd>${collectionLabel(c.quantity)}</dd>
      <dt>持有張數</dt><dd>${Number(c.quantity ?? 0)} 張</dd>
      <dt>照片檔名</dt><dd>${esc(c.photoFilename)}</dd>
      <dt>備註</dt><dd>${esc(c.notes)}</dd>
    </dl>`;
  $("detailDialog").showModal();
}
function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i], next=text[i+1];
    if(ch === '"' && quoted && next === '"'){ cell+='"'; i++; }
    else if(ch === '"'){ quoted=!quoted; }
    else if(ch === ',' && !quoted){ row.push(cell); cell=""; }
    else if((ch === '\n' || ch === '\r') && !quoted){
      if(ch==='\r' && next==='\n') i++;
      row.push(cell); if(row.some(v=>v.trim()!=="")) rows.push(row);
      row=[]; cell="";
    } else cell+=ch;
  }
  row.push(cell); if(row.some(v=>v.trim()!=="")) rows.push(row);
  if(!rows.length) return [];
  const headers=rows.shift().map(h=>h.replace(/^\uFEFF/,"").trim());
  return rows.map(values=>{
    const o={}; headers.forEach((h,i)=>o[h]=(values[i]||"").trim()); return o;
  });
}
function first(obj, names) {
  for(const n of names) if(obj[n] !== undefined) return obj[n];
  return "";
}
async function importCsvFile(file) {
  const text = await file.text();
  const rows = parseCsv(text);
  if(!rows.length) throw new Error("CSV 沒有可匯入的資料。");
  let added=0, updated=0, skipped=0;
  const seenIds = new Set();
  for(const r of rows){
    const id = first(r,["id","唯一識別碼","識別碼"]).trim();
    if(!id || seenIds.has(id)){ skipped++; continue; }
    seenIds.add(id);
    const old = await getOne(id);
    const quantityRaw = first(r,["quantity","數量"]).trim();
    const parsedQuantity = quantityRaw === "" ? (old?.quantity ?? 0) : Number.parseInt(quantityRaw,10);
    const card = {
      id,
      name:first(r,["name","卡片名稱","名稱"]).trim(),
      series:first(r,["series","系列"]).trim(),
      cardNo:first(r,["card_no","卡片編號","卡號"]).trim(),
      notes:first(r,["notes","備註"]).trim(),
      quantity:Number.isFinite(parsedQuantity) && parsedQuantity >= 0 ? parsedQuantity : (old?.quantity ?? 0),
      photoFilename:first(r,["photo_filename","照片檔名","圖片檔名"]).trim(),
      photo:old?.photo || null
    };
    await saveCard(card);
    old ? updated++ : added++;
  }
  await render();
  message(`CSV 匯入完成：新增 ${added} 張、更新 ${updated} 張、略過 ${skipped} 列。接著按「批次加入照片」配對照片。`);
}
async function importPhotos(filesList) {
  const cards = await getAll();
  const byFilename = new Map();
  cards.forEach(c => {
    if(c.photoFilename) byFilename.set(c.photoFilename.trim().toLowerCase(), c);
  });
  let matched=0, unmatched=0;
  for(const file of filesList) {
    const card=byFilename.get(file.name.trim().toLowerCase());
    if(!card){ unmatched++; continue; }
    card.photo=file;
    await saveCard(card); matched++;
  }
  await render();
  message(`照片匯入完成：成功配對 ${matched} 張；未配對 ${unmatched} 張。請確認 CSV 的 photo_filename 與實際檔名一致（含副檔名）。`, unmatched>0);
}
function blobToDataUrl(blob) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
function dataUrlToBlob(dataUrl) {
  const parts=dataUrl.split(",");
  const mime=(parts[0].match(/:(.*?);/)||[])[1]||"application/octet-stream";
  const binary=atob(parts[1]); const arr=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) arr[i]=binary.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
async function exportBackup() {
  const cards=await getAll();
  const out=[];
  for(const c of cards) {
    const copy={...c};
    if(c.photo) copy.photoData=await blobToDataUrl(c.photo);
    delete copy.photo;
    out.push(copy);
  }
  const blob=new Blob([JSON.stringify({format:"photocard-catalog-backup",version:1,exportedAt:new Date().toISOString(),cards:out},null,2)],{type:"application/json"});
  downloadBlob(blob,`小卡圖鑑備份_${new Date().toISOString().slice(0,10)}.json`);
  message("完整備份已匯出。請將備份檔另存到安全位置。");
}
async function restoreBackup(file) {
  const obj=JSON.parse(await file.text());
  if(obj.format!=="photocard-catalog-backup" || !Array.isArray(obj.cards)) throw new Error("這不是本圖鑑的有效備份檔。");
  let count=0;
  for(const item of obj.cards) {
    const c={...item};
    if(c.photoData){ c.photo=dataUrlToBlob(c.photoData); delete c.photoData; }
    else c.photo=null;
    if(!c.id) continue;
    await saveCard(c); count++;
  }
  await render();
  message(`還原完成：已匯入 ${count} 張。相同編號的卡片會被備份內容覆蓋。`);
}
function downloadBlob(blob, filename) {
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function csvEscape(v) {
  const s=String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
async function exportCsv() {
  const cards=await getAll();
  const headers=["id","name","series","card_no","notes","quantity","photo_filename"];
  const rows=[headers.join(",")];
  cards.forEach(c=>{
    const values={id:c.id,name:c.name,series:c.series,card_no:c.cardNo,notes:c.notes,quantity:c.quantity ?? 0,photo_filename:c.photoFilename};
    rows.push(headers.map(h=>csvEscape(values[h] ?? "")).join(","));
  });
  const blob=new Blob(["\\uFEFF"+rows.join("\\r\\n")],{type:"text/csv;charset=utf-8"});
  downloadBlob(blob,"小卡圖鑑資料.csv");
  message("CSV 資料已匯出。收藏標記由數量自動判定；CSV 不包含照片，完整備份請使用「匯出完整備份」。");
}
function updateConnection() {
  const online=navigator.onLine;
  $("connection").textContent=online?"已連線":"離線模式";
  $("connection").style.background=online?"#ffffff18":"#ffe5b8";
  $("connection").style.color=online?"#fff":"#694600";
}

$("addCardBtn").addEventListener("click",()=>openEditor());
$("importCsvBtn").addEventListener("click",()=>$("csvFileInput").click());
$("importPhotosBtn").addEventListener("click",()=>$("photoFilesInput").click());
$("csvFileInput").addEventListener("change",async e=>{
  const file=e.target.files[0]; if(!file)return;
  try { message("正在匯入 CSV…"); await importCsvFile(file); }
  catch(err){ message("匯入失敗："+err.message,true); }
  e.target.value="";
});
$("photoFilesInput").addEventListener("change",async e=>{
  const files=[...e.target.files]; if(!files.length)return;
  try { message("正在配對照片…"); await importPhotos(files); }
  catch(err){ message("照片匯入失敗："+err.message,true); }
  e.target.value="";
});
$("cardForm").addEventListener("submit",saveFromForm);
$("closeDialogBtn").addEventListener("click",()=>$("cardDialog").close());
$("cancelDialogBtn").addEventListener("click",()=>$("cardDialog").close());
$("cardPhoto").addEventListener("change",e=>{
  const f=e.target.files[0]; if(!f)return;
  if(currentPhotoPreviewUrl) cleanUrl(currentPhotoPreviewUrl);
  currentPhotoPreviewUrl=URL.createObjectURL(f);
  $("currentPhotoPreview").innerHTML=`<img src="${currentPhotoPreviewUrl}" alt="新照片預覽">`;
});
$("deleteCardBtn").addEventListener("click",async()=>{
  const id=$("editOriginalId").value;
  if(!id || !confirm(`確定刪除 ${id}？此操作無法復原。`))return;
  await deleteCard(id); $("cardDialog").close(); await render(); message("小卡已刪除。");
});
$("closeDetailBtn").addEventListener("click",()=>$("detailDialog").close());
$("closeDetailBottomBtn").addEventListener("click",()=>$("detailDialog").close());
$("editDetailBtn").addEventListener("click",async()=>{ $("detailDialog").close(); await openEditor(currentDetailId); });
$("searchInput").addEventListener("input",render);
$("collectionFilter").addEventListener("change",render);
$("groupFilter").addEventListener("change",render);
$("exportBackupBtn").addEventListener("click",async()=>{try{await exportBackup();}catch(e){message("備份失敗："+e.message,true);}});
$("restoreBackupBtn").addEventListener("click",()=>$("backupFileInput").click());
$("backupFileInput").addEventListener("change",async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{if(confirm("還原會將備份內容匯入圖鑑；相同編號會被覆蓋。要繼續嗎？"))await restoreBackup(file);}
  catch(err){message("還原失敗："+err.message,true);}
  e.target.value="";
});
$("exportCsvBtn").addEventListener("click",exportCsv);
window.addEventListener("online",updateConnection);
window.addEventListener("offline",updateConnection);

(async function init(){
  try {
    db=await openDb();
    updateConnection();
    await render();
    if("serviceWorker" in navigator && (location.protocol==="https:" || location.hostname==="localhost")) {
      navigator.serviceWorker.register("./sw.js").catch(err=>console.warn("Service worker 註冊失敗",err));
    }
  } catch(err) {
    message("圖鑑初始化失敗："+err.message,true);
  }
})();
