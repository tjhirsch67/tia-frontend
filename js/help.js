// Help page — user guides. Every signed-in TIA user can open it.

if (!Auth.requireAuth([])) { throw new Error("Redirecting"); }

const { username, role } = Auth.getUser();
document.getElementById("navUsername").textContent = username;
if (role === "admin") {
    document.getElementById("navAdmin").classList.remove("hidden");
}
if (role === "admin" || role === "tech_full") {
    document.getElementById("navReport").classList.remove("hidden");
}
Auth.loadDepotTabVisibility();

document.getElementById("hamburger").addEventListener("click", () => {
    document.getElementById("mainNav").classList.toggle("open");
});
