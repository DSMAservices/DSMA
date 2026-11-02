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
$("#customer-logout-button")?.addEventListener("click", () => logout());

$("#customer-ticket-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); try { await api("api/tickets.php", { method: data.ticketId ? "PATCH" : "POST", body: JSON.stringify({ ...data, id: data.ticketId || undefined }) }); resetCustomerTicketForm(); await loadCustomerTickets(); $("#customer-ticket-status").textContent = data.ticketId ? tr("msg_updated") : tr("msg_created"); } catch (error) { showError("#customer-ticket-status", error); } });
$("#customer-ticket-cancel")?.addEventListener("click", () => { resetCustomerTicketForm(); $("#customer-ticket-status").textContent = tr("msg_cancel"); });
const resetCustomerTicketForm = () => { const form = $("#customer-ticket-form"); if (!form) return; form.reset(); $("#customer-ticket-id").value = ""; $("#customer-ticket-submit").textContent = tr("create"); $("#customer-ticket-cancel").classList.add("is-hidden"); };
const startTicketEdit = (ticket) => { $("#customer-ticket-id").value = ticket.id; $("#customer-ticket-subject").value = ticket.subject; $("#customer-ticket-details").value = ticket.details; $("#customer-ticket-submit").textContent = tr("save_changes"); $("#customer-ticket-cancel").classList.remove("is-hidden"); $("#customer-ticket-subject").focus(); };
const deleteTicket = async (id) => { if (!window.confirm(tr("confirm_delete"))) return false; await api("api/tickets.php", { method: "DELETE", body: JSON.stringify({ id }) }); return true; };
const loadCustomerTickets = async () => { const result = await api("api/tickets.php"); const list = $("#customer-ticket-list"); if (!list) return; list.innerHTML = result.tickets.length ? result.tickets.map((ticket) => `<article class="ticket-item"><div class="ticket-item-top"><div><h4>${escapeHtml(ticket.subject)}</h4><p class="ticket-meta">${escapeHtml(ticket.id)} · ${tr("submitted")} ${formatDate(ticket.created_at)}</p></div><span class="status-badge">${escapeHtml(tr("st_" + ticket.status))}</span></div><p>${escapeHtml(ticket.details)}</p><p class="ticket-meta">${tr("eta")}: <strong>${escapeHtml(formatDate(ticket.eta_date))}</strong></p><div class="button-row ticket-actions"><button class="button button-outline ticket-edit" type="button" data-ticket-id="${escapeHtml(ticket.id)}">${tr("edit")}</button><button class="button button-outline ticket-delete" type="button" data-ticket-id="${escapeHtml(ticket.id)}">${tr("delete")}</button></div></article>`).join("") : `<p class="small-note">${tr("empty")}</p>`; list.querySelectorAll(".ticket-edit").forEach((button) => button.addEventListener("click", () => startTicketEdit(result.tickets.find((ticket) => ticket.id === button.dataset.ticketId)))); list.querySelectorAll(".ticket-delete").forEach((button) => button.addEventListener("click", async () => { try { if (!(await deleteTicket(button.dataset.ticketId))) return; resetCustomerTicketForm(); await loadCustomerTickets(); $("#customer-ticket-status").textContent = tr("msg_deleted"); } catch (error) { showError("#customer-ticket-status", error); } })); };
const showCustomerDashboard = async (user) => { customerUser = user; $("#customer-auth-view")?.classList.add("is-hidden"); $("#customer-dashboard")?.classList.remove("is-hidden"); if ($("#customer-welcome")) $("#customer-welcome").textContent = tr("d_title", { name: user.business_name || tr("d_default_name") }); try { await loadCustomerTickets(); } catch (error) { showError("#customer-ticket-status", error); } };

$("#login-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { const data = Object.fromEntries(new FormData(form)); const result = await api("api/auth.php?action=login", { method: "POST", body: JSON.stringify({ ...data, role: "team" }) }); form.reset(); showTeamDashboard(result.user); } catch (error) { showError("#login-status", error); } });
$("#logout-button")?.addEventListener("click", () => logout());
$("#team-account-form")?.addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; try { const data = Object.fromEntries(new FormData(form)); const result = await api("api/team.php", { method: "POST", body: JSON.stringify(data) }); form.reset(); $("#team-account-status").textContent = `Customer account created for ${result.email}. Share the temporary password securely.`; } catch (error) { showError("#team-account-status", error); } });
const loadTeamTickets = async () => { const result = await api("api/tickets.php"); const list = $("#ticket-list"); if (!list) return; list.innerHTML = result.tickets.length ? result.tickets.map((ticket) => `<article class="ticket-item"><div class="ticket-item-top"><div><h4>${escapeHtml(ticket.subject)}</h4><p class="ticket-meta">${escapeHtml(ticket.id)} · ${escapeHtml(ticket.business_name)} · ${formatDate(ticket.created_at)}</p></div><span class="status-badge">${escapeHtml(ticket.status)}</span></div><p>${escapeHtml(ticket.details)}</p><p class="ticket-meta">Customer: ${escapeHtml(ticket.email)}</p><div class="team-ticket-controls"><label>Status<select data-status-id="${escapeHtml(ticket.id)}"><option ${ticket.status === "New" ? "selected" : ""}>New</option><option ${ticket.status === "In progress" ? "selected" : ""}>In progress</option><option ${ticket.status === "Waiting" ? "selected" : ""}>Waiting</option><option ${ticket.status === "Complete" ? "selected" : ""}>Complete</option></select></label><label>ETA<input type="date" data-eta-id="${escapeHtml(ticket.id)}" value="${escapeHtml(ticket.eta_date || "")}"></label><button class="button button-outline save-ticket" type="button" data-save-id="${escapeHtml(ticket.id)}">Save status</button><button class="button button-outline ticket-delete" type="button" data-ticket-id="${escapeHtml(ticket.id)}">Delete request</button></div></article>`).join("") : "<p class=\"small-note\">No requests yet.</p>"; list.querySelectorAll(".save-ticket").forEach((button) => button.addEventListener("click", async () => { try { await api("api/tickets.php", { method: "PATCH", body: JSON.stringify({ id: button.dataset.saveId, status: $(`[data-status-id="${button.dataset.saveId}"]`).value, eta_date: $(`[data-eta-id="${button.dataset.saveId}"]`).value }) }); await loadTeamTickets(); } catch (error) { alert(error.message); } })); list.querySelectorAll(".ticket-delete").forEach((button) => button.addEventListener("click", async () => { try { if (await deleteTicket(button.dataset.ticketId)) await loadTeamTickets(); } catch (error) { alert(error.message); } })); };
const showTeamDashboard = async () => { $("#login-view")?.classList.add("is-hidden"); $("#dashboard-view")?.classList.remove("is-hidden"); try { await loadTeamTickets(); } catch (error) { showError("#login-status", error); } };
async function logout() { try { await api("api/auth.php?action=logout", { method: "POST" }); window.location.reload(); } catch (error) { alert(error.message); } }

(async () => { try { const result = await api("api/auth.php?action=me"); if (result.demoMode) document.querySelectorAll("[data-demo-credentials]").forEach((node) => { node.hidden = false; }); if (result.user?.role === "customer") await showCustomerDashboard(result.user); if (result.user?.role === "team") await showTeamDashboard(result.user); } catch { /* Logged out state is the default UI. */ } })();


document.addEventListener("dsma:lang", () => {
  const submit = $("#customer-ticket-submit"); if (submit) submit.textContent = $("#customer-ticket-id")?.value ? tr("save_changes") : tr("create");
  document.querySelectorAll(".form-status").forEach((node) => { node.textContent = ""; });
  if (customerUser && !$("#customer-dashboard")?.classList.contains("is-hidden")) showCustomerDashboard(customerUser);
});

const footerMark = $(".footer-wordmark");
if (footerMark && "IntersectionObserver" in window) {
  new IntersectionObserver((entries, observer) => { if (entries[0].isIntersecting) { footerMark.classList.add("is-visible"); observer.disconnect(); } }, { threshold: .4 }).observe(footerMark);
}
