(() => {
  "use strict";

  const apiBase = (document.querySelector('meta[name="api-base-url"]')?.content || "").replace(/\/+$/, "");
  const page = document.body.dataset.karunyaPage;
  const keys = { token: "campusly.token", user: "campusly.user" };
  const categories = {
    LIBRARY: { label: "Library seats", title: "Library seat map", chooser: "floor" },
    SEMINAR_HALL: { label: "Seminar halls", title: "Choose a seminar hall", chooser: "facility" },
    COMPUTER_LAB: { label: "Computer labs", title: "Choose a computer lab", chooser: "facility" }
  };
  let facilities = [];
  let selectedFacility = null;
  let selectedSeat = null;
  let selectedWhole = false;
  let availability = null;
  let refreshTimer = null;
  let pollTimer = null;
  let bookings = [];
  let adminFacilities = [];
  let adminBlocks = [];

  function session() {
    const token = sessionStorage.getItem(keys.token) || localStorage.getItem(keys.token);
    let user = null;
    const raw = sessionStorage.getItem(keys.user) || localStorage.getItem(keys.user);
    if (raw) {
      try { user = JSON.parse(raw); } catch { clearSession(); }
    }
    return { token, user };
  }

  function clearSession() {
    for (const storage of [sessionStorage, localStorage]) {
      storage.removeItem(keys.token);
      storage.removeItem(keys.user);
    }
  }

  async function api(path, options = {}) {
    if (window.KarunyaDemo) return window.KarunyaDemo.request(path, options);
    if (!apiBase) throw new Error("The API base URL is missing from this page.");
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    const token = session().token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, { ...options, headers });
    } catch {
      throw new Error(`Could not connect to ${apiBase}. Start Tomcat and check the deployed context path.`);
    }
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : null;
    if (response.status === 401) {
      clearSession();
      if (page !== "home") window.location.href = `login.html?next=${encodeURIComponent(location.pathname.split("/").pop())}`;
    }
    if (!response.ok) throw new Error(body?.message || body?.error || `The server returned ${response.status}.`);
    return body;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function message(element, value, success = false) {
    if (!element) return;
    element.textContent = value || "";
    element.classList.toggle("success", success);
    element.hidden = !value;
  }

  function localDateString(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatDate(date) {
    const value = new Date(`${String(date || "").slice(0, 10)}T12:00:00`);
    return Number.isNaN(value.getTime()) ? String(date || "—") : new Intl.DateTimeFormat(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric"
    }).format(value);
  }

  function formatTime(value) {
    if (!value) return "—";
    const [hour, minute] = String(value).slice(0, 5).split(":").map(Number);
    if (!Number.isFinite(hour)) return String(value);
    return `${hour % 12 || 12}:${String(minute || 0).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  }

  function ensureRole(role) {
    const { token, user } = session();
    if (!token || !user) {
      window.location.href = `login.html?next=${encodeURIComponent(location.pathname.split("/").pop())}`;
      return false;
    }
    const allowed = Array.isArray(role) ? role : [role];
    if (role && !allowed.includes(user.role)) {
      const destination = user.role === "ADMIN" ? "karunya-admin.html"
        : user.role === "FACULTY" ? "faculty.html" : "karunya.html";
      window.location.href = destination;
      return false;
    }
    return true;
  }

  function setupNavigation() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.querySelector(".site-nav");
    toggle?.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    });
    const userLink = document.querySelector("[data-user-link]");
    const { user } = session();
    const homeLogin = document.querySelector("[data-home-login]");
    if (homeLogin && user) homeLogin.hidden = true;
    if (userLink && user) {
      userLink.textContent = user.role === "ADMIN" ? "Admin dashboard ↗"
        : user.role === "FACULTY" ? "Faculty schedule ↗" : "My bookings ↗";
      userLink.href = user.role === "ADMIN" ? "karunya-admin.html"
        : user.role === "FACULTY" ? "faculty.html" : "karunya-dashboard.html";
    }
    if (user && nav && !nav.querySelector("[data-demo-user]")) {
      const chip = document.createElement("span");
      chip.className = "demo-user-chip";
      chip.dataset.demoUser = "";
      chip.textContent = `${user.name} · ${user.role}`;
      nav.append(chip);
    }
    if (user && nav && !nav.querySelector(".logout-button")) {
      const logout = document.createElement("a");
      logout.className = "button button-small button-outline logout-button";
      logout.href = "login.html";
      logout.textContent = "Log out";
      nav.append(logout);
    }
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const dark = localStorage.getItem("karunya.theme") === "dark";
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      button.textContent = dark ? "Light mode" : "Dark mode";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("karunya.theme", next);
        button.textContent = next === "dark" ? "Light mode" : "Dark mode";
      });
    });
    document.querySelectorAll(".logout-button").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        button.setAttribute("aria-disabled", "true");
        try {
          await api("/api/auth/logout", { method: "POST" });
          clearSession();
          location.href = "login.html";
        } catch (error) {
          button.removeAttribute("aria-disabled");
          window.alert(`Could not log out: ${error.message}`);
        }
      });
    });
  }

  function profileText(user) {
    return [user.name, user.role, user.department].filter(Boolean).join(" · ");
  }

  async function fillProfile(target) {
    if (!session().token) return null;
    const user = await api("/api/auth/me");
    target?.forEach((element) => { element.textContent = profileText(user); });
    document.querySelectorAll("[data-role-pill]").forEach((element) => {
      element.textContent = `${user.name || "Account"} · ${user.role}${user.department ? ` · ${user.department}` : ""}`;
    });
    document.querySelectorAll("[data-user-name]").forEach((element) => {
      element.textContent = (user.name || "faculty").split(" ")[0] + ".";
    });
    return user;
  }

  function bookingCard(booking, controls = false) {
    const item = document.createElement("article");
    item.className = "karunya-booking-card";
    const place = `${booking.facilityName || "Campus facility"}${booking.seatCode ? ` · ${booking.seatCode}` : ""}`;
    item.innerHTML = `<div class="booking-date-box"><strong>${escapeHtml(String(booking.date || "").slice(8, 10) || "—")}</strong><span>${escapeHtml(String(booking.date || "").slice(5, 7) || "")}</span></div>
      <div class="karunya-booking-details"><strong>${escapeHtml(place)}</strong><span>${escapeHtml(formatDate(booking.date))} · ${escapeHtml(formatTime(booking.startTime))}–${escapeHtml(formatTime(booking.endTime))}</span><small>${escapeHtml(booking.purpose || "")}</small></div>
      <span class="status-pill status-${escapeHtml(String(booking.status || "").toLowerCase())}">${escapeHtml(String(booking.status || "").replaceAll("_", " ").toLowerCase())}</span>
      ${controls ? `<div class="karunya-booking-actions">
        ${["RESERVED", "CHECKED_IN"].includes(booking.status) ? `<button class="table-action" type="button" data-qr="${escapeHtml(booking.id)}">${window.KarunyaDemo ? "Code" : "QR"}</button>` : ""}
        ${booking.status === "RESERVED" ? `<button class="table-action" type="button" data-checkin="${escapeHtml(booking.id)}">Check in</button>` : ""}
        ${["RESERVED", "CHECKED_IN"].includes(booking.status) ? `<button class="table-action" type="button" data-extend="${escapeHtml(booking.id)}">Extend</button>` : ""}
        ${booking.status === "RESERVED" && (booking.date > localDateString() || (booking.date === localDateString() && booking.startTime > `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`)) ? `<button class="table-action delete-action" type="button" data-cancel="${escapeHtml(booking.id)}">Cancel</button>` : ""}
      </div>` : ""}`;
    return item;
  }

  function upcomingOnly(items) {
    const today = localDateString();
    const nowTime = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
    return items.filter((item) => item.date > today || (item.date === today && item.endTime > nowTime))
      .filter((item) => ["RESERVED", "CHECKED_IN"].includes(item.status))
      .sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  }

  async function loadNotifications() {
    const container = document.querySelector("[data-notifications]");
    if (!container) return;
    try {
      const notifications = await api("/api/notifications");
      container.innerHTML = notifications.length
        ? `<h3>Campus notifications</h3>${notifications.slice(0, 5).map((item) => `<article class="karunya-notification ${item.status === "UNREAD" ? "unread" : ""}"><span><strong>${escapeHtml(item.message)}</strong><small>${escapeHtml(item.createdAt)}</small></span>${item.status === "UNREAD" ? `<button class="table-action" type="button" data-mark-read="${escapeHtml(item.id)}">Mark read</button>` : ""}</article>`).join("")}`
        : '<p class="form-hint">No campus notifications yet.</p>';
      container.querySelectorAll("[data-mark-read]").forEach((button) => button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await api(`/api/notifications/${encodeURIComponent(button.dataset.markRead)}/read`, { method: "PUT" });
          await loadNotifications();
        } catch (error) {
          button.disabled = false;
          message(document.querySelector("[data-error]"), error.message);
        }
      }));
    } catch (error) {
      container.innerHTML = `<p class="form-hint">${escapeHtml(error.message)}</p>`;
    }
  }

  async function initHome() {
    const upcomingElement = document.querySelector("[data-upcoming]");
    const profile = document.querySelector("[data-profile]");
    if (!session().token) {
      upcomingElement.innerHTML = '<div class="empty-state">Sign in to see upcoming bookings and manage your schedule.</div>';
      return;
    }
    try {
      const user = await fillProfile([profile]);
      if (profile) profile.hidden = false;
      const data = await api("/api/campus-bookings/my");
      const upcoming = upcomingOnly(data).slice(0, 3);
      upcomingElement.innerHTML = "";
      if (!upcoming.length) {
        upcomingElement.innerHTML = '<div class="empty-state">No upcoming bookings. Find a space for your next study session.</div>';
      } else {
        upcoming.forEach((booking) => upcomingElement.append(bookingCard(booking)));
      }
      const link = document.querySelector("[data-user-link]");
      if (link && user) link.href = user.role === "ADMIN" ? "karunya-admin.html"
        : user.role === "FACULTY" ? "faculty.html" : "karunya-dashboard.html";
      await loadNotifications();
    } catch (error) {
      upcomingElement.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  function selectedCategory() {
    return document.getElementById("campus-category").value;
  }

  function pickedFacility() {
    return facilities.find((item) => String(item.id) === String(selectedFacility)) || null;
  }

  function bookingWindow() {
    return {
      date: document.getElementById("campus-date").value,
      startTime: document.getElementById("campus-start").value,
      endTime: document.getElementById("campus-end").value
    };
  }

  function validateWindow(window) {
    if (!window.date || !window.startTime || !window.endTime) throw new Error("Choose a date, start time, and end time.");
    if (window.date < localDateString()) throw new Error("Bookings cannot be made in the past.");
    const start = new Date(`${window.date}T${window.startTime}:00`);
    const end = new Date(`${window.date}T${window.endTime}:00`);
    const duration = (end - start) / 60000;
    if (!Number.isFinite(duration) || duration < 30 || duration > 480) {
      throw new Error("Bookings must last between 30 minutes and 8 hours.");
    }
    if (window.date === localDateString() && start <= new Date()) throw new Error("Choose a start time that is still in the future.");
  }

  function renderFloorTabs() {
    const tabs = document.querySelector("[data-floor-tabs]");
    const config = categories[selectedCategory()];
    tabs.hidden = config.chooser !== "floor";
    if (config.chooser !== "floor") {
      tabs.innerHTML = "";
      return;
    }
    const floorIds = [1, 2, 3];
    const currentFloor = pickedFacility()?.floor || Number(tabs.dataset.floor || "1");
    tabs.dataset.floor = String(currentFloor);
    tabs.innerHTML = floorIds.map((floor) => `<button class="floor-tab ${Number(currentFloor) === floor ? "active" : ""}" type="button" role="tab" aria-selected="${Number(currentFloor) === floor}" data-floor="${floor}">Floor ${floor}</button>`).join("");
    tabs.querySelectorAll("[data-floor]").forEach((tab) => tab.addEventListener("click", () => {
      const item = facilities.find((facility) => Number(facility.floor) === Number(tab.dataset.floor));
      if (item) chooseFacility(item.id);
    }));
  }

  function renderFacilities() {
    const list = document.querySelector("[data-facilities]");
    const type = selectedCategory();
    const config = categories[type];
    const choices = type === "LIBRARY"
      ? facilities.filter((facility) => Number(facility.floor) === Number(pickedFacility()?.floor || 1))
      : facilities;
    if (config.chooser === "floor") {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = choices.map((facility) => {
      const selected = String(facility.id) === String(selectedFacility);
      const features = [
        facility.projector ? "Projector" : "",
        facility.ac ? "AC" : "",
        facility.microphone ? "Mic" : "",
        facility.seatCount ? `${facility.seatCount} systems` : ""
      ].filter(Boolean).join(" · ");
      const software = facility.type === "COMPUTER_LAB" && facility.software
        ? `<small>${escapeHtml(facility.software)}</small>` : "";
      return `<button class="facility-choice ${selected ? "active" : ""}" type="button" data-facility-choice="${escapeHtml(facility.id)}">
        <span class="facility-choice-icon">${facility.type === "SEMINAR_HALL" ? "▤" : "⌘"}</span><span><strong>${escapeHtml(facility.name)}</strong><small>${escapeHtml(facility.building)} · capacity ${escapeHtml(facility.capacity)}</small><small>${escapeHtml(features)}</small>${software}</span><span class="facility-choice-arrow">→</span>
      </button>`;
    }).join("");
    list.querySelectorAll("[data-facility-choice]").forEach((button) => button.addEventListener("click", () => chooseFacility(button.dataset.facilityChoice)));
  }

  function renderSeatMap() {
    const map = document.querySelector("[data-seat-map]");
    const facility = pickedFacility();
    const type = selectedCategory();
    const config = categories[type];
    const details = document.querySelector("[data-facility-details]");
    if (!facility || !availability) {
      map.innerHTML = '<div class="empty-state">Choose a date and time to load available spaces.</div>';
      details.textContent = "";
      updateSummary();
      return;
    }
    details.textContent = [facility.building, facility.software].filter(Boolean).join(" · ");
    const seats = availability.seats || [];
    if (!seats.length) {
      const status = availability.status || "AVAILABLE";
      const isAvailable = status === "AVAILABLE";
      const allowed = type !== "SEMINAR_HALL" || session().user?.role === "FACULTY";
      map.innerHTML = `<div class="whole-facility-card"><div class="whole-facility-icon">${type === "SEMINAR_HALL" ? "▤" : "⌘"}</div><span class="eyebrow">${escapeHtml(config.label)}</span><h3>${escapeHtml(facility.name)}</h3><p>${escapeHtml(facility.building)} · capacity ${escapeHtml(facility.capacity)}</p><p>${escapeHtml([facility.projector && "Projector", facility.ac && "Air conditioning", facility.microphone && "Microphone"].filter(Boolean).join(" · ") || facility.software || "Campus facility")}</p><span class="availability-pill ${isAvailable ? "is-available" : "is-unavailable"}">${escapeHtml(status)}</span>
        ${type === "COMPUTER_LAB" && session().user?.role === "FACULTY" && isAvailable ? `<button class="button button-primary" type="button" data-select-facility="${escapeHtml(facility.id)}">Reserve whole lab</button>` : ""}
        ${type === "SEMINAR_HALL" && allowed && isAvailable ? `<button class="button button-primary" type="button" data-select-facility="${escapeHtml(facility.id)}">Select this hall</button>` : ""}
        ${!allowed ? '<p class="form-hint">Seminar halls are available to faculty accounts.</p>' : ""}</div>`;
      map.querySelector("[data-select-facility]")?.addEventListener("click", () => {
        selectedSeat = null;
        selectedWhole = true;
        updateSummary();
      });
    } else {
      const buttons = seats.map((seat) => {
        const selected = String(selectedSeat) === String(seat.id);
        const status = selected ? "SELECTED" : seat.status;
        const disabled = seat.status !== "AVAILABLE";
        return `<button class="seat ${status.toLowerCase()}" type="button" data-seat-id="${escapeHtml(seat.id)}" ${disabled ? "disabled" : ""} title="${escapeHtml(seat.code)} · ${escapeHtml(seat.status)}" aria-label="${escapeHtml(seat.code)}, ${escapeHtml(seat.status)}" aria-pressed="${selected}">${escapeHtml(seat.code)}</button>`;
      }).join("");
      const wholeAvailable = availability.status === "AVAILABLE" && seats.every((seat) => seat.status === "AVAILABLE");
      const wholeOption = type === "COMPUTER_LAB" && session().user?.role === "FACULTY"
        ? `<button class="button button-outline whole-lab-option" type="button" data-select-facility="${escapeHtml(facility.id)}" ${wholeAvailable ? "" : "disabled"}>Reserve the whole lab</button>`
        : "";
      map.innerHTML = `${wholeOption}<div class="seat-map-head"><span>FRONT OF ROOM</span></div><div class="seat-grid">${buttons}</div>`;
      map.querySelector("[data-select-facility]")?.addEventListener("click", () => {
        selectedSeat = null;
        selectedWhole = true;
        updateSummary();
      });
      map.querySelectorAll("[data-seat-id]").forEach((button) => button.addEventListener("click", () => {
        selectedSeat = String(selectedSeat) === button.dataset.seatId ? null : button.dataset.seatId;
        selectedWhole = false;
        renderSeatMap();
      }));
    }
    updateSummary();
  }

  function updateSummary() {
    const summary = document.querySelector("[data-selection-summary]");
    const button = document.getElementById("confirm-campus-booking");
    const facility = pickedFacility();
    const { date, startTime, endTime } = bookingWindow();
    const whole = selectedWhole;
    const role = session().user?.role;
    const needsAttendance = whole && (selectedCategory() === "SEMINAR_HALL" || selectedCategory() === "COMPUTER_LAB");
    document.querySelector("[data-attendance-field]").hidden = !needsAttendance;
    document.querySelector("[data-repeat-field]").hidden = !(role === "FACULTY" && whole);
    if (!facility || !availability || (!whole && !selectedSeat)) {
      summary.innerHTML = "<p>Select an available seat, system, or hall to continue.</p>";
      button.disabled = true;
      return;
    }
    const seat = availability.seats?.find((item) => String(item.id) === String(selectedSeat));
    const place = seat ? `${facility.name} · ${seat.code}` : facility.name;
    const sameDayFuture = date > localDateString() || (date === localDateString() && startTime > `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`);
    summary.innerHTML = `<dl><div><dt>Place</dt><dd>${escapeHtml(place)}</dd></div><div><dt>Date</dt><dd>${escapeHtml(formatDate(date))}</dd></div><div><dt>Time</dt><dd>${escapeHtml(formatTime(startTime))}–${escapeHtml(formatTime(endTime))}</dd></div></dl>`;
    const statusAvailable = seat ? seat.status === "AVAILABLE"
      : whole && availability.status === "AVAILABLE"
        && (!availability.seats?.length || availability.seats.every((item) => item.status === "AVAILABLE"));
    button.disabled = !statusAvailable || !sameDayFuture || !session().token;
  }

  async function chooseFacility(id) {
    selectedFacility = String(id);
    selectedSeat = null;
    selectedWhole = false;
    availability = null;
    renderFloorTabs();
    renderFacilities();
    renderSeatMap();
    await loadAvailability();
  }

  async function loadAvailability(showErrors = true) {
    if (!selectedFacility) return;
    const messageElement = document.getElementById("campus-message");
    try {
      const window = bookingWindow();
      validateWindow(window);
      availability = await api(`/api/facilities/${encodeURIComponent(selectedFacility)}/availability?${new URLSearchParams(window)}`);
      if (selectedSeat && availability.seats?.find((seat) => String(seat.id) === String(selectedSeat))?.status !== "AVAILABLE") {
        selectedSeat = null;
      }
      if (selectedWhole && (availability.status !== "AVAILABLE"
          || availability.seats?.some((seat) => seat.status !== "AVAILABLE"))) selectedWhole = false;
      message(messageElement, "");
      renderSeatMap();
    } catch (error) {
      availability = null;
      renderSeatMap();
      if (showErrors) message(messageElement, error.message);
    }
  }

  async function loadFacilities() {
    const category = selectedCategory();
    const data = await api(`/api/facilities?type=${encodeURIComponent(category)}`);
    if (!Array.isArray(data)) throw new Error("Facility API response must be an array.");
    facilities = data;
    const params = new URLSearchParams(location.search);
    const wanted = params.get("facilityId");
    const preferred = facilities.find((item) => String(item.id) === wanted)
      || (category === "LIBRARY" ? facilities.find((item) => Number(item.floor) === 1) : facilities[0]);
    selectedFacility = preferred ? String(preferred.id) : null;
    selectedSeat = null;
    selectedWhole = false;
    availability = null;
    renderFloorTabs();
    renderFacilities();
    document.querySelector("[data-map-title]").textContent = categories[category].title;
    document.querySelector("[data-map-eyebrow]").textContent = categories[category].label.toUpperCase();
    if (selectedFacility) await loadAvailability();
    else renderSeatMap();
  }

  async function initBooking() {
    const role = session().user?.role;
    if (role && !["STUDENT", "FACULTY"].includes(role)) {
      ensureRole(["STUDENT", "FACULTY"]);
      return;
    }
    const category = document.getElementById("campus-category");
    if (role === "STUDENT") category.querySelector('option[value="SEMINAR_HALL"]').disabled = true;
    const queryCategory = new URLSearchParams(location.search).get("category");
    if (queryCategory && categories[queryCategory]) {
      if (queryCategory === "SEMINAR_HALL" && role === "STUDENT") {
        message(document.getElementById("campus-message"), "Seminar hall reservations are available to faculty accounts.");
      } else category.value = queryCategory;
    } else if (role === "FACULTY" && page === "faculty") category.value = "SEMINAR_HALL";
    const dateInput = document.getElementById("campus-date");
    dateInput.min = localDateString();
    const defaultStart = new Date();
    defaultStart.setMinutes(0, 0, 0);
    defaultStart.setHours(defaultStart.getHours() + 1);
    if (defaultStart.getHours() >= 22) {
      defaultStart.setDate(defaultStart.getDate() + 1);
      defaultStart.setHours(9, 0, 0, 0);
    }
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setHours(defaultEnd.getHours() + 1);
    dateInput.value = localDateString(defaultStart);
    document.getElementById("campus-start").value = `${String(defaultStart.getHours()).padStart(2, "0")}:00`;
    document.getElementById("campus-end").value = `${String(defaultEnd.getHours()).padStart(2, "0")}:00`;
    document.querySelector("[data-role-pill]").textContent = role
      ? `${session().user.name || "University account"} · ${role.toLowerCase()}` : "Sign in to confirm your booking";
    if (role === "FACULTY") {
      document.querySelector("[data-attendance-field]").hidden = false;
      document.querySelector("[data-repeat-field]").hidden = false;
    }
    if (session().token) {
      try { await fillProfile([]); } catch (error) { message(document.getElementById("campus-message"), error.message); }
    }
    category.addEventListener("change", () => {
      selectedFacility = null;
      loadFacilities().catch((error) => message(document.getElementById("campus-message"), error.message));
    });
    ["campus-date", "campus-start", "campus-end"].forEach((id) => {
      document.getElementById(id).addEventListener("change", () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => loadAvailability(), 150);
      });
    });
    document.getElementById("check-availability").addEventListener("click", () => loadAvailability());
    document.getElementById("confirm-campus-booking").addEventListener("click", createBooking);
    try {
      await loadFacilities();
    } catch (error) {
      message(document.getElementById("campus-message"), error.message);
      document.querySelector("[data-seat-map]").innerHTML = '<div class="empty-state">Campus facilities could not be loaded.</div>';
    }
    clearInterval(pollTimer);
    pollTimer = setInterval(() => loadAvailability(false), 5000);
  }

  async function createBooking() {
    const button = document.getElementById("confirm-campus-booking");
    const type = selectedCategory();
    const role = session().user?.role;
    if (!session().token) {
      location.href = `login.html?next=${encodeURIComponent("campus-booking.html")}`;
      return;
    }
    if (!pickedFacility()) return;
    const window = bookingWindow();
    try {
      validateWindow(window);
      const whole = selectedWhole;
      const purpose = document.getElementById("campus-purpose").value.trim();
      if (!purpose) throw new Error("Enter a purpose for the booking.");
      if (whole && (type === "SEMINAR_HALL" || type === "COMPUTER_LAB")) {
        const attendance = Number(document.getElementById("campus-attendance").value);
        if (!Number.isInteger(attendance) || attendance < 1) throw new Error("Enter the expected attendance.");
      }
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      const payload = {
        facilityId: Number(selectedFacility),
        seatId: selectedSeat === null ? null : Number(selectedSeat),
        ...window,
        purpose,
        expectedAttendance: whole ? Number(document.getElementById("campus-attendance").value) || null : null,
        repeatWeeks: role === "FACULTY" && whole ? Number(document.getElementById("campus-repeat").value || 1) : 1
      };
      if (type === "LIBRARY" && whole) throw new Error("Select an available library seat.");
      if (type === "COMPUTER_LAB" && whole && role !== "FACULTY") throw new Error("Only faculty can reserve a whole computer lab.");
      const result = await api("/api/campus-bookings", { method: "POST", body: JSON.stringify(payload) });
      const first = result.bookings?.[0];
      document.querySelector("[data-confirm-content]").innerHTML = `<div class="booking-success-mark">✓</div><span class="eyebrow">BOOKING CONFIRMED</span><h2>You're all set.</h2><p>${escapeHtml(first?.facilityName || pickedFacility().name)}${first?.seatCode ? ` · ${escapeHtml(first.seatCode)}` : ""}</p><p>${escapeHtml(formatDate(first?.date || window.date))} · ${escapeHtml(formatTime(first?.startTime || window.startTime))}–${escapeHtml(formatTime(first?.endTime || window.endTime))}</p><p>Booking ID <strong>#${escapeHtml(first?.id || "—")}</strong></p>${result.qrCode ? `<img class="booking-qr" src="${escapeHtml(result.qrCode)}" alt="Booking check-in QR code">` : ""}<p class="form-hint">A confirmation has been added to your in-app notifications. Check in within 15 minutes of the start time.</p>`;
      document.querySelector("[data-confirm-dialog]").showModal();
      document.getElementById("campus-purpose").value = "";
      await loadAvailability();
    } catch (error) {
      message(document.getElementById("campus-message"), error.message);
    } finally {
      button.removeAttribute("aria-busy");
      updateSummary();
    }
  }

  function setupConfirmDialog() {
    document.querySelector("[data-close-confirm]")?.addEventListener("click", () => {
      document.querySelector("[data-confirm-dialog]").close();
    });
  }

  function bookingCompare(a, b) {
    return `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`);
  }

  async function loadMyBookings() {
    const result = await api("/api/campus-bookings/my");
    if (!Array.isArray(result)) throw new Error("Booking API response must be an array.");
    bookings = result;
    return result;
  }

  async function initDashboard() {
    if (!ensureRole(["STUDENT", "FACULTY"])) return;
    const error = document.querySelector("[data-error]");
    try {
      const [user, items] = await Promise.all([api("/api/auth/me"), loadMyBookings()]);
      document.querySelectorAll("[data-profile]").forEach((element) => {
        element.textContent = profileText(user);
        element.hidden = false;
      });
      const upcoming = upcomingOnly(items);
      const past = items.filter((item) => !upcoming.includes(item) || ["COMPLETED", "NO_SHOW", "CANCELLED"].includes(item.status))
        .sort((a, b) => bookingCompare(b, a));
      renderBookingList(document.querySelector("[data-upcoming]"), upcoming, true);
      renderBookingList(document.querySelector("[data-history]"), past, false);
      renderBookingList(document.querySelector("[data-bookings]"), upcoming, true);
      await loadNotifications();
      setupBookingActions();
    } catch (err) {
      message(error, err.message);
    }

  }

  function renderBookingList(container, list, withControls) {
    if (!container) return;
    container.innerHTML = "";
    if (!list.length) {
      container.innerHTML = '<div class="empty-state">No bookings to show.</div>';
      return;
    }
    list.forEach((item) => container.append(bookingCard(item, withControls)));
  }

  function setupBookingActions() {
    document.addEventListener("click", async (event) => {
      const cancel = event.target.closest("[data-cancel]");
      const checkin = event.target.closest("[data-checkin]");
      const extend = event.target.closest("[data-extend]");
      const qr = event.target.closest("[data-qr]");
      try {
        if (cancel) {
          cancel.disabled = true;
          await api(`/api/campus-bookings/${encodeURIComponent(cancel.dataset.cancel)}/cancel`, { method: "PUT" });
          location.reload();
        } else if (checkin) {
          const item = bookings.find((booking) => String(booking.id) === checkin.dataset.checkin);
          if (!item) throw new Error("Booking details could not be found.");
          checkin.disabled = true;
          await api(`/api/campus-bookings/${encodeURIComponent(item.id)}/check-in`, {
            method: "PUT", body: JSON.stringify({ code: item.checkInCode })
          });
          location.reload();
        } else if (extend) {
          const item = bookings.find((booking) => String(booking.id) === extend.dataset.extend);
          const endTime = window.prompt("Enter the new ending time (HH:mm):", item?.endTime || "");
          if (!endTime) return;
          extend.disabled = true;
          await api(`/api/campus-bookings/${encodeURIComponent(extend.dataset.extend)}/extend`, {
            method: "PUT", body: JSON.stringify({ endTime })
          });
          location.reload();
        } else if (qr) {
          const result = await api(`/api/campus-bookings/${encodeURIComponent(qr.dataset.qr)}/qr`);
          if (window.KarunyaDemo) {
            window.alert(`Demo check-in code: ${result.checkInCode}`);
            return;
          }
          document.querySelector("[data-qr-image]").src = result.qrCode;
          document.querySelector("[data-qr-dialog]").showModal();
        }
      } catch (err) {
        message(document.querySelector("[data-error]"), err.message);
        if (event.target instanceof HTMLButtonElement) event.target.disabled = false;
      }
    });
    document.querySelector("[data-qr-close]")?.addEventListener("click", () => document.querySelector("[data-qr-dialog]").close());
  }

  function mondayOf(date) {
    const monday = new Date(date);
    const offset = (monday.getDay() + 6) % 7;
    monday.setDate(monday.getDate() - offset);
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  function renderFacilityCalendar(schedule) {
    const container = document.querySelector("[data-facility-calendar]");
    const days = schedule.days || [];
    document.querySelector("[data-week-label]").textContent = days.length
      ? `${formatDate(days[0].date)} – ${formatDate(days[days.length - 1].date)}` : "No schedule";
    container.innerHTML = days.map((day) => {
      const events = (day.events || []).map((item) => `<article class="calendar-event ${item.status === "BLOCKED" ? "blocked" : ""}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(formatTime(item.startTime))}–${escapeHtml(formatTime(item.endTime))}</span></article>`).join("");
      return `<section class="calendar-day"><h3>${escapeHtml(formatDate(day.date))}</h3>${events || '<p class="calendar-free">Available</p>'}</section>`;
    }).join("");
  }

  async function loadFacultyCalendar(firstDate) {
    const select = document.querySelector("[data-schedule-facility]");
    if (!select.value) return;
    try {
      const schedule = await api(`/api/facilities/${encodeURIComponent(select.value)}/schedule?from=${encodeURIComponent(firstDate)}`);
      renderFacilityCalendar(schedule);
    } catch (error) {
      document.querySelector("[data-facility-calendar]").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  async function initFaculty() {
    if (!ensureRole("FACULTY")) return;
    try {
      const user = await fillProfile([document.querySelector("[data-profile]")]);
      if (user) {
        document.querySelector("[data-profile]").hidden = false;
        document.querySelector("[data-user-name]").textContent = `${user.name.split(" ")[0]}.`;
      }
      const items = await loadMyBookings();
      renderBookingList(document.querySelector("[data-bookings]"), upcomingOnly(items), true);
      setupBookingActions();
      const [halls, labs] = await Promise.all([
        api("/api/facilities?type=SEMINAR_HALL"), api("/api/facilities?type=COMPUTER_LAB")
      ]);
      const rooms = [...halls, ...labs];
      const facilitySelect = document.querySelector("[data-schedule-facility]");
      facilitySelect.innerHTML = rooms.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
      if (!rooms.length) {
        document.querySelector("[data-week-label]").textContent = "No facilities";
        document.querySelector("[data-facility-calendar]").innerHTML = '<div class="empty-state">No rooms are currently available to schedule.</div>';
        return;
      }
      let firstDate = localDateString(mondayOf(new Date()));
      await loadFacultyCalendar(firstDate);
      facilitySelect.addEventListener("change", () => loadFacultyCalendar(firstDate));
      document.querySelector("[data-week-prev]").addEventListener("click", () => {
        const date = new Date(`${firstDate}T12:00:00`);
        date.setDate(date.getDate() - 7);
        firstDate = localDateString(date);
        loadFacultyCalendar(firstDate);
      });
      document.querySelector("[data-week-next]").addEventListener("click", () => {
        const date = new Date(`${firstDate}T12:00:00`);
        date.setDate(date.getDate() + 7);
        firstDate = localDateString(date);
        loadFacultyCalendar(firstDate);
      });
    } catch (error) {
      message(document.querySelector("[data-error]"), error.message);
    }
  }

  function renderAdminFacilities() {
    const tbody = document.querySelector("[data-admin-facilities]");
    tbody.innerHTML = adminFacilities.length ? adminFacilities.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(item.building)}</td><td>${escapeHtml(item.seatCount)} / ${escapeHtml(item.capacity)}</td><td><span class="status-pill ${item.active ? "status-approved" : "status-cancelled"}">${item.active ? "Active" : "Inactive"}</span></td><td><button class="table-action" type="button" data-edit-facility="${escapeHtml(item.id)}">Edit</button>${item.active ? `<button class="table-action delete-action" type="button" data-delete-facility="${escapeHtml(item.id)}">Deactivate</button>` : ""}</td></tr>`).join("")
      : '<tr><td colspan="6">No facilities found.</td></tr>';
    const select = document.querySelector("[data-block-form] select[name=facilityId]");
    select.innerHTML = adminFacilities.filter((item) => item.active).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  }

  function renderAdminBookings(items) {
    const tbody = document.querySelector("[data-admin-bookings]");
    tbody.innerHTML = items.length ? items.map((item) => `<tr><td>${escapeHtml(item.facilityName)}${item.seatCode ? ` · ${escapeHtml(item.seatCode)}` : ""}</td><td>${escapeHtml(item.userName)}<br><small>${escapeHtml(item.department || "")}</small></td><td>${escapeHtml(formatDate(item.date))}<br>${escapeHtml(formatTime(item.startTime))}–${escapeHtml(formatTime(item.endTime))}</td><td><span class="status-pill status-${escapeHtml(String(item.status).toLowerCase())}">${escapeHtml(String(item.status).replaceAll("_", " ").toLowerCase())}</span></td><td>${["CANCELLED", "NO_SHOW", "COMPLETED"].includes(item.status) ? "—" : `<button class="table-action delete-action" type="button" data-admin-cancel="${escapeHtml(item.id)}">Cancel</button>`}</td></tr>`).join("")
      : '<tr><td colspan="5">No bookings found.</td></tr>';
  }

  function renderAdminBlocks() {
    const container = document.querySelector("[data-admin-blocks]");
    container.innerHTML = adminBlocks.length ? adminBlocks.map((item) => `<div class="karunya-block-row"><span><strong>${escapeHtml(item.facilityName)}${item.seatCode ? ` · ${escapeHtml(item.seatCode)}` : ""}</strong><small>${escapeHtml(item.reason)} · ${escapeHtml(item.startsAt)}</small></span><button class="table-action delete-action" type="button" data-delete-block="${escapeHtml(item.id)}">Remove</button></div>`).join("")
      : '<p class="form-hint">No active blocks.</p>';
  }

  function facilityForm(facility) {
    const form = document.querySelector("[data-facility-form]");
    form.reset();
    form.elements.id.value = facility?.id || "";
    form.elements.code.value = facility?.code || "";
    form.elements.type.value = facility?.type || "LIBRARY";
    form.elements.name.value = facility?.name || "";
    form.elements.building.value = facility?.building || "";
    form.elements.floor.value = facility?.floor ?? "";
    form.elements.capacity.value = facility?.capacity ?? "";
    form.elements.seatCount.value = facility?.seatCount ?? "";
    form.elements.software.value = facility?.software || "";
    form.elements.projector.checked = facility?.projector || false;
    form.elements.ac.checked = facility?.ac || false;
    form.elements.microphone.checked = facility?.microphone || false;
    form.elements.seatCount.disabled = Boolean(facility);
    form.elements.type.disabled = Boolean(facility && facility.seatCount);
    form.elements.floor.disabled = Boolean(facility && facility.seatCount);
    document.querySelector("[data-facility-floor]").hidden = form.elements.type.value !== "LIBRARY";
    document.querySelector("[data-facility-title]").textContent = facility ? "Edit facility" : "Add facility";
    document.querySelector("[data-facility-dialog]").showModal();
  }

  async function initAdmin() {
    if (!ensureRole("ADMIN")) return;
    const error = document.querySelector("[data-error]");
    try {
      const [user, dashboard, facilitiesData, bookingData, blockData] = await Promise.all([
        api("/api/auth/me"), api("/api/admin/campus/dashboard"), api("/api/admin/campus/facilities"),
        api("/api/admin/campus/bookings"), api("/api/admin/campus/blocks")
      ]);
      document.querySelector("[data-profile]").textContent = profileText(user);
      document.querySelector("[data-profile]").hidden = false;
      adminFacilities = facilitiesData;
      adminBlocks = blockData;
      const stats = dashboard.bookings || {};
      for (const [key, value] of Object.entries(stats)) {
        const target = document.querySelector(`[data-stat="${key}"]`);
        if (target) target.textContent = value ?? "—";
      }
      document.querySelector('[data-stat="facilities"]').textContent = dashboard.facilities ?? facilitiesData.length;
      renderAdminFacilities();
      renderAdminBlocks();
      renderAdminBookings(bookingData);
      const settings = dashboard.settings || {};
      const settingsForm = document.querySelector("[data-settings-form]");
      for (const [key, value] of Object.entries(settings)) {
        if (settingsForm.elements[key]) settingsForm.elements[key].value = value;
      }
    } catch (err) {
      message(error, err.message);
    }

    document.querySelector("[data-block-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      try {
        await api("/api/admin/campus/blocks", {
          method: "POST",
          body: JSON.stringify({
            facilityId: Number(form.elements.facilityId.value),
            seatId: form.elements.seatId.value ? Number(form.elements.seatId.value) : null,
            date: form.elements.date.value,
            startTime: form.elements.startTime.value,
            endTime: form.elements.endTime.value,
            reason: form.elements.reason.value.trim()
          })
        });
        const blockDate = document.querySelector("[data-block-form] input[name=date]");
        blockDate.min = localDateString();
        adminBlocks = await api("/api/admin/campus/blocks");
        renderAdminBlocks();
        message(document.querySelector("[data-block-message]"), "Time slot blocked.", true);
        form.reset();
      } catch (err) { message(document.querySelector("[data-block-message]"), err.message); }
    });
    document.querySelector("[data-settings-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        for (const key of ["advance_booking_days", "student_max_daily_bookings", "library_seat_max_minutes"]) {
          await api(`/api/admin/campus/settings/${key}`, {
            method: "PUT", body: JSON.stringify({ value: Number(form.elements[key].value) })
          });
        }
        message(document.querySelector("[data-settings-message]"), "Booking policies saved.", true);
      } catch (err) { message(document.querySelector("[data-settings-message]"), err.message); }
    });
    document.querySelector("[data-new-facility]").addEventListener("click", () => facilityForm(null));
    document.querySelector("[data-facility-close]").addEventListener("click", () => document.querySelector("[data-facility-dialog]").close());
    document.querySelector("[data-facility-form] select[name=type]").addEventListener("change", (event) => {
      document.querySelector("[data-facility-floor]").hidden = event.currentTarget.value !== "LIBRARY";
    });
    document.querySelector("[data-facility-form]").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const id = form.elements.id.value;
      const payload = {
        code: form.elements.code.value.trim(), type: form.elements.type.value,
        name: form.elements.name.value.trim(), building: form.elements.building.value.trim(),
        floor: form.elements.type.value === "LIBRARY" ? Number(form.elements.floor.value) : null,
        capacity: Number(form.elements.capacity.value),
        seatCount: form.elements.seatCount.value ? Number(form.elements.seatCount.value) : null,
        projector: form.elements.projector.checked, ac: form.elements.ac.checked,
        microphone: form.elements.microphone.checked, software: form.elements.software.value.trim() || null,
        active: id ? adminFacilities.find((item) => String(item.id) === id)?.active !== false : true
      };
      try {
        await api(id ? `/api/admin/campus/facilities/${encodeURIComponent(id)}` : "/api/admin/campus/facilities", {
          method: id ? "PUT" : "POST", body: JSON.stringify(payload)
        });
        adminFacilities = await api("/api/admin/campus/facilities");
        renderAdminFacilities();
        document.querySelector("[data-facility-dialog]").close();
      } catch (err) { message(document.querySelector("[data-facility-message]"), err.message); }
    });
    document.addEventListener("click", async (event) => {
      const edit = event.target.closest("[data-edit-facility]");
      const deactivate = event.target.closest("[data-delete-facility]");
      const removeBlock = event.target.closest("[data-delete-block]");
      const cancelBooking = event.target.closest("[data-admin-cancel]");
      try {
        if (edit) {
          facilityForm(adminFacilities.find((item) => String(item.id) === edit.dataset.editFacility));
        } else if (deactivate && window.confirm("Deactivate this facility? Existing booking history will be preserved.")) {
          await api(`/api/admin/campus/facilities/${encodeURIComponent(deactivate.dataset.deleteFacility)}`, { method: "DELETE" });
          adminFacilities = await api("/api/admin/campus/facilities");
          renderAdminFacilities();
        } else if (removeBlock && window.confirm("Remove this block?")) {
          await api(`/api/admin/campus/blocks/${encodeURIComponent(removeBlock.dataset.deleteBlock)}`, { method: "DELETE" });
          adminBlocks = await api("/api/admin/campus/blocks");
          renderAdminBlocks();
        } else if (cancelBooking && window.confirm("Cancel this campus booking?")) {
          await api(`/api/campus-bookings/${encodeURIComponent(cancelBooking.dataset.adminCancel)}/cancel`, { method: "PUT" });
          const result = await api("/api/admin/campus/bookings");
          renderAdminBookings(result);
        }
      } catch (err) { message(error, err.message); }
    });
  }

  function init() {
    setupNavigation();
    setupConfirmDialog();
    if (page === "home") initHome();
    if (page === "booking") initBooking();
    if (page === "dashboard") initDashboard();
    if (page === "faculty") initFaculty();
    if (page === "admin") initAdmin();
  }

  init();
})();
