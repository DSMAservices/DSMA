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


// Windy awning: every scallop is a flap of cloth hinged at the top rail. Gusts push the flaps in and out and sideways,
// each flap springs back with some overshoot, and neighbours pull on each other, so a flutter travels along the edge.
(() => {
  const header = document.querySelector(".site-header");
  if (!header || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "awning-canvas"; canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  header.appendChild(canvas);
  const root = getComputedStyle(document.documentElement);
  const COLORS = [root.getPropertyValue("--blue").trim() || "#3e4059", root.getPropertyValue("--orange").trim() || "#d27f65"];
  const INK = root.getPropertyValue("--ink").trim() || "#2d2f45";
  const SW = 23.25, RAIL = 2, STRAIGHT = 8.3, RADIUS = SW / 2, HEIGHT = 24;
  let width = 0, dpr = 1, count = 0;
  const swing = [], swingV = [], sway = [], swayV = [];
  const resize = () => {
    width = header.clientWidth; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(HEIGHT * dpr);
    count = Math.ceil(width / SW) + 1;
    while (swing.length < count) { swing.push(0); swingV.push(0); sway.push(0); swayV.push(0); }
  };
  resize(); window.addEventListener("resize", resize);

  // Gusts: where they hit (left, right or everywhere), how hard, and which way they push sideways.
  const gusts = [];
  const newGust = (now) => {
    const roll = Math.random();
    gusts.push({ t0: now, centre: roll < .33 ? Math.random() * .25 : roll < .66 ? .75 + Math.random() * .25 : Math.random(), spread: roll < .66 ? .14 + Math.random() * .14 : .4 + Math.random() * .4, power: Math.random() < .12 ? 1 + Math.random() * .4 : .3 + Math.random() * .7, side: Math.random() < .5 ? -1 : 1, tau: .6 + Math.random() * .7 });
    return now + (Math.random() < .1 ? 3 + Math.random() * 2.5 : .5 + Math.random() * 1.7);
  };
  const STIFF = 70, DAMP = 2.4, COUPLE = 55, PUSH = 60;
  const step = (dt, now) => {
    for (let i = 0; i < count; i++) {
      const place = (i * SW) / Math.max(width, 1);
      let push = 0, side = 0;
      for (const gust of gusts) {
        const age = now - gust.t0; if (age < 0) continue;
        const envelope = age < .25 ? age / .25 : Math.exp(-(age - .25) / gust.tau);
        const reach = Math.exp(-(((place - gust.centre) / gust.spread) ** 2)) * gust.power * envelope;
        const ripple = .65 + .35 * Math.sin(9 * age - .8 * i);
        push += reach * ripple; side += reach * gust.side * (.5 + .5 * Math.sin(7 * age - .6 * i + 1.3));
      }
      const breeze = Math.sin(1.7 * now + .5 * i) * Math.sin(.37 * now + 2 * i);
      const left = i > 0 ? i - 1 : i, right = i < count - 1 ? i + 1 : i;
      swingV[i] += (PUSH * push + 5 * breeze - STIFF * swing[i] - DAMP * swingV[i] + COUPLE * (swing[left] + swing[right] - 2 * swing[i])) * dt;
      swayV[i] += (PUSH * .9 * side + 4 * breeze - STIFF * sway[i] - DAMP * swayV[i] + COUPLE * (sway[left] + sway[right] - 2 * sway[i])) * dt;
    }
    for (let i = 0; i < count; i++) { swing[i] += swingV[i] * dt; sway[i] += swayV[i] * dt; }
  };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, HEIGHT);
    for (let i = 0; i < count; i++) {
      const angle = Math.max(-.35, Math.min(1.25, swing[i])), lean = Math.max(-.7, Math.min(.7, sway[i]));
      ctx.save(); ctx.translate(i * SW, RAIL); ctx.transform(1, 0, Math.sin(lean), Math.cos(angle), 0, 0);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(SW, 0); ctx.lineTo(SW, STRAIGHT); ctx.arc(SW / 2, STRAIGHT, RADIUS, 0, Math.PI); ctx.closePath();
      ctx.fillStyle = COLORS[i % 2]; ctx.fill();
      if (angle > 0) { ctx.fillStyle = `rgba(255,255,255,${(Math.min(angle, 1) * .22).toFixed(3)})`; ctx.fill(); }
      ctx.restore();
    }
    ctx.fillStyle = INK; ctx.fillRect(0, 0, width, RAIL);
  };

  let running = false, last = 0, now = 0, nextGust = 1.2;
  const frame = (stamp) => {
    if (!running) return;
    const dt = Math.min((stamp - last) / 1000 || 0, .033); last = stamp; now += dt;
    if (now >= nextGust) nextGust = newGust(now);
    while (gusts.length && now - gusts[0].t0 > 6) gusts.shift();
    step(dt / 2, now); step(dt / 2, now); draw();
    requestAnimationFrame(frame);
  };
  const start = () => { if (running) return; running = true; last = performance.now(); header.classList.add("awning-live"); requestAnimationFrame(frame); };
  const stop = () => { running = false; };
  draw(); header.classList.add("awning-live");
  if ("IntersectionObserver" in window) new IntersectionObserver((entries) => (entries[0].isIntersecting ? start() : stop())).observe(header); else start();
})();
