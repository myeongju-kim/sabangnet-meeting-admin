// ===== Firebase (CDN) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
    getFirestore, doc, setDoc, deleteDoc,
    collection, query, orderBy, limit, getDocs, serverTimestamp
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

// edit state
let currentDocId = null; // when editing existing doc

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
        showMsg("Google 로그인 후 사용하세요.", "muted");
    } else {
        showMsg("로그인 완료. Presenter CRUD 가능.", "ok");
        loadPresenters();
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

btnReload.addEventListener("click", loadPresenters);
btnSave.addEventListener("click", upsertPresenter);
btnReset.addEventListener("click", resetForm);

// 초기 상태
resetForm();
setFormDisabled(true);
btnLogout.disabled = true;
btnReload.disabled = true;
