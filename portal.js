// Portal workspace for customers and the DSMA team: a request list, a conversation per request,
// and attachments (images and documents) on every message. Shared helpers ($, api, tr, escapeHtml,
// formatDate, logout) come from script.js, which loads first.
window.PortalUI = (() => {
  const MAX_FILES = 4;
  const MAX_BYTES = 5 * 1024 * 1024;
  const EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  const STATUSES = ["New", "In progress", "Waiting", "Complete"];
  const POLL_MS = 20000;

  const state = { role: null, user: null, tickets: [], selected: null, view: "empty", filter: "all", messageCount: -1 };
  let root = null;
  let picker = null;
  let timer = null;

  const lang = () => (window.currentLang ? window.currentLang() : undefined);
  const time = (value) => {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T") + (String(value).includes("Z") || String(value).includes("+") ? "" : "Z"));
    return date.toLocaleString(lang(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const size = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const statusLabel = (status) => (state.role === "customer" ? tr("st_" + status) : status);
  const clip = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.4-8.4"/></svg>';

  // ---- Attachment picker (used by the composer and the new-request form) ----
  const makePicker = (scope) => {
    const input = scope.querySelector(".pt-file-input");
    const list = scope.querySelector(".pt-chosen");
    const note = scope.querySelector(".pt-attach-note");
    const files = [];
    const draw = () => {
      list.innerHTML = files.map((file, index) => `<li><span>${escapeHtml(file.name)} <small>${size(file.size)}</small></span><button type="button" data-remove="${index}" aria-label="${escapeHtml(tr("pt_remove"))}">×</button></li>`).join("");
      list.hidden = !files.length;
    };
    const add = (incoming) => {
      note.textContent = "";
      for (const file of incoming) {
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        if (files.length >= MAX_FILES) { note.textContent = tr("pt_err_count"); break; }
        if (!file.name.includes(".") || !EXTENSIONS.includes(ext)) { note.textContent = tr("pt_err_type", { name: file.name }); continue; }
        if (file.size > MAX_BYTES) { note.textContent = tr("pt_err_size", { name: file.name }); continue; }
        files.push(file);
      }
      draw();
    };
    scope.querySelector(".pt-attach")?.addEventListener("click", () => input.click());
    input.addEventListener("change", () => { add([...input.files]); input.value = ""; });
    list.addEventListener("click", (event) => { const button = event.target.closest("[data-remove]"); if (!button) return; files.splice(Number(button.dataset.remove), 1); draw(); });
    const read = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(",")[1] || "" }); reader.onerror = () => reject(new Error(tr("pt_err_read", { name: file.name }))); reader.readAsDataURL(file); });
    draw();
    return { add, count: () => files.length, clear: () => { files.length = 0; draw(); note.textContent = ""; }, payload: () => Promise.all(files.map(read)) };
  };
  const pickerHtml = () => `<div class="pt-attachments"><button class="pt-attach" type="button">${clip}<span>${escapeHtml(tr("pt_attach"))}</span></button><input class="pt-file-input" type="file" multiple hidden accept="${EXTENSIONS.map((ext) => "." + ext).join(",")}"><ul class="pt-chosen" hidden></ul><p class="pt-attach-note small-note" role="status"></p></div>`;

  // ---- Shell ----
  const buildShell = () => {
    const customer = state.role === "customer";
    const title = customer ? tr("d_title", { name: state.user.business_name || tr("d_default_name") }) : tr("pt_team_title");
    const filters = customer ? "" : `<div class="pt-filters" role="group" aria-label="${escapeHtml(tr("pt_filter"))}">${["all", ...STATUSES].map((key) => `<button type="button" data-filter="${key}" class="${state.filter === key ? "is-on" : ""}">${escapeHtml(key === "all" ? tr("pt_all") : key)}</button>`).join("")}</div>`;
    root.innerHTML = `
      <div class="pt-top"><div><p class="portal-eyebrow">${escapeHtml(customer ? tr("d_eyebrow") : tr("pt_team_eyebrow"))}</p><h2>${escapeHtml(title)}</h2><p class="pt-help">${escapeHtml(customer ? tr("pt_help_customer") : tr("pt_help_team"))}</p></div><button class="button button-outline" type="button" data-act="logout">${escapeHtml(tr("signout"))}</button></div>
      <div class="pt-layout is-${state.view === "empty" || state.view === "list" ? "list" : "detail"}">
        <aside class="pt-side"><div class="pt-side-head"><button class="button button-blue" type="button" data-act="${customer ? "new" : "customer"}">${escapeHtml(customer ? tr("pt_new_request") : tr("pt_new_customer"))} <span aria-hidden="true">+</span></button></div>${filters}<ul class="pt-list" id="pt-list"></ul></aside>
        <section class="pt-main" id="pt-main" aria-live="polite"></section>
      </div>`;
    drawList();
    drawMain();
  };

  const needsReply = (ticket) => (state.role === "team" ? ticket.last_author_role !== "team" && ticket.status !== "Complete" : ticket.last_author_role === "team");
  const drawList = () => {
    const list = $("#pt-list", root);
    if (!list) return;
    const tickets = state.tickets.filter((ticket) => state.role === "customer" || state.filter === "all" || ticket.status === state.filter);
    list.innerHTML = tickets.length ? tickets.map((ticket) => `<li><button type="button" class="pt-item ${ticket.id === state.selected ? "is-open" : ""}" data-id="${escapeHtml(ticket.id)}"><span class="pt-item-top"><strong>${escapeHtml(ticket.subject)}</strong><span class="pt-pill s-${escapeHtml(ticket.status.replace(/\s/g, "-"))}">${escapeHtml(statusLabel(ticket.status))}</span></span><span class="pt-item-meta">${escapeHtml(state.role === "team" ? `${ticket.business_name || ticket.email} · ` : "")}${escapeHtml(formatDate(ticket.updated_at || ticket.created_at))}</span>${needsReply(ticket) ? `<span class="pt-flag">${escapeHtml(state.role === "team" ? tr("pt_needs_reply") : tr("pt_dsma_replied"))}</span>` : ""}</button></li>`).join("") : `<li class="pt-none">${escapeHtml(state.role === "customer" ? tr("pt_none_customer") : tr("pt_none_team"))}</li>`;
  };

  const setView = (view) => { state.view = view; root.querySelector(".pt-layout")?.classList.toggle("is-detail", view !== "empty" && view !== "list"); root.querySelector(".pt-layout")?.classList.toggle("is-list", view === "empty" || view === "list"); drawList(); drawMain(); };

  // ---- Main pane ----
  const drawMain = () => {
    const main = $("#pt-main", root);
    picker = null;
    if (!main) return;
    if (state.view === "new") return drawNewRequest(main);
    if (state.view === "customer") return drawNewCustomer(main);
    if (state.view === "thread" && state.selected) return drawThread(main);
    main.innerHTML = `<div class="pt-empty"><h3>${escapeHtml(state.role === "customer" ? tr("pt_empty_h_customer") : tr("pt_empty_h_team"))}</h3><p>${escapeHtml(state.role === "customer" ? tr("pt_empty_p_customer") : tr("pt_empty_p_team"))}</p></div>`;
  };

  const drawNewRequest = (main) => {
    main.innerHTML = `<form class="pt-form"><button class="pt-back" type="button" data-act="back">← ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(tr("req_h"))}</h3>
      <label for="pt-subject"><span>${escapeHtml(tr("lbl_subj"))}</span><input id="pt-subject" name="subject" type="text" maxlength="200" required placeholder="${escapeHtml(tr("ph_subj"))}"></label>
      <label for="pt-details"><span>${escapeHtml(tr("lbl_det"))}</span><textarea id="pt-details" name="details" rows="6" maxlength="5000" required placeholder="${escapeHtml(tr("ph_det"))}"></textarea></label>
      ${pickerHtml()}<p class="small-note">${escapeHtml(tr("pt_attach_hint"))}</p>
      <div class="button-row"><button class="button button-blue" type="submit">${escapeHtml(tr("create"))}</button><button class="button button-outline" type="button" data-act="back">${escapeHtml(tr("pt_cancel"))}</button></div><p class="form-status" role="status"></p></form>`;
    const form = main.querySelector("form");
    picker = makePicker(form);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status"); const submit = form.querySelector("[type=submit]"); submit.disabled = true; status.textContent = tr("pt_sending");
      try {
        const attachments = await picker.payload();
        const data = Object.fromEntries(new FormData(form));
        const result = await api("api/tickets.php", { method: "POST", body: JSON.stringify({ subject: data.subject, details: data.details, attachments }) });
        await loadTickets(); await openTicket(result.id);
      } catch (error) { status.textContent = error.message; submit.disabled = false; }
    });
    form.querySelector("input")?.focus();
  };

  const drawNewCustomer = (main) => {
    main.innerHTML = `<form class="pt-form"><button class="pt-back" type="button" data-act="back">← ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(tr("pt_new_customer"))}</h3><p class="small-note">${escapeHtml(tr("pt_new_customer_help"))}</p>
      <div class="form-grid"><label for="pt-c-name"><span>Contact name</span><input id="pt-c-name" name="name" type="text" required></label><label for="pt-c-business"><span>Business name</span><input id="pt-c-business" name="business" type="text" required></label></div>
      <div class="form-grid"><label for="pt-c-email"><span>Account email</span><input id="pt-c-email" name="email" type="email" required placeholder="name@example.com"></label><label for="pt-c-pass"><span>Temporary password</span><input id="pt-c-pass" name="password" type="text" required minlength="8" placeholder="At least 8 characters"></label></div>
      <div class="button-row"><button class="button button-blue" type="submit">Create customer account</button><button class="button button-outline" type="button" data-act="back">${escapeHtml(tr("pt_cancel"))}</button></div><p class="form-status" role="status"></p></form>`;
    const form = main.querySelector("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status");
      try { const result = await api("api/team.php", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) }); form.reset(); status.textContent = tr("pt_customer_created", { email: result.email }); } catch (error) { status.textContent = error.message; }
    });
  };

  const fileHtml = (file) => file.image
    ? `<a class="pt-img" href="api/files.php?id=${file.id}" target="_blank" rel="noopener" title="${escapeHtml(file.name)}"><img src="api/files.php?id=${file.id}" alt="${escapeHtml(file.name)}" loading="lazy"></a>`
    : `<a class="pt-doc" href="api/files.php?id=${file.id}&download=1">${clip}<span>${escapeHtml(file.name)} <small>${size(file.size)}</small></span></a>`;
  const bubble = (who, name, when, body, files) => `<article class="pt-msg ${who === state.role ? "is-mine" : "is-theirs"}"><header><strong>${escapeHtml(who === state.role ? tr("pt_you") : name)}</strong><span>${escapeHtml(when)}</span></header>${body ? `<p>${escapeHtml(body)}</p>` : ""}${files.length ? `<div class="pt-files">${files.map(fileHtml).join("")}</div>` : ""}</article>`;
  const ticket = () => state.tickets.find((item) => item.id === state.selected);

  const messagesHtml = (messages) => {
    const current = ticket();
    const first = bubble("customer", current.business_name || state.user.business_name || tr("d_default_name"), time(current.created_at), current.details, []);
    return `<span class="pt-section-label">${escapeHtml(tr("pt_original"))}</span>${first}${messages.length ? `<span class="pt-section-label">${escapeHtml(tr("pt_conversation"))}</span>` : ""}${messages.map((message) => bubble(message.author_role, message.author_name, time(message.created_at), message.body, message.files)).join("")}`;
  };

  const drawThread = async (main) => {
    const current = ticket();
    if (!current) { state.view = "empty"; return drawMain(); }
    const team = state.role === "team";
    const controls = team
      ? `<div class="pt-controls"><label>Status<select id="pt-status">${STATUSES.map((status) => `<option ${current.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><label>${escapeHtml(tr("eta"))}<input id="pt-eta" type="date" value="${escapeHtml(current.eta_date ? String(current.eta_date).slice(0, 10) : "")}"></label><button class="button button-blue" type="button" data-act="save">${escapeHtml(tr("pt_save"))}</button></div>`
      : `<p class="pt-facts"><span class="pt-pill s-${escapeHtml(current.status.replace(/\s/g, "-"))}">${escapeHtml(statusLabel(current.status))}</span><span>${escapeHtml(tr("eta"))}: <strong>${escapeHtml(formatDate(current.eta_date))}</strong></span></p>`;
    main.innerHTML = `<div class="pt-thread"><div class="pt-thread-head"><button class="pt-back" type="button" data-act="back">← ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(current.subject)}</h3><p class="pt-meta">${escapeHtml(current.id)}${team ? " · " + escapeHtml(current.business_name || "") + " · " + escapeHtml(current.email || "") : ""} · ${escapeHtml(tr("submitted"))} ${escapeHtml(formatDate(current.created_at))}</p>${controls}</div>
      <div class="pt-msgs" id="pt-msgs" tabindex="0"><p class="small-note">${escapeHtml(tr("pt_loading"))}</p></div>
      <form class="pt-composer"><label for="pt-body" class="sr-only">${escapeHtml(tr("pt_write"))}</label><textarea id="pt-body" name="body" rows="3" maxlength="5000" placeholder="${escapeHtml(tr("pt_write"))}"></textarea>${pickerHtml()}<div class="pt-composer-row"><span class="small-note">${escapeHtml(tr("pt_attach_hint"))}</span><button class="button button-blue" type="submit">${escapeHtml(tr("pt_send"))} <span aria-hidden="true">↗</span></button></div><p class="form-status" role="status"></p></form>
      <div class="pt-danger"><button type="button" class="pt-delete" data-act="delete">${escapeHtml(tr("delete"))}</button></div></div>`;
    const form = main.querySelector("form");
    picker = makePicker(form);
    const body = form.querySelector("textarea");
    body.addEventListener("paste", (event) => { const files = [...(event.clipboardData?.files || [])]; if (files.length) { event.preventDefault(); picker.add(files); } });
    form.addEventListener("dragover", (event) => event.preventDefault());
    form.addEventListener("drop", (event) => { event.preventDefault(); picker.add([...event.dataTransfer.files]); });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status"); const submit = form.querySelector("[type=submit]");
      if (!body.value.trim() && !picker.count()) { status.textContent = tr("pt_err_empty"); return; }
      submit.disabled = true; status.textContent = tr("pt_sending");
      try {
        const attachments = await picker.payload();
        await api("api/messages.php", { method: "POST", body: JSON.stringify({ ticket_id: state.selected, body: body.value, attachments }) });
        body.value = ""; picker.clear(); status.textContent = "";
        await refreshThread(true); await loadTickets(true);
      } catch (error) { status.textContent = error.message; }
      submit.disabled = false;
    });
    await refreshThread(true);
  };

  const refreshThread = async (force) => {
    const box = $("#pt-msgs", root);
    if (!box || !state.selected) return;
    const result = await api(`api/messages.php?ticket_id=${encodeURIComponent(state.selected)}`);
    const signature = result.messages.length + ":" + result.messages.reduce((total, message) => total + message.files.length, 0);
    if (!force && signature === state.messageCount) return;
    state.messageCount = signature;
    box.innerHTML = messagesHtml(result.messages);
    box.scrollTop = box.scrollHeight;
  };

  // ---- Data and actions ----
  const loadTickets = async (quiet) => {
    const result = await api("api/tickets.php");
    state.tickets = result.tickets;
    if (state.selected && !ticket()) { state.selected = null; if (state.view === "thread") state.view = "empty"; }
    drawList();
    if (!quiet && state.view === "empty") drawMain();
  };
  const openTicket = async (id) => { state.selected = id; state.messageCount = -1; setView("thread"); root.scrollIntoView({ block: "start" }); };

  const onClick = async (event) => {
    const filter = event.target.closest("[data-filter]");
    if (filter) { state.filter = filter.dataset.filter; root.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("is-on", button === filter)); return drawList(); }
    const item = event.target.closest(".pt-item");
    if (item) return openTicket(item.dataset.id);
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    try {
      if (act === "logout") return logout();
      if (act === "new") { state.selected = null; return setView("new"); }
      if (act === "customer") { state.selected = null; return setView("customer"); }
      if (act === "back") { state.view = "empty"; state.selected = null; return setView("empty"); }
      if (act === "save") {
        const current = ticket();
        await api("api/tickets.php", { method: "PATCH", body: JSON.stringify({ id: current.id, status: $("#pt-status", root).value, eta_date: $("#pt-eta", root).value }) });
        await loadTickets(true);
        const note = root.querySelector(".pt-controls .button"); if (note) { const label = note.textContent; note.textContent = tr("pt_saved"); setTimeout(() => { note.textContent = label; }, 1600); }
      }
      if (act === "delete") {
        if (!window.confirm(tr("confirm_delete"))) return;
        await api("api/tickets.php", { method: "DELETE", body: JSON.stringify({ id: state.selected }) });
        state.selected = null; await loadTickets(true); setView("empty");
      }
    } catch (error) { window.alert(error.message); }
  };

  const poll = () => {
    clearInterval(timer);
    timer = setInterval(async () => {
      if (document.hidden || !state.role) return;
      try { await loadTickets(true); if (state.view === "thread") await refreshThread(false); } catch { /* try again next time */ }
    }, POLL_MS);
  };

  const show = async (role, user) => {
    state.role = role; state.user = user;
    root = role === "customer" ? $("#customer-dashboard") : $("#dashboard-view");
    $(".portal-main")?.classList.add("pt-active");
    $(".portal-tabs")?.classList.add("is-hidden");
    document.querySelectorAll(".portal-panel").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.panel !== role));
    $("#customer-auth-view")?.classList.add("is-hidden"); $("#login-view")?.classList.add("is-hidden");
    root.classList.remove("is-hidden");
    root.onclick = onClick;
    try { const result = await api("api/tickets.php"); state.tickets = result.tickets; } catch (error) { state.tickets = []; }
    buildShell(); poll();
  };

  const rerender = () => { if (!state.role || !root) return; const draft = $("#pt-body", root)?.value; buildShell(); const body = $("#pt-body", root); if (body && draft) body.value = draft; };

  return { show, rerender };
})();
