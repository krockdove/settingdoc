import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

const storage = {
  async get(key) {
    const value = localStorage.getItem(key);
    return value === null ? null : { value };
  },

  async set(key, value) {
    localStorage.setItem(key, value);
    return { value };
  },

  async delete(key) {
    localStorage.removeItem(key);
  },
};

const CATS = [
  { key: "character", label: "인물" },
  { key: "world", label: "지형·기후" },
  { key: "system", label: "제도" },
  { key: "power", label: "힘의 체계" },
  { key: "place", label: "장소" },
  { key: "org", label: "단체" },
  { key: "event", label: "사건·역사" },
  { key: "item", label: "물건·개념" },
  { key: "etc", label: "기타" },
];

const ETC = CATS[CATS.length - 1];
const catOf = (k) => CATS.find((c) => c.key === k) || ETC;
const isCat = (k) => CATS.some((c) => c.key === k);
/* 없어진 분류를 지금 쓰는 분류로 옮긴다 */
const MERGED = { history: "event" };
const fixCat = (k) => (MERGED[k] ? MERGED[k] : isCat(k) ? k : "etc");
const uid = () => Math.random().toString(36).slice(2, 10);
const CHUNK = 900;
const snippet = (t) => {
  const s = String(t || "").replace(/\s+/g, " ").trim();
  return s.length > 14 ? s.slice(0, 14) + "…" : s || "새 항목";
};

/* ── 조각 나누기 ──
   마침표 없이 길게 이어지는 문장도 반드시 size 아래로 끊는다.
   이게 안 되면 조각이 통째로 커져서 모델 응답이 잘리고, 그 조각은 사라진다. */
function hardSplit(s, size) {
  const out = [];
  let rest = s;
  while (rest.length > size) {
    const w = rest.slice(0, size);
    let cut = Math.max(
      w.lastIndexOf(", "),
      w.lastIndexOf("; "),
      w.lastIndexOf("며 "),
      w.lastIndexOf("고 "),
      w.lastIndexOf("데 "),
      w.lastIndexOf("만 "),
      w.lastIndexOf("서 ")
    );
    if (cut < size * 0.5) cut = w.lastIndexOf(" ");
    if (cut < size * 0.5) cut = size - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

function splitLong(p, size) {
  const sents = p.match(/[^.!?…\n]+[.!?…]*\s*/g) || [p];
  const out = [];
  let cur = "";
  for (const s of sents) {
    const parts = s.length > size ? hardSplit(s, size) : [s];
    for (const piece of parts) {
      if (cur && cur.length + piece.length > size) {
        out.push(cur);
        cur = piece;
      } else cur += piece;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function toChunks(text, size = CHUNK) {
  const paras = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let cur = "";
  for (const p of paras) {
    const pieces = p.length > size ? splitLong(p, size) : [p];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length > size) {
        out.push(cur);
        cur = piece;
      } else if (!cur && piece.length > size) {
        out.push(...hardSplit(piece, size));
      } else cur = cur ? cur + "\n\n" + piece : piece;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/* 응답이 중간에 잘려도 완결된 객체만은 건져낸다 */
function parseItems(raw) {
  const a = raw.indexOf("[");
  if (a < 0) return [];
  const body = raw.slice(a);
  const b = body.lastIndexOf("]");
  if (b > 0) {
    try {
      const v = JSON.parse(body.slice(0, b + 1));
      if (Array.isArray(v)) return v;
    } catch (e) {}
  }
  const out = [];
  let depth = 0,
    start = -1,
    inStr = false,
    esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth++ === 0) start = i;
    } else if (ch === "}") {
      if (--depth === 0 && start >= 0) {
        try {
          out.push(JSON.parse(body.slice(start, i + 1)));
        } catch (e) {}
        start = -1;
      }
      if (depth < 0) depth = 0;
    }
  }
  return out;
}

/* 저장된 옛 데이터가 망가져 있어도 화면이 죽지 않게 */
function normalize(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((e) => ({
    id: e && e.id ? e.id : uid(),
    workId: e && e.workId ? e.workId : null,
    category: fixCat(e && e.category),
    name: String((e && e.name) || "").trim() || "이름 없음",
    notes: (Array.isArray(e && e.notes) ? e.notes : []).map((n) => ({
      id: n && n.id ? n.id : uid(),
      text: String((n && n.text) || ""),
    })),
  }));
}

const CSS = `
.sd-root{
  --font:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif;

  /* 바탕 */
  --ink:#FFFFFF;
  --panel:#FFFFFF;
  --panel-2:#FFFFFF;

  /* 구분선 */
  --wash:rgba(48, 83, 94, .055);
  --line:#D5DEE2;
  --hair:#E4EAED;

  /* 글씨 — 기존 값 그대로 */
  --text:#0C090D;
  --body:#3A363C;
  --muted:#5F5A66;
  --faint:#87818E;

  /* 강조 */
  --focus:#376F7D;
  --danger:#E01A4F;

  /* 카테고리 강조색 */
  --c-character:#E01A4F;
  --c-world:#0C090D;
  --c-place:#53B3CB;
  --c-org:#F15946;
  --c-event:#2196E3;
  --c-item:#F9C22E;
  --c-etc:#8A858F;
  --c-system:#4E7A4F;
  --c-power:#8A4FA8;
  
  background:var(--ink); color:var(--text);
  font-family:var(--font); font-weight:400;
  min-height:100vh; padding:0 0 90px; overflow-x:hidden; -webkit-font-smoothing:antialiased;
  transition:background .2s,color .2s;
}
.sd-root[data-theme="dark"]{
  --ink:#0D141A; --panel:#0D141A; --panel-2:#0D141A;
  --wash:rgba(160,186,198,.07);
  --line:#242E35; --hair:#1C242A;
  --text:#E2E8EB; --body:#B0BBC2; --muted:#84919A; --faint:#65727A;
  --focus:#5E9AA8; --danger:#D9758A;
  --c-character:#D9758A; --c-world:#E2E8EB; --c-place:#6FA3AF;
  --c-org:#D08472; --c-item:#CBAE6C; --c-event:#5FB6F2; --c-etc:#7E8B93;
  --c-system:#7DA37E; --c-power:#A98BC4;
}
.sd-root *{box-sizing:border-box;}
.sd-wrap{max-width:1180px;margin:0 auto;padding:0 20px;}

.sd-head{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;
  padding:34px 0 22px;border-bottom:1px solid var(--line);margin-bottom:26px;}
.sd-title{font-family:var(--font);font-size:27px;font-weight:700;letter-spacing:-.01em;margin:0;}
.sd-sub{font-size:14.5px;color:var(--muted);margin:0;}
.sd-right{margin-left:auto;display:flex;align-items:center;gap:14px;}
.sd-count{font-family:var(--font);font-size:13.5px;color:var(--faint);letter-spacing:.06em;}

.sd-grid{display:grid;grid-template-columns:minmax(0,430px) minmax(0,1fr);gap:30px;align-items:start;}
@media(max-width:1000px){.sd-grid{grid-template-columns:1fr;gap:24px;}}

.sd-label{font-size:13px;letter-spacing:.14em;color:var(--faint);
  text-transform:uppercase;font-family:var(--font);margin:0 0 10px;
  display:flex;align-items:center;gap:10px;}

.sd-ta{width:100%;min-height:230px;resize:vertical;background:var(--panel);
  color:var(--text);border:1px solid var(--line);border-radius:3px;padding:15px 16px;
  font-family:var(--font);font-size:15px;line-height:1.85;outline:none;}
.sd-ta:focus{border-color:var(--muted);}
.sd-ta::placeholder{color:var(--faint);}

.sd-row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap;}
.sd-btn{background:var(--text);color:var(--ink);border:none;border-radius:3px;
  padding:11px 20px;font-family:var(--font);font-size:14px;font-weight:500;
  cursor:pointer;transition:opacity .15s;}
.sd-btn:hover:not(:disabled){opacity:.82;}
.sd-btn:disabled{opacity:.35;cursor:default;}
.sd-btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);
  font-weight:400;padding:9px 15px;font-size:14.5px;}
.sd-btn.ghost:hover:not(:disabled){color:var(--text);border-color:var(--muted);opacity:1;}
.sd-mini{background:transparent;border:1px solid var(--line);color:var(--muted);
  border-radius:2px;font-size:13px;padding:4px 9px;cursor:pointer;
  font-family:var(--font);white-space:nowrap;}
.sd-mini:hover:not(:disabled){color:var(--text);border-color:var(--muted);}
.sd-mini:disabled{opacity:.35;cursor:default;}
.sd-mini.warn:hover:not(:disabled){color:var(--danger);border-color:var(--danger);}
.sd-hint{font-size:13.5px;color:var(--faint);line-height:1.6;margin:10px 0 0;}
.sd-err{font-size:14.5px;color:var(--danger);margin:12px 0 0;line-height:1.6;}

.sd-file{display:flex;align-items:center;gap:11px;background:var(--panel);
  border:1px solid var(--line);border-radius:3px;padding:13px 14px;}
.sd-fname{font-family:var(--font);font-size:15px;font-weight:700;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sd-fmeta{font-family:var(--font);font-size:13px;color:var(--faint);margin-top:3px;}

.sd-bar{height:2px;background:var(--wash);border-radius:2px;overflow:hidden;margin:14px 0 8px;}
.sd-bar i{display:block;height:100%;background:var(--muted);transition:width .3s;}
.sd-prog{font-family:var(--font);font-size:13px;color:var(--muted);letter-spacing:.04em;}

.sd-pending{margin-top:24px;border-top:1px solid var(--line);padding-top:18px;}
.sd-gtitle{display:flex;align-items:center;gap:8px;cursor:pointer;padding:8px 6px 6px;
  font-size:14.5px;color:var(--muted);border-bottom:1px solid var(--hair);border-radius:2px;}
.sd-gtitle:hover{color:var(--text);}
.sd-gnum{font-family:var(--font);font-size:13px;color:var(--faint);margin-left:auto;}
.sd-pcard{background:var(--panel);border:1px solid var(--line);border-left:3px solid;
  border-radius:3px;padding:11px 13px;margin:8px 0;transition:opacity .15s;}
.sd-pcard.off{opacity:.34;}
.sd-ptop{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
.sd-chk{width:15px;height:15px;accent-color:var(--muted);cursor:pointer;flex:none;}
.sd-name{background:transparent;border:none;border-bottom:1px dashed transparent;color:var(--text);
  font-family:var(--font);font-size:15px;font-weight:700;padding:1px 0;outline:none;min-width:40px;flex:1;}
.sd-name:hover,.sd-name:focus{border-bottom-color:var(--faint);}
.sd-sel{background:var(--ink);color:var(--muted);border:1px solid var(--line);
  border-radius:2px;font-size:13px;padding:3px 5px;font-family:var(--font);cursor:pointer;outline:none;max-width:150px;}
.sd-tag{font-family:var(--font);font-size:12px;letter-spacing:.08em;
  color:var(--faint);border:1px solid var(--line);border-radius:2px;padding:2px 5px;flex:none;}
.sd-ptext{font-family:var(--font);font-size:14px;line-height:1.75;color:var(--body);margin:0;padding-left:23px;}

.sd-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;align-items:center;}
.sd-chip{background:transparent;border:1px solid var(--line);border-radius:99px;
  color:var(--muted);font-size:14px;padding:5px 12px;cursor:pointer;display:flex;align-items:center;gap:6px;
  font-family:var(--font);transition:.15s;}
.sd-chip:hover{color:var(--text);}
.sd-chip.on{background:var(--wash);color:var(--text);border-color:var(--muted);}
.sd-dot{width:7px;height:7px;border-radius:99px;flex:none;}
.sd-chip .num{font-family:var(--font);font-size:12.5px;color:var(--faint);}
.sd-search{background:var(--panel);border:1px solid var(--line);border-radius:99px;
  color:var(--text);font-size:14px;padding:5px 13px;outline:none;width:120px;
  font-family:var(--font);transition:width .15s;}
.sd-search:focus{border-color:var(--muted);width:170px;}

.sd-tools{display:flex;gap:7px;align-items:center;flex-wrap:wrap;background:var(--wash);
  border:1px solid var(--line);border-radius:3px;padding:9px 11px;margin-bottom:14px;}
.sd-tcount{font-family:var(--font);font-size:13px;color:var(--muted);letter-spacing:.04em;}
.sd-div{width:1px;height:16px;background:var(--line);margin:0 2px;}
.sd-rep{display:flex;gap:7px;align-items:center;flex-wrap:wrap;width:100%;
  padding-top:9px;margin-top:2px;border-top:1px solid var(--line);}
.sd-inp{background:var(--panel);border:1px solid var(--line);border-radius:2px;color:var(--text);
  font-family:var(--font);font-size:15px;padding:5px 9px;outline:none;width:130px;}
.sd-inp:focus{border-color:var(--muted);}

.sd-entry{background:var(--panel);border:1px solid var(--line);border-left:3px solid;
  border-radius:3px;margin-bottom:9px;overflow:hidden;}
.sd-over{outline:2px dashed var(--focus);outline-offset:1px;}
.sd-ehead{display:flex;align-items:center;gap:9px;padding:12px 14px;cursor:pointer;}
.sd-ehead:hover{background:var(--wash);}
.sd-grip{color:var(--faint);font-size:14.5px;line-height:1;cursor:grab;flex:none;
  opacity:0;transition:opacity .15s;padding:0 1px;user-select:none;}
.sd-grip:active{cursor:grabbing;}
.sd-note:hover .sd-grip{opacity:1;}
.sd-ename{font-family:var(--font);font-size:16.5px;font-weight:700;
  background:transparent;border:none;color:var(--text);outline:none;padding:0;flex:1;min-width:0;}
.sd-enum{font-family:var(--font);font-size:13px;color:var(--faint);flex:none;}
.sd-body{border-top:1px solid var(--line);padding:6px 14px 12px;}
.sd-note{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--hair);}
.sd-note:last-of-type{border-bottom:none;}
.sd-note.dragging{opacity:.35;}
.sd-note.picked{background:var(--wash);border-radius:2px;padding-left:6px;padding-right:6px;}
.sd-ntext{font-family:var(--font);font-size:14.5px;line-height:1.8;color:var(--body);
  flex:1;background:transparent;border:none;outline:none;resize:none;overflow:hidden;padding:0;}
.sd-ntools{display:flex;align-items:center;gap:4px;flex:none;opacity:0;transition:.15s;}
.sd-note:hover .sd-ntools{opacity:1;}
.sd-x{background:none;border:none;color:var(--faint);cursor:pointer;font-size:15px;
  line-height:1;padding:2px 4px;flex:none;}
.sd-x:hover{color:var(--danger);}
.sd-ehead .sd-x{opacity:0;transition:.15s;}
.sd-ehead:hover .sd-x{opacity:1;}
.sd-add{width:100%;background:transparent;border:1px dashed var(--line);border-radius:2px;
  color:var(--faint);font-family:var(--font);font-size:14px;padding:7px;
  cursor:pointer;margin-top:8px;}
.sd-add:hover{color:var(--text);border-color:var(--muted);}
.sd-nonote{font-size:14px;color:var(--faint);padding:8px 0 2px;}

.sd-empty{border:1px dashed var(--line);border-radius:3px;padding:44px 24px;text-align:center;}
.sd-empty p{margin:0 0 6px;font-family:var(--font);font-size:15.5px;color:var(--muted);}
.sd-empty span{font-size:14px;color:var(--faint);}

.sd-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:60;
  background:var(--panel);border:1px solid var(--muted);border-radius:4px;
  padding:11px 15px;display:flex;align-items:center;gap:14px;font-size:15px;color:var(--text);
  box-shadow:0 4px 18px rgba(12,9,13,.12);max-width:92vw;}
.sd-root[data-theme="dark"] .sd-toast{box-shadow:0 6px 22px rgba(3,10,16,.6);}
.sd-undo{background:none;border:none;color:var(--focus);font-size:15px;cursor:pointer;
  font-family:var(--font);font-weight:500;padding:0;white-space:nowrap;}
.sd-undo:hover{text-decoration:underline;}

.sd-ord{display:flex;flex-direction:column;gap:1px;flex:none;margin-left:4px;}
.sd-ob{background:transparent;border:1px solid var(--line);border-radius:2px;color:var(--muted);
  font-size:9px;line-height:1;padding:2px 5px;cursor:pointer;font-family:var(--font);}
.sd-ob:hover:not(:disabled){color:var(--text);border-color:var(--muted);}
.sd-ob:disabled{opacity:.3;cursor:default;}
.sd-lockbar{display:flex;align-items:center;gap:10px;background:var(--wash);
  border:1px solid var(--line);border-radius:3px;padding:12px 14px;margin-bottom:14px;
  font-size:13.5px;font-weight:500;color:var(--muted);}
.sd-works{display:flex;align-items:center;gap:6px;flex-wrap:wrap;
  padding:0 0 16px;margin-bottom:20px;border-bottom:1px solid var(--line);}
.sd-wtab{background:transparent;border:1px solid var(--line);border-radius:3px;
  color:var(--muted);font-family:var(--font);font-size:14px;font-weight:500;
  padding:7px 14px;cursor:pointer;display:flex;align-items:center;gap:7px;transition:.15s;}
.sd-wtab:hover{color:var(--text);border-color:var(--muted);}
.sd-wtab.on{background:var(--text);color:var(--ink);border-color:var(--text);font-weight:700;}
.sd-wtab .num{font-size:12px;font-weight:500;opacity:.7;}
.sd-wedit{display:flex;align-items:center;gap:7px;flex-wrap:wrap;width:100%;padding-top:4px;}

.sd-card{background:var(--panel);border:1px solid var(--line);border-left:3px solid;
  border-radius:3px;padding:12px 14px;margin-bottom:9px;cursor:pointer;transition:background .12s;}
.sd-card:hover{background:var(--wash);}
.sd-ctop{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;}
.sd-cname{font-size:16.5px;font-weight:700;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.sd-ccat{font-size:12.5px;font-weight:500;color:var(--muted);flex:none;}
.sd-preview{margin:5px 0 0;font-size:13.5px;line-height:1.7;color:var(--body);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.sd-preview.none{color:var(--faint);}

.sd-detail{max-width:720px;margin:0 auto;padding-top:4px;}
.sd-dtop{display:flex;align-items:center;gap:10px;margin-bottom:18px;flex-wrap:wrap;}
.sd-dcat{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--muted);}
.sd-dname{width:100%;background:transparent;border:none;border-bottom:1px solid var(--line);
  color:var(--text);font-size:25px;font-weight:700;padding:2px 0 9px;outline:none;}
.sd-dname:focus{border-bottom-color:var(--muted);}
.sd-drow{display:flex;align-items:center;gap:8px;margin:13px 0 14px;flex-wrap:wrap;}

/* 작은 글씨는 한 단계 굵게 잡아 흐려지지 않게 한다 */
.sd-sub,.sd-count,.sd-label,.sd-prog,.sd-gnum,.sd-enum,.sd-fmeta,.sd-tag,
.sd-chip,.sd-chip .num,.sd-tcount,.sd-mini,.sd-hint,.sd-nonote,.sd-add,
.sd-sel,.sd-search,.sd-empty span,.sd-btn.ghost{font-weight:500;}
.sd-tag,.sd-gnum,.sd-enum,.sd-chip .num{font-weight:600;}

@media(prefers-reduced-motion:reduce){.sd-bar i{transition:none;}}
.sd-root :focus-visible{outline:2px solid var(--focus);outline-offset:2px;}

/* ── 손가락으로 쓰는 화면 ──
   hover 로 숨겨 둔 도구는 터치에서 영영 안 나온다. 항상 보이게 한다. */
@media(hover:none){
  .sd-ntools,.sd-grip,.sd-ehead .sd-x{opacity:1;}
  .sd-mini{padding:7px 12px;}
  .sd-ob{padding:6px 9px;font-size:11px;}
  .sd-x{padding:6px 8px;font-size:17px;}
  .sd-chk{width:18px;height:18px;}
}

/* ── 좁은 화면 ── */
@media(max-width:720px){
  .sd-root{padding-bottom:70px;}
  .sd-wrap{padding:0 14px;}
  .sd-head{padding:22px 0 16px;margin-bottom:18px;gap:10px;}
  .sd-title{font-size:23px;}
  .sd-right{margin-left:0;width:100%;gap:10px;}
  .sd-works{padding-bottom:13px;margin-bottom:16px;gap:5px;}
  .sd-wtab{font-size:13.5px;padding:6px 11px;}
  .sd-search{width:100%;order:9;}
  .sd-search:focus{width:100%;}
  .sd-filters{gap:5px;}
  .sd-ta{min-height:180px;font-size:15px;}
  .sd-sel{max-width:120px;}
  .sd-dname{font-size:21px;}
  .sd-detail{max-width:none;margin:0;}
  .sd-inp{width:100%;}
  .sd-rep .sd-inp{width:calc(50% - 16px);}
  .sd-toast{left:14px;right:14px;bottom:14px;transform:none;max-width:none;}
  .sd-empty{padding:32px 16px;}
}

/* ── 아주 좁은 화면 ── */
@media(max-width:400px){
  .sd-title{font-size:21px;}
  .sd-cname{font-size:15.5px;}
  .sd-ccat{display:none;}
  .sd-tools{padding:8px;}
  .sd-toast{flex-wrap:wrap;gap:8px;}
}
/* =========================================================
   SettingDoc UI refinement
   - 원문 입력 : 설정 메모 = 45 : 55
   - 읽기 편한 글자 크기와 여백
   - 카드 밀도 조절
   ========================================================= */

/* 전체 작업 영역 */
.sd-grid {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 28px;
  align-items: start;
}

/* 데스크톱에서 작업 공간을 조금 더 넓게 */
.sd-wrap {
  max-width: 1280px;
}

/* 원문 입력 영역 */
.sd-ta {
  min-height: 420px;
  padding: 18px 20px;
  font-size: 15.5px;
  line-height: 1.9;
  border-radius: 6px;
}

.sd-ta:focus {
  border-color: var(--focus);
  box-shadow: 0 0 0 3px rgba(46, 138, 166, 0.08);
}

/* 입력 영역 주변의 설명 */
.sd-hint {
  font-size: 13.5px;
  line-height: 1.7;
  margin-top: 12px;
}

/* AI 정리 버튼 */
.sd-btn {
  border-radius: 6px;
  padding: 12px 22px;
  font-size: 14.5px;
  font-weight: 600;
}

.sd-btn.ghost {
  border-radius: 6px;
}

/* 오른쪽 필터 영역 */
.sd-filters {
  gap: 7px;
  margin-bottom: 16px;
}

.sd-chip {
  padding: 7px 13px;
  font-size: 13.5px;
}

/* 검색창 */
.sd-search {
  height: 34px;
  padding: 6px 14px;
  font-size: 13.5px;
}

/* 설정 메모 카드 */
.sd-card {
  padding: 16px 18px;
  margin-bottom: 12px;
  border-left-width: 4px;
  border-radius: 6px;
  transition:
    background .15s ease,
    border-color .15s ease,
    transform .12s ease;
}

.sd-card:hover {
  background: var(--wash);
  transform: translateY(-1px);
}

.sd-ctop {
  gap: 10px;
  margin-bottom: 4px;
}

.sd-cname {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.45;
}

.sd-ccat {
  font-size: 12.5px;
}

.sd-enum {
  font-size: 12.5px;
}

.sd-preview {
  margin-top: 7px;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--body);
}

/* 실제 상세 메모 화면 */
.sd-entry {
  margin-bottom: 12px;
  border-radius: 6px;
}

.sd-ehead {
  padding: 14px 16px;
}

.sd-ename {
  font-size: 17px;
  line-height: 1.5;
}

.sd-body {
  padding: 7px 16px 14px;
}

.sd-note {
  padding: 10px 0;
}

.sd-ntext {
  font-size: 15px;
  line-height: 1.85;
}

/* 작품 탭 */
.sd-works {
  gap: 7px;
  padding-bottom: 18px;
  margin-bottom: 24px;
}

.sd-wtab {
  padding: 8px 15px;
  border-radius: 5px;
}

/* 상단 헤더 */
.sd-head {
  padding: 38px 0 24px;
  margin-bottom: 28px;
}

.sd-title {
  font-size: 29px;
  letter-spacing: -0.025em;
}

.sd-sub {
  margin-top: 5px;
  font-size: 14.5px;
  line-height: 1.6;
}

/* 버튼들의 터치 영역 */
.sd-mini {
  min-height: 34px;
  padding: 6px 11px;
  border-radius: 5px;
}

/* 파일 영역 */
.sd-file {
  border-radius: 6px;
}

/* 진행 상태 */
.sd-bar {
  height: 3px;
  margin: 16px 0 9px;
}

/* ---------------------------------------------------------
   태블릿
   --------------------------------------------------------- */
@media (max-width: 1000px) and (min-width: 721px) {
  .sd-wrap {
    padding: 0 24px;
  }

  .sd-grid {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 22px;
  }

  .sd-ta {
    min-height: 360px;
  }
}

/* ---------------------------------------------------------
   모바일
   --------------------------------------------------------- */
@media (max-width: 720px) {
  .sd-wrap {
    padding: 0 14px;
  }

  .sd-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }

  .sd-ta {
    min-height: 260px;
    padding: 16px;
    font-size: 15px;
  }

  .sd-card {
    padding: 14px 15px;
  }

  .sd-cname {
    font-size: 16px;
  }

  .sd-preview {
    font-size: 14px;
    line-height: 1.75;
  }

  .sd-filters {
    margin-bottom: 14px;
  }
}

/* ---------------------------------------------------------
   다크 모드에서 포커스 강조
   --------------------------------------------------------- */
.sd-root[data-theme="dark"] .sd-ta:focus {
  box-shadow: 0 0 0 3px rgba(94, 154, 168, 0.12);
}
  /* =========================================================
   SettingDoc UI refinement
   - 원문 입력 : 설정 메모 = 45 : 55
   - 읽기 편한 글자 크기와 여백
   - 카드 밀도 조절
   ========================================================= */

/* 전체 작업 영역 */
.sd-grid {
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 28px;
  align-items: start;
}

/* 데스크톱에서 작업 공간을 조금 더 넓게 */
.sd-wrap {
  max-width: 1280px;
}

/* 원문 입력 영역 */
.sd-ta {
  min-height: 420px;
  padding: 18px 20px;
  font-size: 15.5px;
  line-height: 1.9;
  border-radius: 6px;
}

.sd-ta:focus {
  border-color: var(--focus);
  box-shadow: 0 0 0 3px rgba(46, 138, 166, 0.08);
}

/* 입력 영역 주변의 설명 */
.sd-hint {
  font-size: 13.5px;
  line-height: 1.7;
  margin-top: 12px;
}

/* AI 정리 버튼 */
.sd-btn {
  border-radius: 6px;
  padding: 12px 22px;
  font-size: 14.5px;
  font-weight: 600;
}

.sd-btn.ghost {
  border-radius: 6px;
}

/* 오른쪽 필터 영역 */
.sd-filters {
  gap: 7px;
  margin-bottom: 16px;
}

.sd-chip {
  padding: 7px 13px;
  font-size: 13.5px;
}

/* 검색창 */
.sd-search {
  height: 34px;
  padding: 6px 14px;
  font-size: 13.5px;
}

/* 설정 메모 카드 */
.sd-card {
  padding: 16px 18px;
  margin-bottom: 12px;
  border-left-width: 4px;
  border-radius: 6px;
  transition:
    background .15s ease,
    border-color .15s ease,
    transform .12s ease;
}

.sd-card:hover {
  background: var(--wash);
  transform: translateY(-1px);
}

.sd-ctop {
  gap: 10px;
  margin-bottom: 4px;
}

.sd-cname {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.45;
}

.sd-ccat {
  font-size: 12.5px;
}

.sd-enum {
  font-size: 12.5px;
}

.sd-preview {
  margin-top: 7px;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--body);
}

/* 실제 상세 메모 화면 */
.sd-entry {
  margin-bottom: 12px;
  border-radius: 6px;
}

.sd-ehead {
  padding: 14px 16px;
}

.sd-ename {
  font-size: 17px;
  line-height: 1.5;
}

.sd-body {
  padding: 7px 16px 14px;
}

.sd-note {
  padding: 10px 0;
}

.sd-ntext {
  font-size: 15px;
  line-height: 1.85;
}

/* 작품 탭 */
.sd-works {
  gap: 7px;
  padding-bottom: 18px;
  margin-bottom: 24px;
}

.sd-wtab {
  padding: 8px 15px;
  border-radius: 5px;
}

/* 상단 헤더 */
.sd-head {
  padding: 38px 0 24px;
  margin-bottom: 28px;
}

.sd-title {
  font-size: 29px;
  letter-spacing: -0.025em;
}

.sd-sub {
  margin-top: 5px;
  font-size: 14.5px;
  line-height: 1.6;
}

/* 버튼들의 터치 영역 */
.sd-mini {
  min-height: 34px;
  padding: 6px 11px;
  border-radius: 5px;
}

/* 파일 영역 */
.sd-file {
  border-radius: 6px;
}

/* 진행 상태 */
.sd-bar {
  height: 3px;
  margin: 16px 0 9px;
}

/* ---------------------------------------------------------
   태블릿
   --------------------------------------------------------- */
@media (max-width: 1000px) and (min-width: 721px) {
  .sd-wrap {
    padding: 0 24px;
  }

  .sd-grid {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 22px;
  }

  .sd-ta {
    min-height: 360px;
  }
}

/* ---------------------------------------------------------
   모바일
   --------------------------------------------------------- */
@media (max-width: 720px) {
  .sd-wrap {
    padding: 0 14px;
  }

  .sd-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }

  .sd-ta {
    min-height: 260px;
    padding: 16px;
    font-size: 15px;
  }

  .sd-card {
    padding: 14px 15px;
  }

  .sd-cname {
    font-size: 16px;
  }

  .sd-preview {
    font-size: 14px;
    line-height: 1.75;
  }

  .sd-filters {
    margin-bottom: 14px;
  }
}

/* ---------------------------------------------------------
   다크 모드에서 포커스 강조
   --------------------------------------------------------- */
.sd-root[data-theme="dark"] .sd-ta:focus {
  box-shadow: 0 0 0 3px rgba(94, 154, 168, 0.12);
}`;

/* 컴포넌트 밖에 둔다. 안에 두면 렌더마다 새로 마운트되어
   타이핑 중에 드롭다운이 닫히거나 값이 리셋된다. */
function MoveSelect({ ids, entries, onMove, disabled, label = "옮길 곳…" }) {
  return (
    <select
      className="sd-sel"
      value=""
      disabled={disabled}
      onClick={(ev) => ev.stopPropagation()}
      onChange={(ev) => {
        const v = ev.target.value;
        ev.target.value = "";
        onMove(ids, v);
      }}
    >
      <option value="">{label}</option>
      {CATS.map((c) => {
        const list = entries.filter((e) => e.category === c.key);
        return (
          <optgroup key={c.key} label={c.label}>
            {list.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
            <option value={"new:" + c.key}>＋ {c.label}에 새 항목</option>
          </optgroup>
        );
      })}
    </select>
  );
}

export default function SettingDoc() {
  const [theme, setTheme] = useState("light");
  const [fontOk, setFontOk] = useState(true);
  const [entries, setEntries] = useState([]);
  const [works, setWorks] = useState([]);
  const [workId, setWorkId] = useState(null);
  const [workEdit, setWorkEdit] = useState(null); // {mode:"new"|"rename", value}
  const [delArmed, setDelArmed] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState(null);
  const [pending, setPending] = useState(null);
  const [prog, setProg] = useState(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [viewId, setViewId] = useState(null);
  const [gopen, setGopen] = useState({});
  const [ready, setReady] = useState(false);

  const [pickMode, setPickMode] = useState(false);
  const [pickedN, setPickedN] = useState([]);
  const [repOpen, setRepOpen] = useState(false);
  const [find, setFind] = useState("");
  const [repl, setRepl] = useState("");
  const [toast, setToast] = useState(null);

  const drag = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [dragKind, setDragKind] = useState(null);
  const [over, setOver] = useState(null);

  const cancel = useRef(false);
  const saveTimer = useRef(null);
  const toastTimer = useRef(null);
  const fileInput = useRef(null);
  const entriesRef = useRef([]);
  const workIdRef = useRef(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    workIdRef.current = workId;
  }, [workId]);

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get("setting-drawer");
        if (r && r.value) {
          const parsed = normalize(JSON.parse(r.value));
          entriesRef.current = parsed;
          setEntries(parsed);
        }
      } catch (e) {}
      try {
        const w = await storage.get("setting-drawer-works");
        if (w && w.value) {
          const box = JSON.parse(w.value);
          if (Array.isArray(box.works) && box.works.length) {
            setWorks(box.works);
            setWorkId(box.current && box.works.some((x) => x.id === box.current) ? box.current : box.works[0].id);
          }
        }
      } catch (e) {}
      try {
        const t = await storage.get("setting-drawer-theme");
        if (t && t.value) setTheme(t.value);
      } catch (e) {}
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (works.length === 0) {
      const w = { id: uid(), name: "내 작품" };
      setWorks([w]);
      setWorkId(w.id);
      if (entriesRef.current.length) {
        mutate((prev) => prev.map((e) => (e.workId ? e : { ...e, workId: w.id })));
      }
      return;
    }
    const orphan = entriesRef.current.some((e) => !e.workId);
    if (orphan) mutate((prev) => prev.map((e) => (e.workId ? e : { ...e, workId: works[0].id })));
  }, [ready, works]);

  useEffect(() => {
    if (!ready || !works.length) return;
    storage
      .set("setting-drawer-works", JSON.stringify({ works, current: workId }))
      .catch(() => {});
  }, [works, workId, ready]);

  useEffect(() => {
    if (!ready) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await storage.set("setting-drawer", JSON.stringify(entries));
      } catch (e) {}
    }, 500);
    return () => clearTimeout(saveTimer.current);
  }, [entries, ready]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /* 글꼴을 실제로 내려받았는지 확인한다. 막히면 조용히 대체 글꼴로
     떨어지기 때문에, 그 사실을 화면에 알려 준다. */
  useEffect(() => {
    const href =
      "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap";
    if (!document.querySelector(`link[href="${href}"]`)) {
      const pre = document.createElement("link");
      pre.rel = "preconnect";
      pre.href = "https://fonts.gstatic.com";
      pre.crossOrigin = "anonymous";
      document.head.appendChild(pre);
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    if (!document.fonts || !document.fonts.ready) return;
    let alive = true;
    document.fonts.ready.then(() => {
      if (!alive) return;
      try {
        setFontOk(document.fonts.check('400 16px "Noto Sans KR"'));
      } catch (e) {}
    });
    return () => {
      alive = false;
    };
  }, []);

  function flipTheme() {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    if (storage) storage.set("setting-drawer-theme", t).catch(() => {});
  }

  /* 모든 변경은 여기를 지난다. ref를 즉시 갱신해 같은 틱에 두 번
     불려도 스냅샷이 어긋나지 않게 한다. */
  const mutate = useCallback((fn) => {
    const next = fn(entriesRef.current);
    entriesRef.current = next;
    setEntries(next);
    return next;
  }, []);

  const apply = useCallback(
    (msg, fn) => {
      const snapshot = entriesRef.current;
      mutate(fn);
      setToast({ msg, snapshot });
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 8000);
    },
    [mutate]
  );

  function undo() {
    if (!toast) return;
    entriesRef.current = toast.snapshot;
    setEntries(toast.snapshot);
    setToast(null);
    clearTimeout(toastTimer.current);
  }

  const source = file ? file.text : draft;
  const chunks = useMemo(() => (source.trim() ? toChunks(source) : []), [source]);
  const chunkCount = chunks.length;

  async function runChunk(text, known) {
  const prompt = `너는 소설 설정 문서를 관리하는 편집자다.
  원고를 읽고, 앞으로 설정집에서 다시 참고할 가치가 있는 정보를 추출한다.

  중요한 목표는 "단어를 분류하는 것"이 아니다.
  문장 전체와 주변 문맥을 읽고, 그 문장이 실제로 말하고 있는 설정 정보를 찾아내는 것이다.

<이미 알고 있는 항목>
${known || "아직 비어 있음"}
</이미 알고 있는 항목>

<원문>
${text}
</원문>

## 가장 중요한 원칙

1. 단어 단위로 분류하지 마라.
   명사나 고유명사가 등장했다는 이유만으로 그것을 설정 항목으로 만들지 마라.
   단, 조직·집단·세력으로 사용되는 명사는 예외적으로 적극적으로 추출한다. 조직 여부가 문맥에서 명확하다면 일반명사라는 이유로 생략하지 마라.

2. 먼저 문장의 의미를 이해한 뒤 설정 정보를 추출한다.
   다음 질문을 순서대로 생각한다.
   - 무엇이 존재하는가?
   - 그것은 무엇인가?
   - 어떤 특징이나 성질을 가지고 있는가?
   - 어떤 조직이나 집단이 존재하는가?
   - 어떤 장소가 존재하는가?
   - 어떤 규칙이나 제도가 적용되는가?
   - 어떤 힘이나 기술의 체계가 존재하는가?
   - 어떤 중요한 사건이나 변화가 일어났는가?

3. 하나의 문장에 여러 개의 독립적인 설정 정보가 있으면 여러 항목으로 나눌 수 있다.

4. 반대로 하나의 설정 정보를 여러 단어로 잘게 쪼개지 마라.

5. 문맥상 같은 대상을 다른 표현으로 부른 것이라면 새로운 항목을 만들지 말고 기존 항목에 합친다.

6. <이미 알고 있는 항목>에 이름과 의미가 일치하거나 사실상 같은 대상이 있으면 반드시 그 항목의 name을 정확히 그대로 사용한다.

7. 기존 항목과 관련된 새로운 정보는 기존 항목의 추가 설명으로 추출할 수 있다.

8. 기존 항목과 이름이 비슷하다는 이유만으로 합치지 마라.
   실제로 같은 대상을 가리키는지 문맥으로 판단한다.

9. 원문에 없는 사실을 추가하지 마라.
   추측, 세계관 보완, 상식에 의한 살붙이기를 금지한다.

## 설정 대상 발견 규칙

원문에서 다음과 같은 대상이 명확하게 언급되면 설정 항목 후보로 반드시 검토한다.

- 인물
- 조직·집단·세력
- 장소
- 사건
- 제도·규칙
- 능력·기술
- 물건·유물

특히 조직·집단·세력은 다른 설정을 설명하는 과정에서 등장하더라도 쉽게 생략하지 마라.

예를 들어 다음 문장에서:

"해군은 왕국의 해안을 방어한다."

해군은 단순한 일반 명사가 아니라 문장의 행위 주체인 군사 조직이다.
따라서 반드시 설정 항목 후보로 검토하고, 별도의 기존 해군 항목이 없다면 org 항목으로 추출한다.

"이바는 해군에 입대했다."

여기서도 해군은 입대의 대상이 되는 조직이므로 org 항목으로 추출한다.

"해군 사령관은 함대를 이끌었다."

여기서 해군은 사령관의 소속과 조직을 나타내므로 기존 해군 항목이 있다면 연결하고,
없다면 org 항목으로 추출한다.

조직이 문장의 핵심 주제가 아니더라도,
그 조직이 세계관에서 독립적인 집단으로 존재한다는 사실이 문맥에서 확인된다면 생략하지 마라.

## 분류 기준

category는 반드시 다음 중 하나만 사용한다.

character
- 특정 개인이나 개인으로 식별되는 인물. 한번이라도 언급된 적이 있다면 무조건 새로운 항목을 만든다.
캐릭터들 사이의 관계성에 대해서도 꼭 메모를 추가한다.

org
- 여러 구성원으로 이루어진 조직·집단·세력.
- 군대, 해군, 혁명군, 정부기관, 왕국, 제국, 길드, 종교단체, 정당, 학교, 회사, 기사단 등이 여기에 해당할 수 있다.
- 중요한 것은 단어 자체가 아니라 문맥에서 실제 집단이나 조직을 가리키는지 여부다.
- 예: "해군은 섬의 항구를 관리한다."에서 해군은 org다.
- 기존 항목에 동일하거나 비슷한 조직이 존재한다면 새로운 항목을 만들지 않는다.
대신 기존 항목의 name을 사용하여 해당 조직에 대한 새로운 정보를 기록한다.

예:
기존:
- 해군: 왕국의 군사 조직

원문:
"해군은 철의 섬에 함대를 파견했다."

결과:
{
  "category": "org",
  "name": "해군",
  "text": "철의 섬에 함대를 파견했다."
}

새로운 이름 "해군 함대"를 만들지 않는다.

place
- 특정 도시, 국가의 특정 지역, 섬, 산, 건물, 항구 등 특정할 수 있는 장소.

world
- 특정 장소 하나가 아니라 세계의 지형·기후·계절·자연환경·지리적 경향.

system
- 법, 제도, 신분, 화폐, 정치 체제, 관습, 복무 규정처럼 지속적으로 적용되는 규칙이나 운영 방식.
- 단순히 어떤 행동이 있었다는 이유만으로 system으로 만들지 마라.

power
- 마법, 이능, 초능력, 기술 등의 작동 원리와 체계, 대가와 한계.
- 그 힘을 사용하는 조직은 org이고, 그 힘을 구현하는 물건은 item이다.

event
- 특정 시점에 일어난 중요한 사건이나 행위.
- 전쟁, 혁명, 사고, 창설, 점령, 선언, 결정, 명령, 정책 시행, 제도 도입처럼 세계나 인물·조직의 상태를 변화시키는 일이 해당할 수 있다.
- 단순한 행동 묘사나 일상적인 동작도 event로 만들어라.
- 사건의 결과로 지속적인 제도나 규칙이 생겼다면 event와 system을 각각 추출할 수 있다.
- 단, 원문이 실제로 두 정보를 제공할 때만 그렇게 한다.

item
- 물건, 장비, 유물, 또는 설정상 독립적인 개념·용어.

etc
- 위 분류에 명확하게 속하지 않는 경우에만 사용한다.

## 문맥 판단 예시

예시 1:
"해군은 왕국의 해안을 지키는 군사 조직이다."

→ 해군 = org

예시 2:
"왕국은 모든 해군 복무를 의무화했다."

이 문장에는 여러 정보가 있을 수 있다.
- 왕국이 이미 알려진 독립적인 국가/세력이라면 기존 왕국 항목과 연결할 수 있다.
- 해군이 독립적인 조직으로 중요하다면 org로 추출할 수 있다.
- "해군 복무 의무화"는 세계의 상태를 변화시킨 중요한 조치라면 event로 추출할 수 있다.
- 지속적인 복무 제도가 실제로 설명되어 있다면 system으로도 추출할 수 있다.

단, 모든 문장에서 위 항목을 기계적으로 전부 생성하지 마라.
설정집에서 독립적으로 참고할 가치가 있는 정보인지 판단한다.

예시 3:
"왕국에서는 모든 시민이 열여덟 살이 되면 3년간 해군에서 복무해야 한다."

→ 해군 = org일 수 있다.
→ 18세부터 3년간 복무해야 한다는 규칙 = system
→ 문장만으로 별도의 event를 만들 필요는 없다.

예시 4:
"왕은 그날 해군 복무 의무화를 선포했다."

→ 왕 = character
→ 해군 = 기존 org가 있다면 그 이름을 그대로 사용
→ 해군 복무 의무화 선포 = event

## 항목을 추출할 때

- 한 문장에 여러 독립적인 대상과 사실이 있다면 적절히 분리한다.
- 하나의 항목에는 서로 직접 관련된 사실을 함께 담는다.
- 단순한 단어의 등장만으로 항목을 생성하지 않는다.
- 같은 대상에 대한 설명이 여러 문장에 걸쳐 있으면 하나의 항목으로 묶을 수 있다.
- 이름은 짧고 명확하게 만든다.
- 고유명사가 있으면 원문의 고유명사를 사용한다.
- 고유명사가 없으면 내용을 가장 잘 나타내는 짧은 이름을 만든다.
- text는 원문의 의미와 어감을 유지하면서 설정 문서에 적합하게 다듬는다.
- text는 1~2문장 이내로 작성한다.
- 원문에 없는 정보를 보충하지 않는다.
- 한 번에 최대 12개까지만 추출한다.
- 추출할 가치가 있는 것이 없으면 []을 출력한다.

## 출력

JSON 배열만 출력한다.
설명, 인사말, 마크다운 백틱은 절대 출력하지 않는다.

형식:
[
  {
    "category": "org",
    "name": "해군",
    "text": "왕국의 해안을 지키는 군사 조직."
  }
]`;

  const res = await fetch("/api/organize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prompt }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      data?.error || `API 오류 (${res.status})`
    );
  }

  if (!data || typeof data.text !== "string") {
    throw new Error("AI 응답이 올바르지 않습니다.");
  }
    return parseItems(data.text);
}

  async function organize() {
    if (!source.trim() || prog) return;
    setErr("");
    setPending(null);
    cancel.current = false;

    const list = chunks;
    const names = {};
    const wid = workId;
    entriesRef.current
      .filter((e) => e.workId === wid)
      .forEach((e) => (names[e.category] = names[e.category] || new Set()).add(e.name));
    const existing = new Set(
      entriesRef.current.filter((e) => e.workId === wid).map((e) => e.category + "\u0000" + e.name)
    );
    const collected = [];
    const seen = new Set();
    let failed = 0;
    let lastErr = "";

    setProg({ done: 0, total: list.length, found: 0, failed: 0 });

    for (let i = 0; i < list.length; i++) {
      if (cancel.current) break;
      const known = CATS
        .map((c) => {
          const entries = entriesRef.current
          .filter((e) => e.workId === wid && e.category === c.key)
          .slice(-60);

         if (!entries.length) return "";

        const lines = entries.map((e) => {
          const notes = Array.isArray(e.notes)
            ? e.notes
             .map((n) => String(n.text || "").trim())
              .filter(Boolean)
              .slice(-2)
              .join(" / ")
            : "";

         return notes
           ? `- ${e.name}: ${notes}`
           : `- ${e.name}`;
       });

       return `[${c.label}]\n${lines.join("\n")}`;
     })
      .filter(Boolean)
      .join("\n\n");

      let arr = null;
      for (let t = 0; t < 2 && arr === null; t++) {
        try {
          arr = await runChunk(list[i], known);
        } catch (e) {
          lastErr = e && e.message ? e.message : String(e);
          if (t === 1) failed++;
        }
      }

      (arr || []).forEach((x) => {
        if (!x || !x.text) return;
        const cat = fixCat(x.category);
        const name = String(x.name || "").trim() || "이름 없음";
        const text = String(x.text).trim();
        if (!text) return;
        const dupe = cat + "\u0000" + name + "\u0000" + text.slice(0, 40);
        if (seen.has(dupe)) return;
        seen.add(dupe);
        (names[cat] = names[cat] || new Set()).add(name);
        collected.push({
          id: uid(),
          category: cat,
          name,
          text,
          merge: existing.has(cat + "\u0000" + name),
          on: true,
        });
      });

      setProg({ done: i + 1, total: list.length, found: collected.length, failed });
    }

    setProg(null);
    if (!collected.length) {
      setErr(
        failed
          ? `읽어내지 못했습니다${lastErr ? ` — ${lastErr}` : ""}. 잠시 후 다시 시도해 보세요.`
          : "설정으로 남길 만한 내용이 보이지 않습니다."
      );
    } else {
      setPending(collected);
      if (failed) setErr(`조각 ${failed}개는 읽지 못하고 넘어갔습니다${lastErr ? ` — ${lastErr}` : ""}.`);
      const g = {};
      CATS.forEach((c) => (g[c.key] = collected.length <= 25));
      setGopen(g);
    }
  }

  function commit() {
    const list = pending.filter((p) => p.on);
    apply(`${list.length}개를 문서에 넣었습니다`, (prev) => {
      const next = [...prev];
      list.forEach((p) => {
        const nm = p.name.trim() || "이름 없음";
        const i = next.findIndex(
          (e) => e.workId === workId && e.category === p.category && e.name === nm
        );
        const note = { id: uid(), text: p.text };
        if (i >= 0) next[i] = { ...next[i], notes: [...next[i].notes, note] };
        else next.push({ id: uid(), workId, category: p.category, name: nm, notes: [note] });
      });
      return next;
    });
    setPending(null);
    setDraft("");
    setFile(null);
    setErr("");
  }

  const patch = useCallback(
    (id, fn) => mutate((p) => p.map((e) => (e.id === id ? fn(e) : e))),
    [mutate]
  );
  const setPend = (id, fn) => setPending((p) => p.map((x) => (x.id === id ? fn(x) : x)));

  /* dest 는 항목 id, 또는 "new:카테고리키" */
  const moveNotes = useCallback(
    (ids, dest) => {
      if (!ids || !ids.length || !dest) return;
      const set = new Set(ids);
      const moving = [];
      entriesRef.current.forEach((e) => e.notes.forEach((n) => set.has(n.id) && moving.push(n)));
      if (!moving.length) return;

      const wid = workIdRef.current;
      const isNew = dest.startsWith("new:");
      const target = isNew ? null : entriesRef.current.find((e) => e.id === dest);
      if (!isNew && !target) return;
      const where = isNew ? `${catOf(dest.slice(4)).label}의 새 항목` : `'${target.name}'`;

      apply(`메모 ${moving.length}개를 ${where}(으)로 옮겼습니다`, (prev) => {
        let next = prev.map((e) => ({ ...e, notes: e.notes.filter((n) => !set.has(n.id)) }));
        if (isNew) {
          const cat = isCat(dest.slice(4)) ? dest.slice(4) : "etc";
          next = [
            ...next,
            { id: uid(), workId: wid, category: cat, name: snippet(moving[0].text), notes: moving },
          ];
        } else {
          next = next.map((e) => (e.id === dest ? { ...e, notes: [...e.notes, ...moving] } : e));
        }
        return next;
      });
      setPickedN([]);
    },
    [apply]
  );

  const deleteNotes = useCallback(
    (ids) => {
      if (!ids.length) return;
      const set = new Set(ids);
      apply(`메모 ${ids.length}개를 지웠습니다`, (prev) =>
        prev.map((e) => ({ ...e, notes: e.notes.filter((n) => !set.has(n.id)) }))
      );
      setPickedN([]);
    },
    [apply]
  );

  function replaceAll() {
    if (!find.trim()) return;
    let hits = 0;
    entriesRef.current.forEach((e) => {
      if (e.name.includes(find)) hits += e.name.split(find).length - 1;
      e.notes.forEach((n) => {
        if (n.text.includes(find)) hits += n.text.split(find).length - 1;
      });
    });
    if (!hits) {
      setErr(`'${find}'을(를) 찾지 못했습니다.`);
      return;
    }
    setErr("");
    apply(`${hits}곳을 '${repl}'로 바꿨습니다`, (prev) =>
      prev.map((e) => ({
        ...e,
        name: e.name.split(find).join(repl),
        notes: e.notes.map((n) => ({ ...n, text: n.text.split(find).join(repl) })),
      }))
    );
    setFind("");
    setRepl("");
    setRepOpen(false);
  }

  /* ── 드래그 ──
     grip 자체를 draggable로 둔다. 컨테이너에 mousedown으로 draggable을
     켜는 방식은 Firefox에서 첫 드래그가 씹힌다. */
  const startDrag = (payload) => (ev) => {
    ev.stopPropagation();
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = "move";
      try {
        ev.dataTransfer.setData("text/plain", payload.id);
      } catch (e) {}
    }
    drag.current = payload;
    setDragId(payload.id);
    setDragKind(payload.type);
  };

  const endDrag = () => {
    drag.current = null;
    setDragId(null);
    setDragKind(null);
    setOver(null);
  };

  function dropOnCategory(cat) {
    const d = drag.current;
    if (!d) return;
    if (d.type === "pending") {
      setPend(d.id, (x) => ({ ...x, category: cat }));
      setGopen((g) => ({ ...g, [cat]: true }));
    }
  }

  function loadFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      setFile({ name: f.name, text: String(r.result) });
      setErr("");
    };
    r.onerror = () => setErr("파일을 읽지 못했습니다. txt나 md 파일인지 확인해 주세요.");
    r.readAsText(f);
  }

  function exportMd() {
    const title = (work && work.name) || "설정집";
    let md = `# ${title}\n`;
    CATS.forEach((c) => {
      const list = mine.filter((e) => e.category === c.key);
      if (!list.length) return;
      md += `\n## ${c.label}\n`;
      list.forEach((e) => {
        md += `\n### ${e.name}\n`;
        e.notes.forEach((n) => (md += `- ${n.text}\n`));
      });
    });
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const viewing = viewId ? entries.find((e) => e.id === viewId && e.workId === workId) : null;
  const allPicked =
    viewing && viewing.notes.length > 0 && viewing.notes.every((n) => pickedN.includes(n.id));

  function closeView() {
    setViewId(null);
    setPickMode(false);
    setPickedN([]);
  }

  const mine = entries.filter((e) => e.workId === workId);
  const work = works.find((w) => w.id === workId) || null;

  const locked = !!(work && work.locked);
  const sortable = filter === "all" && !q.trim() && !locked;

  function toggleLock() {
    setWorks((ws) => ws.map((w) => (w.id === workId ? { ...w, locked: !w.locked } : w)));
    setWorkEdit(null);
    setDelArmed(false);
    if (!locked) {
      setPickMode(false);
      setPickedN([]);
    }
  }

  /* 작품 탭 순서 */
  function moveWork(dir) {
    setWorks((ws) => {
      const i = ws.findIndex((w) => w.id === workId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ws.length) return ws;
      const next = [...ws];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /* 항목 순서: 같은 작품 안에서 앞뒤 항목과 자리를 바꾼다 */
  function moveEntry(id, dir) {
    mutate((prev) => {
      const idx = prev.map((e, i) => (e.workId === workId ? i : -1)).filter((i) => i >= 0);
      const at = idx.indexOf(prev.findIndex((e) => e.id === id));
      if (at < 0) return prev;
      const to = at + dir;
      if (to < 0 || to >= idx.length) return prev;
      const next = [...prev];
      [next[idx[at]], next[idx[to]]] = [next[idx[to]], next[idx[at]]];
      return next;
    });
  }

  function switchWork(id) {
    setWorkId(id);
    setViewId(null);
    setPickMode(false);
    setPickedN([]);
    setFilter("all");
    setQ("");
    setDelArmed(false);
    setWorkEdit(null);
  }

  function saveWorkEdit() {
    const name = (workEdit.value || "").trim();
    if (!name) return;
    if (workEdit.mode === "new") {
      const w = { id: uid(), name };
      setWorks((ws) => [...ws, w]);
      switchWork(w.id);
    } else {
      setWorks((ws) => ws.map((w) => (w.id === workId ? { ...w, name } : w)));
    }
    setWorkEdit(null);
  }

  function deleteWork() {
    if (!work) return;
    const rest = works.filter((w) => w.id !== workId);
    apply(`작품 '${work.name}'을(를) 지웠습니다`, (prev) => prev.filter((e) => e.workId !== workId));
    setWorks(rest);
    setViewId(null);
    setDelArmed(false);
    if (rest.length) switchWork(rest[0].id);
    else {
      const w = { id: uid(), name: "내 작품" };
      setWorks([w]);
      setWorkId(w.id);
    }
  }

  const shown = mine.filter(
    (e) =>
      (filter === "all" || e.category === filter) &&
      (!q.trim() || e.name.includes(q.trim()) || e.notes.some((n) => n.text.includes(q.trim())))
  );
  const noteCount = mine.reduce((s, e) => s + e.notes.length, 0);

  return (
    <>
      <style>{CSS}</style>
      <div className="sd-root" data-theme={theme}>
        <div className="sd-wrap">
          <header className="sd-head">
            <div>
              <h1 className="sd-title">설정 문서</h1>
              <p className="sd-sub">{work ? `${work.name} · 쏟아내면 항목별로 나눠 넣어 둡니다` : "쏟아내거나 원고째로 넣으면 항목별로 나눠 넣어 둡니다"}</p>
            </div>
            <div className="sd-right">
              <span className="sd-count">
                항목 {entries.length} · 메모 {noteCount}
              </span>
              {!fontOk && (
                <span className="sd-count" title="외부 글꼴 요청이 막혀 기본 글꼴로 보이는 중입니다">
                  글꼴 불러오기 실패
                </span>
              )}
              <button className="sd-mini" onClick={flipTheme}>
                {theme === "dark" ? "밝게" : "어둡게"}
              </button>
            </div>
          </header>

          <div className="sd-works">
            {works.map((w) => (
              <button
                key={w.id}
                className={"sd-wtab" + (w.id === workId ? " on" : "")}
                onClick={() => switchWork(w.id)}
              >
                {w.locked ? "🔒 " : ""}
                {w.name}
                <span className="num">{entries.filter((e) => e.workId === w.id).length}</span>
              </button>
            ))}
            <button
              className="sd-mini"
              onClick={() => {
                setWorkEdit({ mode: "new", value: "" });
                setDelArmed(false);
              }}
            >
              ＋ 새 작품
            </button>
            {work && (
              <>
                <span className="sd-div" />
                <button
                  className="sd-mini"
                  disabled={works.findIndex((w) => w.id === workId) === 0}
                  title="작품 순서 앞으로"
                  onClick={() => moveWork(-1)}
                >
                  ◀
                </button>
                <button
                  className="sd-mini"
                  disabled={works.findIndex((w) => w.id === workId) === works.length - 1}
                  title="작품 순서 뒤로"
                  onClick={() => moveWork(1)}
                >
                  ▶
                </button>
                <span className="sd-div" />
                <button className="sd-mini" onClick={toggleLock}>
                  {locked ? "🔓 잠금 풀기" : "🔒 잠그기"}
                </button>
                {!locked && (
                  <>
                    <button
                      className="sd-mini"
                      onClick={() => {
                        setWorkEdit({ mode: "rename", value: work.name });
                        setDelArmed(false);
                      }}
                    >
                      이름 바꾸기
                    </button>
                    <button
                      className="sd-mini warn"
                      onClick={() => (delArmed ? deleteWork() : setDelArmed(true))}
                      onBlur={() => setDelArmed(false)}
                    >
                      {delArmed ? `정말 지울까요? 항목 ${mine.length}개가 함께 사라집니다` : "작품 지우기"}
                    </button>
                  </>
                )}
              </>
            )}

            {workEdit && (
              <div className="sd-wedit">
                <input
                  className="sd-inp"
                  autoFocus
                  style={{ width: 200 }}
                  value={workEdit.value}
                  placeholder="작품 이름 (예: 아이언 링)"
                  onChange={(ev) => setWorkEdit((w2) => ({ ...w2, value: ev.target.value }))}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter") saveWorkEdit();
                    if (ev.key === "Escape") setWorkEdit(null);
                  }}
                />
                <button className="sd-mini" disabled={!workEdit.value.trim()} onClick={saveWorkEdit}>
                  {workEdit.mode === "new" ? "만들기" : "저장"}
                </button>
                <button className="sd-mini" onClick={() => setWorkEdit(null)}>
                  취소
                </button>
              </div>
            )}
          </div>

          {viewing ? (
            <section className="sd-detail">
              <div className="sd-dtop">
                <button className="sd-mini" onClick={closeView}>
                  ← 목록으로
                </button>
                <span className="sd-dcat">
                  <span className="sd-dot" style={{ background: `var(--c-${viewing.category})` }} />
                  {catOf(viewing.category).label}
                </span>
                <span className="sd-count">메모 {viewing.notes.length}</span>
                {locked && <span className="sd-count">🔒 잠김</span>}
                <button
                  className="sd-mini warn"
                  style={{ marginLeft: "auto", display: locked ? "none" : undefined }}
                  onClick={() => {
                    apply(`'${viewing.name}'을(를) 지웠습니다`, (prev) => prev.filter((x) => x.id !== viewing.id));
                    closeView();
                  }}
                >
                  항목 지우기
                </button>
              </div>

              <input
                className="sd-dname"
                readOnly={locked}
                value={viewing.name}
                onChange={(ev) => patch(viewing.id, (x) => ({ ...x, name: ev.target.value }))}
              />

              <div className="sd-drow">
                <select
                  className="sd-sel"
                  disabled={locked}
                  value={viewing.category}
                  onChange={(ev) => patch(viewing.id, (x) => ({ ...x, category: ev.target.value }))}
                >
                  {CATS.map((c2) => (
                    <option key={c2.key} value={c2.key}>
                      {c2.label}
                    </option>
                  ))}
                </select>
                <button
                  className="sd-mini"
                  style={{ marginLeft: "auto", display: locked ? "none" : undefined }}
                  disabled={!viewing.notes.length}
                  onClick={() => {
                    setPickMode(!pickMode);
                    setPickedN([]);
                  }}
                >
                  {pickMode ? "고르기 끝" : "메모 골라 옮기기"}
                </button>
              </div>

              {pickMode && !locked && (
                <div className="sd-tools">
                  <span className="sd-tcount">메모 {pickedN.length}개 선택</span>
                  <button
                    className="sd-mini"
                    onClick={() => setPickedN(allPicked ? [] : viewing.notes.map((n) => n.id))}
                  >
                    {allPicked ? "선택 해제" : "전체 선택"}
                  </button>
                  <span className="sd-div" />
                  <MoveSelect
                    ids={pickedN}
                    entries={mine}
                    onMove={moveNotes}
                    disabled={!pickedN.length}
                    label="선택한 메모를 옮길 곳…"
                  />
                  <button className="sd-mini warn" disabled={!pickedN.length} onClick={() => deleteNotes(pickedN)}>
                    지우기
                  </button>
                </div>
              )}

              {viewing.notes.length === 0 && <div className="sd-nonote">메모가 없습니다</div>}
              {viewing.notes.map((n) => {
                const isPicked = pickedN.includes(n.id);
                return (
                  <div key={n.id} className={"sd-note" + (isPicked ? " picked" : "")}>
                    {pickMode && (
                      <input
                        type="checkbox"
                        className="sd-chk"
                        style={{ marginTop: 5 }}
                        checked={isPicked}
                        onChange={() =>
                          setPickedN((pv) => (pv.includes(n.id) ? pv.filter((x) => x !== n.id) : [...pv, n.id]))
                        }
                      />
                    )}
                    <textarea
                      className="sd-ntext"
                      rows={1}
                      readOnly={locked}
                      value={n.text}
                      ref={(el) => {
                        if (el) {
                          el.style.height = "auto";
                          el.style.height = el.scrollHeight + "px";
                        }
                      }}
                      onChange={(ev) =>
                        patch(viewing.id, (x) => ({
                          ...x,
                          notes: x.notes.map((m) => (m.id === n.id ? { ...m, text: ev.target.value } : m)),
                        }))
                      }
                    />
                    {!locked && (
                      <div className="sd-ntools">
                        <MoveSelect ids={[n.id]} entries={mine} onMove={moveNotes} label="옮기기…" />
                        <button className="sd-x" title="메모 지우기" onClick={() => deleteNotes([n.id])}>
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {!locked && (
                <button
                  className="sd-add"
                  onClick={() =>
                    patch(viewing.id, (x) => ({ ...x, notes: [...x.notes, { id: uid(), text: "" }] }))
                  }
                >
                  메모 직접 추가
                </button>
              )}
            </section>
          ) : (
          <div className="sd-grid">
            {/* 넣기 */}
            {locked ? (
              <section>
                <div className="sd-lockbar">
                  🔒 잠긴 문서입니다. 읽기만 되고 고칠 수 없습니다.
                </div>
                <p className="sd-hint">
                  위의 잠금 풀기를 누르면 다시 넣고 고칠 수 있습니다. 잠금은 이 작품에만 걸립니다.
                </p>
              </section>
            ) : (
            <section>
              <p className="sd-label">
                넣기
                {!file && (
                  <button
                    className="sd-mini"
                    style={{ marginLeft: "auto" }}
                    onClick={() => fileInput.current.click()}
                  >
                    원고 파일 불러오기
                  </button>
                )}
              </p>
              <input
                ref={fileInput}
                type="file"
                accept=".txt,.md,.markdown,text/plain"
                style={{ display: "none" }}
                onChange={(e) => {
                  loadFile(e.target.files[0]);
                  e.target.value = "";
                }}
              />

              {file ? (
                <div className="sd-file">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sd-fname">{file.name}</div>
                    <div className="sd-fmeta">
                      {file.text.length.toLocaleString()}자 · 조각 {chunkCount}개
                    </div>
                  </div>
                  <button className="sd-mini" onClick={() => setFile(null)} disabled={!!prog}>
                    빼기
                  </button>
                </div>
              ) : (
                <textarea
                  className="sd-ta"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    "카엘은 스물셋, 왼쪽 눈에 흉터가 있다. 말수가 적고 검을 왼손으로 쓴다.\n은빛 골짜기는 일 년 내내 안개가 걷히지 않는 곳. 여기 사는 사람들은 소리로 길을 찾는다.\n재의 형제단은 마법을 쓰는 자를 색출하는 조직인데 정작 단장이 마법사다..."
                  }
                />
              )}

              {prog ? (
                <>
                  <div className="sd-bar">
                    <i style={{ width: `${(prog.done / prog.total) * 100}%` }} />
                  </div>
                  <div className="sd-row" style={{ marginTop: 4 }}>
                    <span className="sd-prog">
                      조각 {prog.done} / {prog.total} · 찾은 항목 {prog.found}
                      {prog.failed ? ` · 건너뜀 ${prog.failed}` : ""}
                    </span>
                    <button
                      className="sd-mini"
                      style={{ marginLeft: "auto" }}
                      onClick={() => (cancel.current = true)}
                    >
                      여기까지만
                    </button>
                  </div>
                </>
              ) : (
                <div className="sd-row">
                  <button className="sd-btn" onClick={organize} disabled={!source.trim()}>
                    정리하기
                  </button>
                  {chunkCount > 1 && <span className="sd-prog">조각 {chunkCount}개로 나눠 읽습니다</span>}
                  {draft && !file && (
                    <button className="sd-btn ghost" onClick={() => setDraft("")}>
                      비우기
                    </button>
                  )}
                </div>
              )}

              {err && <p className="sd-err">{err}</p>}
              {!err && !pending && !prog && (
                <p className="sd-hint">
                  문장을 다듬지 않아도 됩니다. 긴 문단이나 마침표 없이 이어지는 문장도 알아서 끊어 읽고, 앞
                  조각에서 찾은 이름을 뒤 조각이 이어받아 같은 인물이 흩어지지 않습니다.
                </p>
              )}

              {/* 검토 */}
              {pending && (
                <div className="sd-pending">
                  <p className="sd-label">
                    이렇게 나눴습니다 · 확인 후 넣기
                    <button
                      className="sd-mini"
                      style={{ marginLeft: "auto" }}
                      onClick={() => {
                        const all = pending.every((p) => p.on);
                        setPending((ps) => ps.map((p) => ({ ...p, on: !all })));
                      }}
                    >
                      {pending.every((p) => p.on) ? "전체 해제" : "전체 선택"}
                    </button>
                  </p>

                  {CATS.map((c) => {
                    const list = pending.filter((p) => p.category === c.key);
                    const isOpen = gopen[c.key];
                    if (!list.length && dragKind !== "pending") return null;
                    return (
                      <div key={c.key}>
                        <div
                          className={"sd-gtitle" + (over === "g" + c.key ? " sd-over" : "")}
                          onClick={() => setGopen((g) => ({ ...g, [c.key]: !isOpen }))}
                          onDragOver={(ev) => {
                            if (drag.current && drag.current.type === "pending") {
                              ev.preventDefault();
                              setOver("g" + c.key);
                            }
                          }}
                          onDragLeave={() => setOver(null)}
                          onDrop={(ev) => {
                            ev.preventDefault();
                            dropOnCategory(c.key);
                            endDrag();
                          }}
                        >
                          <span className="sd-dot" style={{ background: `var(--c-${c.key})` }} />
                          <span style={{ fontWeight: 500 }}>{c.label}</span>
                          <span className="sd-gnum">
                            {list.filter((p) => p.on).length}/{list.length} {isOpen ? "−" : "+"}
                          </span>
                        </div>
                        {isOpen &&
                          list.map((p) => (
                            <div
                              key={p.id}
                              className={"sd-pcard" + (p.on ? "" : " off") + (dragId === p.id ? " dragging" : "")}
                              style={{ borderLeftColor: `var(--c-${p.category})` }}
                            >
                              <div className="sd-ptop">
                                <span
                                  className="sd-grip"
                                  style={{ opacity: 1 }}
                                  title="끌어서 다른 분류로"
                                  draggable
                                  onDragStart={startDrag({ type: "pending", id: p.id })}
                                  onDragEnd={endDrag}
                                >
                                  ⠿
                                </span>
                                <input
                                  type="checkbox"
                                  className="sd-chk"
                                  checked={p.on}
                                  onChange={() => setPend(p.id, (x) => ({ ...x, on: !x.on }))}
                                />
                                <input
                                  className="sd-name"
                                  value={p.name}
                                  onChange={(e) => setPend(p.id, (x) => ({ ...x, name: e.target.value }))}
                                />
                                {p.merge && <span className="sd-tag">기존에 추가</span>}
                                <select
                                  className="sd-sel"
                                  value={p.category}
                                  onChange={(e) => setPend(p.id, (x) => ({ ...x, category: e.target.value }))}
                                >
                                  {CATS.map((c2) => (
                                    <option key={c2.key} value={c2.key}>
                                      {c2.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <p className="sd-ptext">{p.text}</p>
                            </div>
                          ))}
                      </div>
                    );
                  })}

                  <div className="sd-row">
                    <button className="sd-btn" onClick={commit} disabled={!pending.some((p) => p.on)}>
                      문서에 넣기 ({pending.filter((p) => p.on).length})
                    </button>
                    <button className="sd-btn ghost" onClick={() => setPending(null)}>
                      취소
                    </button>
                  </div>
                </div>
              )}
            </section>
            )}

            {/* 문서 — 목록 */}
            <section>
              <div className="sd-filters">
                <button className={"sd-chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>
                  전체 <span className="num">{mine.length}</span>
                </button>
                {CATS.map((c) => {
                  const n = mine.filter((e) => e.category === c.key).length;
                  if (!n) return null;
                  return (
                    <button
                      key={c.key}
                      className={"sd-chip" + (filter === c.key ? " on" : "")}
                      onClick={() => setFilter(c.key)}
                    >
                      <span className="sd-dot" style={{ background: `var(--c-${c.key})` }} />
                      {c.label} <span className="num">{n}</span>
                    </button>
                  );
                })}
                {mine.length > 0 && (
                  <>
                    <input
                      className="sd-search"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="찾기"
                    />
                    {!locked && (
                      <button
                        className="sd-mini"
                        style={{ marginLeft: "auto" }}
                        onClick={() => setRepOpen(!repOpen)}
                      >
                        찾아 바꾸기
                      </button>
                    )}
                    <button className="sd-mini" onClick={exportMd}>
                      내려받기 .md
                    </button>
                  </>
                )}
              </div>

              {repOpen && !locked && (
                <div className="sd-tools">
                  <input
                    className="sd-inp"
                    value={find}
                    onChange={(e) => setFind(e.target.value)}
                    placeholder="바꿀 말"
                  />
                  <span style={{ color: "var(--faint)" }}>→</span>
                  <input
                    className="sd-inp"
                    value={repl}
                    onChange={(e) => setRepl(e.target.value)}
                    placeholder="새 말"
                  />
                  <button className="sd-mini" disabled={!find.trim()} onClick={replaceAll}>
                    바꾸기
                  </button>
                  <span className="sd-tcount">문서 전체의 이름과 메모에서 바꿉니다</span>
                </div>
              )}

              {shown.length === 0 ? (
                <div className="sd-empty">
                  <p>{mine.length ? "찾는 항목이 없습니다" : "문서가 비어 있습니다"}</p>
                  <span>
                    {mine.length ? "다른 말로 찾아보세요" : "왼쪽에 아무렇게나 적거나 원고 파일을 넣어보세요"}
                  </span>
                </div>
              ) : (
                shown.map((e, i) => {
                  const key = q.trim();
                  const hit = key ? e.notes.find((n) => n.text.includes(key)) : null;
                  const preview = (hit || e.notes[0] || {}).text || "";
                  return (
                    <article
                      key={e.id}
                      className="sd-card"
                      style={{ borderLeftColor: `var(--c-${e.category})` }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setViewId(e.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          setViewId(e.id);
                        }
                      }}
                    >
                      <div className="sd-ctop">
                        <span className="sd-cname">{e.name}</span>
                        <span className="sd-ccat">{catOf(e.category).label}</span>
                        <span className="sd-enum">메모 {e.notes.length}</span>
                        {sortable && (
                          <span className="sd-ord" onClick={(ev) => ev.stopPropagation()}>
                            <button
                              className="sd-ob"
                              title="위로"
                              disabled={i === 0}
                              onClick={() => moveEntry(e.id, -1)}
                            >
                              ▲
                            </button>
                            <button
                              className="sd-ob"
                              title="아래로"
                              disabled={i === shown.length - 1}
                              onClick={() => moveEntry(e.id, 1)}
                            >
                              ▼
                            </button>
                          </span>
                        )}
                      </div>
                      <p className={"sd-preview" + (preview ? "" : " none")}>
                        {preview || "메모가 없습니다"}
                      </p>
                    </article>
                  );
                })
              )}
            </section>
          </div>
          )}
        </div>

        {toast && (
          <div className="sd-toast">
            <span>{toast.msg}</span>
            <button className="sd-undo" onClick={undo}>
              되돌리기
            </button>
            <button className="sd-x" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        )}
      </div>
    </>
  );
}

