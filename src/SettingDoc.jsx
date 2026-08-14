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
  --ink:#FAFAFA; --panel:#FAFAFA; --panel-2:#FAFAFA;
  --wash:rgba(12,9,13,.045);
  --line:#E2DFE3; --hair:#ECEAED;
  --text:#0C090D; --body:#3A363C; --muted:#5F5A66; --faint:#87818E;
  --focus:#2E8AA6; --danger:#E01A4F;
  --c-character:#E01A4F; --c-world:#0C090D; --c-place:#53B3CB;
  --c-org:#F15946; --c-event:#2196E3; --c-item:#F9C22E; --c-etc:#8A858F;
  --c-system:#4E7A4F; --c-power:#8A4FA8;
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
`;

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
    const prompt = `너는 소설 설정 문서를 관리하는 편집자다. 원고나 메모에서 설정에 해당하는 정보만 뽑아 항목별로 분류한다.

<이미 알고 있는 항목>
${known || "아직 비어 있음"}
</이미 알고 있는 항목>

<원문>
${text}
</원문>

규칙:
- 설정 정보만 뽑는다. 단순한 사건 묘사나 대사, 문장 표현은 무시한다. 인물의 성격·외양·이력, 장소의 특징, 조직의 성격, 세계의 규칙처럼 설정집에 남길 가치가 있는 것만.
- 뽑을 것이 없으면 빈 배열 []을 출력한다.
- category는 반드시 다음 중 하나:
  character(인물) / world(지형·기후·지리·자연환경·계절)
  system(제도·법·신분·화폐·정치 체제·관습처럼 사람이 만들어 굴러가는 규칙)
  power(마법·이능·기술 체계와 그 규칙, 대가와 한계)
  place(장소·지역) / org(단체·조직·세력)
  event(사건·사고·전쟁, 그리고 과거에 일어나 지금 세계를 만든 일까지)
  item(물건·개념·용어) / etc(그 외)
- world는 땅과 하늘의 생김새다. 지형, 기후, 계절, 자연환경만 넣는다. 종족이나 세계의 규칙은 넣지 마라.
- 마법이나 능력이라도 그 '규칙'이면 power, 그 힘을 쓰는 '조직'이면 org, '도구'면 item이다.
- 특정 지역 하나의 이야기면 place, 세계 전체의 지형·기후 경향이면 world다.
- 이미 알고 있는 항목에 관한 내용이면 name을 그 이름과 글자 하나까지 똑같이 쓴다.
- 새 대상이면 적절한 이름을 붙인다. 고유명사가 없으면 내용을 요약한 짧은 이름을 만든다.
- 한 문장에 여러 대상의 설정이 섞여 있으면 대상별로 나눠서 각각 항목으로 만든다.
- text는 원문의 표현과 어감을 살려 다듬되 두 줄을 넘기지 않는다.
- 한 번에 12개를 넘게 뽑지 않는다. 넘치면 중요한 것부터 고른다.
- 원문에 없는 정보를 지어내지 마라. 추측이나 살붙이기 금지.

JSON 배열만 출력한다. 설명, 인사말, 마크다운 백틱 모두 금지.
형식: [{"category":"character","name":"이름","text":"내용"}]`;

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
      const known = CATS.filter((c) => names[c.key] && names[c.key].size)
        .map((c) => `${c.label}: ${[...names[c.key]].slice(-60).join(", ")}`)
        .join("\n");

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

