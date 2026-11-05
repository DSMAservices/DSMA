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


// Windy awning: the header awning is built from segments. Gusts arrive at random, from the left, the right or
// all along it, at random strengths, and each segment flaps a moment after its neighbour so the wind ripples through.
(() => {
  const header = document.querySelector(".site-header");
  if (!header || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !header.animate) return;
  const COUNT = 10;
  const rail = document.createElement("div");
  rail.className = "awning-rail"; rail.setAttribute("aria-hidden", "true");
  const segments = Array.from({ length: COUNT }, () => rail.appendChild(document.createElement("div"))).map((node) => { node.className = "awning-seg"; return node; });
  header.appendChild(rail); header.classList.add("awning-live");
  const align = () => { const left = rail.getBoundingClientRect().left; segments.forEach((node) => { node.style.backgroundPositionX = `${left - node.getBoundingClientRect().left}px`; }); };
  align(); window.addEventListener("resize", align);

  const SWINGS = [[.12, -14], [.28, 9], [.45, -10], [.62, 6], [.78, -4], [.91, 2], [1, 0]];
  const busyUntil = segments.map(() => 0);
  const gust = () => {
    const roll = Math.random();
    const centre = roll < .35 ? Math.random() * .2 : roll < .7 ? .8 + Math.random() * .2 : Math.random();
    const spread = roll < .7 ? .16 + Math.random() * .12 : .35 + Math.random() * .3;
    const strength = Math.random() < .1 ? 1 + Math.random() * .4 : .25 + Math.random() * .75;
    const sign = Math.random() < .5 ? -1 : 1;
    const duration = 1500 + Math.random() * 1500;
    const now = performance.now();
    segments.forEach((node, index) => {
      const place = (index + .5) / COUNT;
      const weight = Math.exp(-(((place - centre) / spread) ** 2)) * strength;
      if (weight < .06 || busyUntil[index] > now) return;
      const delay = Math.abs(place - centre) * 700;
      busyUntil[index] = now + delay + duration;
      node.animate(
        [{ offset: 0, transform: "none" }, ...SWINGS.map(([offset, angle]) => ({ offset, transform: `perspective(260px) rotateX(${(angle * sign * weight).toFixed(2)}deg) skewX(${(angle * sign * weight * .09).toFixed(2)}deg)` }))],
        { duration, delay, easing: "ease-in-out" }
      );
    });
    // Nearly constant wind: a new gust every half second or two, with the odd calm spell.
    setTimeout(gust, Math.random() < .12 ? 3500 + Math.random() * 3000 : 350 + Math.random() * 1500);
  };
  setTimeout(gust, 1200);
})();
