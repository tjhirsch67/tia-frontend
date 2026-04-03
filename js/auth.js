const Auth = {
    getToken() {
        return localStorage.getItem("tia_token");
    },

    getUser() {
        return {
            username: localStorage.getItem("tia_username"),
            role: localStorage.getItem("tia_role")
        };
    },

    setSession(token, username, role) {
        localStorage.setItem("tia_token", token);
        localStorage.setItem("tia_username", username);
        localStorage.setItem("tia_role", role);
        localStorage.setItem("tia_last_active", Date.now());
    },

    clearSession() {
        localStorage.removeItem("tia_token");
        localStorage.removeItem("tia_username");
        localStorage.removeItem("tia_role");
        localStorage.removeItem("tia_last_active");
    },

    updateActivity() {
        localStorage.setItem("tia_last_active", Date.now());
    },

    isSessionValid() {
        const token = this.getToken();
        if (!token) return false;
        const last = parseInt(localStorage.getItem("tia_last_active") || "0");
        if (Date.now() - last > CONFIG.INACTIVITY_LIMIT) {
            this.clearSession();
            return false;
        }
        return true;
    },

    requireAuth(allowedRoles = []) {
        if (!this.isSessionValid()) {
            window.location.href = "index.html";
            return false;
        }
        const { role } = this.getUser();
        if (allowedRoles.length && !allowedRoles.includes(role)) {
            window.location.href = "form.html";
            return false;
        }
        this.updateActivity();
        return true;
    },

    logout() {
        this.clearSession();
        window.location.href = "index.html";
    },

    async apiCall(method, endpoint, body = null) {
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.getToken()}`
        };
        const options = { method, headers };
        if (body) options.body = JSON.stringify(body);
        const res = await fetch(`${CONFIG.API_BASE}${endpoint}`, options);
        if (res.status === 401) {
            this.clearSession();
            window.location.href = "index.html";
            return null;
        }
        return res;
    }
};