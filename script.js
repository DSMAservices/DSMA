const $ = (selector) => document.querySelector(selector);
let customerUser = null;

async function api(path, options = {}) {
  if (location.protocol === "file:") throw new Error("Sign-in needs the local server. Run npm run demo, then open http://127.0.0.1:3000/portal.html.");
  const method = options.method || "GET";
  const headers = { "Accept": "application/json", ...(options.headers || {}) };
  if (method !== "GET") {
    const csrfResponse = await fetch("api/auth.php?action=csrf", { credentials: "same-origin" });
    const csrf = await csrfResponse.json(); headers["X-CSRF-Token"] = csrf.csrf;
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data;
}

const tr = (key, vars) => (window.t ? window.t(key, vars) : key);
const formatDate = (value) => value ? new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")).toLocaleDateString(window.currentLang ? window.currentLang() : undefined, { month: "short", day: "numeric", year: "numeric" }) : tr("not_set");
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const showError = (selector, error) => { const node = $(selector); if (node) node.textContent = error.message; };

const scrollMeter = $(".scroll-meter");
if (scrollMeter) {
  let scrollQueued = false;
  const updateScrollMeter = () => {
    const distance = document.documentElement.scrollHeight - window.innerHeight;
    scrollMeter.style.transform = `scaleX(${distance > 0 ? window.scrollY / distance : 0})`;
    scrollQueued = false;
  };
  window.addEventListener("scroll", () => {
    if (!scrollQueued) { scrollQueued = true; requestAnimationFrame(updateScrollMeter); }
  }, { passive: true });
  window.addEventListener("resize", updateScrollMeter);
  updateScrollMeter();
}

const menuToggle = $(".menu-toggle");
const nav = $(".site-nav");
menuToggle?.addEventListener("click", () => { const open = nav.classList.toggle("is-open"); menuToggle.setAttribute("aria-expanded", String(open)); });
document.querySelectorAll(".site-nav a").forEach((link) => link.addEventListener("click", () => { nav?.classList.remove("is-open"); menuToggle?.setAttribute("aria-expanded", "false"); }));
document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".tab-button").forEach((item) => { item.classList.toggle("is-active", item === button); item.setAttribute("aria-selected", String(item === button)); }); document.querySelectorAll(".portal-panel").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.panel !== button.dataset.tab)); }));
document.querySelectorAll("[data-demo-fill]").forEach((button) => button.addEventListener("click", () => { const isTeam = button.dataset.demoFill === "team"; const prefix = isTeam ? "login" : "customer-login"; $(`#${prefix}-email`).value = isTeam ? "team@dsma.demo" : "customer@dsma.demo"; $(`#${prefix}-password`).value = isTeam ? "DSMA-team-2026" : "DSMA-customer-2026"; $(`#${prefix}-password`).focus(); }));

$("#contact-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api("api/contact.php", { method: "POST", body: JSON.stringify({ ...Object.fromEntries(new FormData(form)), language: window.currentLang ? window.currentLang() : "en" }) }); form.reset(); $("#contact-status").textContent = tr("sent"); } catch (error) { showError("#contact-status", error); } });

$("#customer-login-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { const data = Object.fromEntries(new FormData(form)); const result = await api("api/auth.php?action=login", { method: "POST", body: JSON.stringify({ ...data, role: "customer" }) }); form.reset(); showCustomerDashboard(result.user); } catch (error) { showError("#customer-login-status", error); } });
const showCustomerDashboard = (user) => window.PortalUI.show("customer", user);
const showTeamDashboard = (user) => window.PortalUI.show("team", user);

$("#login-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { const data = Object.fromEntries(new FormData(form)); const result = await api("api/auth.php?action=login", { method: "POST", body: JSON.stringify({ ...data, role: "team" }) }); form.reset(); showTeamDashboard(result.user); } catch (error) { showError("#login-status", error); } });
async function logout() { try { await api("api/auth.php?action=logout", { method: "POST" }); window.location.reload(); } catch (error) { alert(error.message); } }

(async () => { try { const result = await api("api/auth.php?action=me"); if (result.demoMode) document.querySelectorAll("[data-demo-credentials]").forEach((node) => { node.hidden = false; }); if (result.user?.role === "customer") await showCustomerDashboard(result.user); if (result.user?.role === "team") await showTeamDashboard(result.user); } catch { /* Logged out state is the default UI. */ } })();


document.addEventListener("dsma:lang", () => {
  document.querySelectorAll(".form-status").forEach((node) => { node.textContent = ""; });
  window.PortalUI?.rerender();
});

const footerMark = $(".footer-wordmark");
if (footerMark && "IntersectionObserver" in window) {
  new IntersectionObserver((entries, observer) => { if (entries[0].isIntersecting) { footerMark.classList.add("is-visible"); observer.disconnect(); } }, { threshold: .4 }).observe(footerMark);
}
