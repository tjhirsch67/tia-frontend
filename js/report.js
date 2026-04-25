// ── Auth Check ────────────────────────────────────────────────────────────
if (!Auth.requireAuth(["admin", "tech_full"])) { throw new Error("Redirecting"); }

const { username, role } = Auth.getUser();
document.getElementById("navUsername").textContent = username;
if (role === "admin") {
    document.getElementById("navAdmin").classList.remove("hidden");
    document.getElementById("emailAutoBtn").style.display = "";
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
        const date = new Date(data.last_export + "Z").toLocaleString("en-US");
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

// ── Email Modal ───────────────────────────────────────────────────────────
let emailModalCallback = null;

function openEmailModal(title, callback) {
    emailModalCallback = callback;
    document.getElementById("emailModalTitle").textContent = title;
    document.getElementById("emailRecipients").value = "";
    document.getElementById("emailModalMsg").classList.add("hidden");
    document.getElementById("emailModal").classList.remove("hidden");
}

document.getElementById("emailModalCancel").addEventListener("click", () => {
    document.getElementById("emailModal").classList.add("hidden");
    emailModalCallback = null;
});

document.getElementById("emailModalSend").addEventListener("click", async () => {
    const raw = document.getElementById("emailRecipients").value.trim();
    const msgEl = document.getElementById("emailModalMsg");
    msgEl.classList.add("hidden");

    if (!raw) {
        msgEl.textContent = "Please enter at least one email address.";
        msgEl.className = "error-message";
        msgEl.classList.remove("hidden");
        return;
    }

    const emails = raw.split(",").map(e => e.trim()).filter(e => e.length > 0);
    if (!emails.length) {
        msgEl.textContent = "Please enter valid email addresses.";
        msgEl.className = "error-message";
        msgEl.classList.remove("hidden");
        return;
    }

    const sendBtn = document.getElementById("emailModalSend");
    sendBtn.disabled = true;
    sendBtn.textContent = "Sending...";

    if (emailModalCallback) {
        await emailModalCallback(emails, msgEl);
    }

    sendBtn.disabled = false;
    sendBtn.textContent = "✉ Send";
});

// ── Build Export Query Params ─────────────────────────────────────────────
function buildExportParams() {
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;
    const unreportedOnly = document.getElementById("unreportedOnly").checked;
    const checkedTypes = Array.from(document.querySelectorAll(".svc-type:checked"))
        .map(cb => cb.value);
    return { startDate, endDate, unreportedOnly, checkedTypes };
}

// ── Section 1: Export by Date & Service Type ──────────────────────────────
document.getElementById("exportBtn").addEventListener("click", async () => {
    const btn = document.getElementById("exportBtn");
    const { startDate, endDate, unreportedOnly, checkedTypes } = buildExportParams();

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

document.getElementById("emailExportBtn").addEventListener("click", () => {
    const { checkedTypes } = buildExportParams();
    if (!checkedTypes.length) {
        const errorDiv = document.getElementById("reportError");
        errorDiv.textContent = "Please select at least one service type.";
        errorDiv.classList.remove("hidden");
        return;
    }

    openEmailModal("Email Date & Service Type Report", async (emails, msgEl) => {
        const { startDate, endDate, unreportedOnly, checkedTypes } = buildExportParams();

        const params = new URLSearchParams();
        emails.forEach(e => params.append("emails", e));
        if (startDate) params.append("start_date", startDate);
        if (endDate) params.append("end_date", endDate + "T23:59:59");
        if (unreportedOnly) params.append("unreported_only", "true");
        params.append("service_types", checkedTypes.join(","));

        const res = await fetch(`${CONFIG.API_BASE}/email-reports/send-export?${params.toString()}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${Auth.getToken()}` }
        });

        const data = await res.json();
        if (res.ok) {
            msgEl.textContent = `✓ Report sent to ${emails.join(", ")}`;
            msgEl.className = "success-message";
            msgEl.classList.remove("hidden");
            if (unreportedOnly) await loadLastRun();
            setTimeout(() => document.getElementById("emailModal").classList.add("hidden"), 2500);
        } else {
            msgEl.textContent = data.detail || "Failed to send email.";
            msgEl.className = "error-message";
            msgEl.classList.remove("hidden");
        }
    });
});

document.getElementById("emailAutoBtn").addEventListener("click", async () => {
    const btn = document.getElementById("emailAutoBtn");
    btn.disabled = true;
    btn.textContent = "Sending...";

    const res = await fetch(`${CONFIG.API_BASE}/email-reports/send-unreported-auto`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${Auth.getToken()}` }
    });

    const data = await res.json();
    const errorDiv = document.getElementById("reportError");
    if (res.ok) {
        errorDiv.textContent = `✓ Unreported records sent to ${data.recipients.join(", ")}`;
        errorDiv.className = "success-message";
        errorDiv.classList.remove("hidden");
        await loadLastRun();
        setTimeout(() => errorDiv.classList.add("hidden"), 4000);
    } else {
        errorDiv.textContent = data.detail || "Failed to send auto report.";
        errorDiv.className = "error-message";
        errorDiv.classList.remove("hidden");
    }

    btn.disabled = false;
    btn.textContent = "✉ Send to Auto-Recipients";
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

document.getElementById("emailLookupBtn").addEventListener("click", () => {
    const field = document.getElementById("lookupField").value;
    const value = document.getElementById("lookupValue").value.trim();
    const errorDiv = document.getElementById("lookupError");

    if (!value) {
        errorDiv.textContent = "Please enter a search value.";
        errorDiv.classList.remove("hidden");
        return;
    }

    openEmailModal("Email Device Lookup Report", async (emails, msgEl) => {
        const params = new URLSearchParams();
        emails.forEach(e => params.append("emails", e));
        params.append("field", field);
        params.append("value", value);

        const res = await fetch(`${CONFIG.API_BASE}/email-reports/send-lookup?${params.toString()}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${Auth.getToken()}` }
        });

        const data = await res.json();
        if (res.ok) {
            msgEl.textContent = `✓ Report sent to ${emails.join(", ")}`;
            msgEl.className = "success-message";
            msgEl.classList.remove("hidden");
            setTimeout(() => document.getElementById("emailModal").classList.add("hidden"), 2500);
        } else {
            msgEl.textContent = data.detail || "Failed to send email.";
            msgEl.className = "error-message";
            msgEl.classList.remove("hidden");
        }
    });
});