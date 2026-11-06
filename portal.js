// Portal workspace for clients and the DSMA team: a request list, a conversation per request,
// and attachments (images and documents) on every message. Shared helpers ($, api, tr, escapeHtml,
// formatDate, logout) come from script.js, which loads first.
window.PortalUI = (() => {
  const MAX_FILES = 4;
  const MAX_BYTES = 5 * 1024 * 1024;
  const EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "csv", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];
  const STATUSES = ["New", "In progress", "Waiting", "Complete"];
  const POLL_MS = 20000;

  const state = { translate: false, role: null, user: null, tickets: [], selected: null, view: "empty", filter: "all", messageCount: -1, materials: [], matOpen: false, matId: null, matEdit: null, matCustomer: null };
  const KINDS = [["website", "mt_g_website"], ["print", "mt_g_print"], ["photo", "mt_g_photo"], ["social", "mt_g_social"], ["other", "mt_g_other"]];
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
  const statusLabel = (status) => tr("st_" + status);
  const clip = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8.4-8.4"/></svg>';

  const tx = (key) => `<span data-i18n="${key}">${escapeHtml(tr(key))}</span>`; // re-translated by i18n.js on every language switch

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
    const filters = customer ? "" : `<div class="pt-filters" role="group" aria-label="${escapeHtml(tr("pt_filter"))}">${["all", ...STATUSES].map((key) => `<button type="button" data-filter="${key}" class="${state.filter === key ? "is-on" : ""}">${escapeHtml(key === "all" ? tr("pt_all") : statusLabel(key))}</button>`).join("")}</div>`;
    root.innerHTML = `
      <div class="pt-top"><div><p class="portal-eyebrow">${escapeHtml(customer ? tr("d_eyebrow") : tr("pt_team_eyebrow"))}</p><h2>${escapeHtml(title)}</h2><p class="pt-help">${escapeHtml(customer ? tr("pt_help_customer") : tr("pt_help_team"))}</p></div><div class="pt-top-actions"><button class="button button-outline" type="button" data-act="password">${escapeHtml(tr("pt_change_pw"))}</button><button class="button button-outline" type="button" data-act="logout">${escapeHtml(tr("signout"))}</button></div></div>
      <div class="pt-layout is-${state.view === "empty" || state.view === "list" ? "list" : "detail"}">
        <aside class="pt-side"><div class="pt-side-head"><button class="button button-blue" type="button" data-act="${customer ? "new" : "customer"}">${escapeHtml(customer ? tr("pt_new_request") : tr("pt_new_customer"))} <span aria-hidden="true">+</span></button></div>${filters}<details class="pt-mat" id="pt-mat"></details><ul class="pt-list" id="pt-list"></ul></aside>
        <section class="pt-main" id="pt-main" aria-live="polite"></section>
      </div>`;
    drawList();
    drawMaterials();
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
    if (state.view === "password") return drawPassword(main);
    if (state.view === "material" && state.matId) return drawMaterial(main);
    if (state.view === "material-form") return drawMaterialForm(main);
    if (state.view === "thread" && state.selected) return drawThread(main);
    main.innerHTML = `<div class="pt-empty"><h3>${escapeHtml(state.role === "customer" ? tr("pt_empty_h_customer") : tr("pt_empty_h_team"))}</h3><p>${escapeHtml(state.role === "customer" ? tr("pt_empty_p_customer") : tr("pt_empty_p_team"))}</p></div>`;
  };

  // ---- Materials: things the team made for a client (websites, print designs...). The team edits them; clients only look. ----
  const teamSide = () => state.role === "team";
  const materialClient = () => (teamSide() ? ticket()?.customer_id ?? state.matCustomer : null);
  const material = () => state.materials.find((item) => item.id === state.matId);
  const drawMaterials = () => {
    const box = $("#pt-mat", root);
    if (!box) return;
    const team = teamSide();
    const groups = KINDS.map(([kind, key]) => [kind, key, state.materials.filter((item) => item.kind === kind)]).filter((group) => group[2].length);
    const needClient = team && !materialClient();
    const body = needClient ? `<p class="pt-mat-note">${tx("mt_pick")}</p>`
      : `${team ? `<button class="button button-blue pt-mat-add" type="button" data-act="mt-add">${tx("mt_add")} <span aria-hidden="true">+</span></button>` : ""}`
        + (groups.length ? groups.map(([, key, items]) => `<h4>${tx(key)}</h4><ul>${items.map((item) => `<li><button type="button" class="pt-mat-item ${item.id === state.matId && state.view === "material" ? "is-open" : ""}" data-mat="${item.id}">${escapeHtml(item.title)}</button></li>`).join("")}</ul>`).join("")
          : `<p class="pt-mat-note">${tx(team ? "mt_empty_team" : "mt_empty_client")}</p>`);
    box.open = state.matOpen;
    box.innerHTML = `<summary>${tx("mt_h")} <span class="pt-mat-count">${state.materials.length}</span></summary><div class="pt-mat-body">${body}</div>`;
  };
  const loadMaterials = async () => {
    const id = materialClient();
    if (teamSide() && !id) { state.materials = []; return drawMaterials(); }
    if (teamSide()) state.matCustomer = id;
    try { state.materials = (await api("api/materials.php" + (teamSide() ? `?customer_id=${encodeURIComponent(id)}` : ""))).materials; } catch { return; }
    if (state.matId && !material() && state.view === "material") { state.matId = null; state.view = "empty"; drawMain(); }
    drawMaterials();
  };
  const canEmbed = (url) => { try { const link = new URL(url); return link.protocol === "https:" && link.origin !== window.location.origin; } catch { return false; } };
  const fileUrl = (item, download) => `api/material-file.php?id=${encodeURIComponent(item.id)}${download ? "&download=1" : ""}`;
  const drawMaterial = (main) => {
    const item = material();
    if (!item) { state.view = "empty"; return drawMain(); }
    let look;
    let actions = "";
    if (item.url) {
      actions = `<a class="button button-blue" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${tx("mt_open")} <span aria-hidden="true">↗︎</span></a><button class="button button-outline" type="button" data-act="mt-refresh">${tx("mt_refresh")}</button>`;
      look = canEmbed(item.url)
        ? `<iframe class="mt-frame" src="${escapeHtml(item.url)}" title="${escapeHtml(item.title)}" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" loading="lazy"></iframe><p class="small-note">${tx("mt_site_note")}</p>`
        : `<p class="mt-box">${tx("mt_insecure")}</p>`;
    } else if (item.image) {
      actions = `<a class="button button-blue" href="${fileUrl(item)}" target="_blank" rel="noopener">${tx("mt_full")}</a><a class="button button-outline" href="${fileUrl(item, true)}" download>${tx("mt_download")}</a>`;
      look = `<img class="mt-img" src="${fileUrl(item)}" alt="${escapeHtml(item.title)}">`;
    } else if (item.pdf) {
      actions = `<a class="button button-blue" href="${fileUrl(item)}" target="_blank" rel="noopener">${tx("mt_full")}</a><a class="button button-outline" href="${fileUrl(item, true)}" download>${tx("mt_download")}</a>`;
      look = `<iframe class="mt-frame" src="${fileUrl(item)}" title="${escapeHtml(item.title)}"></iframe>`;
    } else {
      actions = `<a class="button button-blue" href="${fileUrl(item, true)}" download>${tx("mt_download")}</a>`;
      look = `<p class="mt-box">${escapeHtml(item.file_name || "")} <small>${size(item.size || 0)}</small></p>`;
    }
    const kind = KINDS.find((entry) => entry[0] === item.kind);
    main.innerHTML = `<div class="pt-form mt-view"><button class="pt-back" type="button" data-act="back">←︎ ${tx("mt_back")}</button><p class="portal-eyebrow">${tx(kind ? kind[1] : "mt_g_other")}</p><h3>${escapeHtml(item.title)}</h3>
      <div class="button-row">${actions}</div>${look}
      ${teamSide() ? `<div class="button-row"><button class="button button-outline" type="button" data-act="mt-edit">${tx("mt_edit")}</button><button class="button button-outline pt-danger" type="button" data-act="mt-delete">${tx("mt_delete")}</button></div>` : ""}</div>`;
  };
  const drawMaterialForm = (main) => {
    const editing = state.materials.find((item) => item.id === state.matEdit);
    const kind = editing ? editing.kind : "website";
    main.innerHTML = `<form class="pt-form"><button class="pt-back" type="button" data-act="back">←︎ ${tx("mt_back")}</button><h3>${tx(editing ? "mt_form_edit" : "mt_form_new")}</h3>
      <label for="mt-kind"><span>${tx("mt_f_kind")}</span><select id="mt-kind" name="kind" ${editing ? "disabled" : ""}>${KINDS.map(([value, key]) => `<option value="${value}" ${value === kind ? "selected" : ""}>${escapeHtml(tr(key))}</option>`).join("")}</select></label>
      <label for="mt-title"><span>${tx("mt_f_title")}</span><input id="mt-title" name="title" type="text" maxlength="160" required value="${escapeHtml(editing ? editing.title : "")}" placeholder="${escapeHtml(tr("mt_f_title_ph"))}"></label>
      <label for="mt-url" class="mt-only-website"><span>${tx("mt_f_url")}</span><input id="mt-url" name="url" type="text" inputmode="url" maxlength="500" autocapitalize="off" value="${escapeHtml(editing && editing.url ? editing.url : "")}" placeholder="www.example.com"></label>
      <label for="mt-file" class="mt-only-file"><span>${tx("mt_f_file")}</span><input id="mt-file" name="file" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx"></label>
      <p class="small-note mt-only-file">${tx(editing ? "mt_f_keep" : "mt_f_file_hint")}</p>
      <div class="button-row"><button class="button button-blue" type="submit">${tx("mt_save")}</button><button class="button button-outline" type="button" data-act="back">${tx("pt_cancel")}</button></div><p class="form-status" role="status"></p></form>`;
    const form = main.querySelector("form");
    const sync = () => { const site = form.kind.value === "website"; form.querySelectorAll(".mt-only-website").forEach((el) => { el.hidden = !site; }); form.querySelectorAll(".mt-only-file").forEach((el) => { el.hidden = site; }); };
    form.kind.addEventListener("change", sync); sync();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status"); const submit = form.querySelector("[type=submit]"); submit.disabled = true; status.textContent = tr("pt_sending");
      try {
        const body = { title: form.title.value, kind: form.kind.value };
        if (form.kind.value === "website") body.url = form.url.value;
        const chosen = form.file.files[0];
        if (form.kind.value !== "website" && chosen) {
          if (chosen.size > MAX_BYTES) throw new Error(tr("pt_err_size", { name: chosen.name }));
          body.file = { name: chosen.name, data: await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = () => reject(new Error(tr("pt_err_read", { name: chosen.name }))); reader.readAsDataURL(chosen); }) };
        }
        let saved;
        if (editing) saved = await api("api/materials.php", { method: "PATCH", body: JSON.stringify({ ...body, id: editing.id }) });
        else saved = await api("api/materials.php", { method: "POST", body: JSON.stringify({ ...body, customer_id: materialClient() }) });
        await loadMaterials();
        state.matOpen = true; state.matId = editing ? editing.id : saved.id;
        setView(state.materials.some((item) => item.id === state.matId) ? "material" : "empty"); drawMaterials();
      } catch (error) { status.textContent = error.message; submit.disabled = false; }
    });
    form.title.focus();
  };

  const drawNewRequest = (main) => {
    main.innerHTML = `<form class="pt-form"><button class="pt-back" type="button" data-act="back">←︎ ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(tr("req_h"))}</h3>
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

  const passwordFields = (current) => `${current ? `<label for="pt-pw-current"><span>${tx("pt_current_pw")}</span><input id="pt-pw-current" name="current" type="password" autocomplete="current-password" required></label>` : ""}
      <label for="pt-pw-new"><span>${tx("pt_new_pw")}</span><input id="pt-pw-new" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label for="pt-pw-again"><span>${tx("pt_confirm_pw")}</span><input id="pt-pw-again" name="again" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="small-note">${tx("pt_pw_hint")}</p>`;
  const drawPassword = (main) => {
    main.innerHTML = `<form class="pt-form"><button class="pt-back" type="button" data-act="back">←︎ ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(tr("pt_change_pw"))}</h3>${passwordFields(true)}
      <div class="button-row"><button class="button button-blue" type="submit">${escapeHtml(tr("pt_save_pw"))}</button><button class="button button-outline" type="button" data-act="back">${escapeHtml(tr("pt_cancel"))}</button></div><p class="form-status" role="status"></p></form>`;
    const form = main.querySelector("form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status"); const data = Object.fromEntries(new FormData(form));
      if (data.password !== data.again) { status.textContent = tr("pt_pw_mismatch"); return; }
      try { await api("api/password.php?action=change", { method: "POST", body: JSON.stringify({ current: data.current, password: data.password }) }); form.reset(); status.textContent = tr("pt_pw_changed"); } catch (error) { status.textContent = error.message; }
    });
    form.querySelector("input")?.focus();
  };

  const drawNewCustomer = (main) => {
    main.innerHTML = `<form class="pt-form"><button class="pt-back" type="button" data-act="back">←︎ ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(tr("pt_new_customer"))}</h3><p class="small-note">${escapeHtml(tr("pt_new_customer_help"))}</p>
      <div class="form-grid"><label for="pt-c-name"><span>${escapeHtml(tr("c_name"))}</span><input id="pt-c-name" name="name" type="text" required></label><label for="pt-c-business"><span>${escapeHtml(tr("c_business"))}</span><input id="pt-c-business" name="business" type="text" required></label></div>
      <div class="form-grid"><label for="pt-c-email"><span>${escapeHtml(tr("c_email"))}</span><input id="pt-c-email" name="email" type="email" required placeholder="name@example.com"></label><label for="pt-c-pass"><span>${escapeHtml(tr("c_pass"))}</span><input id="pt-c-pass" name="password" type="text" required minlength="8" placeholder="${escapeHtml(tr("c_pass_ph"))}"></label></div>
      <div class="button-row"><button class="button button-blue" type="submit">${escapeHtml(tr("c_create"))}</button><button class="button button-outline" type="button" data-act="back">${escapeHtml(tr("pt_cancel"))}</button></div><p class="form-status" role="status"></p></form>`;
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
  const bubble = (who, name, when, body, files, id) => `<article class="pt-msg ${who === state.role ? "is-mine" : "is-theirs"}" data-msg="${escapeHtml(String(id))}"><header><strong>${escapeHtml(who === state.role ? tr("pt_you") : name)}</strong><span>${escapeHtml(when)}</span></header>${body ? `<p>${escapeHtml(body)}</p>` : ""}${body && state.translate ? `<div class="pt-translate"><button type="button" class="pt-tr-btn" data-act="translate">${escapeHtml(tr("pt_translate"))}</button><p class="pt-tr-out" hidden></p></div>` : ""}${files.length ? `<div class="pt-files">${files.map(fileHtml).join("")}</div>` : ""}</article>`;
  const ticket = () => state.tickets.find((item) => item.id === state.selected);

  const messagesHtml = (messages) => {
    const current = ticket();
    const first = bubble("customer", current.business_name || state.user.business_name || tr("d_default_name"), time(current.created_at), current.details, [], "original");
    return `<span class="pt-section-label">${escapeHtml(tr("pt_original"))}</span>${first}${messages.length ? `<span class="pt-section-label">${escapeHtml(tr("pt_conversation"))}</span>` : ""}${messages.map((message) => bubble(message.author_role, message.author_name, time(message.created_at), message.body, message.files, message.id)).join("")}`;
  };

  const drawThread = async (main) => {
    const current = ticket();
    if (!current) { state.view = "empty"; return drawMain(); }
    const team = state.role === "team";
    const controls = team
      ? `<div class="pt-controls"><label>${escapeHtml(tr("pt_status"))}<select id="pt-status">${STATUSES.map((status) => `<option value="${status}" ${current.status === status ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("")}</select></label><label>${escapeHtml(tr("eta"))}<input id="pt-eta" type="date" value="${escapeHtml(current.eta_date ? String(current.eta_date).slice(0, 10) : "")}"></label><button class="button button-blue" type="button" data-act="save">${escapeHtml(tr("pt_save"))}</button></div>`
      : `<p class="pt-facts"><span class="pt-pill s-${escapeHtml(current.status.replace(/\s/g, "-"))}">${escapeHtml(statusLabel(current.status))}</span><span>${escapeHtml(tr("eta"))}: <strong>${escapeHtml(formatDate(current.eta_date))}</strong></span></p>`;
    main.innerHTML = `<div class="pt-thread"><div class="pt-thread-head"><button class="pt-back" type="button" data-act="back">←︎ ${escapeHtml(tr("pt_back"))}</button><h3>${escapeHtml(current.subject)}</h3><p class="pt-meta">${escapeHtml(current.id)}${team ? " · " + escapeHtml(current.business_name || "") + " · " + escapeHtml(current.email || "") : ""} · ${escapeHtml(tr("submitted"))} ${escapeHtml(formatDate(current.created_at))}</p>${controls}</div>
      <div class="pt-msgs" id="pt-msgs" tabindex="0"><p class="small-note">${escapeHtml(tr("pt_loading"))}</p></div>
      <form class="pt-composer"><label for="pt-body" class="sr-only">${escapeHtml(tr("pt_write"))}</label><textarea id="pt-body" name="body" rows="3" maxlength="5000" placeholder="${escapeHtml(tr("pt_write"))}"></textarea>${pickerHtml()}<div class="pt-composer-row"><span class="small-note">${escapeHtml(tr("pt_attach_hint"))}</span><button class="button button-blue" type="submit">${escapeHtml(tr("pt_send"))} <span aria-hidden="true">↗︎</span></button></div><p class="form-status" role="status"></p></form>
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
  const openTicket = async (id) => { state.selected = id; state.messageCount = -1; setView("thread"); root.scrollIntoView({ block: "start" }); if (teamSide()) loadMaterials(); };

  const translateMessage = async (article, button) => {
    const out = article.querySelector(".pt-tr-out");
    if (out.dataset.done === "1") { // toggle between translation and original
      const showing = !out.hidden; out.hidden = showing; button.textContent = showing ? tr("pt_translate") : tr("pt_show_original"); return;
    }
    button.disabled = true; button.textContent = tr("pt_translating");
    try {
      const result = await api("api/translate.php", { method: "POST", body: JSON.stringify({ ticket_id: state.selected, message_id: article.dataset.msg, target: lang() || "en" }) });
      out.textContent = result.text; out.hidden = false; out.dataset.done = "1"; out.dataset.lang = result.language;
      out.setAttribute("aria-label", tr("pt_translated_to", { language: result.language })); button.textContent = tr("pt_show_original");
    } catch (error) { button.textContent = tr("pt_translate"); window.alert(error.message); }
    button.disabled = false;
  };

  const onClick = async (event) => {
    const filter = event.target.closest("[data-filter]");
    if (filter) { state.filter = filter.dataset.filter; root.querySelectorAll("[data-filter]").forEach((button) => button.classList.toggle("is-on", button === filter)); return drawList(); }
    const mat = event.target.closest("[data-mat]");
    if (mat) { state.matId = Number(mat.dataset.mat); state.selected = teamSide() ? state.selected : null; return setView("material"); }
    const item = event.target.closest(".pt-item");
    if (item) return openTicket(item.dataset.id);
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    try {
      if (act === "translate") return translateMessage(event.target.closest(".pt-msg"), event.target.closest("[data-act]"));
      if (act === "logout") return logout();
      if (act === "mt-add") { state.matEdit = null; return setView("material-form"); }
      if (act === "mt-edit") { state.matEdit = state.matId; return setView("material-form"); }
      if (act === "mt-refresh") { const frame = root.querySelector(".mt-frame"); if (frame) frame.src = frame.src; return; }
      if (act === "mt-delete") {
        if (!window.confirm(tr("mt_confirm_delete"))) return;
        await api("api/materials.php", { method: "DELETE", body: JSON.stringify({ id: state.matId }) });
        state.matId = null; await loadMaterials(); return setView("empty");
      }
      if (act === "new") { state.selected = null; return setView("new"); }
      if (act === "customer") { state.selected = null; return setView("customer"); }
      if (act === "password") { state.selected = null; return setView("password"); }
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
      try { await loadTickets(true); await loadMaterials(); if (state.view === "thread") await refreshThread(false); } catch { /* try again next time */ }
    }, POLL_MS);
  };

  const show = async (role, user) => {
    state.role = role; state.user = user;
    try { state.translate = Boolean((await api("api/auth.php?action=me")).translate); } catch { state.translate = false; }
    root = role === "customer" ? $("#customer-dashboard") : $("#dashboard-view");
    $(".portal-main")?.classList.add("pt-active");
    $(".portal-tabs")?.classList.add("is-hidden");
    document.querySelectorAll(".portal-panel").forEach((panel) => panel.classList.toggle("is-hidden", panel.dataset.panel !== role));
    $("#customer-auth-view")?.classList.add("is-hidden"); $("#login-view")?.classList.add("is-hidden");
    root.classList.remove("is-hidden");
    root.onclick = onClick;
    if (!root.dataset.mt) { root.dataset.mt = "1"; root.addEventListener("toggle", (event) => { if (event.target.id === "pt-mat") state.matOpen = event.target.open; }, true); }
    try { const result = await api("api/tickets.php"); state.tickets = result.tickets; } catch (error) { state.tickets = []; }
    buildShell(); poll(); loadMaterials();
  };

  const rerender = () => { if (!state.role || !root) return; const draft = $("#pt-body", root)?.value; buildShell(); const body = $("#pt-body", root); if (body && draft) body.value = draft; };


  // ---- Signed-out screens: "Forgot password?" on both sign-in forms, and the page the emailed link opens ----
  const setupForgot = () => {
    [["customer", "#customer-login-form"], ["team", "#login-form"]].forEach(([role, selector]) => {
      const login = $(selector);
      if (!login) return;
      const link = document.createElement("p");
      link.className = "auth-links"; link.innerHTML = `<button type="button" class="link-btn">${tx("pt_forgot")}</button>`;
      login.appendChild(link);
      const forgot = document.createElement("form");
      forgot.className = "login-card forgot-form"; forgot.hidden = true;
      forgot.innerHTML = `<h2>${tx("pt_forgot_h")}</h2><p>${tx("pt_forgot_help")}</p><label for="forgot-${role}"><span>${tx("lbl_email")}</span><input id="forgot-${role}" name="email" type="email" autocomplete="username" required placeholder="name@example.com"></label><button class="button button-blue" type="submit"><span>${tx("pt_send_link")}</span> <span aria-hidden="true">↗︎</span></button><p class="auth-links"><button type="button" class="link-btn" data-back>${tx("pt_back_signin")}</button></p><p class="form-status" role="status"></p>`;
      login.after(forgot);
      const toggle = (open) => { login.hidden = open; forgot.hidden = !open; forgot.querySelector(".form-status").textContent = ""; };
      link.querySelector("button").addEventListener("click", () => toggle(true));
      forgot.querySelector("[data-back]").addEventListener("click", () => toggle(false));
      forgot.addEventListener("submit", async (event) => {
        event.preventDefault();
        const status = forgot.querySelector(".form-status"); const submit = forgot.querySelector("[type=submit]"); submit.disabled = true;
        try { await api("api/password.php?action=forgot", { method: "POST", body: JSON.stringify({ email: forgot.email.value, role }) }); status.textContent = tr("pt_forgot_sent"); forgot.reset(); } catch (error) { status.textContent = error.message; }
        submit.disabled = false;
      });
    });
  };
  const setupReset = () => {
    const params = new URLSearchParams(window.location.search); const token = params.get("reset");
    if (!token) return false;
    const holder = $(".portal-content"); if (!holder) return false;
    $(".portal-tabs")?.classList.add("is-hidden"); document.querySelectorAll(".portal-panel").forEach((panel) => panel.classList.add("is-hidden"));
    const panel = document.createElement("form");
    panel.className = "login-card reset-panel";
    panel.innerHTML = `<h2>${tx("pt_reset_h")}</h2><p>${tx("pt_reset_help")}</p>${passwordFields(false)}<button class="button button-blue" type="submit"><span>${tx("pt_save_pw")}</span> <span aria-hidden="true">↗︎</span></button><p class="form-status" role="status"></p>`;
    holder.prepend(panel);
    panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = panel.querySelector(".form-status"); const data = Object.fromEntries(new FormData(panel));
      if (data.password !== data.again) { status.textContent = tr("pt_pw_mismatch"); return; }
      try {
        await api("api/password.php?action=reset", { method: "POST", body: JSON.stringify({ token, password: data.password }) });
        panel.innerHTML = `<h2>${tx("pt_reset_done_h")}</h2><p>${tx("pt_reset_done")}</p><a class="button button-blue" href="portal.html${params.get("role") === "team" ? "#team" : ""}"><span>${tx("signin")}</span> <span aria-hidden="true">↗︎</span></a>`;
        history.replaceState(null, "", "portal.html");
      } catch (error) { status.textContent = error.message; }
    });
    return true;
  };

  // ---- Sign-up: a clearly visible "Create an account" button on the client sign-in, opening a short form ----
  const setupSignup = () => {
    const login = $("#customer-login-form");
    if (!login) return;
    const cta = document.createElement("div");
    cta.className = "signup-cta";
    cta.innerHTML = `<span>${tx("su_new")}</span><button type="button" class="button button-signup"><span>${tx("su_btn")}</span> <span aria-hidden="true">+</span></button>`;
    login.querySelector("button[type=submit]").after(cta);
    const form = document.createElement("form");
    form.className = "login-card signup-form"; form.hidden = true;
    form.innerHTML = `<h2>${tx("su_h")}</h2><p>${tx("su_help")}</p>
      <label for="su-name"><span>${tx("su_name")}</span><input id="su-name" name="name" type="text" autocomplete="name" maxlength="120" required></label>
      <label for="su-business"><span>${tx("su_business")}</span><input id="su-business" name="business" type="text" autocomplete="organization" maxlength="160" required></label>
      <label for="su-email"><span>${tx("lbl_email")}</span><input id="su-email" name="email" type="email" autocomplete="email" maxlength="190" required placeholder="name@example.com"></label>
      <label for="su-pw"><span>${tx("lbl_pw")}</span><input id="su-pw" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label for="su-pw2"><span>${tx("pt_confirm_pw")}</span><input id="su-pw2" name="again" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="small-note">${tx("pt_pw_hint")}</p>
      <div class="hp-field" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
      <button class="button button-blue" type="submit"><span>${tx("su_submit")}</span> <span aria-hidden="true">↗︎</span></button>
      <p class="auth-links"><button type="button" class="link-btn" data-back>${tx("pt_back_signin")}</button></p><p class="form-status" role="status"></p>`;
    login.after(form);
    const toggle = (open) => { login.hidden = open; form.hidden = !open; form.querySelector(".form-status").textContent = ""; if (open) form.querySelector("input")?.focus(); };
    cta.querySelector("button").addEventListener("click", () => toggle(true));
    form.querySelector("[data-back]").addEventListener("click", () => toggle(false));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector(".form-status"); const submit = form.querySelector("[type=submit]"); const data = Object.fromEntries(new FormData(form));
      if (data.password !== data.again) { status.textContent = tr("pt_pw_mismatch"); return; }
      submit.disabled = true; status.textContent = tr("pt_sending");
      try { const result = await api("api/signup.php", { method: "POST", body: JSON.stringify({ name: data.name, business: data.business, email: data.email, password: data.password, website: data.website }) }); form.reset(); await show("customer", result.user); }
      catch (error) { status.textContent = error.message; submit.disabled = false; }
    });
  };
  if (!setupReset()) { setupForgot(); setupSignup(); }

  return { show, rerender };
})();

// ---- Show/hide eye button on every password field (also the ones the portal draws later) ----
(() => {
  const eye = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12s3.8-7 10.5-7 10.5 7 10.5 7-3.8 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.6 10.6 0 0 1 12 19.5C5.3 19.5 1.5 12 1.5 12a18.5 18.5 0 0 1 4.6-5.6M9.9 4.7A9.7 9.7 0 0 1 12 4.5c6.7 0 10.5 7.5 10.5 7.5a18.6 18.6 0 0 1-2.2 3.2M1 1l22 22"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const label = (shown) => tr(shown ? "pt_hide_pw" : "pt_show_pw");
  const enhance = (input) => {
    if (input.dataset.eye) return;
    input.dataset.eye = "1";
    const wrap = document.createElement("span");
    wrap.className = "pw-wrap";
    input.before(wrap); wrap.appendChild(input);
    const button = document.createElement("button");
    button.type = "button"; button.className = "pw-eye"; button.innerHTML = eye; button.setAttribute("aria-pressed", "false"); button.setAttribute("aria-label", label(false)); button.title = label(false);
    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.innerHTML = show ? eyeOff : eye; button.setAttribute("aria-pressed", String(show)); button.setAttribute("aria-label", label(show)); button.title = label(show);
      input.focus({ preventScroll: true });
    });
    wrap.appendChild(button);
  };
  const scan = () => document.querySelectorAll('input[type="password"]:not([data-eye])').forEach(enhance);
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("dsma:lang", () => document.querySelectorAll(".pw-eye").forEach((button) => { const shown = button.getAttribute("aria-pressed") === "true"; button.setAttribute("aria-label", label(shown)); button.title = label(shown); }));
})();
