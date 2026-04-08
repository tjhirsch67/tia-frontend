// ── Auth Check ────────────────────────────────────────────────────────────
if (!Auth.requireAuth()) { throw new Error("Redirecting"); }

const { username, role } = Auth.getUser();
document.getElementById("navUsername").textContent = username;
if (role === "admin" || role === "tech_full") {
    document.getElementById("navReport").classList.remove("hidden");
}
if (role === "admin") {
    document.getElementById("navAdmin").classList.remove("hidden");
}

document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("open");
});

// ── Date ──────────────────────────────────────────────────────────────────
function setToday() {
    const today = new Date();
    document.getElementById("date").value = today.toLocaleDateString("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit"
    });
}
setToday();

// ── Uppercase Fields ──────────────────────────────────────────────────────
["serial", "mercyId", "asset"].forEach(id => {
    document.getElementById(id).addEventListener("input", (e) => {
        const pos = e.target.selectionStart;
        e.target.value = e.target.value.toUpperCase();
        e.target.setSelectionRange(pos, pos);
    });
});

// ── Manufacturer / Model Combobox ─────────────────────────────────────────
let allMfrModels = [];
let comboboxEnabled = false;

async function loadMfrModels() {
    const res = await Auth.apiCall("GET", "/mfr-models/");
    if (res && res.ok) {
        allMfrModels = await res.json();
    }
}

function setupCombobox(inputId, dropdownId, getOptions, onSelect) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);

    input.addEventListener("input", () => {
        if (!comboboxEnabled) return;
        const q = input.value.trim().toLowerCase();
        const options = getOptions().filter(o => o.toLowerCase().includes(q));
        renderCombobox(dropdown, options, (val) => {
            input.value = val;
            dropdown.classList.add("hidden");
            onSelect(val);
        });
    });

    input.addEventListener("focus", () => {
        if (!comboboxEnabled) return;
        const options = getOptions();
        const q = input.value.trim().toLowerCase();
        const filtered = q ? options.filter(o => o.toLowerCase().includes(q)) : options;
        renderCombobox(dropdown, filtered, (val) => {
            input.value = val;
            dropdown.classList.add("hidden");
            onSelect(val);
        });
    });

    document.addEventListener("click", (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add("hidden");
        }
    });
}

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

function getMfrOptions() {
    return [...new Set(allMfrModels.map(r => r.manufacturer))].sort();
}

function getModelOptions(manufacturer) {
    return allMfrModels
        .filter(r => !manufacturer || r.manufacturer === manufacturer)
        .map(r => r.model)
        .sort();
}

function enableComboboxes() {
    comboboxEnabled = true;
    document.getElementById("manufacturer").readOnly = false;
    document.getElementById("model").readOnly = false;
    document.getElementById("manufacturerDropdown").classList.add("hidden");
    document.getElementById("modelDropdown").classList.add("hidden");
}

function disableComboboxes() {
    comboboxEnabled = false;
    document.getElementById("manufacturerDropdown").classList.add("hidden");
    document.getElementById("modelDropdown").classList.add("hidden");
}

let selectedManufacturer = "";

setupCombobox(
    "manufacturer",
    "manufacturerDropdown",
    getMfrOptions,
    (val) => {
        selectedManufacturer = val;
        document.getElementById("model").value = "";
    }
);

setupCombobox(
    "model",
    "modelDropdown",
    () => getModelOptions(selectedManufacturer),
    () => {}
);

loadMfrModels();

// ── Serial Lookup ─────────────────────────────────────────────────────────
const deviceFields = ["asset", "mercyId", "manufacturer", "model"];

function lockDeviceFields() {
    deviceFields.forEach(f => {
        const el = document.getElementById(f);
        el.readOnly = true;
        el.classList.add("auto-filled");
    });
    ["scanAssetBtn", "scanMercyBtn"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = "none";
    });
    disableComboboxes();
}

function unlockDeviceFields() {
    deviceFields.forEach(f => {
        const el = document.getElementById(f);
        el.readOnly = false;
        el.classList.remove("auto-filled");
    });
    ["scanAssetBtn", "scanMercyBtn"].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.style.display = "";
    });
    enableComboboxes();
}

function clearDeviceFields() {
    deviceFields.forEach(f => document.getElementById(f).value = "");
    selectedManufacturer = "";
}

let serialLookupTimeout = null;
document.getElementById("serial").addEventListener("input", (e) => {
    clearTimeout(serialLookupTimeout);
    const serial = e.target.value.trim();
    const notice = document.getElementById("serialNotice");
    if (!serial) {
        notice.classList.add("hidden");
        clearDeviceFields();
        unlockDeviceFields();
        return;
    }
    serialLookupTimeout = setTimeout(async () => {
        const res = await Auth.apiCall("GET", `/cmdb/lookup/${encodeURIComponent(serial)}`);
        if (res && res.ok) {
            const data = await res.json();
            document.getElementById("asset").value = data.asset || "";
            document.getElementById("mercyId").value = data.mercy_id || "";
            document.getElementById("manufacturer").value = data.manufacturer || "";
            document.getElementById("model").value = data.model || "";
            selectedManufacturer = data.manufacturer || "";
            lockDeviceFields();
            notice.textContent = "✓ Device found in CMDB";
            notice.className = "field-notice success";
            notice.classList.remove("hidden");
        } else if (res && res.status === 404) {
            clearDeviceFields();
            unlockDeviceFields();
            notice.textContent = "Not found in CMDB — enter details manually";
            notice.className = "field-notice warning";
            notice.classList.remove("hidden");
        }
    }, 500);
});

// ── Location Typeahead ────────────────────────────────────────────────────
function setupTypeahead(inputId, dropdownId, labelField, fillCallback) {
    const input = document.getElementById(inputId);
    const dropdown = document.getElementById(dropdownId);
    let timeout = null;

    input.addEventListener("input", () => {
        clearTimeout(timeout);
        const q = input.value.trim();
        if (!q) { dropdown.classList.add("hidden"); return; }
        timeout = setTimeout(async () => {
            const res = await Auth.apiCall("GET", `/locations/search?q=${encodeURIComponent(q)}`);
            if (!res || !res.ok) return;
            const results = await res.json();
            dropdown.innerHTML = "";
            if (!results.length) { dropdown.classList.add("hidden"); return; }
            results.forEach(loc => {
                const item = document.createElement("div");
                item.className = "typeahead-item";
                item.textContent = loc[labelField];
                item.addEventListener("click", () => {
                    input.value = loc[labelField];
                    dropdown.classList.add("hidden");
                    fillCallback(loc);
                });
                dropdown.appendChild(item);
            });
            dropdown.classList.remove("hidden");
        }, 300);
    });

    document.addEventListener("click", (e) => {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add("hidden");
        }
    });
}

function fillFromLocation(loc) {
    document.getElementById("location").value = loc.facility;
    document.getElementById("address").value = loc.street;
    document.getElementById("city").value = loc.city;
    document.getElementById("state").value = loc.state;
    document.getElementById("zip").value = loc.zip;
    document.getElementById("locationManual").value = "";
    lockLocationFields();
}

function lockLocationFields() {
    ["city", "state", "zip"].forEach(f => {
        const el = document.getElementById(f);
        el.readOnly = true;
        el.classList.add("auto-filled");
    });
}

function unlockLocationFields() {
    ["city", "state", "zip"].forEach(f => {
        const el = document.getElementById(f);
        el.readOnly = false;
        el.classList.remove("auto-filled");
    });
}

setupTypeahead("location", "locationDropdown", "facility", fillFromLocation);
setupTypeahead("address", "addressDropdown", "street", fillFromLocation);

document.getElementById("locationManual").addEventListener("input", (e) => {
    if (e.target.value.trim()) {
        document.getElementById("location").value = "";
        document.getElementById("address").value = "";
        document.getElementById("city").value = "";
        document.getElementById("state").value = "";
        document.getElementById("zip").value = "";
        unlockLocationFields();
    } else {
        lockLocationFields();
    }
});

// ── Service Type Logic ────────────────────────────────────────────────────
document.getElementById("serviceType").addEventListener("change", updateRequiredFields);

function updateRequiredFields() {
    const type = document.getElementById("serviceType").value;
    const isRemoval = type === "Removal";
    const floorRoom = ["floorGroup", "roomGroup"];
    floorRoom.forEach(id => {
        const el = document.getElementById(id);
        const label = el.querySelector("label");
        const star = label.querySelector(".required");
        if (isRemoval) {
            if (star) star.remove();
        } else {
            if (!star) {
                const s = document.createElement("span");
                s.className = "required";
                s.textContent = " *";
                label.appendChild(s);
            }
        }
    });
}

// ── Validation ────────────────────────────────────────────────────────────
function validate() {
    const type = document.getElementById("serviceType").value;
    const serial = document.getElementById("serial").value.trim();
    const location = document.getElementById("location").value.trim();
    const locationManual = document.getElementById("locationManual").value.trim();
    const floor = document.getElementById("floor").value.trim();
    const room = document.getElementById("room").value.trim();
    const asset = document.getElementById("asset").value.trim();
    const mercyId = document.getElementById("mercyId").value.trim();
    const manufacturer = document.getElementById("manufacturer").value.trim();
    const model = document.getElementById("model").value.trim();

    if (!type) return "Please select a Service Type.";
    if (!serial) return "Serial number is required.";
    if (!location && !locationManual) return "Location is required for all service types.";

    if (type !== "Removal") {
        if (!asset) return "Asset Tag is required.";
        if (!mercyId) return "MercyID is required.";
        if (!manufacturer) return "Manufacturer is required.";
        if (!model) return "Model is required.";
        if (!floor) return "Floor is required.";
        if (!room) return "Room is required.";
    }

    return null;
}

// ── Submit ────────────────────────────────────────────────────────────────
document.getElementById("submitBtn").addEventListener("click", async () => {
    const errorDiv = document.getElementById("formError");
    const successDiv = document.getElementById("formSuccess");
    errorDiv.classList.add("hidden");
    successDiv.classList.add("hidden");

    const validationError = validate();
    if (validationError) {
        errorDiv.textContent = validationError;
        errorDiv.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
    }

    const btn = document.getElementById("submitBtn");
    btn.disabled = true;
    btn.textContent = "Submitting...";

    const payload = {
        date: new Date().toISOString(),
        service_type: document.getElementById("serviceType").value,
        serial: document.getElementById("serial").value.trim(),
        asset: document.getElementById("asset").value.trim() || null,
        mercy_id: document.getElementById("mercyId").value.trim() || null,
        manufacturer: document.getElementById("manufacturer").value.trim() || null,
        model: document.getElementById("model").value.trim() || null,
        end_user: document.getElementById("endUser").value.trim() || null,
        phone: document.getElementById("phone").value.trim() || null,
        atr: document.getElementById("atr").value || null,
        ip: document.getElementById("ip").value.trim() || null,
        location: document.getElementById("location").value.trim() || null,
        location_manual: document.getElementById("locationManual").value.trim() || null,
        address: document.getElementById("address").value.trim() || null,
        city: document.getElementById("city").value.trim() || null,
        state: document.getElementById("state").value.trim() || null,
        zip: document.getElementById("zip").value.trim() || null,
        floor: document.getElementById("floor").value.trim() || null,
        room: document.getElementById("room").value.trim() || null,
    };

    const res = await Auth.apiCall("POST", "/submissions/", payload);
    if (res && res.ok) {
        successDiv.textContent = "✓ Record submitted successfully.";
        successDiv.classList.remove("hidden");
        clearForm();
        window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
        const err = res ? await res.json() : null;
        errorDiv.textContent = err?.detail || "Submission failed. Please try again.";
        errorDiv.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    btn.disabled = false;
    btn.textContent = "Submit";
});

// ── Clear Form ────────────────────────────────────────────────────────────
function clearForm() {
    const fields = ["serial", "asset", "mercyId", "manufacturer", "model",
                    "endUser", "phone", "ip", "location", "locationManual",
                    "address", "city", "state", "zip", "floor", "room"];
    fields.forEach(f => document.getElementById(f).value = "");
    document.getElementById("serviceType").value = "";
    document.getElementById("atr").value = "";
    document.getElementById("serialNotice").classList.add("hidden");
    selectedManufacturer = "";
    unlockDeviceFields();
    disableComboboxes();
    lockLocationFields();
    setToday();
}

document.getElementById("clearBtn").addEventListener("click", clearForm);

// ── Orientation Detection ─────────────────────────────────────────────────
function isPortrait() {
    if (screen.orientation) {
        const angle = screen.orientation.angle;
        return angle === 0 || angle === 180;
    }
    return window.innerHeight > window.innerWidth;
}

function updateScanOrientation() {
    const overlay = document.querySelector(".scan-overlay");
    if (!overlay) return;
    if (isPortrait()) {
        overlay.classList.add("portrait");
    } else {
        overlay.classList.remove("portrait");
    }
}

if (screen.orientation) {
    screen.orientation.addEventListener("change", updateScanOrientation);
} else {
    window.addEventListener("resize", updateScanOrientation);
}

// ── Mobile Camera Scanning ────────────────────────────────────────────────
let activeField = null;
let scanStream = null;
let scanAnimFrame = null;
let scanCanvas = document.createElement("canvas");
let scanCtx = scanCanvas.getContext("2d");
let zxingReader = null;

async function startScan(fieldId) {
    activeField = fieldId;
    const modal = document.getElementById("cameraModal");
    const resultEl = document.getElementById("scanResult");
    modal.classList.remove("hidden");
    resultEl.textContent = "";
    resultEl.className = "";
    updateScanOrientation();

    try {
        // Load ZXing reader
        zxingReader = new ZXing.BrowserMultiFormatReader();

        scanStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        const video = document.getElementById("cameraStream");
        video.srcObject = scanStream;
        await video.play();

        // Wait for video to have data
        await new Promise(resolve => {
            video.addEventListener("loadeddata", resolve, { once: true });
        });

        function processFrame() {
            if (!scanStream) return;

            const portrait = isPortrait();
            updateScanOrientation();

            const vw = video.videoWidth;
            const vh = video.videoHeight;
            if (!vw || !vh) {
                scanAnimFrame = requestAnimationFrame(processFrame);
                return;
            }

            // Draw frame to canvas — rotate 90° CCW if portrait
            if (portrait) {
                scanCanvas.width = vh;
                scanCanvas.height = vw;
                scanCtx.save();
                scanCtx.translate(0, vw);
                scanCtx.rotate(-Math.PI / 2);
                scanCtx.drawImage(video, 0, 0, vw, vh);
                scanCtx.restore();
            } else {
                scanCanvas.width = vw;
                scanCanvas.height = vh;
                scanCtx.drawImage(video, 0, 0, vw, vh);
            }

            // Try to decode from canvas image data
            try {
                const imgData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
                const luminance = new ZXing.RGBLuminanceSource(
                    imgData.data,
                    scanCanvas.width,
                    scanCanvas.height
                );
                const binary = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminance));
                const result = new ZXing.MultiFormatReader().decode(binary);

                if (result) {
                    const value = result.getText().toUpperCase();
                    document.getElementById(activeField).value = value;
                    if (activeField === "serial") {
                        document.getElementById("serial").dispatchEvent(new Event("input"));
                    }
                    resultEl.textContent = `✓ Scanned: ${value}`;
                    resultEl.className = "field-notice success";
                    setTimeout(() => stopScan(), 1200);
                    return;
                }
            } catch (e) {
                // No barcode in this frame — keep scanning
            }

            scanAnimFrame = requestAnimationFrame(processFrame);
        }

        scanAnimFrame = requestAnimationFrame(processFrame);

    } catch (err) {
        document.getElementById("scanResult").textContent =
            `Camera error: ${err.message || "Permission denied or not available."}`;
        document.getElementById("scanResult").className = "field-notice error";
    }
}

function stopScan() {
    if (scanAnimFrame) {
        cancelAnimationFrame(scanAnimFrame);
        scanAnimFrame = null;
    }
    if (scanStream) {
        scanStream.getTracks().forEach(t => t.stop());
        scanStream = null;
    }
    const video = document.getElementById("cameraStream");
    if (video.srcObject) {
        video.srcObject = null;
    }
    document.getElementById("cameraModal").classList.add("hidden");
    activeField = null;
}

document.getElementById("cancelScanBtn").addEventListener("click", stopScan);
document.getElementById("manualEntryBtn").addEventListener("click", stopScan);
document.getElementById("scanSerialBtn").addEventListener("click", () => startScan("serial"));
document.getElementById("scanAssetBtn").addEventListener("click", () => startScan("asset"));
document.getElementById("scanMercyBtn").addEventListener("click", () => startScan("mercyId"));