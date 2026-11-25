"use strict";

const $ = (selector) => document.querySelector(selector);
const views = [...document.querySelectorAll(".view")];
const navLinks = [...document.querySelectorAll("[data-view]")];
const visitedViews = new Set();
const tokenKey = "cognifyz-workbench-token";
const tasksKey = "cognifyz-workbench-tasks";
let authMode = "register";
let editingItemId = null;
let tasks = loadTasks();

function showMessage(element, message, type = "") {
  element.textContent = message;
  element.className = `form-message${type ? ` ${type}` : ""}`;
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const token = localStorage.getItem(tokenKey);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, { ...options, headers });
  if (response.status === 204) return null;

  const data = await response.json().catch(() => {
    throw new Error(`The server returned an invalid response (${response.status}).`);
  });
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function setBusy(form, busy) {
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = busy;
}

function showView(name) {
  const selected = views.find((view) => view.id === `view-${name}`) || views[0];
  views.forEach((view) => view.classList.toggle("active", view === selected));
  navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === selected.id.replace("view-", "")));
  $("#crumb").textContent = selected.dataset.title;
  visitedViews.add(selected.id);
  $("#progress-count").textContent = `${Math.max(0, visitedViews.size - 1)} / 8`;
  $("#menu-button").setAttribute("aria-expanded", "false");
  $(".sidebar").classList.remove("open");
}

function loadTasks() {
  try {
    const stored = JSON.parse(localStorage.getItem(tasksKey) || "[]");
    return Array.isArray(stored) ? stored.filter((task) => task && typeof task.text === "string" && typeof task.done === "boolean") : [];
  } catch {
    return [];
  }
}

function saveTasks() {
  localStorage.setItem(tasksKey, JSON.stringify(tasks));
}

function renderTasks() {
  const list = $("#board-list");
  list.replaceChildren();
  $("#board-empty").classList.toggle("hidden", tasks.length > 0);
  $("#board-count").textContent = String(tasks.length);
  for (const [index, task] of tasks.entries()) {
    const row = document.createElement("li");
    row.className = `board-item${task.done ? " completed" : ""}`;
    const toggle = document.createElement("button");
    toggle.className = "check-button";
    toggle.type = "button";
    toggle.setAttribute("aria-label", task.done ? "Mark task incomplete" : "Mark task complete");
    toggle.setAttribute("aria-pressed", String(task.done));
    toggle.textContent = task.done ? "✓" : "";
    toggle.addEventListener("click", () => {
      tasks[index].done = !tasks[index].done;
      saveTasks();
      renderTasks();
    });
    const text = document.createElement("span");
    text.textContent = task.text;
    const remove = document.createElement("button");
    remove.className = "icon-button";
    remove.type = "button";
    remove.setAttribute("aria-label", "Delete task");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      tasks.splice(index, 1);
      saveTasks();
      renderTasks();
    });
    row.append(toggle, text, remove);
    list.append(row);
  }
}

async function loadItems() {
  const list = $("#item-list");
  list.replaceChildren();
  try {
    const items = await api("/api/items");
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "resource-item";
      const title = document.createElement("span");
      title.className = "job-title resource-title";
      title.textContent = item.title;
      const edit = document.createElement("button");
      edit.className = "icon-button";
      edit.type = "button";
      edit.setAttribute("aria-label", `Edit ${item.title}`);
      edit.textContent = "✎";
      edit.addEventListener("click", () => {
        editingItemId = item.id;
        $("#item-title").value = item.title;
        $("#item-submit").innerHTML = 'Save changes <span>✓</span>';
        $("#item-cancel").classList.remove("hidden");
        $("#item-title").focus();
      });
      const remove = document.createElement("button");
      remove.className = "icon-button";
      remove.type = "button";
      remove.setAttribute("aria-label", `Delete ${item.title}`);
      remove.textContent = "×";
      remove.addEventListener("click", async () => {
        try {
          await api(`/api/items/${item.id}`, { method: "DELETE" });
          showMessage($("#item-message"), "Item deleted.", "success");
          await loadItems();
        } catch (error) {
          showMessage($("#item-message"), error.message, "error");
        }
      });
      row.append(title, edit, remove);
      list.append(row);
    }
    if (items.length === 0) list.innerHTML = '<p class="empty-state">No items yet. Create one above.</p>';
  } catch (error) {
    showMessage($("#item-message"), error.message, "error");
  }
}

function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.classList.toggle("active", button.dataset.authMode === mode));
  $("#auth-name-label").classList.toggle("hidden", mode !== "register");
  $("#auth-name-label").querySelector("input").required = mode === "register";
  $("#auth-title").textContent = mode === "register" ? "Create an account" : "Welcome back";
  $("#auth-subtitle").textContent = mode === "register" ? "Use a valid email and a password of at least 8 characters." : "Sign in to access your protected profile.";
  $("#auth-submit").innerHTML = mode === "register" ? 'Create account <span>→</span>' : 'Sign in <span>→</span>';
  $("#auth-form").reset();
  showMessage($("#auth-message"), "");
}

function showProfile(user) {
  $("#auth-forms").classList.add("hidden");
  $("#profile-card").classList.remove("hidden");
  $("#profile-name").textContent = user.name;
  $("#profile-email").textContent = user.email;
  $("#profile-avatar").textContent = user.name.slice(0, 1).toUpperCase();
  $("#avatar").textContent = user.name.slice(0, 1).toUpperCase();
}

function clearProfile() {
  localStorage.removeItem(tokenKey);
  $("#auth-forms").classList.remove("hidden");
  $("#profile-card").classList.add("hidden");
  $("#avatar").textContent = "CW";
  setAuthMode("register");
}

async function refreshProfile() {
  if (!localStorage.getItem(tokenKey)) return;
  try {
    showProfile(await api("/api/profile"));
  } catch {
    clearProfile();
  }
}

function renderJobs(jobs) {
  const list = $("#job-list");
  list.replaceChildren();
  for (const job of jobs) {
    const row = document.createElement("div");
    row.className = "job-item";
    const text = document.createElement("span");
    text.className = "job-title";
    text.textContent = job.text;
    const state = document.createElement("span");
    state.className = `job-state${job.status === "completed" ? " completed" : ""}`;
    state.textContent = job.status;
    row.append(text, state);
    list.append(row);
  }
  if (jobs.length === 0) list.innerHTML = '<p class="empty-state">The queue is empty.</p>';
}

async function refreshJobs() {
  renderJobs(await api("/api/jobs"));
}

for (const link of navLinks) {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const name = link.dataset.view;
    history.replaceState(null, "", `#${name}`);
    showView(name);
  });
}

window.addEventListener("hashchange", () => showView(location.hash.slice(1)));
$("#menu-button").addEventListener("click", () => {
  const open = $(".sidebar").classList.toggle("open");
  $("#menu-button").setAttribute("aria-expanded", String(open));
});

$("#registration-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  showMessage($("#registration-message"), "Sending registration…");
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api("/api/greetings", { method: "POST", body: JSON.stringify(values) });
    showMessage($("#registration-message"), result.message, "success");
    form.reset();
  } catch (error) {
    showMessage($("#registration-message"), error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

$("#validation-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  showMessage($("#validation-message"), "Validating submission…");
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api("/api/submissions", { method: "POST", body: JSON.stringify(values) });
    showMessage($("#validation-message"), result.message, "success");
    form.reset();
    const submissions = await api("/api/submissions");
    $("#submission-count").textContent = String(submissions.length);
  } catch (error) {
    showMessage($("#validation-message"), error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

$("#board-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = $("#board-input");
  const text = input.value.trim();
  if (!text) return;
  tasks.push({ text, done: false });
  saveTasks();
  renderTasks();
  input.value = "";
  input.focus();
});

$("#item-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    const title = $("#item-title").value.trim();
    await api(editingItemId ? `/api/items/${editingItemId}` : "/api/items", {
      method: editingItemId ? "PUT" : "POST",
      body: JSON.stringify({ title }),
    });
    $("#item-title").value = "";
    editingItemId = null;
    $("#item-submit").innerHTML = 'Create item <span>＋</span>';
    $("#item-cancel").classList.add("hidden");
    showMessage($("#item-message"), "Item saved.", "success");
    await loadItems();
  } catch (error) {
    showMessage($("#item-message"), error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

$("#item-cancel").addEventListener("click", () => {
  editingItemId = null;
  $("#item-form").reset();
  $("#item-submit").innerHTML = 'Create item <span>＋</span>';
  $("#item-cancel").classList.add("hidden");
  showMessage($("#item-message"), "");
});

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  showMessage($("#auth-message"), authMode === "register" ? "Creating account…" : "Signing in…");
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await api(`/api/${authMode}`, { method: "POST", body: JSON.stringify(values) });
    localStorage.setItem(tokenKey, result.token);
    showProfile(result.user);
  } catch (error) {
    showMessage($("#auth-message"), error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    clearProfile();
  } catch (error) {
    showMessage($("#auth-message"), error.message, "error");
  }
});

$("#weather-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  $("#weather-result").classList.add("hidden");
  showMessage($("#weather-message"), "Looking up the latest weather…");
  try {
    const city = $("#city-input").value.trim();
    const result = await api(`/api/weather?city=${encodeURIComponent(city)}`);
    const current = result.current;
    const units = result.units;
    $("#weather-result").innerHTML = `
      <p class="weather-place">${escapeHtml(result.location)} · ${escapeHtml(result.timezone || "")}</p>
      <strong class="weather-temp">${escapeHtml(String(current.temperature_2m))}${escapeHtml(units.temperature_2m || "°")}</strong>
      <div class="weather-details">
        <div class="weather-detail"><small>FEELS LIKE</small><strong>${escapeHtml(String(current.apparent_temperature))}${escapeHtml(units.apparent_temperature || "°")}</strong></div>
        <div class="weather-detail"><small>HUMIDITY</small><strong>${escapeHtml(String(current.relative_humidity_2m))}${escapeHtml(units.relative_humidity_2m || "%")}</strong></div>
        <div class="weather-detail"><small>WIND</small><strong>${escapeHtml(String(current.wind_speed_10m))} ${escapeHtml(units.wind_speed_10m || "km/h")}</strong></div>
      </div>`;
    $("#weather-result").classList.remove("hidden");
    showMessage($("#weather-message"), "Forecast updated.", "success");
  } catch (error) {
    showMessage($("#weather-message"), error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function refreshTime() {
  const result = await api("/api/time");
  $("#server-time").textContent = new Date(result.serverTime).toLocaleString();
  $("#cache-state").textContent = result.cache === "hit" ? "Served from cache · expires in 15 sec" : "Fresh value · cached for 15 sec";
}

$("#refresh-time").addEventListener("click", async () => {
  try {
    await refreshTime();
  } catch (error) {
    $("#cache-state").textContent = error.message;
  }
});

$("#job-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  setBusy(form, true);
  try {
    await api("/api/jobs", { method: "POST", body: JSON.stringify({ text: $("#job-input").value.trim() }) });
    $("#job-input").value = "";
    showMessage($("#job-message"), "Job added to the queue.", "success");
    await refreshJobs();
  } catch (error) {
    showMessage($("#job-message"), error.message, "error");
  } finally {
    setBusy(form, false);
  }
});

async function initialize() {
  const name = location.hash.slice(1);
  showView(name || "overview");
  renderTasks();
  await Promise.all([
    api("/api/health").then(() => {
      $("#connection-status").textContent = "Server connected";
      $("#api-status").textContent = "Online";
    }).catch((error) => {
      $("#connection-status").textContent = error.message;
      $("#api-status").textContent = "Offline";
    }),
    loadItems(),
    api("/api/submissions").then((submissions) => {
      $("#submission-count").textContent = String(submissions.length);
    }).catch((error) => {
      showMessage($("#validation-message"), error.message, "error");
    }),
    refreshProfile(),
    refreshTime().catch((error) => {
      $("#cache-state").textContent = error.message;
    }),
    refreshJobs().catch((error) => {
      showMessage($("#job-message"), error.message, "error");
    }),
  ]);
  window.setInterval(() => {
    refreshJobs().catch((error) => showMessage($("#job-message"), error.message, "error"));
  }, 2500);
}

initialize();
