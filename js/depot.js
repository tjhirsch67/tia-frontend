// Depot Inventory page — Phase 5.3
// All TIA users can use this page (Auth.requireAuth with no role restriction).
// Status edit is intentionally limited to In Stock <-> In Maintenance; the
// Damaged In Transit transition uses its own action so each arrival produces
// exactly one damaged claim.

if (!Auth.requireAuth([])) { throw new Error("Redirecting"); }

const { username, role } = Auth.getUser();
document.getElementById("navUsername").textContent = username;
if (role === "admin") {
    document.getElementById("navAdmin").classList.remove("hidden");
}
if (role === "admin" || role === "tech_full") {
    document.getElementById("navReport").classList.remove("hidden");
}

// (We're on the depot page, so navDepot is visible regardless of the flag —
//  the flag only gates whether other pages show the link to get here.)

// Hamburger
document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("open");
});

// ── State ──────────────────────────────────────────────────────────────────
let depotSites = [];
let currentFacility = null;
let inventoryRows = [];

// ── Helpers ────────────────────────────────────────────────────────────────
function showError(msg) {
    const el = document.getElementById("pageError");
    el.textContent = msg;
    el.classList.remove("hidden");
    document.getElementById("pageSuccess").classList.add("hidden");
    setTimeout(() => el.classList.add("hidden"), 6000);
}

function showSuccess(msg) {
    const el = document.getElementById("pageSuccess");
    el.textContent = msg;
    el.classList.remove("hidden");
    document.getElementById("pageError").classList.add("hidden");
    setTimeout(() => el.classList.add("hidden"), 4000);
}

function statusBadge(status) {
    const cls = {
        "In Stock":           "badge-green",
        "In Maintenance":     "badge-gray",
        "New Damaged":        "badge-red",
        "In Transit":         "badge-blue",
        "Damaged In Transit": "badge-red",
    }[status] || "badge-gray";
    return `<span class="badge ${cls}">${status}</span>`;
}

function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US");
}

function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// ── Load depot sites ───────────────────────────────────────────────────────
async function loadDepotSites() {
    const res = await Auth.apiCall("GET", "/depot/sites");
    if (!res || !res.ok) {
        showError("Failed to load depot sites.");
        return;
    }
    depotSites = await res.json();
    const sel = document.getElementById("depotSelect");
    sel.innerHTML = '<option value="">-- Select a depot --</option>';
    depotSites.forEach(site => {
        const opt = document.createElement("option");
        opt.value = site.facility;
        opt.textContent = site.facility;
        sel.appendChild(opt);
    });
}

// ── Load depot inventory ──────────────────────────────────────────────────
async function loadDepotInventory(facility) {
    currentFacility = facility;
    document.getElementById("inventoryCard").style.display = "";
    document.getElementById("inventoryTitle").textContent = facility;
    document.getElementById("inventoryCount").textContent = "";
    document.getElementById("inventoryBody").innerHTML =
        '<tr><td colspan="8" style="text-align:center; padding:20px; color:#666;">Loading…</td></tr>';
    document.getElementById("refreshBtn").disabled = false;

    const res = await Auth.apiCall(
        "GET",
        `/depot/inventory?facility=${encodeURIComponent(facility)}`
    );
    if (!res || !res.ok) {
        showError("Failed to load inventory for this depot.");
        document.getElementById("inventoryBody").innerHTML =
            '<tr><td colspan="8" style="text-align:center; padding:20px; color:#c0392b;">Failed to load.</td></tr>';
        return;
    }
    inventoryRows = await res.json();
    renderInventoryTable();
}

function renderInventoryTable() {
    const tbody = document.getElementById("inventoryBody");
    document.getElementById("inventoryCount").textContent =
        `(${inventoryRows.length} ${inventoryRows.length === 1 ? "device" : "devices"})`;

    if (!inventoryRows.length) {
        tbody.innerHTML =
            '<tr><td colspan="8" style="text-align:center; padding:20px; color:#666;">No devices at this depot.</td></tr>';
        return;
    }

    tbody.innerHTML = inventoryRows.map(r => {
        const status = r.status;
        let actions = "";
        if (status === "In Transit") {
            actions = `
                <button class="btn btn-primary btn-sm" data-action="check-in" data-serial="${escapeHtml(r.serial)}">Check In</button>
                <button class="btn btn-secondary btn-sm" data-action="damaged" data-serial="${escapeHtml(r.serial)}" style="background:#fdecea; color:#c0392b; border:1px solid #c0392b;">Damaged</button>
            `;
        } else if (status === "In Stock" || status === "In Maintenance") {
            actions = `<button class="btn btn-secondary btn-sm" data-action="edit" data-serial="${escapeHtml(r.serial)}">Edit</button>`;
        } else if (status === "Damaged In Transit") {
            actions = `<span style="color:#666; font-size:0.85rem;">Close claim in IMS</span>`;
        }

        return `<tr>
            <td><strong>${escapeHtml(r.serial)}</strong></td>
            <td>${escapeHtml(r.asset_tag)}</td>
            <td>${escapeHtml(r.mercy_id)}</td>
            <td>${escapeHtml(r.manufacturer)}</td>
            <td>${escapeHtml(r.model)}</td>
            <td>${statusBadge(status)}</td>
            <td>${formatDate(r.receive_date)}</td>
            <td style="white-space:nowrap;">${actions}</td>
        </tr>`;
    }).join("");

    // Wire row action buttons
    tbody.querySelectorAll("button[data-action]").forEach(btn => {
        const action = btn.getAttribute("data-action");
        const serial = btn.getAttribute("data-serial");
        btn.addEventListener("click", () => {
            const row = inventoryRows.find(x => x.serial === serial);
            if (!row) return;
            if (action === "check-in")    openCheckInModal(row);
            else if (action === "damaged") openDamagedModal(row);
            else if (action === "edit")    openEditModal(row);
        });
    });
}

// ── Check In ──────────────────────────────────────────────────────────────
let checkInTarget = null;

function openCheckInModal(row) {
    checkInTarget = row;
    document.getElementById("checkInSerial").textContent = row.serial;
    document.getElementById("checkInMfrModel").textContent = `${row.manufacturer} ${row.model}`;
    document.getElementById("checkInError").classList.add("hidden");
    document.getElementById("checkInModal").classList.remove("hidden");
}

document.getElementById("checkInCancel").addEventListener("click", () => {
    document.getElementById("checkInModal").classList.add("hidden");
    checkInTarget = null;
});

document.getElementById("checkInConfirm").addEventListener("click", async () => {
    if (!checkInTarget) return;
    const btn = document.getElementById("checkInConfirm");
    btn.disabled = true;
    btn.textContent = "Checking in…";
    const res = await Auth.apiCall(
        "PATCH",
        `/depot/inventory/${encodeURIComponent(checkInTarget.serial)}/check-in`
    );
    if (res && res.ok) {
        document.getElementById("checkInModal").classList.add("hidden");
        showSuccess(`${checkInTarget.serial} checked in.`);
        checkInTarget = null;
        await loadDepotInventory(currentFacility);
    } else {
        let detail = "Check-in failed.";
        try { const err = await res.json(); if (err.detail) detail = err.detail; } catch (e) {}
        const errDiv = document.getElementById("checkInError");
        errDiv.textContent = detail;
        errDiv.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Check In";
});

// ── Damaged In Transit ────────────────────────────────────────────────────
let damagedTarget = null;

function openDamagedModal(row) {
    damagedTarget = row;
    document.getElementById("damagedSerial").textContent = row.serial;
    document.getElementById("damagedMfrModel").textContent = `${row.manufacturer} ${row.model}`;
    document.getElementById("damagedNotes").value = "";
    document.getElementById("damagedError").classList.add("hidden");
    document.getElementById("damagedModal").classList.remove("hidden");
}

document.getElementById("damagedCancel").addEventListener("click", () => {
    document.getElementById("damagedModal").classList.add("hidden");
    damagedTarget = null;
});

document.getElementById("damagedConfirm").addEventListener("click", async () => {
    if (!damagedTarget) return;
    const btn = document.getElementById("damagedConfirm");
    btn.disabled = true;
    btn.textContent = "Submitting…";
    const notes = document.getElementById("damagedNotes").value.trim() || null;
    const res = await Auth.apiCall(
        "PATCH",
        `/depot/inventory/${encodeURIComponent(damagedTarget.serial)}/damaged-in-transit`,
        { notes }
    );
    if (res && res.ok) {
        document.getElementById("damagedModal").classList.add("hidden");
        showSuccess(`${damagedTarget.serial} flagged as Damaged In Transit. Claim opened in IMS.`);
        damagedTarget = null;
        await loadDepotInventory(currentFacility);
    } else {
        let detail = "Submission failed.";
        try { const err = await res.json(); if (err.detail) detail = err.detail; } catch (e) {}
        const errDiv = document.getElementById("damagedError");
        errDiv.textContent = detail;
        errDiv.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Mark Damaged";
});

// ── Edit Status ───────────────────────────────────────────────────────────
let editTarget = null;

function openEditModal(row) {
    editTarget = row;
    document.getElementById("editSerial").textContent = row.serial;
    document.getElementById("editMfrModel").textContent = `${row.manufacturer} ${row.model}`;
    document.getElementById("editCurrentStatus").innerHTML = statusBadge(row.status);
    document.getElementById("editStatusSelect").value = row.status;
    document.getElementById("editError").classList.add("hidden");
    document.getElementById("editModal").classList.remove("hidden");
}

document.getElementById("editCancel").addEventListener("click", () => {
    document.getElementById("editModal").classList.add("hidden");
    editTarget = null;
});

document.getElementById("editConfirm").addEventListener("click", async () => {
    if (!editTarget) return;
    const newStatus = document.getElementById("editStatusSelect").value;
    if (newStatus === editTarget.status) {
        document.getElementById("editModal").classList.add("hidden");
        editTarget = null;
        return;
    }
    const btn = document.getElementById("editConfirm");
    btn.disabled = true;
    btn.textContent = "Saving…";
    const res = await Auth.apiCall(
        "PATCH",
        `/depot/inventory/${encodeURIComponent(editTarget.serial)}`,
        { status: newStatus }
    );
    if (res && res.ok) {
        document.getElementById("editModal").classList.add("hidden");
        showSuccess(`${editTarget.serial} status updated to ${newStatus}.`);
        editTarget = null;
        await loadDepotInventory(currentFacility);
    } else {
        let detail = "Update failed.";
        try { const err = await res.json(); if (err.detail) detail = err.detail; } catch (e) {}
        const errDiv = document.getElementById("editError");
        errDiv.textContent = detail;
        errDiv.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Save";
});

// ── Wire-up ───────────────────────────────────────────────────────────────
document.getElementById("depotSelect").addEventListener("change", e => {
    const facility = e.target.value;
    if (!facility) {
        document.getElementById("inventoryCard").style.display = "none";
        currentFacility = null;
        return;
    }
    loadDepotInventory(facility);
});

document.getElementById("refreshBtn").addEventListener("click", () => {
    if (currentFacility) loadDepotInventory(currentFacility);
});

loadDepotSites();
