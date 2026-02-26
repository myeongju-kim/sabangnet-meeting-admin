// ===== Firebase (CDN) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    getFirestore, doc, setDoc, deleteDoc,
    collection, query, orderBy, limit, getDocs, serverTimestamp, Timestamp, getDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD36S7mRWj080VDFM30hhWIL3qtjU-TjbU",
    authDomain: "sabangnet-meeting-app.firebaseapp.com",
    projectId: "sabangnet-meeting-app",
    storageBucket: "sabangnet-meeting-app.firebasestorage.app",
    messagingSenderId: "841331066338",
    appId: "1:841331066338:web:428a498c4804eb80e825bb",
    measurementId: "G-VHDQZ7PB8B"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ===== UI refs =====
const $ = (id) => document.getElementById(id);
const authStateEl = $("authState");
const msgEl = $("msg");

const btnLogin = $("btnLogin");
const btnLogout = $("btnLogout");
const btnReload = $("btnReload");
const btnSave = $("btnSave");
const btnReset = $("btnReset");

const nameEl = $("name");
const dateEl = $("date");
const typeEl = $("type");
const tbody = $("tbody");

// Boards UI refs
const selectedPresenterPill = $("selectedPresenterPill");
const btnBoardsReload = $("btnBoardsReload");
const boardsTbody = $("boardsTbody");
const selectedQnaDateKeyPill = $("selectedQnaDateKeyPill");
const btnQnaReload = $("btnQnaReload");
const qnaTbody = $("qnaTbody");


// edit state
let currentDocId = null; // when editing existing doc
let selectedPresenterIdForBoards = null;
let selectedPresenterDateKeyForQna = null;

function showMsg(text, kind = "muted") {
    msgEl.innerHTML = "";
    const div = document.createElement("div");
    div.className = kind === "err" ? "err" : (kind === "ok" ? "ok" : "muted");
    div.textContent = text;
    msgEl.appendChild(div);
}

function yyyymmdd(dateStr) {
    // dateStr: "YYYY-MM-DD" -> number YYYYMMDD
    if (!dateStr) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    return Number(`${m[1]}${m[2]}${m[3]}`);
}

function slugName(name) {
    // 아주 단순 slug (영문/숫자/한글 남기고 공백 제거)
    return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[^0-9a-z가-힣]/g, "");
}

function buildDocId({ dateKey, name }) {
    return `${dateKey}_${slugName(name)}`;
}

function setFormDisabled(disabled) {
    [nameEl, dateEl, typeEl, btnSave, btnReset].forEach(el => el.disabled = disabled);
}

function resetForm() {
    currentDocId = null;
    nameEl.value = "";
    dateEl.value = "";
    typeEl.value = "GENERAL";
    btnSave.textContent = "저장(Insert/Update)";
}

async function login() {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
}

async function logout() {
    await signOut(auth);
}

async function upsertPresenter() {
    const name = nameEl.value.trim();
    const date = dateEl.value; // YYYY-MM-DD
    const type = typeEl.value;

    if (!name) return showMsg("이름을 입력하세요.", "err");
    const dateKey = yyyymmdd(date);
    if (!dateKey) return showMsg("일자를 선택하세요.", "err");

    const docId = currentDocId ?? buildDocId({ dateKey, name });

    // Presenter 문서 스키마
    const payload = {
        name,
        date,      // string
        dateKey,   // number for sort
        type,
        updatedAt: serverTimestamp(),
        // createdAt은 처음 insert 때만 의미 있지만, setDoc merge로 처리해도 OK
        createdAt: serverTimestamp(),
    };

    try {
        // merge:true => 있으면 update / 없으면 insert
        await setDoc(doc(db, "presenters", docId), payload, { merge: true });
        showMsg(`저장 완료: ${docId}`, "ok");
        resetForm();
        await loadPresenters();
    } catch (e) {
        console.error(e);
        showMsg(String(e?.message ?? e), "err");
    }
}

async function removePresenter(docId) {
    if (!confirm(`삭제할까요?\n\n${docId}`)) return;
    try {
        await deleteDoc(doc(db, "presenters", docId));
        showMsg(`삭제 완료: ${docId}`, "ok");
        await loadPresenters();
    } catch (e) {
        console.error(e);
        showMsg(String(e?.message ?? e), "err");
    }
}

function renderRows(rows) {
    tbody.innerHTML = "";
    if (!rows.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="6" class="muted">등록된 presenter가 없습니다.</td>`;
        tbody.appendChild(tr);
        return;
    }

    for (const r of rows) {
        const tr = document.createElement("tr");
        const docId = r.id;

        tr.innerHTML = `
        <td>${r.dateKey ?? ""}</td>
        <td>${r.date ?? ""}</td>
        <td>${escapeHtml(r.name ?? "")}</td>
        <td><span class="pill">${escapeHtml(r.type ?? "")}</span></td>
        <td class="mono">${escapeHtml(docId)}</td>
        <td>
          <button data-action="edit" data-id="${escapeAttr(docId)}">수정</button>
          <button data-action="delete" data-id="${escapeAttr(docId)}" class="danger">삭제</button>
        </td>
      `;
        tbody.appendChild(tr);
    }
}

function escapeHtml(s) {
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHtml(s); }

async function loadPresenters() {
    try {
        tbody.innerHTML = `<tr><td colspan="6" class="muted">불러오는 중...</td></tr>`;
        const q = query(collection(db, "presenters"), orderBy("dateKey", "desc"), limit(100));
        const snap = await getDocs(q);
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderRows(rows);
    } catch (e) {
        console.error(e);
        tbody.innerHTML = `<tr><td colspan="6" class="err">로드 실패: ${escapeHtml(String(e?.message ?? e))}</td></tr>`;
    }
}

// [ADD] util: createdAt 표시용
function formatCreatedAt(v) {
    // Firestore Timestamp 또는 null
    try {
        if (!v) return "";
        // Timestamp has toDate()
        if (typeof v.toDate === "function") {
            const d = v.toDate();
            const yy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            const hh = String(d.getHours()).padStart(2, "0");
            const mi = String(d.getMinutes()).padStart(2, "0");
            return `${yy}-${mm}-${dd} ${hh}:${mi}`;
        }
        return String(v);
    } catch {
        return "";
    }
}

function renderBoardsEmpty(message) {
    boardsTbody.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(message)}</td></tr>`;
}

function renderQnaEmpty(message) {
    qnaTbody.innerHTML = `<tr><td colspan="6" class="muted">${escapeHtml(message)}</td></tr>`;
}

function renderBoards(rows) {
    boardsTbody.innerHTML = "";
    if (!rows.length) {
        renderBoardsEmpty("댓글(boards)이 없습니다.");
        return;
    }

    for (const r of rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${escapeHtml(formatCreatedAt(r.createdAt))}</td>
      <td class="mono">${escapeHtml(r.nickname ?? "")}</td>
      <td class="boardText">${escapeHtml(r.message ?? "")}</td>
      <td>
        <button data-baction="delete" data-bid="${escapeAttr(r.id)}" class="danger">삭제</button>
      </td>
    `;
        boardsTbody.appendChild(tr);
    }
}

function timestampMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
    return 0;
}

function renderQna(rows) {
    qnaTbody.innerHTML = "";
    if (!rows.length) {
        renderQnaEmpty("QnA가 없습니다.");
        return;
    }

    for (const r of rows) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${escapeHtml(formatCreatedAt(r.createdAt))}</td>
      <td class="mono">${escapeHtml(r.to ?? "")}</td>
      <td class="qnaText">${escapeHtml(r.content ?? "")}</td>
      <td>${r.presenterDateKey ?? ""}</td>
      <td class="mono">${escapeHtml(r.id)}</td>
      <td>
        <button data-qaction="delete" data-qid="${escapeAttr(r.id)}" class="danger">삭제</button>
      </td>
    `;
        qnaTbody.appendChild(tr);
    }
}

async function loadBoards(presenterId) {
    if (!presenterId) {
        renderBoardsEmpty("발표자를 선택하세요.");
        return;
    }

    try {
        boardsTbody.innerHTML = `<tr><td colspan="4" class="muted">불러오는 중...</td></tr>`;

        // subcollection: presenters/{presenterId}/boards
        const boardsCol = collection(db, "presenters", presenterId, "boards");
        const q = query(boardsCol, orderBy("createdAt", "desc"), limit(200));
        const snap = await getDocs(q);

        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderBoards(rows);
    } catch (e) {
        console.error(e);
        renderBoardsEmpty(`로드 실패: ${escapeHtml(String(e?.message ?? e))}`);
    }
}

async function loadQna(dateKey = null) {
    try {
        renderQnaEmpty("불러오는 중...");

        let qnaQuery;
        if (dateKey === null || dateKey === undefined) {
            qnaQuery = query(collection(db, "qna"), orderBy("createdAt", "desc"), limit(200));
        } else {
            // where + limit 으로 조회 후 클라이언트 정렬하여 복합 인덱스 요구를 피함
            qnaQuery = query(collection(db, "qna"), where("presenterDateKey", "==", dateKey), limit(200));
        }

        const snap = await getDocs(qnaQuery);
        const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
        renderQna(rows);
    } catch (e) {
        console.error(e);
        renderQnaEmpty(`로드 실패: ${escapeHtml(String(e?.message ?? e))}`);
    }
}

async function deleteBoard(presenterId, boardId) {
    if (!presenterId || !boardId) return;
    if (!confirm(`댓글을 삭제할까요?\n\npresenter: ${presenterId}\nboard: ${boardId}`)) return;

    try {
        await deleteDoc(doc(db, "presenters", presenterId, "boards", boardId));
        showMsg(`댓글 삭제 완료: ${boardId}`, "ok");
        await loadBoards(presenterId);
    } catch (e) {
        console.error(e);
        showMsg(String(e?.message ?? e), "err");
    }
}

async function deleteQna(qnaId) {
    if (!qnaId) return;
    if (!confirm(`QnA를 삭제할까요?\n\nqnaId: ${qnaId}`)) return;

    try {
        await deleteDoc(doc(db, "qna", qnaId));
        showMsg(`QnA 삭제 완료: ${qnaId}`, "ok");
        await loadQna(selectedPresenterDateKeyForQna);
    } catch (e) {
        console.error(e);
        showMsg(String(e?.message ?? e), "err");
    }
}


// Row actions: edit/delete
tbody.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button");
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;

    if (action === "delete") {
        removePresenter(id);
        return;
    }

    if (action === "edit") {
        // 현재 화면에 렌더된 row에서 값 가져오기(간단하게)
        const tr = btn.closest("tr");
        const tds = tr.querySelectorAll("td");
        const dateKey = tds[0]?.textContent?.trim();
        const date = tds[1]?.textContent?.trim();
        const name = tds[2]?.textContent?.trim();
        const type = tr.querySelector(".pill")?.textContent?.trim();

        currentDocId = id;
        nameEl.value = name || "";
        dateEl.value = date || "";
        typeEl.value = type || "GENERAL";
        btnSave.textContent = `수정 저장 (${id})`;
        window.scrollTo({ top: 0, behavior: "smooth" });

        selectedPresenterIdForBoards = id;
        selectedPresenterPill.textContent = `선택된 발표자: ${id}`;
        btnBoardsReload.disabled = false;
        loadBoards(id);

        selectedPresenterDateKeyForQna = Number(dateKey) || null;
        selectedQnaDateKeyPill.textContent = selectedPresenterDateKeyForQna
            ? `선택된 presenterDateKey: ${selectedPresenterDateKeyForQna}`
            : "선택된 presenterDateKey: 전체";
        btnQnaReload.disabled = false;
        loadQna(selectedPresenterDateKeyForQna);

        return;
    }
});

// Auth state binding
onAuthStateChanged(auth, (user) => {
    const loggedIn = !!user;
    authStateEl.textContent = loggedIn
        ? `로그인됨: ${user.email ?? "(no email)"}`
        : "로그인 필요";

    btnLogin.disabled = loggedIn;
    btnLogout.disabled = !loggedIn;
    btnReload.disabled = !loggedIn;
    setFormDisabled(!loggedIn);

    if (!loggedIn) {
        tbody.innerHTML = `<tr><td colspan="6" class="muted">로그인 후 목록이 표시됩니다.</td></tr>`;
        boardsTbody.innerHTML = `<tr><td colspan="4" class="muted">로그인 후 목록이 표시됩니다.</td></tr>`;
        qnaTbody.innerHTML = `<tr><td colspan="6" class="muted">로그인 후 목록이 표시됩니다.</td></tr>`;
        selectedPresenterDateKeyForQna = null;
        selectedQnaDateKeyPill.textContent = "선택된 presenterDateKey: 전체";
        btnQnaReload.disabled = true;

        showMsg("Google 로그인 후 사용하세요.", "muted");
    } else {
        showMsg("로그인 완료. Presenter CRUD 가능.", "ok");
        loadPresenters();
        btnQnaReload.disabled = false;
        loadQna(null);
    }
});

// Button events
btnLogin.addEventListener("click", async () => {
    try { await login(); }
    catch (e) { showMsg(String(e?.message ?? e), "err"); }
});

btnLogout.addEventListener("click", async () => {
    try {
        await logout();
        resetForm();
    } catch (e) {
        showMsg(String(e?.message ?? e), "err");
    }
});

boardsTbody.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button");
    if (!btn) return;
    const action = btn.dataset.baction;
    const bid = btn.dataset.bid;
    if (action === "delete" && bid) {
        deleteBoard(selectedPresenterIdForBoards, bid);
    }
});

qnaTbody.addEventListener("click", (ev) => {
    const btn = ev.target?.closest?.("button");
    if (!btn) return;
    const action = btn.dataset.qaction;
    const qid = btn.dataset.qid;
    if (action === "delete" && qid) {
        deleteQna(qid);
    }
});

btnBoardsReload.addEventListener("click", () => {
    loadBoards(selectedPresenterIdForBoards);
});

btnQnaReload.addEventListener("click", () => {
    loadQna(selectedPresenterDateKeyForQna);
});



btnReload.addEventListener("click", loadPresenters);
btnSave.addEventListener("click", upsertPresenter);
btnReset.addEventListener("click", resetForm);

// 초기 상태
resetForm();
setFormDisabled(true);
btnLogout.disabled = true;
btnReload.disabled = true;
btnQnaReload.disabled = true;
