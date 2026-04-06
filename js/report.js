// ── Auth Check ────────────────────────────────────────────────────────────
if (!Auth.requireAuth(["admin", "tech_full"])) { throw new Error("Redirecting"); }

const { username, role } = Auth.getUser();
document.getElementById("navUsername").textContent = username;
if (role === "admin") {
    document.getElementById("navAdmin").classList.remove("hidden");
}

// Hamburger
document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("open");
});

// ── Last Run Info ─────────────────────────────────────────────────────────
async function loadLastRun() {
    const res = await Auth.apiCall("GET", "/reports/last-run");
    if (!res || !res.ok) return;
    const data = await res.json();
    const el = document.getElementById("lastRunInfo");
    if (data.last_export) {
        const date = new Date(data.last_export).toLocaleString("en-US");
        el.innerHTML = `
            <p>Last export: <strong>${date}</strong></p>
            <p style="margin-top:6px;">Unreported records: <strong>${data.unreported_count}</strong></p>
        `;
    } else {
        el.innerHTML = `
            <p>No exports have been run yet.</p>
            <p style="margin-top:6px;">Unreported records: <strong>${data.unreported_count}</strong></p>
        `;
    }
}

loadLastRun();

// ── CSV Download Helper ───────────────────────────────────────────────────
async function downloadCSVFromUrl(url, filename, errorDivId) {
    const errorDiv = document.getElementById(errorDivId);
    errorDiv.classList.add("hidden");

    try {
        const res = await fetch(`${CONFIG.API_BASE}${url}`, {
            method: "GET",
            headers: { "Authorization": `Bearer ${Auth.getToken()}` }
        });

        if (res.ok) {
            const blob = await res.blob();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            a.click();
            URL.revokeObjectURL(a.href);
            return true;
        } else {
            errorDiv.textContent = "Export failed. Please try again.";
            errorDiv.classList.remove("hidden");
            return false;
        }
    } catch (err) {
        errorDiv.textContent = "Could not connect to server.";
        errorDiv.classList.remove("hidden");
        return false;
    }
}

// ── Section 1: Export by Date & Service Type ──────────────────────────────
document.getElementById("exportBtn").addEventListener("click", async () => {
    const btn = document.getElementById("exportBtn");
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const unreportedOnly = document.getElementById("unreportedOnly").checked;

    const checkedTypes = Array.from(document.querySelectorAll(".svc-type:checked"))
        .map(cb => cb.value);

    if (!checkedTypes.length) {
        const errorDiv = document.getElementById("reportError");
        errorDiv.textContent = "Please select at least one service type.";
        errorDiv.classList.remove("hidden");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Exporting...";

    let url = `/reports/export?service_types=${encodeURIComponent(checkedTypes.join(","))}`;
    if (startDate) url += `&start_date=${startDate}`;
    if (endDate) url += `&end_date=${endDate}T23:59:59`;
    if (unreportedOnly) url += `&unreported_only=true`;

    const filename = `TIA_Report_${new Date().toISOString().slice(0,10)}.csv`;
    const success = await downloadCSVFromUrl(url, filename, "reportError");
    if (success) await loadLastRun();

    btn.disabled = false;
    btn.textContent = "⬇ Export to CSV";
});

// ── Section 2: Device Lookup Report ──────────────────────────────────────
document.getElementById("lookupExportBtn").addEventListener("click", async () => {
    const btn = document.getElementById("lookupExportBtn");
    const field = document.getElementById("lookupField").value;
    const value = document.getElementById("lookupValue").value.trim();
    const errorDiv = document.getElementById("lookupError");

    errorDiv.classList.add("hidden");

    if (!value) {
        errorDiv.textContent = "Please enter a search value.";
        errorDiv.classList.remove("hidden");
        return;
    }

    btn.disabled = true;
    btn.textContent = "Exporting...";

    const url = `/reports/lookup?field=${encodeURIComponent(field)}&value=${encodeURIComponent(value)}`;
    const filename = `TIA_Lookup_${field}_${value}_${new Date().toISOString().slice(0,10)}.csv`;
    await downloadCSVFromUrl(url, filename, "lookupError");

    btn.disabled = false;
    btn.textContent = "⬇ Export to CSV";
});