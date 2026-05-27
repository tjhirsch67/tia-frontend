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

// CMDB-derived options for Mfr/Model comboboxes (Add Device modal)
let cmdbManufacturers = [];
let cmdbModelsCache = {}; // keyed by manufacturer (or "" for all)

// Scan state
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const isAndroid = /Android/i.test(navigator.userAgent);
const isMobile = isIOS || isAndroid;
let activeScanField = null;
let zxingLoaded = false;
let codeReader = null;

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

// ── Load CMDB manufacturers (for Add Device combobox) ──────────────────────
async function loadCmdbManufacturers() {
    const res = await Auth.apiCall("GET", "/cmdb/manufacturers");
    if (!res || !res.ok) return;
    cmdbManufacturers = await res.json();
}

async function loadCmdbModels(manufacturer) {
    const key = manufacturer || "";
    if (cmdbModelsCache[key]) return cmdbModelsCache[key];
    const qs = manufacturer ? `?manufacturer=${encodeURIComponent(manufacturer)}` : "";
    const res = await Auth.apiCall("GET", `/cmdb/models${qs}`);
    if (!res || !res.ok) return [];
    const models = await res.json();
    cmdbModelsCache[key] = models;
    return models;
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
    resetPhotoStaging("damaged");
    document.getElementById("damagedModal").classList.remove("hidden");
}

document.getElementById("damagedCancel").addEventListener("click", () => {
    document.getElementById("damagedModal").classList.add("hidden");
    damagedTarget = null;
    resetPhotoStaging("damaged");
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
        const data = await res.json();
        const claimId = data && data.damaged_claim_id;
        // Phase 6.5 — upload staged photos sequentially after claim creation
        if (claimId && photoStaging.damaged.length > 0) {
            btn.textContent = "Uploading photos…";
            const result = await uploadStagedPhotos("damaged", claimId);
            if (result.failed > 0) {
                showError(
                    `${damagedTarget.serial} flagged but ${result.failed} of ${result.failed + result.succeeded} photos failed to upload. Check console.`
                );
            } else {
                showSuccess(
                    `${damagedTarget.serial} flagged as Damaged In Transit. ${result.succeeded} photo(s) uploaded. Claim opened in IMS.`
                );
            }
        } else {
            showSuccess(`${damagedTarget.serial} flagged as Damaged In Transit. Claim opened in IMS.`);
        }
        document.getElementById("damagedModal").classList.add("hidden");
        damagedTarget = null;
        resetPhotoStaging("damaged");
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
        document.getElementById("addDeviceBtn").disabled = true;
        currentFacility = null;
        return;
    }
    document.getElementById("addDeviceBtn").disabled = false;
    loadDepotInventory(facility);
});

document.getElementById("refreshBtn").addEventListener("click", () => {
    if (currentFacility) loadDepotInventory(currentFacility);
});

// ── Add Device modal ──────────────────────────────────────────────────────
function openAddDeviceModal() {
    if (!currentFacility) return;
    document.getElementById("addDestDepot").textContent = currentFacility;
    ["addSerial", "addAsset", "addMercyId", "addManufacturer", "addModel", "addNotes"].forEach(id => {
        document.getElementById(id).value = "";
    });
    document.getElementById("addStatus").value = "In Stock";
    document.getElementById("addSerialNotice").classList.add("hidden");
    document.getElementById("addError").classList.add("hidden");
    document.getElementById("addManufacturerDropdown").classList.add("hidden");
    document.getElementById("addModelDropdown").classList.add("hidden");
    saveBlockedByConflict = false;
    updateSaveButtonState();
    resetPhotoStaging("add");
    // Photo section visibility tracks status selection (only shown when DIT)
    syncAddPhotoSectionVisibility();
    document.getElementById("addDeviceModal").classList.remove("hidden");
}

document.getElementById("addDeviceBtn").addEventListener("click", openAddDeviceModal);
document.getElementById("addCancel").addEventListener("click", () => {
    document.getElementById("addDeviceModal").classList.add("hidden");
    resetPhotoStaging("add");
});

// Phase 6.5 — show/hide the photo upload section based on status selection
function syncAddPhotoSectionVisibility() {
    const status = document.getElementById("addStatus").value;
    document.getElementById("addPhotosSection").style.display =
        status === "Damaged In Transit" ? "" : "none";
}
document.getElementById("addStatus").addEventListener("change", syncAddPhotoSectionVisibility);

// Force uppercase on serial, asset, mercyId; strip spaces on mercyId
["addSerial", "addAsset", "addMercyId"].forEach(id => {
    document.getElementById(id).addEventListener("input", (e) => {
        const pos = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(pos, pos);
    });
});
document.getElementById("addMercyId").addEventListener("input", (e) => {
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.replace(/\s/g, "");
    e.target.setSelectionRange(pos, pos);
});

// ── Lexmark leading-S strip ───────────────────────────────────────────────
// When manufacturer is Lexmark, strip a leading "S" from the serial. Applied
// whenever the serial OR manufacturer changes (since either may arrive first).
function applyLexmarkStrip() {
    const serialEl = document.getElementById("addSerial");
    const mfrEl = document.getElementById("addManufacturer");
    const mfr = (mfrEl.value || "").trim().toUpperCase();
    const serial = (serialEl.value || "").trim();
    if ((mfr === "LEXMARK" || mfr === "LM") && serial.startsWith("S")) {
        serialEl.value = serial.slice(1);
    }
}

document.getElementById("addManufacturer").addEventListener("change", applyLexmarkStrip);
document.getElementById("addManufacturer").addEventListener("blur", applyLexmarkStrip);

// ── Save-button gate driven by conflict state ─────────────────────────────
// When the pre-flight conflict check fails we don't want the user submitting.
// (The backend POST also rejects — this is just UX defense in depth.)
let saveBlockedByConflict = false;
function updateSaveButtonState() {
    document.getElementById("addSave").disabled = saveBlockedByConflict;
}

// ── CMDB autofill + cross-table conflict check on serial entry (debounced) ─
let serialLookupTimer = null;
document.getElementById("addSerial").addEventListener("input", () => {
    clearTimeout(serialLookupTimer);
    // Any new serial input clears the prior conflict block; the debounced
    // check below will reapply it if the new serial conflicts too.
    saveBlockedByConflict = false;
    updateSaveButtonState();

    const serial = document.getElementById("addSerial").value.trim();
    const notice = document.getElementById("addSerialNotice");
    if (!serial) {
        notice.classList.add("hidden");
        return;
    }
    serialLookupTimer = setTimeout(async () => {
        // Fire both checks in parallel
        const [cmdbRes, checkRes] = await Promise.all([
            Auth.apiCall("GET", `/cmdb/lookup/${encodeURIComponent(serial)}`),
            Auth.apiCall("GET", `/depot/inventory-check/${encodeURIComponent(serial)}`),
        ]);

        // 1) CMDB autofill — only fill fields if the input hasn't changed since
        //    we fired the request (user kept typing).
        if (document.getElementById("addSerial").value.trim() !== serial) return;

        if (cmdbRes && cmdbRes.ok) {
            const data = await cmdbRes.json();
            document.getElementById("addAsset").value = (data.asset || "").toUpperCase();
            document.getElementById("addMercyId").value = (data.mercy_id || "").replace(/\s/g, "");
            document.getElementById("addManufacturer").value = data.manufacturer || "";
            document.getElementById("addModel").value = data.model || "";
            applyLexmarkStrip();
        }

        // 2) Cross-table conflict check — blocks Save and shows the red badge
        if (checkRes && checkRes.ok) {
            const check = await checkRes.json();
            if (check.conflict) {
                notice.textContent = "✗ " + check.detail + " Cannot add as a duplicate.";
                notice.className = "field-notice error";
                notice.classList.remove("hidden");
                saveBlockedByConflict = true;
                updateSaveButtonState();
                return;
            }
        }

        // 3) If no conflict, show the CMDB hit/miss notice
        if (cmdbRes && cmdbRes.ok) {
            notice.textContent = "✓ Found in CMDB — fields auto-populated, update any if needed.";
            notice.className = "field-notice success";
            notice.classList.remove("hidden");
        } else if (cmdbRes && cmdbRes.status === 404) {
            notice.textContent = "Not found in CMDB — enter details manually.";
            notice.className = "field-notice warning";
            notice.classList.remove("hidden");
        } else {
            notice.classList.add("hidden");
        }
    }, 400);
});

// ── Manufacturer / Model comboboxes ───────────────────────────────────────
function renderCombobox(dropdown, options, onSelect) {
    dropdown.innerHTML = "";
    if (!options.length) {
        const empty = document.createElement("div");
        empty.className = "combobox-empty";
        empty.textContent = "No matches — type to use custom value";
        dropdown.appendChild(empty);
    } else {
        options.forEach(opt => {
            const item = document.createElement("div");
            item.className = "combobox-item";
            item.textContent = opt;
            item.addEventListener("click", () => onSelect(opt));
            dropdown.appendChild(item);
        });
    }
    dropdown.classList.remove("hidden");
}

function setupCombobox(inputId, dropdownId, getOptionsAsync, onSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    async function refresh() {
        const q = input.value.trim().toLowerCase();
        const all = await getOptionsAsync();
        const filtered = q ? all.filter(o => o.toLowerCase().includes(q)) : all;
        renderCombobox(dropdown, filtered, (val) => {
            input.value = val;
            dropdown.classList.add("hidden");
            onSelect(val);
        });
    }
    input.addEventListener("input", refresh);
    input.addEventListener("focus", refresh);
    document.addEventListener("click", (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add("hidden");
        }
    });
}

setupCombobox(
    "addManufacturer",
    "addManufacturerDropdown",
    async () => { if (!cmdbManufacturers.length) await loadCmdbManufacturers(); return cmdbManufacturers; },
    (val) => {
        // Clear cached model list for the new manufacturer to force refresh
        document.getElementById("addModel").value = "";
        delete cmdbModelsCache[val];
        // Selecting Lexmark must trigger the leading-S strip on the serial
        // (programmatic input.value changes don't fire native change events).
        applyLexmarkStrip();
    }
);

setupCombobox(
    "addModel",
    "addModelDropdown",
    async () => {
        const mfr = document.getElementById("addManufacturer").value.trim();
        return await loadCmdbModels(mfr);
    },
    () => {}
);

// ── Add Device save ───────────────────────────────────────────────────────
document.getElementById("addSave").addEventListener("click", async () => {
    const payload = {
        facility:     currentFacility,
        serial:       document.getElementById("addSerial").value.trim().toUpperCase(),
        asset_tag:    document.getElementById("addAsset").value.trim().toUpperCase(),
        mercy_id:     document.getElementById("addMercyId").value.trim().replace(/\s/g, ""),
        manufacturer: document.getElementById("addManufacturer").value.trim(),
        model:        document.getElementById("addModel").value.trim(),
        status:       document.getElementById("addStatus").value,
        notes:        document.getElementById("addNotes").value.trim() || null,
    };

    // Client-side required-field check
    const missing = [];
    if (!payload.serial)       missing.push("Serial");
    if (!payload.asset_tag)    missing.push("Asset");
    if (!payload.mercy_id)     missing.push("MercyID");
    if (!payload.manufacturer) missing.push("Manufacturer");
    if (!payload.model)        missing.push("Model");
    const errDiv = document.getElementById("addError");
    if (missing.length) {
        errDiv.textContent = `Missing required fields: ${missing.join(", ")}`;
        errDiv.classList.remove("hidden");
        return;
    }

    const btn = document.getElementById("addSave");
    btn.disabled = true;
    btn.textContent = "Adding…";
    const res = await Auth.apiCall("POST", "/depot/inventory", payload);
    if (res && res.ok) {
        const data = await res.json();
        const claimId = data && data.damaged_claim_id;
        // Phase 6.5 — if Damaged In Transit, upload staged photos
        let photoSummary = "";
        if (payload.status === "Damaged In Transit" && claimId && photoStaging.add.length > 0) {
            btn.textContent = "Uploading photos…";
            const result = await uploadStagedPhotos("add", claimId);
            photoSummary = result.failed > 0
                ? ` (${result.succeeded}/${result.succeeded + result.failed} photos uploaded; ${result.failed} failed)`
                : ` (${result.succeeded} photo(s) uploaded)`;
        }
        document.getElementById("addDeviceModal").classList.add("hidden");
        const msg = payload.status === "Damaged In Transit"
            ? `${payload.serial} added as Damaged In Transit. Claim opened in IMS.${photoSummary}`
            : `${payload.serial} added to ${currentFacility}.`;
        showSuccess(msg);
        resetPhotoStaging("add");
        await loadDepotInventory(currentFacility);
    } else {
        let detail = "Add failed.";
        try { const err = await res.json(); if (err.detail) detail = err.detail; } catch (e) {}
        errDiv.textContent = detail;
        errDiv.classList.remove("hidden");
    }
    btn.disabled = false;
    btn.textContent = "Add Device";
});

// ── Mobile barcode scanning (matches form.js pattern) ─────────────────────
// Hide scan buttons on desktop
if (!isMobile) {
    ["addScanSerialBtn", "addScanAssetBtn", "addScanMercyBtn"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = "none";
    });
}

function loadZXing() {
    return new Promise((resolve) => {
        if (zxingLoaded || typeof ZXing !== "undefined") {
            zxingLoaded = true;
            resolve();
            return;
        }
        const script = document.createElement("script");
        script.src = "https://unpkg.com/@zxing/library@0.19.1/umd/index.min.js";
        script.onload = () => { zxingLoaded = true; resolve(); };
        document.head.appendChild(script);
    });
}

function startScan(fieldId) {
    if (!isMobile) return;
    activeScanField = fieldId;
    if (isIOS) startIOSScan();
    else       startAndroidScan();
}

// Android — native camera capture + BarcodeDetector
const barcodeCapture = document.getElementById("barcodeCapture");

function startAndroidScan() {
    barcodeCapture.value = "";
    barcodeCapture.click();
}

barcodeCapture.addEventListener("change", async () => {
    if (!barcodeCapture.files || !barcodeCapture.files[0]) return;
    const file = barcodeCapture.files[0];
    if ("BarcodeDetector" in window) {
        try {
            const bitmap = await createImageBitmap(file);
            const detector = new BarcodeDetector({
                formats: ["code_128", "code_39", "code_93", "codabar",
                          "ean_13", "ean_8", "upc_a", "upc_e", "pdf417"]
            });
            const barcodes = await detector.detect(bitmap);
            if (barcodes.length > 0 && activeScanField) {
                const value = barcodes[0].rawValue.toUpperCase();
                const field = document.getElementById(activeScanField);
                field.value = value;
                field.dispatchEvent(new Event("input"));
            } else {
                alert("No barcode detected. Please try again or enter manually.");
            }
        } catch (err) {
            alert("Could not read barcode. Please enter manually.");
        }
    } else {
        alert("Barcode detection not supported in this browser. Please enter manually.");
    }
    barcodeCapture.value = "";
    activeScanField = null;
});

// iOS — ZXing video stream
async function startIOSScan() {
    await loadZXing();
    const modal = document.getElementById("cameraModal");
    const resultEl = document.getElementById("scanResult");
    modal.classList.remove("hidden");
    resultEl.textContent = "";
    resultEl.className = "";
    try {
        codeReader = new ZXing.BrowserMultiFormatReader();
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        const video = document.getElementById("cameraStream");
        video.srcObject = stream;
        await video.play();
        codeReader.decodeFromStream(stream, video, (result) => {
            if (result && activeScanField) {
                const value = result.getText().toUpperCase();
                const field = document.getElementById(activeScanField);
                field.value = value;
                field.dispatchEvent(new Event("input"));
                resultEl.textContent = `✓ Scanned: ${value}`;
                resultEl.className = "field-notice success";
                setTimeout(() => stopIOSScan(), 1200);
            }
        });
    } catch (err) {
        resultEl.textContent = `Camera error: ${err.message || "Permission denied or not available."}`;
        resultEl.className = "field-notice error";
    }
}

function stopIOSScan() {
    if (codeReader) {
        codeReader.reset();
        codeReader = null;
    }
    const video = document.getElementById("cameraStream");
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    document.getElementById("cameraModal").classList.add("hidden");
    activeScanField = null;
}

document.getElementById("cancelScanBtn").addEventListener("click", stopIOSScan);
document.getElementById("manualEntryBtn").addEventListener("click", stopIOSScan);

document.getElementById("addScanSerialBtn").addEventListener("click", () => startScan("addSerial"));
document.getElementById("addScanAssetBtn").addEventListener("click",  () => startScan("addAsset"));
document.getElementById("addScanMercyBtn").addEventListener("click",  () => startScan("addMercyId"));

// ── Phase 6.5 — Damaged Claim Photo upload (Damaged + Add Device modals) ─
// Per-modal staging: each modal keeps an array of File objects selected by
// the tech. Upload happens AFTER the claim is created so we have a claim_id.
//
// Pipeline per photo: HEIC → JPEG (iPhone) → Canvas resize to 1600 px
// JPEG @ 0.85 (strips EXIF/GPS) → POST multipart.
//
// Bypasses Auth.apiCall for the POST because apiCall forces
// Content-Type: application/json which breaks multipart. Manual Bearer
// header preserves auth.

const photoStaging = { damaged: [], add: [] };

function resetPhotoStaging(modal) {
    photoStaging[modal] = [];
    const preview = document.getElementById(
        modal === "damaged" ? "damagedPhotosPreview" : "addPhotosPreview"
    );
    if (preview) preview.innerHTML = "";
    const input = document.getElementById(
        modal === "damaged" ? "damagedPhotos" : "addPhotos"
    );
    if (input) input.value = "";
}

function renderPhotoPreviews(modal) {
    const preview = document.getElementById(
        modal === "damaged" ? "damagedPhotosPreview" : "addPhotosPreview"
    );
    preview.innerHTML = "";
    photoStaging[modal].forEach((file, idx) => {
        const wrap = document.createElement("div");
        wrap.style.cssText =
            "position:relative; width:72px; height:72px; border-radius:6px; overflow:hidden; border:1px solid #d1d5db; background:#f3f4f6;";
        const img = document.createElement("img");
        img.style.cssText = "width:100%; height:100%; object-fit:cover; display:block;";
        // Show preview directly from in-memory File via blob URL
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        wrap.appendChild(img);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove from upload";
        removeBtn.style.cssText =
            "position:absolute; top:2px; right:2px; width:18px; height:18px; border:none; border-radius:50%; background:rgba(220,38,38,0.9); color:#fff; font-size:0.8rem; line-height:18px; padding:0; cursor:pointer;";
        removeBtn.addEventListener("click", () => {
            photoStaging[modal].splice(idx, 1);
            renderPhotoPreviews(modal);
        });
        wrap.appendChild(removeBtn);

        preview.appendChild(wrap);
    });
}

function wirePhotoInput(modal) {
    const inputId = modal === "damaged" ? "damagedPhotos" : "addPhotos";
    const btnId   = modal === "damaged" ? "damagedAddPhotosBtn" : "addAddPhotosBtn";
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    btn.addEventListener("click", () => input.click());
    input.addEventListener("change", (e) => {
        const files = Array.from(e.target.files || []);
        photoStaging[modal] = photoStaging[modal].concat(files);
        renderPhotoPreviews(modal);
        input.value = "";   // clear so same file can be re-picked if user removed it
    });
}
wirePhotoInput("damaged");
wirePhotoInput("add");

// Phase 6.7 — isHeicFile, ensureHeic2AnyLoaded, resizeImageToJpeg live in
// js/photo-helpers.js (loaded by depot.html before this script). Keep the
// IMS copy at frontend/js/photo-helpers.js byte-identical.

async function uploadOnePhoto(claimId, origFile) {
    let file = origFile;
    if (isHeicFile(file)) {
        await ensureHeic2AnyLoaded();
        const converted = await window.heic2any({
            blob: file, toType: "image/jpeg", quality: 0.92,
        });
        file = Array.isArray(converted) ? converted[0] : converted;
    }
    const resized = await resizeImageToJpeg(file);
    const baseName = (origFile.name || "photo").replace(/\.[^.]+$/, "");
    const fd = new FormData();
    fd.append("file", resized, `${baseName}.jpg`);
    // Bypass Auth.apiCall (forces JSON Content-Type) — keep Bearer manually
    const res = await fetch(
        `${CONFIG.API_BASE}/depot/damaged-claims/${claimId}/photos`,
        {
            method: "POST",
            headers: { "Authorization": `Bearer ${Auth.getToken()}` },
            body: fd,
        }
    );
    if (!(res.ok || res.status === 201)) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body}`);
    }
    return await res.json();
}

async function uploadStagedPhotos(modal, claimId) {
    const files = photoStaging[modal];
    let succeeded = 0, failed = 0;
    for (const f of files) {
        try {
            await uploadOnePhoto(claimId, f);
            succeeded++;
        } catch (err) {
            failed++;
            console.error("Photo upload failed", f.name, err);
        }
    }
    return { succeeded, failed };
}

// ── Initial load ──────────────────────────────────────────────────────────
loadDepotSites();
loadCmdbManufacturers();
