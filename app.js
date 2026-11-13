(() => {
  "use strict";

  const page = document.body.dataset.page;
  const apiMeta = document.querySelector('meta[name="api-base-url"]');
  const apiBase = (apiMeta?.content || "").replace(/\/+$/, "");
  const storageKeys = { token: "campusly.token", user: "campusly.user" };
  const imageByType = {
    classroom: "assets/classroom.svg",
    "computer laboratory": "assets/computer-laboratory.svg",
    "seminar hall": "assets/seminar-hall.svg",
    "library room": "assets/library-room.svg",
    "sports facility": "assets/sports-facility.svg",
    projector: "assets/projector.svg",
    auditorium: "assets/auditorium.svg"
  };
  let resourceCache = [];
  let bookingCache = [];
  let studentCache = [];

  function getStored(key) {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  }

  function getSession() {
    const token = getStored(storageKeys.token);
    const rawUser = getStored(storageKeys.user);
    let user = null;
    if (rawUser) {
      try { user = JSON.parse(rawUser); } catch { clearSession(); }
    }
    return { token, user };
  }

  function saveSession(token, user, remember) {
    clearSession();
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(storageKeys.token, token);
    storage.setItem(storageKeys.user, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(storageKeys.token);
    localStorage.removeItem(storageKeys.user);
    sessionStorage.removeItem(storageKeys.token);
    sessionStorage.removeItem(storageKeys.user);
  }

  async function request(path, options = {}) {
    if (window.KarunyaDemo) return window.KarunyaDemo.request(path, options);
    if (!apiBase) throw new Error("Set the API base URL in the page's api-base-url meta tag.");
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    const token = getSession().token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body !== undefined && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, { ...options, headers });
    } catch {
      const sourceHint = window.location.protocol === "file:"
        ? " Open the site through the Campusly WAR or serve it over HTTP; browsers block API requests from file pages."
        : " Confirm Tomcat is running, the WAR is deployed at the configured context path, and this frontend origin is allowed.";
      throw new Error(`Could not connect to the Campusly API at ${apiBase}.${sourceHint}`);
    }
    if (response.status === 401 && !path.includes("/auth/login")) {
      clearSession();
      if (page !== "login") window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname.split("/").pop() || "dashboard.html")}`;
    }
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) {
      const message = result?.message || result?.error || `The server returned ${response.status}.`;
      throw new Error(message);
    }
    return result;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function safeImageUrl(value, type) {
    if (value) {
      try {
        const url = new URL(value, window.location.href);
        if (url.protocol === "http:" || url.protocol === "https:") return url.href;
      } catch { /* Use the category image when the API image URL is invalid. */ }
    }
    return imageByType[String(type || "").toLowerCase()] || imageByType.classroom;
  }

  function showMessage(element, message, success = false) {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("success", success);
    element.hidden = !message;
  }

  function formatDate(date, options = { month: "short", day: "numeric", year: "numeric" }) {
    const parsed = new Date(`${String(date).slice(0, 10)}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? String(date || "—") : new Intl.DateTimeFormat(undefined, options).format(parsed);
  }

  function formatTime(time) {
    if (!time) return "";
    const [hour, minute] = String(time).split(":");
    const parsedHour = Number(hour);
    if (!Number.isFinite(parsedHour)) return String(time);
    return `${parsedHour % 12 || 12}:${minute || "00"} ${parsedHour >= 12 ? "PM" : "AM"}`;
  }

  function getStatusClass(status) {
    return `status-${String(status || "pending").toLowerCase()}`;
  }

  function resourceCard(resource) {
    const id = escapeHtml(resource.id);
    const available = resource.available === true;
    const title = escapeHtml(resource.name || "Campus resource");
    const type = escapeHtml(resource.type || "Campus resource");
    const location = escapeHtml(resource.location || "Location not provided");
    const description = escapeHtml(resource.description || "A campus space ready for your next project or study session.");
    const image = escapeHtml(safeImageUrl(resource.imageUrl, resource.type));
    const capacity = Number.isFinite(Number(resource.capacity)) ? Number(resource.capacity) : "—";
    return `<article class="resource-card">
      <div class="resource-image"><img src="${image}" alt="${title}" loading="lazy"><span class="resource-type">${type}</span></div>
      <div class="resource-card-body"><div class="resource-card-top"><h3>${title}</h3><span class="availability-pill ${available ? "is-available" : "is-unavailable"}">${available ? "Available" : "Unavailable"}</span></div>
      <p class="resource-location">⌖ &nbsp;${location}</p><p class="resource-description">${description}</p>
      <div class="resource-card-foot"><span class="capacity">Capacity <strong>${capacity}</strong></span><div class="card-actions">
      <button class="card-action" type="button" data-resource-details="${id}">View details</button>
      <a class="card-action book-action" ${available ? `href="booking.html?resourceId=${encodeURIComponent(resource.id)}"` : 'aria-disabled="true" tabindex="-1"'}>Book now</a></div></div></div></article>`;
  }

  function renderDetailsDialog(resource) {
    let dialog = document.getElementById("resource-details-dialog");
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.id = "resource-details-dialog";
      dialog.className = "resource-dialog";
      document.body.append(dialog);
    }
    const available = resource.available === true;
    dialog.innerHTML = `<div class="card-heading"><div><span class="eyebrow">${escapeHtml(resource.type || "CAMPUS RESOURCE")}</span><h2>${escapeHtml(resource.name)}</h2></div><button class="icon-button" type="button" data-close-details aria-label="Close dialog">×</button></div>
      <div class="resource-image"><img src="${escapeHtml(safeImageUrl(resource.imageUrl, resource.type))}" alt="${escapeHtml(resource.name)}"></div>
      <p class="resource-location">⌖ &nbsp;${escapeHtml(resource.location || "Location not provided")} &nbsp; · &nbsp; Capacity ${escapeHtml(resource.capacity ?? "—")}</p>
      <p class="resource-description">${escapeHtml(resource.description || "No description provided.")}</p>
      <span class="availability-pill ${available ? "is-available" : "is-unavailable"}">${available ? "Available" : "Unavailable"}</span>
      <div class="details-book-link-wrap"><a class="button button-primary button-full" ${available ? `href="booking.html?resourceId=${encodeURIComponent(resource.id)}"` : 'aria-disabled="true"'}>Book this resource <span>→</span></a></div>`;
    if (typeof dialog.showModal === "function") dialog.showModal();
  }

  function setupSharedNavigation() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".site-nav");
    toggle?.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    document.addEventListener("click", (event) => {
      const detailsButton = event.target.closest("[data-resource-details]");
      if (detailsButton) {
        const item = resourceCache.find((resource) => String(resource.id) === detailsButton.dataset.resourceDetails);
        if (item) renderDetailsDialog(item);
        return;
      }
      if (event.target.closest("[data-close-details]")) {
        document.getElementById("resource-details-dialog")?.close();
      }
      const logout = event.target.closest(".logout-button");
      if (logout) {
        event.preventDefault();
        logout.setAttribute("aria-disabled", "true");
        request("/api/auth/logout", { method: "POST" })
          .then(() => {
            clearSession();
            window.location.href = "login.html";
          })
          .catch((error) => {
            logout.removeAttribute("aria-disabled");
            window.alert(`Logout failed: ${error.message}`);
          });
        return;
      }
      const cancelBooking = event.target.closest("[data-cancel-booking]");
      if (cancelBooking) {
        cancelBooking.disabled = true;
        request(`/api/bookings/${encodeURIComponent(cancelBooking.dataset.cancelBooking)}/cancel`, { method: "PUT" })
          .then(() => window.location.reload())
          .catch((error) => {
            cancelBooking.disabled = false;
            window.alert(`Booking could not be cancelled: ${error.message}`);
          });
      }
    });
    const storedUser = getSession().user;
    if (storedUser && nav && !nav.querySelector("[data-demo-user]")) {
      const chip = document.createElement("span");
      chip.className = "demo-user-chip";
      chip.dataset.demoUser = "";
      chip.textContent = `${storedUser.name} · ${storedUser.role}`;
      nav.append(chip);
    }
    document.querySelectorAll(".nav-login").forEach((link) => {
      if (storedUser) {
        link.textContent = storedUser.role === "ADMIN" ? "Admin dashboard ↗" : "My bookings ↗";
        link.href = storedUser.role === "ADMIN" ? "karunya-admin.html"
          : storedUser.role === "FACULTY" ? "faculty.html" : "karunya-dashboard.html";
        link.classList.add("button-dark");
      }
    });
  }

  async function loadResources() {
    const data = await request("/api/resources");
    if (!Array.isArray(data)) throw new Error("Resource API response must be an array of resources.");
    resourceCache = data;
    return data;
  }

  async function initHome() {
    document.getElementById("home-search")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = document.getElementById("home-query").value.trim();
      window.location.href = `resources.html${query ? `?search=${encodeURIComponent(query)}` : ""}`;
    });
    try {
      const resources = await loadResources();
      const featured = resources.filter((item) => item.available === true).slice(0, 3);
      document.getElementById("featured-resources").innerHTML = featured.length
        ? featured.map(resourceCard).join("")
        : '<div class="empty-state">There are no available campus resources right now.</div>';
    } catch (error) {
      const container = document.getElementById("featured-resources");
      container.innerHTML = '<div class="empty-state">Campus resources couldn’t be loaded.</div>';
      showMessage(document.getElementById("featured-message"), error.message);
    }
  }

  async function initResources() {
    const queryInput = document.getElementById("resource-query");
    const typeSelect = document.getElementById("resource-type");
    const availabilitySelect = document.getElementById("availability-filter");
    const query = new URLSearchParams(window.location.search).get("search") || "";
    queryInput.value = query;
    const render = () => {
      const needle = queryInput.value.trim().toLowerCase();
      const type = typeSelect.value.toLowerCase();
      const availability = availabilitySelect.value;
      const matching = resourceCache.filter((item) => {
        const searchable = [item.name, item.type, item.location, item.description].join(" ").toLowerCase();
        return (!needle || searchable.includes(needle))
          && (!type || String(item.type).toLowerCase() === type)
          && (!availability || (availability === "available" ? item.available === true : item.available !== true));
      });
      document.getElementById("results-count").textContent = `${matching.length} ${matching.length === 1 ? "resource" : "resources"} found`;
      document.getElementById("resource-list").innerHTML = matching.length
        ? matching.map(resourceCard).join("")
        : '<div class="empty-state">No resources match your search. Try another filter.</div>';
    };
    document.getElementById("resource-search").addEventListener("submit", (event) => event.preventDefault());
    [queryInput, typeSelect, availabilitySelect].forEach((control) => control.addEventListener("input", render));
    document.getElementById("clear-filters").addEventListener("click", () => {
      queryInput.value = "";
      typeSelect.value = "";
      availabilitySelect.value = "";
      render();
    });
    try { await loadResources(); render(); }
    catch (error) {
      document.getElementById("results-count").textContent = "Resources unavailable";
      document.getElementById("resource-list").innerHTML = '<div class="empty-state">Campus resources couldn’t be loaded.</div>';
      showMessage(document.getElementById("resource-message"), error.message);
    }
  }

  function requireSession(role) {
    const { token, user } = getSession();
    if (!token || !user) {
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname.split("/").pop())}`;
      return false;
    }
    if (role && user.role !== role) {
      window.location.href = user.role === "ADMIN" ? "karunya-admin.html"
        : user.role === "FACULTY" ? "faculty.html" : "karunya.html";
      return false;
    }
    return true;
  }

  async function initLogin() {
    document.querySelectorAll(".role-option").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".role-option").forEach((item) => {
          const active = item === button;
          item.classList.toggle("active", active);
          item.setAttribute("aria-pressed", String(active));
        });
        document.querySelector('#login-form [name="role"]').value = button.dataset.role;
      });
    });
    document.getElementById("forgot-password").addEventListener("click", () => {
      showMessage(document.getElementById("login-message"), "Password resets are handled by your campus administrator.");
    });
    let authenticating = false;
    document.getElementById("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (authenticating) return;
      const form = event.currentTarget;
      const message = document.getElementById("login-message");
      if (!form.reportValidity()) return;
      const submit = form.querySelector('[type="submit"]');
      const originalLabel = submit.innerHTML;
      authenticating = true;
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>Signing in...</span>';
      showMessage(message, "");
      try {
        const response = await request("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: form.elements.email.value.trim(), password: form.elements.password.value, role: form.elements.role.value })
        });
        if (!response?.token || !response?.user?.role) throw new Error("Login response is missing the required token or user role.");
        const user = response.user;
        if (user.role !== form.elements.role.value) throw new Error("This account does not have the selected login role.");
        saveSession(response.token, user, form.elements.remember.checked);
        const requested = new URLSearchParams(window.location.search).get("next");
        const nextPage = requested && /^[a-z0-9-]+\.html$/i.test(requested)
          ? requested
          : user.role === "ADMIN" ? "karunya-admin.html" : user.role === "FACULTY" ? "faculty.html" : "karunya.html";
        window.location.href = nextPage;
      } catch (error) {
        showMessage(message, error.message);
        authenticating = false;
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.innerHTML = originalLabel;
      }
    });
  }

  function bookingRow(booking) {
    const resource = booking.resourceName || resourceCache.find((item) => String(item.id) === String(booking.resourceId))?.name || "Campus resource";
    const date = formatDate(booking.date, { month: "short", day: "numeric" });
    const range = `${formatTime(booking.startTime)}–${formatTime(booking.endTime)}`;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const localTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const canCancel = ["PENDING", "APPROVED"].includes(booking.status)
      && (booking.date > today || (booking.date === today && String(booking.startTime).slice(0, 5) > localTime));
    const cancelButton = canCancel
      ? `<button class="table-action delete-action booking-cancel" type="button" data-cancel-booking="${escapeHtml(booking.id)}">Cancel</button>`
      : "";
    return `<article class="booking-row"><div class="booking-date-box"><strong>${escapeHtml(new Date(`${String(booking.date).slice(0, 10)}T12:00:00`).getDate() || "—")}</strong><span>${escapeHtml(formatDate(booking.date, { month: "short" }))}</span></div><div class="booking-details"><strong>${escapeHtml(resource)}</strong><span>${escapeHtml(date)} · ${escapeHtml(range)}</span></div><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(String(booking.status || "Pending").toLowerCase())}</span>${cancelButton}</article>`;
  }

  function historyRow(booking) {
    const resource = booking.resourceName || resourceCache.find((item) => String(item.id) === String(booking.resourceId))?.name || "Campus resource";
    return `<tr><td>${escapeHtml(resource)}</td><td>${escapeHtml(formatDate(booking.date))}<br>${escapeHtml(formatTime(booking.startTime))}–${escapeHtml(formatTime(booking.endTime))}</td><td>${escapeHtml(booking.purpose || "—")}</td><td><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(String(booking.status || "Pending").toLowerCase())}</span></td></tr>`;
  }

  async function initDashboard() {
    if (!requireSession("STUDENT")) return;
    const message = document.getElementById("dashboard-message");
    try {
      const [user, bookings, resources] = await Promise.all([
        request("/api/auth/me"),
        request("/api/bookings/my"),
        loadResources()
      ]);
      if (!Array.isArray(bookings)) throw new Error("Booking API response must be an array.");
      bookingCache = bookings;
      const name = user.name || "student";
      document.getElementById("student-name").textContent = `${name.split(" ")[0]}.`;
      document.getElementById("profile-name").textContent = name;
      document.getElementById("profile-email").textContent = user.email || "Email not provided";
      document.getElementById("profile-avatar").textContent = (name[0] || "S").toUpperCase();
      const profile = document.getElementById("profile-form");
      profile.elements.name.value = user.name || "";
      profile.elements.phone.value = user.phone || "";
      const localNow = new Date();
      const today = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, "0")}-${String(localNow.getDate()).padStart(2, "0")}`;
      const localTime = `${String(localNow.getHours()).padStart(2, "0")}:${String(localNow.getMinutes()).padStart(2, "0")}`;
      const upcoming = bookings.filter((item) => (item.date > today
        || (item.date === today && String(item.endTime).slice(0, 5) > localTime))
        && ["PENDING", "APPROVED"].includes(item.status))
        .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
      document.getElementById("upcoming-count").textContent = upcoming.length;
      document.getElementById("pending-count").textContent = bookings.filter((item) => item.status === "PENDING").length;
      document.getElementById("available-count").textContent = resources.filter((item) => item.available === true).length;
      document.getElementById("upcoming-bookings").innerHTML = upcoming.length
        ? upcoming.slice(0, 5).map(bookingRow).join("")
        : '<div class="empty-state">No upcoming bookings. Find a space for your next plan.</div>';
      const orderedHistory = [...bookings].sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`));
      document.getElementById("history-rows").innerHTML = orderedHistory.length
        ? orderedHistory.map(historyRow).join("")
        : '<tr class="empty-row"><td colspan="4">Your booking history will show up here.</td></tr>';
    } catch (error) {
      showMessage(message, error.message);
      document.getElementById("upcoming-bookings").innerHTML = '<div class="empty-state">Your bookings could not be loaded.</div>';
      document.getElementById("history-rows").innerHTML = '<tr class="empty-row"><td colspan="4">Booking history is unavailable.</td></tr>';
    }
    document.getElementById("profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      try {
        const updated = await request("/api/users/me", {
          method: "PATCH",
          body: JSON.stringify({ name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim() })
        });
        document.getElementById("profile-name").textContent = updated.name;
        document.getElementById("student-name").textContent = `${updated.name.split(" ")[0]}.`;
        document.getElementById("profile-avatar").textContent = (updated.name[0] || "S").toUpperCase();
        showMessage(document.getElementById("profile-message"), "Profile saved.", true);
      } catch (error) { showMessage(document.getElementById("profile-message"), error.message); }
    });
  }

  function setMinimumBookingDate() {
    const input = document.getElementById("booking-date");
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    input.min = localDate;
    const selected = new URLSearchParams(window.location.search).get("resourceId");
    if (selected) document.getElementById("booking-resource").value = selected;
  }

  async function initBooking() {
    if (!requireSession("STUDENT")) return;
    setMinimumBookingDate();
    try {
      const resources = await loadResources();
      const select = document.getElementById("booking-resource");
      const available = resources.filter((item) => item.available === true);
      select.innerHTML = `<option value="">Select a resource</option>${available.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.location ? ` · ${escapeHtml(item.location)}` : ""}</option>`).join("")}`;
      const selected = new URLSearchParams(window.location.search).get("resourceId");
      if (selected && available.some((item) => String(item.id) === selected)) select.value = selected;
      if (!available.length) showMessage(document.getElementById("booking-message"), "No resources are currently available to book.");
    } catch (error) {
      document.getElementById("booking-resource").innerHTML = '<option value="">Resources unavailable</option>';
      showMessage(document.getElementById("booking-message"), error.message);
    }
    document.getElementById("booking-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = document.getElementById("booking-message");
      if (!form.reportValidity()) return;
      if (form.elements.date.value < document.getElementById("booking-date").min) {
        showMessage(message, "Choose a date that is today or later.");
        return;
      }
      const currentTime = new Date();
      const localTime = `${String(currentTime.getHours()).padStart(2, "0")}:${String(currentTime.getMinutes()).padStart(2, "0")}`;
      if (form.elements.date.value === document.getElementById("booking-date").min && form.elements.startTime.value <= localTime) {
        showMessage(message, "Choose a start time that is still in the future.");
        return;
      }
      if (form.elements.endTime.value <= form.elements.startTime.value) {
        showMessage(message, "The end time must be later than the start time.");
        return;
      }
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const booking = await request("/api/bookings", {
          method: "POST",
          body: JSON.stringify({
            resourceId: Number(form.elements.resourceId.value),
            date: form.elements.date.value,
            startTime: form.elements.startTime.value,
            endTime: form.elements.endTime.value,
            purpose: form.elements.purpose.value.trim()
          })
        });
        showMessage(message, `Request submitted${booking?.id ? ` (reference ${booking.id})` : ""}. Check your dashboard for its status.`, true);
        form.reset();
        setMinimumBookingDate();
      } catch (error) {
        showMessage(message, error.message);
      } finally { button.disabled = false; }
    });
  }

  function adminBookingRow(booking) {
    const actions = booking.status === "PENDING"
      ? `<button class="table-action approve-action" type="button" data-booking-review="approve" data-booking-id="${escapeHtml(booking.id)}">Approve</button><button class="table-action reject-action" type="button" data-booking-review="reject" data-booking-id="${escapeHtml(booking.id)}">Reject</button>`
      : "—";
    const resource = booking.resourceName || resourceCache.find((item) => String(item.id) === String(booking.resourceId))?.name || "Campus resource";
    return `<tr><td>${escapeHtml(booking.studentName || booking.studentEmail || "Student")}</td><td>${escapeHtml(resource)}</td><td>${escapeHtml(formatDate(booking.date))}<br>${escapeHtml(formatTime(booking.startTime))}–${escapeHtml(formatTime(booking.endTime))}</td><td>${escapeHtml(booking.purpose || "—")}</td><td><span class="status-pill ${getStatusClass(booking.status)}">${escapeHtml(String(booking.status || "Pending").toLowerCase())}</span></td><td>${actions}</td></tr>`;
  }

  function renderAdminBookings() {
    const status = document.getElementById("admin-status-filter").value;
    const filtered = status ? bookingCache.filter((item) => item.status === status) : bookingCache;
    document.getElementById("admin-booking-rows").innerHTML = filtered.length
      ? filtered.map(adminBookingRow).join("")
      : '<tr class="empty-row"><td colspan="6">No booking requests found.</td></tr>';
  }

  function renderAdminResources() {
    document.getElementById("admin-resource-rows").innerHTML = resourceCache.length
      ? resourceCache.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.type || "—")}</td><td>${escapeHtml(item.location || "—")}</td><td>${escapeHtml(item.capacity ?? "—")}</td><td><span class="availability-pill ${item.available ? "is-available" : "is-unavailable"}">${item.available ? "Available" : "Unavailable"}</span></td><td><button class="table-action edit-action" type="button" data-edit-resource="${escapeHtml(item.id)}">Edit</button><button class="table-action delete-action" type="button" data-delete-resource="${escapeHtml(item.id)}">Delete</button></td></tr>`).join("")
      : '<tr class="empty-row"><td colspan="6">No resources have been added.</td></tr>';
  }

  function renderAdminStudents() {
    document.getElementById("admin-student-rows").innerHTML = studentCache.length
      ? studentCache.map((student) => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.email)}</td><td>${escapeHtml(student.phone || "—")}</td><td><span class="status-pill ${student.active ? "status-approved" : "status-rejected"}">${student.active ? "Active" : "Inactive"}</span></td><td><button class="table-action ${student.active ? "delete-action" : "approve-action"}" type="button" data-student-active="${student.active ? "false" : "true"}" data-student-id="${escapeHtml(student.id)}">${student.active ? "Deactivate" : "Reactivate"}</button></td></tr>`).join("")
      : '<tr class="empty-row"><td colspan="5">No student accounts found.</td></tr>';
  }

  function openResourceDialog(resource) {
    const dialog = document.getElementById("resource-dialog");
    const form = document.getElementById("resource-form");
    form.reset();
    form.elements.id.value = resource?.id || "";
    form.elements.name.value = resource?.name || "";
    form.elements.type.value = resource?.type || "";
    form.elements.location.value = resource?.location || "";
    form.elements.capacity.value = resource?.capacity ?? "";
    form.elements.description.value = resource?.description || "";
    form.elements.imageUrl.value = resource?.imageUrl || "";
    form.elements.available.checked = resource ? resource.available === true : true;
    document.getElementById("resource-dialog-title").textContent = resource ? "Edit resource" : "Add resource";
    showMessage(document.getElementById("resource-form-message"), "");
    dialog.showModal();
  }

  async function initAdmin() {
    if (!requireSession("ADMIN")) return;
    const user = getSession().user;
    document.getElementById("admin-name").textContent = `${(user.name || "admin").split(" ")[0]}.`;
    const message = document.getElementById("admin-message");
    try {
      const [stats, bookings, resources, students] = await Promise.all([
        request("/api/admin/dashboard"),
        request("/api/admin/bookings"),
        loadResources(),
        request("/api/admin/students")
      ]);
      if (!Array.isArray(bookings)) throw new Error("Admin booking API response must be an array.");
      if (!Array.isArray(students)) throw new Error("Admin student API response must be an array.");
      bookingCache = bookings;
      studentCache = students;
      document.getElementById("admin-students").textContent = stats.totalStudents ?? "—";
      document.getElementById("admin-resources").textContent = stats.totalResources ?? resources.length;
      document.getElementById("admin-bookings").textContent = stats.totalBookings ?? bookings.length;
      document.getElementById("admin-pending").textContent = stats.pendingBookings ?? bookings.filter((item) => item.status === "PENDING").length;
      document.getElementById("admin-approved").textContent = stats.approvedBookings ?? bookings.filter((item) => item.status === "APPROVED").length;
      document.getElementById("admin-rejected").textContent = stats.rejectedBookings ?? bookings.filter((item) => item.status === "REJECTED").length;
      renderAdminBookings();
      renderAdminResources();
      renderAdminStudents();
    } catch (error) {
      showMessage(message, error.message);
      document.getElementById("admin-booking-rows").innerHTML = '<tr class="empty-row"><td colspan="6">Booking requests could not be loaded.</td></tr>';
      document.getElementById("admin-resource-rows").innerHTML = '<tr class="empty-row"><td colspan="6">Resources could not be loaded.</td></tr>';
      document.getElementById("admin-student-rows").innerHTML = '<tr class="empty-row"><td colspan="5">Students could not be loaded.</td></tr>';
    }
    document.getElementById("admin-status-filter").addEventListener("change", renderAdminBookings);
    document.getElementById("new-resource-button").addEventListener("click", () => openResourceDialog());
    document.getElementById("close-resource-dialog").addEventListener("click", () => document.getElementById("resource-dialog").close());
    document.getElementById("resource-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const resourceId = form.elements.id.value;
      const payload = {
        name: form.elements.name.value.trim(),
        type: form.elements.type.value,
        location: form.elements.location.value.trim(),
        capacity: Number(form.elements.capacity.value),
        description: form.elements.description.value.trim(),
        imageUrl: form.elements.imageUrl.value.trim() || null,
        available: form.elements.available.checked
      };
      try {
        await request(resourceId ? `/api/resources/${encodeURIComponent(resourceId)}` : "/api/resources", {
          method: resourceId ? "PUT" : "POST",
          body: JSON.stringify(payload)
        });
        await loadResources();
        renderAdminResources();
        document.getElementById("resource-dialog").close();
        showMessage(document.getElementById("admin-resource-message"), "Resource saved.", true);
      } catch (error) { showMessage(document.getElementById("resource-form-message"), error.message); }
    });
    document.addEventListener("click", async (event) => {
      const statusButton = event.target.closest("[data-booking-review]");
      if (statusButton) {
        statusButton.disabled = true;
        try {
          await request(`/api/admin/bookings/${encodeURIComponent(statusButton.dataset.bookingId)}/${statusButton.dataset.bookingReview}`, { method: "PUT" });
          bookingCache = await request("/api/admin/bookings");
          renderAdminBookings();
          const stats = await request("/api/admin/dashboard");
          document.getElementById("admin-pending").textContent = stats.pendingBookings;
          document.getElementById("admin-approved").textContent = stats.approvedBookings;
          document.getElementById("admin-rejected").textContent = stats.rejectedBookings;
          showMessage(message, "Booking request updated.", true);
        } catch (error) {
          statusButton.disabled = false;
          showMessage(message, error.message);
        }
        return;
      }
      const studentButton = event.target.closest("[data-student-active]");
      if (studentButton) {
        studentButton.disabled = true;
        try {
          await request(`/api/admin/students/${encodeURIComponent(studentButton.dataset.studentId)}`, {
            method: "PUT",
            body: JSON.stringify({ active: studentButton.dataset.studentActive === "true" })
          });
          studentCache = await request("/api/admin/students");
          renderAdminStudents();
          showMessage(document.getElementById("admin-student-message"), "Student account updated.", true);
        } catch (error) {
          studentButton.disabled = false;
          showMessage(document.getElementById("admin-student-message"), error.message);
        }
        return;
      }
      const edit = event.target.closest("[data-edit-resource]");
      if (edit) {
        const resource = resourceCache.find((item) => String(item.id) === edit.dataset.editResource);
        if (resource) openResourceDialog(resource);
        return;
      }
      const remove = event.target.closest("[data-delete-resource]");
      if (remove) {
        const resource = resourceCache.find((item) => String(item.id) === remove.dataset.deleteResource);
        if (!resource || !window.confirm(`Delete "${resource.name}"? This cannot be undone.`)) return;
        remove.disabled = true;
        try {
          await request(`/api/resources/${encodeURIComponent(resource.id)}`, { method: "DELETE" });
          await loadResources();
          renderAdminResources();
          showMessage(document.getElementById("admin-resource-message"), "Resource deleted.", true);
        } catch (error) {
          remove.disabled = false;
          showMessage(document.getElementById("admin-resource-message"), error.message);
        }
      }
    });
  }

  setupSharedNavigation();
  const initializers = {
    home: initHome,
    login: initLogin,
    resources: initResources,
    dashboard: initDashboard,
    booking: initBooking,
    admin: initAdmin
  };
  if (initializers[page]) initializers[page]();
})();
