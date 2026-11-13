(() => {
  "use strict";

  const DATA_KEY = "karunya.demo.data.v1";
  const TOKEN_KEY = "campusly.token";
  const USER_KEY = "campusly.user";
  const ACTIVE_BOOKINGS = new Set(["RESERVED", "CHECKED_IN"]);
  const nowLocal = () => new Date();
  const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const timeString = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const stamp = (date, time) => new Date(`${date}T${String(time).slice(0, 5)}:00`);
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function seedData() {
    let nextSeatId = 1;
    const facilities = [];
    for (let floor = 1; floor <= 3; floor++) {
      const seats = [];
      for (let row = 1; row <= 10; row++) {
        for (let number = 1; number <= 8; number++) {
          const label = String.fromCharCode(64 + row);
          seats.push({ id: nextSeatId++, code: `F${floor}-${label}${String(number).padStart(2, "0")}`, rowLabel: label, seatNumber: number, type: "LIBRARY_SEAT" });
        }
      }
      facilities.push({
        id: floor, code: `LIB-F${floor}`, type: "LIBRARY", name: `Central Library — Floor ${floor}`,
        building: "Central Library", floor, capacity: 80, projector: false, ac: true,
        microphone: false, software: null, photoUrl: "assets/library-room.svg", active: true, seats
      });
    }
    for (let number = 1; number <= 7; number++) {
      facilities.push({
        id: number + 3, code: `HALL-${String(number).padStart(2, "0")}`, type: "SEMINAR_HALL",
        name: `Seminar Hall ${number}`, building: number < 3 ? "Academic Block A" : "Academic Block B",
        floor: null, capacity: [120, 80, 150, 100, 60, 90, 200][number - 1],
        projector: true, ac: true, microphone: true, software: null,
        photoUrl: "assets/seminar-hall.svg", active: true, seats: []
      });
    }
    const software = [
      "Java, Python, VS Code, MySQL", "C, C++, Java, MATLAB", "Python, R, Jupyter, Anaconda",
      "Java, Eclipse, MySQL", "AutoCAD, SolidWorks, MATLAB", "Python, TensorFlow, Jupyter",
      "C, C++, Linux, Git", "MATLAB, Simulink, LabVIEW", "Java, Spring, PostgreSQL",
      "Python, R, Jupyter", "SPSS, R, Python", "AutoCAD, Revit, SketchUp",
      "C, C++, Python, Git", "Java, Android Studio, Git", "Blender, Unity, Unreal Engine",
      "Python, Docker, Kubernetes", "VS Code, Git, Node.js, Python"
    ];
    for (let number = 1; number <= 17; number++) {
      const seats = [];
      for (let pc = 1; pc <= 40; pc++) {
        seats.push({
          id: nextSeatId++, code: `PC-${String(pc).padStart(2, "0")}`,
          rowLabel: `R${Math.floor((pc - 1) / 10) + 1}`, seatNumber: pc, type: "COMPUTER_SYSTEM"
        });
      }
      facilities.push({
        id: number + 10, code: `LAB-${String(number).padStart(2, "0")}`, type: "COMPUTER_LAB",
        name: `Computer Lab ${number}`, building: number < 6 ? "Technology Block" : number < 11 ? "Engineering Block" : "Science Block",
        floor: null, capacity: 40, projector: true, ac: true, microphone: false,
        software: software[number - 1], photoUrl: "assets/computer-laboratory.svg", active: true, seats
      });
    }
    return {
      version: 1, facilities, users: [], bookings: [], blocks: [], notifications: [],
      settings: { advance_booking_days: 30, student_max_daily_bookings: 2, library_seat_max_minutes: 240 },
      nextBookingId: 1, nextBlockId: 1, nextNotificationId: 1
    };
  }

  function save(data) {
    localStorage.setItem(DATA_KEY, JSON.stringify(data));
  }

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(DATA_KEY) || "null");
      if (data?.version === 1 && Array.isArray(data.facilities) && Array.isArray(data.bookings)) return data;
    } catch { /* Re-seed a damaged local demo store. */ }
    const data = seedData();
    save(data);
    return data;
  }

  function signedInUser() {
    try {
      if (!localStorage.getItem(TOKEN_KEY) && !sessionStorage.getItem(TOKEN_KEY)) return null;
      const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function requireUser() {
    const user = signedInUser();
    if (!user) fail(401, "Please sign in to continue.");
    return user;
  }

  function requireRole(role) {
    const user = requireUser();
    if (user.role !== role) fail(403, `This action requires the ${role.toLowerCase()} role.`);
    return user;
  }

  function fail(status, message) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }

  function cleanFacility(facility, includeSeats = false) {
    const { seats, ...fields } = facility;
    return includeSeats ? { ...fields, seats: clone(seats) } : { ...fields, seatCount: seats.length };
  }

  function facilityFor(data, id) {
    const facility = data.facilities.find((item) => Number(item.id) === Number(id));
    if (!facility || !facility.active) fail(404, "Facility not found.");
    return facility;
  }

  function expireBookings(data) {
    const now = nowLocal();
    let changed = false;
    for (const booking of data.bookings) {
      if (!ACTIVE_BOOKINGS.has(booking.status)) continue;
      const start = stamp(booking.date, booking.startTime);
      const end = stamp(booking.date, booking.endTime);
      if (end <= now) {
        booking.status = "COMPLETED";
        changed = true;
      } else if (booking.status === "RESERVED" && start.getTime() + 15 * 60 * 1000 <= now.getTime()) {
        booking.status = "NO_SHOW";
        changed = true;
      }
    }
    if (changed) save(data);
  }

  function overlaps(start, end, otherStart, otherEnd) {
    return start < otherEnd && end > otherStart;
  }

  function slotStatus(data, facility, seatId, date, startTime, endTime) {
    const start = stamp(date, startTime);
    const end = stamp(date, endTime);
    const blocked = data.blocks.some((block) => Number(block.facilityId) === Number(facility.id)
      && (block.seatId == null || seatId == null || Number(block.seatId) === Number(seatId))
      && overlaps(start, end, stamp(block.date, block.startTime), stamp(block.date, block.endTime)));
    if (blocked) return "BLOCKED";
    const booked = data.bookings.some((booking) => ACTIVE_BOOKINGS.has(booking.status)
      && Number(booking.facilityId) === Number(facility.id)
      && (booking.seatId == null || seatId == null || Number(booking.seatId) === Number(seatId))
      && overlaps(start, end, stamp(booking.date, booking.startTime), stamp(booking.date, booking.endTime)));
    return booked ? "BOOKED" : "AVAILABLE";
  }

  function facilityAvailability(data, facility, date, startTime, endTime) {
    if (!date || !startTime || !endTime || !stamp(date, endTime).getTime()) fail(400, "Choose a valid date and time.");
    const seats = facility.seats.map((seat) => ({
      ...clone(seat), status: slotStatus(data, facility, seat.id, date, startTime, endTime)
    }));
    const wholeStatus = slotStatus(data, facility, null, date, startTime, endTime);
    return { facility: cleanFacility(facility), status: wholeStatus, seats, startsAt: `${date}T${startTime}`, endsAt: `${date}T${endTime}` };
  }

  function bookingView(data, booking, currentUser) {
    const facility = data.facilities.find((item) => Number(item.id) === Number(booking.facilityId));
    const seat = facility?.seats.find((item) => Number(item.id) === Number(booking.seatId));
    return {
      ...clone(booking), facilityName: facility?.name || "Campus facility", seatCode: seat?.code || null,
      userName: booking.userName || "", department: booking.department || ""
    };
  }

  function notification(data, userId, message) {
    data.notifications.unshift({
      id: data.nextNotificationId++, userId, message, status: "UNREAD", createdAt: new Date().toLocaleString()
    });
  }

  function createBookings(data, user, payload) {
    const facility = facilityFor(data, payload.facilityId);
    const start = stamp(payload.date, payload.startTime);
    const end = stamp(payload.date, payload.endTime);
    const now = nowLocal();
    const duration = (end - start) / 60000;
    if (!Number.isFinite(duration) || duration < 30 || duration > 480) fail(400, "Bookings must last 30 minutes to 8 hours.");
    if (start <= now) fail(400, "Bookings must start in the future.");
    if ((start - now) / 86400000 > Number(data.settings.advance_booking_days || 30)) fail(400, "That date is outside the advance booking window.");
    if (!String(payload.purpose || "").trim()) fail(400, "Enter a purpose for the booking.");
    const isWhole = payload.seatId == null;
    if (facility.type === "LIBRARY") {
      if (isWhole || !facility.seats.some((seat) => Number(seat.id) === Number(payload.seatId))) fail(400, "Choose an available library seat.");
      if (duration > Number(data.settings.library_seat_max_minutes || 240)) fail(400, "Library bookings are limited to four hours.");
    }
    if (facility.type === "SEMINAR_HALL" && (user.role !== "FACULTY" || !isWhole)) fail(403, "Seminar halls can only be reserved by faculty.");
    if (facility.type === "COMPUTER_LAB") {
      if (isWhole && user.role !== "FACULTY") fail(403, "Only faculty can reserve an entire computer lab.");
      if (!isWhole && !facility.seats.some((seat) => Number(seat.id) === Number(payload.seatId))) fail(400, "Choose a valid computer.");
    }
    const repeats = Number(payload.repeatWeeks || 1);
    if (repeats < 1 || repeats > 12 || !Number.isInteger(repeats)) fail(400, "Weekly repeats must be between 1 and 12.");
    if (repeats > 1 && (user.role !== "FACULTY" || !isWhole)) fail(403, "Only faculty can repeat whole-facility bookings.");
    const dates = [];
    for (let week = 0; week < repeats; week++) {
      const occurrence = new Date(`${payload.date}T12:00:00`);
      occurrence.setDate(occurrence.getDate() + week * 7);
      const occurrenceDate = dateString(occurrence);
      if ((stamp(occurrenceDate, payload.startTime) - now) / 86400000 > Number(data.settings.advance_booking_days || 30)) {
        fail(400, "A recurring booking is outside the advance booking window.");
      }
      if (user.role === "STUDENT") {
        const dailyCount = data.bookings.filter((item) => item.userId === user.id && item.date === occurrenceDate
          && ACTIVE_BOOKINGS.has(item.status)).length;
        if (dailyCount >= Number(data.settings.student_max_daily_bookings || 2)) fail(400, "You have reached the daily booking limit.");
      }
      const status = slotStatus(data, facility, payload.seatId, occurrenceDate, payload.startTime, payload.endTime);
      if (status !== "AVAILABLE") fail(409, `${facility.name} is ${status.toLowerCase()} for that time.`);
      dates.push(occurrenceDate);
    }
    const created = dates.map((date) => {
      const booking = {
        id: data.nextBookingId++, userId: user.id, userName: user.name, email: user.email,
        department: user.department, role: user.role, facilityId: facility.id,
        seatId: payload.seatId == null ? null : Number(payload.seatId), date,
        startTime: payload.startTime, endTime: payload.endTime, purpose: String(payload.purpose).trim(),
        expectedAttendance: payload.expectedAttendance || null, status: "RESERVED",
        checkInCode: `DEMO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        createdAt: new Date().toISOString()
      };
      data.bookings.push(booking);
      notification(data, user.id, `Booking confirmed: ${facility.name} on ${date} at ${payload.startTime}.`);
      return bookingView(data, booking, user);
    });
    save(data);
    return { bookings: created, checkInCode: created[0]?.checkInCode || null };
  }

  function allFacilities(data, activeOnly = true) {
    return data.facilities.filter((item) => !activeOnly || item.active).map((item) => cleanFacility(item));
  }

  function resourceList(data) {
    return data.facilities.map((facility) => ({
      id: facility.id, name: facility.name,
      type: facility.type === "LIBRARY" ? "Library room" : facility.type === "COMPUTER_LAB" ? "Computer laboratory" : "Seminar hall",
      location: facility.building, capacity: facility.capacity, available: facility.active,
      description: facility.software || `${facility.seats.length || facility.capacity} places available for campus activities.`,
      imageUrl: facility.photoUrl
    }));
  }

  function legacyBooking(data, booking) {
    const item = bookingView(data, booking);
    return { ...item, resourceId: item.facilityId, resourceName: item.facilityName,
      studentName: item.userName, studentEmail: item.email,
      status: ({ RESERVED: "APPROVED", CHECKED_IN: "APPROVED", COMPLETED: "APPROVED", NO_SHOW: "REJECTED", CANCELLED: "CANCELLED" })[item.status] || "PENDING" };
  }

  function adminStats(data) {
    const active = data.bookings.filter((item) => ACTIVE_BOOKINGS.has(item.status));
    const hourCounts = new Map();
    for (const item of active) {
      const hour = String(item.startTime).slice(0, 2);
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }
    const peak = [...hourCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const facilityCounts = new Map();
    for (const item of active) facilityCounts.set(item.facilityId, (facilityCounts.get(item.facilityId) || 0) + 1);
    const busy = [...facilityCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const facility = busy && data.facilities.find((item) => item.id === busy[0]);
    return {
      bookings: { total: data.bookings.length, upcoming: active.length, checkedIn: data.bookings.filter((item) => item.status === "CHECKED_IN").length,
        peakHour: peak ? `${peak[0]}:00` : "—", busiestFacility: facility?.name || "—" },
      facilities: data.facilities.length, settings: clone(data.settings)
    };
  }

  function setFacility(data, id, payload) {
    if (id) {
      const facility = data.facilities.find((item) => Number(item.id) === Number(id));
      if (!facility) fail(404, "Facility not found.");
      Object.assign(facility, {
        code: payload.code ?? facility.code, type: payload.type ?? facility.type,
        name: payload.name ?? facility.name, building: payload.building ?? facility.building,
        floor: payload.floor ?? null, capacity: Number(payload.capacity ?? facility.capacity),
        projector: payload.projector ?? facility.projector, ac: payload.ac ?? facility.ac,
        microphone: payload.microphone ?? facility.microphone, software: payload.software ?? facility.software,
        active: payload.active ?? facility.active
      });
      save(data);
      return cleanFacility(facility);
    }
    const nextId = Math.max(...data.facilities.map((item) => Number(item.id))) + 1;
    const type = payload.type || "LIBRARY";
    const count = Math.min(312, Math.max(0, Number(payload.seatCount) || 0));
    const seats = Array.from({ length: count }, (_, index) => ({
      id: Math.max(...data.facilities.flatMap((item) => item.seats.map((seat) => seat.id)), 0) + index + 1,
      code: type === "COMPUTER_LAB" ? `PC-${String(index + 1).padStart(2, "0")}` : `S-${String(index + 1).padStart(2, "0")}`,
      rowLabel: `R${Math.floor(index / 10) + 1}`, seatNumber: index + 1,
      type: type === "COMPUTER_LAB" ? "COMPUTER_SYSTEM" : "LIBRARY_SEAT"
    }));
    const facility = {
      id: nextId, code: payload.code || `DEMO-${nextId}`, type, name: payload.name || `Campus facility ${nextId}`,
      building: payload.building || "Campus", floor: payload.floor ?? null, capacity: Number(payload.capacity) || Math.max(count, 1),
      projector: Boolean(payload.projector), ac: Boolean(payload.ac), microphone: Boolean(payload.microphone),
      software: payload.software || null, photoUrl: "assets/library-room.svg", active: true, seats
    };
    data.facilities.push(facility);
    save(data);
    return cleanFacility(facility);
  }

  function handleFacilityRoute(data, url, method, body, user) {
    const path = url.pathname.replace(/^.*?\/api\/facilities/, "") || "/";
    if (method === "GET" && (path === "/" || path === "")) {
      const type = url.searchParams.get("type");
      return allFacilities(data).filter((item) => !type || item.type === type);
    }
    const match = path.match(/^\/(\d+)(?:\/(availability|schedule))?$/);
    if (!match) fail(404, "Facility endpoint not found.");
    const facility = facilityFor(data, match[1]);
    if (method === "GET" && match[2] === "availability") {
      const date = url.searchParams.get("date");
      const start = url.searchParams.get("startTime");
      const end = url.searchParams.get("endTime");
      if (!date || !start || !end || stamp(date, end) <= stamp(date, start)) fail(400, "Choose a valid date and time window.");
      return facilityAvailability(data, facility, date, start, end);
    }
    if (method === "GET" && match[2] === "schedule") {
      const first = url.searchParams.get("from");
      if (!first) fail(400, "from must use YYYY-MM-DD.");
      const days = [];
      for (let offset = 0; offset < 7; offset++) {
        const day = new Date(`${first}T12:00:00`);
        day.setDate(day.getDate() + offset);
        const date = dateString(day);
        const events = [
          ...data.bookings.filter((item) => item.facilityId === facility.id && ACTIVE_BOOKINGS.has(item.status) && item.date === date)
            .map((item) => ({ id: item.id, startTime: item.startTime, endTime: item.endTime, status: item.status,
              label: item.seatId == null ? "Facility reserved" : `${facility.seats.find((seat) => seat.id === item.seatId)?.code || "Seat"} reserved` })),
          ...data.blocks.filter((item) => item.facilityId === facility.id && item.date === date)
            .map((item) => ({ id: item.id, startTime: item.startTime, endTime: item.endTime, status: "BLOCKED", label: item.reason }))
        ].sort((a, b) => a.startTime.localeCompare(b.startTime));
        days.push({ date, events });
      }
      return { facility: cleanFacility(facility), days };
    }
    if (method === "GET") return cleanFacility(facility, true);
    fail(405, "This facility operation is not available.");
  }

  function handle(path, method, body, url) {
    let data = load();
    expireBookings(data);
    if (path === "/api/auth/login" && method === "POST") {
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = String(body.role || "STUDENT").toUpperCase();
      if (!/^[^\s@]+@karunya\.edu\.in$/i.test(email)) fail(400, "Use your @karunya.edu.in email address.");
      if (!password) fail(400, "Password is required.");
      if (!["STUDENT", "FACULTY", "ADMIN"].includes(role)) fail(400, "Choose Student, Faculty, or Admin.");
      const name = email.split("@")[0].split(/[._-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ") || "Karunya user";
      const user = { id: email, name, email, role, department: role === "ADMIN" ? "Campus Administration" : "Demo Department", phone: "" };
      data.users ||= [];
      const existing = data.users.findIndex((account) => account.email === email);
      if (existing < 0) data.users.push(user);
      else data.users[existing] = user;
      save(data);
      const token = `demo-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      return { token, user };
    }
    if (path === "/api/auth/logout" && method === "POST") return { success: true };
    const user = (path === "/api/auth/me") ? requireUser() : signedInUser();
    if (path === "/api/auth/me" && method === "GET") return clone(user);
    if (path === "/api/facilities" || path.startsWith("/api/facilities/")) return handleFacilityRoute(data, url, method, body, user);

    if (path === "/api/resources" && method === "GET") return resourceList(data);
    if (path === "/api/resources" && ["POST", "PUT"].includes(method)) {
      requireRole("ADMIN");
      const result = setFacility(data, body.id, { ...body, type: ({
        "Library room": "LIBRARY", "Seminar hall": "SEMINAR_HALL", "Computer laboratory": "COMPUTER_LAB"
      })[body.type] || body.type });
      return { ...result, available: result.active };
    }
    const resourceMatch = path.match(/^\/api\/resources\/(\d+)$/);
    if (resourceMatch && method === "DELETE") {
      requireRole("ADMIN");
      const facility = facilityFor(data, resourceMatch[1]);
      facility.active = false; save(data); return { success: true };
    }
    if (path === "/api/users/me" && method === "PATCH") {
      const current = requireUser();
      const updated = { ...current, name: String(body.name || current.name).trim(), phone: String(body.phone || "") };
      localStorage.setItem(USER_KEY, JSON.stringify(updated));
      save(data);
      return updated;
    }

    if (path === "/api/campus-bookings" && method === "POST") return createBookings(data, requireUser(), body);
    if (path === "/api/campus-bookings/my" && method === "GET") {
      const current = requireUser();
      return data.bookings.filter((item) => item.userId === current.id).map((item) => bookingView(data, item));
    }
    if (path === "/api/bookings" && method === "POST") {
      const current = requireRole("STUDENT");
      const facility = facilityFor(data, body.resourceId);
      const seat = facility.seats.find((item) => slotStatus(data, facility, item.id, body.date, body.startTime, body.endTime) === "AVAILABLE");
      const created = createBookings(data, current, { ...body, facilityId: facility.id, seatId: seat?.id ?? null });
      return legacyBooking(data, created.bookings[0]);
    }
    if ((path === "/api/bookings/my" || path === "/api/admin/bookings") && method === "GET") {
      const items = path === "/api/admin/bookings" ? (requireRole("ADMIN"), data.bookings) : data.bookings.filter((item) => item.userId === requireUser().id);
      return items.map((item) => legacyBooking(data, item));
    }
    if (path === "/api/admin/dashboard" && method === "GET") {
      requireRole("ADMIN");
      const states = data.bookings.map((item) => legacyBooking(data, item).status);
      return {
        totalStudents: (data.users || []).filter((item) => item.role === "STUDENT").length,
        totalResources: data.facilities.filter((item) => item.active).length, totalBookings: states.length,
        pendingBookings: states.filter((status) => status === "PENDING").length,
        approvedBookings: states.filter((status) => status === "APPROVED").length,
        rejectedBookings: states.filter((status) => status === "REJECTED").length
      };
    }
    if (path === "/api/admin/students" && method === "GET") {
      requireRole("ADMIN");
      return (data.users || []).filter((item) => item.role === "STUDENT")
        .map((item) => ({ id: item.id, name: item.name, email: item.email, phone: item.phone || "", active: item.active !== false }));
    }
    const oldAdminAction = path.match(/^\/api\/admin\/bookings\/(\d+)\/(approve|reject)$/);
    if (oldAdminAction && method === "PUT") {
      requireRole("ADMIN");
      const booking = data.bookings.find((item) => item.id === Number(oldAdminAction[1]));
      if (!booking) fail(404, "Booking not found.");
      if (oldAdminAction[2] === "reject") booking.status = "CANCELLED";
      save(data); return bookingView(data, booking);
    }
    const studentAction = path.match(/^\/api\/admin\/students\/(.+)$/);
    if (studentAction && method === "PUT") {
      requireRole("ADMIN");
      const student = (data.users || []).find((item) => item.id === decodeURIComponent(studentAction[1]));
      if (student) student.active = Boolean(body.active);
      save(data); return { success: true };
    }

    if (path === "/api/notifications" && method === "GET") {
      const current = requireUser();
      return clone(data.notifications.filter((item) => item.userId === current.id));
    }
    const readNotice = path.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (readNotice && method === "PUT") {
      const current = requireUser();
      const item = data.notifications.find((notice) => notice.id === Number(readNotice[1]) && notice.userId === current.id);
      if (item) item.status = "READ";
      save(data); return { success: true };
    }

    const campusAdmin = path.match(/^\/api\/admin\/campus(?:\/(.*))?$/);
    if (campusAdmin) {
      requireRole("ADMIN");
      const subpath = campusAdmin[1] || "";
      if (subpath === "dashboard" && method === "GET") return adminStats(data);
      if (subpath === "facilities" && method === "GET") return data.facilities.map((item) => cleanFacility(item));
      if (subpath === "bookings" && method === "GET") return data.bookings.map((item) => bookingView(data, item));
      if (subpath === "blocks" && method === "GET") return clone(data.blocks.map((block) => ({
        ...block, facilityName: data.facilities.find((item) => item.id === block.facilityId)?.name,
        seatCode: data.facilities.flatMap((item) => item.seats).find((seat) => seat.id === block.seatId)?.code || null
      })));
      if (subpath === "blocks" && method === "POST") {
        const facility = facilityFor(data, body.facilityId);
        if (!body.date || stamp(body.date, body.endTime) <= stamp(body.date, body.startTime)) fail(400, "Choose a valid block time.");
        const block = { id: data.nextBlockId++, facilityId: facility.id, seatId: body.seatId || null,
          date: body.date, startTime: body.startTime, endTime: body.endTime, reason: String(body.reason || "Maintenance") };
        data.blocks.push(block); save(data); return block;
      }
      const blockDelete = subpath.match(/^blocks\/(\d+)$/);
      if (blockDelete && method === "DELETE") {
        data.blocks = data.blocks.filter((item) => item.id !== Number(blockDelete[1])); save(data); return { success: true };
      }
      const settings = subpath.match(/^settings\/([a-z_]+)$/);
      if (settings && method === "PUT") {
        const allowed = ["advance_booking_days", "student_max_daily_bookings", "library_seat_max_minutes"];
        if (!allowed.includes(settings[1])) fail(404, "Unknown booking policy.");
        data.settings[settings[1]] = Number(body.value); save(data); return { success: true };
      }
      const facilityId = subpath.match(/^facilities\/(\d+)$/);
      if (subpath === "facilities" && method === "POST") return setFacility(data, null, body);
      if (facilityId && method === "PUT") return setFacility(data, facilityId[1], body);
      if (facilityId && method === "DELETE") {
        const facility = data.facilities.find((item) => item.id === Number(facilityId[1]));
        if (facility) facility.active = false;
        save(data); return { success: true };
      }
    }

    const bookingMatch = path.match(/^\/api\/(?:campus-)?bookings\/(\d+)(?:\/(cancel|check-in|extend|qr))?$/);
    if (bookingMatch) {
      const current = requireUser();
      const booking = data.bookings.find((item) => item.id === Number(bookingMatch[1]));
      if (!booking) fail(404, "Booking not found.");
      if (booking.userId !== current.id && current.role !== "ADMIN") fail(403, "You cannot manage this booking.");
      const action = bookingMatch[2];
      if (method === "GET" && action === "qr") return { checkInCode: booking.checkInCode };
      if (method === "PUT" && action === "cancel") {
        if (!ACTIVE_BOOKINGS.has(booking.status)) fail(400, "This booking can no longer be cancelled.");
        booking.status = "CANCELLED"; save(data); return { success: true };
      }
      if (method === "PUT" && action === "check-in") {
        const start = stamp(booking.date, booking.startTime);
        if (body.code && body.code !== booking.checkInCode) fail(400, "The check-in code is invalid.");
        if (nowLocal() < start || nowLocal() > new Date(start.getTime() + 15 * 60 * 1000)) fail(400, "Check-in is only available within 15 minutes of the start time.");
        booking.status = "CHECKED_IN"; save(data); return bookingView(data, booking);
      }
      if (method === "PUT" && action === "extend") {
        const newEnd = stamp(booking.date, body.endTime);
        if (newEnd <= stamp(booking.date, booking.endTime)) fail(400, "The new end time must be later.");
        const conflict = data.bookings.some((item) => item.id !== booking.id && ACTIVE_BOOKINGS.has(item.status)
          && item.facilityId === booking.facilityId && (item.seatId == null || booking.seatId == null || item.seatId === booking.seatId)
          && overlaps(stamp(item.date, item.startTime), stamp(item.date, item.endTime), stamp(booking.date, booking.endTime), newEnd));
        if (conflict) fail(409, "That extension overlaps another booking.");
        booking.endTime = body.endTime; save(data); return bookingView(data, booking);
      }
    }
    fail(404, "Demo API endpoint not found.");
  }

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    let body = {};
    if (options.body) {
      try { body = JSON.parse(options.body); } catch { fail(400, "Request body must be valid JSON."); }
    }
    const url = new URL(path, window.location.origin);
    const cleanPath = url.pathname;
    if (cleanPath === "/api/auth/logout" && method === "POST") {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      return { success: true };
    }
    if (cleanPath === "/api/auth/login" && method === "POST") {
      const result = handle(cleanPath, method, body, url);
      localStorage.setItem(TOKEN_KEY, result.token);
      localStorage.setItem(USER_KEY, JSON.stringify(result.user));
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
      return result;
    }
    try {
      return clone(handle(cleanPath, method, body, url));
    } catch (error) {
      throw error;
    }
  }

  window.KarunyaDemo = Object.freeze({ request, storageKey: DATA_KEY });
  load();
  window.setInterval(() => expireBookings(load()), 30_000);
})();
