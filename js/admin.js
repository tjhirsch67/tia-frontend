// ── Auth Check ────────────────────────────────────────────────────────────
if (!Auth.requireAuth(["admin"])) { throw new Error("Redirecting"); }

const { username } = Auth.getUser();
document.getElementById("navUsername").textContent = username;

document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("open");
});

// ── Tab Switching ─────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => {
            c.classList.remove("active");
        });
        btn.classList.add("active");
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
        if (btn.dataset.tab === "users") loadUsers();
        if (btn.dataset.tab === "records") loadRecords();
    });
});

document.querySelectorAll(".inner-tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        const parent = btn.closest(".card");
        parent.querySelectorAll(".inner-tab-btn").forEach(b => b.classList.remove("active"));
        parent.querySelectorAll(".inner-tab-content").forEach(c => {
            c.classList.remove("active");
            c.classList.add("hidden");
        });
        btn.classList.add("active");
        const target = document.getElementById(`inner-${btn.dataset.inner}`);
        target.classList.remove("hidden");
        target.classList.add("active");
    });
});

// ── Drop Zone Setup ───────────────────────────────────────────────────────
function setupDropZone(dropId, inputId) {
    const drop = document.getElementById(dropId);
    const input = document.getElementById(inputId);
    drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
    drop.addEventListener("drop", e => {
        e.preventDefault();
        drop.classList.remove("dragover");
        if (e.dataTransfer.files.length) {
            input.files = e.dataTransfer.files;
            drop.classList.add("has-file");
            drop.querySelector(".drop-zone-text").textContent = e.dataTransfer.files[0].name;
        }
    });
    input.addEventListener("change", () => {
        if (input.files.length) {
            drop.classList.add("has-file");
            drop.querySelector(".drop-zone-text").textContent = input.files[0].name;
        }
    });
}

setupDropZone("cmdbUpdateDrop", "cmdbUpdateFile");
setupDropZone("cmdbDeleteDrop", "cmdbDeleteFile");
setupDropZone("locUpdateDrop", "locUpdateFile");
setupDropZone("locDeleteDrop", "locDeleteFile");
setupDropZone("recordsImportDrop", "recordsImportFile");

// ── Show Message ──────────────────────────────────────────────────────────
function showMsg(id, text, isError = false) {
    const el = document.getElementById(id);
    el.className = isError ? "error-message" : "success-message";
    el.textContent = text;
    el.classList.remove("hidden");
    setTimeout(() => el.classList.add("hidden"), 6000);
}

// ── Confirm Modal ─────────────────────────────────────────────────────────
function showConfirm(title, message, onConfirm, requireTyping = false) {
    const modal = document.getElementById("confirmModal");
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    const extraInput = document.getElementById("confirmExtraInput");
    const input = document.getElementById("confirmInput");
    if (requireTyping) {
        extraInput.classList.remove("hidden");
        input.value = "";
        input.style.borderColor = "";
    } else {
        extraInput.classList.add("hidden");
    }
    modal.classList.remove("hidden");
    document.getElementById("confirmCancel").onclick = () => modal.classList.add("hidden");
    document.getElementById("confirmOk").onclick = () => {
        if (requireTyping && input.value !== "DELETE") {
            input.style.borderColor = "#c0392b";
            return;
        }
        modal.classList.add("hidden");
        onConfirm();
    };
}

// ── File Upload Helper ────────────────────────────────────────────────────
async function uploadFile(endpoint, fileInputId, msgId) {
    const input = document.getElementById(fileInputId);
    if (!input.files.length) {
        showMsg(msgId, "Please select a file first.", true);
        return;
    }
    const formData = new FormData();
    formData.append("file", input.files[0]);
    const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${Auth.getToken()}` },
        body: formData
    });
    const data = await res.json();
    if (res.ok) {
        const msg = data.inserted !== undefined
            ? `Done — Inserted: ${data.inserted}, Updated: ${data.updated ?? 0}, Deleted: ${data.deleted ?? 0}`
            : JSON.stringify(data);
        showMsg(msgId, msg);
    } else {
        showMsg(msgId, data.detail || "Upload failed.", true);
    }
}

// ── CSV Download Helper ───────────────────────────────────────────────────
async function downloadCSV(endpoint, filename, msgId) {
    const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
        headers: { "Authorization": `Bearer ${Auth.getToken()}` }
    });
    if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    } else {
        if (msgId) showMsg(msgId, "Export failed.", true);
    }
}

// ── Sample Templates ──────────────────────────────────────────────────────
document.getElementById("cmdbTemplateDl").addEventListener("click", (e) => {
    e.preventDefault();
    const csv = "serial,asset,mercy_id,manufacturer,model\nSERIAL123,PRT001,12345678,HP,LaserJet M507";
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "cmdb_template.csv";
    a.click();
});

document.getElementById("locTemplateDl").addEventListener("click", (e) => {
    e.preventDefault();
    const csv = "facility,street,city,state,zip\nMercy Hospital Example,123 Main Street,St. Louis,MO,63101";
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    a.download = "locations_template.csv";
    a.click();
});

// ── CMDB Actions ──────────────────────────────────────────────────────────
document.getElementById("cmdbUpdateBtn").addEventListener("click", () =>
    uploadFile("/cmdb/import", "cmdbUpdateFile", "cmdbUpdateMsg"));

document.getElementById("cmdbDeleteBtn").addEventListener("click", () => {
    showConfirm(
        "Delete CMDB Records",
        "This will permanently delete all matching CMDB records. This cannot be undone.",
        () => uploadFile("/cmdb/delete-batch", "cmdbDeleteFile", "cmdbDeleteMsg")
    );
});

document.getElementById("cmdbExportBtn").addEventListener("click", () =>
    downloadCSV("/cmdb/export", "cmdb_export.csv", "cmdbExportMsg"));

// ── Location Actions ──────────────────────────────────────────────────────
document.getElementById("locUpdateBtn").addEventListener("click", () =>
    uploadFile("/locations/import", "locUpdateFile", "locUpdateMsg"));

document.getElementById("locDeleteBtn").addEventListener("click", () => {
    showConfirm(
        "Delete Location Records",
        "This will permanently delete all matching location records. This cannot be undone.",
        () => uploadFile("/locations/delete-batch", "locDeleteFile", "locDeleteMsg")
    );
});

document.getElementById("locExportBtn").addEventListener("click", () =>
    downloadCSV("/locations/export", "locations_export.csv", "locExportMsg"));

// ── Records ───────────────────────────────────────────────────────────────
let recordsPage = 0;
const recordsLimit = 50;

async function loadRecords() {
    const res = await Auth.apiCall("GET", `/submissions/?skip=${recordsPage * recordsLimit}&limit=${recordsLimit}`);
    if (!res || !res.ok) return;
    const records = await res.json();
    const tbody = document.getElementById("recordsBody");
    tbody.innerHTML = "";
    records.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${r.id}</td>
            <td>${r.date ? r.date.slice(0,10) : ""}</td>
            <td>${r.service_type || ""}</td>
            <td>${r.serial || ""}</td>
            <td>${r.asset || ""}</td>
            <td>${r.manufacturer || ""}</td>
            <td>${r.model || ""}</td>
            <td>${r.location || r.location_manual || ""}</td>
            <td>${r.created_by || ""}</td>
            <td><button class="btn btn-danger btn-sm" onclick="deleteRecord(${r.id})">Delete</button></td>
        `;
        tbody.appendChild(tr);
    });
    document.getElementById("recordsPage").textContent = `Page ${recordsPage + 1}`;
    document.getElementById("recordsPrev").disabled = recordsPage === 0;
    document.getElementById("recordsNext").disabled = records.length < recordsLimit;
}

window.deleteRecord = function(id) {
    showConfirm(
        "Delete Record",
        `Are you sure you want to delete record #${id}? This cannot be undone.`,
        async () => {
            const res = await Auth.apiCall("DELETE", `/submissions/${id}`);
            if (res && res.ok) {
                showMsg("recordsMsg", `Record #${id} deleted.`);
                loadRecords();
            } else {
                showMsg("recordsMsg", "Delete failed.", true);
            }
        }
    );
};

document.getElementById("recordsPrev").addEventListener("click", () => {
    if (recordsPage > 0) { recordsPage--; loadRecords(); }
});
document.getElementById("recordsNext").addEventListener("click", () => {
    recordsPage++; loadRecords();
});

document.getElementById("recordsExportBtn").addEventListener("click", () =>
    downloadCSV("/reports/export?service_types=Install-New,Move,Hot%20Swap,Removal", "all_records.csv", "recordsMsg"));

document.getElementById("deleteAllBtn").addEventListener("click", () => {
    showConfirm(
        "Delete ALL Records",
        "This will permanently delete every record in the database. This cannot be undone.",
        async () => {
            const res = await Auth.apiCall("DELETE", "/submissions/all");
            if (res && res.ok) {
                showMsg("recordsMsg", "All records deleted.");
                loadRecords();
            } else {
                showMsg("recordsMsg", "Delete failed.", true);
            }
        },
        true
    );
});

document.getElementById("recordsImportToggle").addEventListener("click", () => {
    document.getElementById("recordsImportSection").classList.toggle("hidden");
});

document.getElementById("recordsImportBtn").addEventListener("click", () =>
    uploadFile("/submissions/import", "recordsImportFile", "recordsMsg"));

// ── Users ─────────────────────────────────────────────────────────────────
async function loadUsers() {
    const res = await Auth.apiCall("GET", "/users/");
    if (!res || !res.ok) return;
    const users = await res.json();
    const tbody = document.getElementById("usersBody");
    tbody.innerHTML = "";
    users.forEach(u => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${u.username}</td>
            <td>${u.email}</td>
            <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${u.role}</span></td>
            <td><span class="badge ${u.is_active ? 'badge-green' : 'badge-red'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
            <td style="display:flex; gap:6px; flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" onclick="toggleUser(${u.id}, ${u.is_active})">
                    ${u.is_active ? 'Disable' : 'Enable'}
                </button>
                <button class="btn btn-primary btn-sm" onclick="resetPassword(${u.id}, '${u.username}')">Reset PW</button>
                <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id}, '${u.username}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

document.getElementById("addUserBtn").addEventListener("click", async () => {
    const username = document.getElementById("newUsername").value.trim();
    const email = document.getElementById("newEmail").value.trim();
    const password = document.getElementById("newPassword").value;
    const role = document.getElementById("newRole").value;

    if (!username || !email || !password) {
        showMsg("userMsg", "All fields are required.", true);
        return;
    }

    const res = await Auth.apiCall("POST", "/users/", { username, email, password, role });
    if (res && res.ok) {
        showMsg("userMsg", `User "${username}" created.`);
        document.getElementById("newUsername").value = "";
        document.getElementById("newEmail").value = "";
        document.getElementById("newPassword").value = "";
        loadUsers();
    } else {
        const err = await res.json();
        showMsg("userMsg", err.detail || "Failed to create user.", true);
    }
});

window.toggleUser = function(id, isActive) {
    showConfirm(
        isActive ? "Disable User" : "Enable User",
        isActive ? "This user will no longer be able to log in." : "This user will be able to log in again.",
        async () => {
            const res = await Auth.apiCall("PUT", `/users/${id}`, { is_active: !isActive });
            if (res && res.ok) loadUsers();
        }
    );
};

window.deleteUser = function(id, username) {
    showConfirm(
        "Delete User",
        `Are you sure you want to delete user "${username}"? This cannot be undone.`,
        async () => {
            const res = await Auth.apiCall("DELETE", `/users/${id}`);
            if (res && res.ok) {
                showMsg("userMsg", `User "${username}" deleted.`);
                loadUsers();
            }
        }
    );
};

// ── Reset Password ────────────────────────────────────────────────────────
window.resetPassword = function(id, username) {
    const modal = document.getElementById("resetPasswordModal");
    document.getElementById("resetPasswordUser").textContent = `User: ${username}`;
    document.getElementById("resetPasswordInput").value = "";
    document.getElementById("resetPasswordMsg").classList.add("hidden");
    modal.classList.remove("hidden");

    document.getElementById("resetPasswordCancel").onclick = () => {
        modal.classList.add("hidden");
    };

    document.getElementById("resetPasswordOk").onclick = async () => {
        const password = document.getElementById("resetPasswordInput").value;
        const msgEl = document.getElementById("resetPasswordMsg");

        if (!password || password.length < 6) {
            msgEl.className = "error-message";
            msgEl.textContent = "Password must be at least 6 characters.";
            msgEl.classList.remove("hidden");
            return;
        }

        const res = await Auth.apiCall("PUT", `/users/${id}`, { password });
        if (res && res.ok) {
            modal.classList.add("hidden");
            showMsg("userMsg", `Password reset for "${username}".`);
        } else {
            msgEl.className = "error-message";
            msgEl.textContent = "Failed to reset password.";
            msgEl.classList.remove("hidden");
        }
    };
};