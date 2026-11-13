# Smart Campus Resource Finder and Booking System

Campus resource finder and booking system with a responsive frontend, a browser-local demo mode, and an optional Java Servlet/JDBC/MySQL backend.

## Run the local demo (no Java, Maven, MySQL, or Tomcat)

1. Open PowerShell in this project folder.
2. Run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start-demo.ps1
   ```

3. Open **http://127.0.0.1:5500/**. `karunya.html` redirects to the same home page.
4. Sign in with any non-empty password and an address ending in `@karunya.edu.in`. Select Student, Faculty, or Admin. Example: `student@karunya.edu.in`.
5. The demo seeds three library floors, seven seminar halls, 17 computer labs, 240 library seats, and 680 lab systems. Bookings and demo account data are stored in this browser's localStorage; they are not sent to a server. Expiry is checked every 30 seconds while the app is open and again when it is next used. Clear this site's browser storage to reset the demo.

This is a local demonstration, not production authentication: selecting Admin in the browser is not secure authorization, and localStorage data is not shared across browsers or devices. Use the Java backend below for deployment.

## Requirements

- JDK 17+
- Maven 3.9+
- MySQL 8.0.16+ (InnoDB; enforces `CHECK` constraints)
- Apache Tomcat 10.1 (Jakarta Servlet 6)

## Database setup

1. Apply `src/main/resources/db/schema.sql` to MySQL. It creates the `smart_campus_db` database, the original Campusly tables, and the additive Karunya facility, seat, booking, block, recurrence, and policy tables.
2. For an existing Campusly database, back it up, run `src/main/resources/db/upgrade_karunya.sql` to extend the role enum, then run `schema.sql` to create the new tables. The upgrade preserves existing rows; it does not drop or recreate the database.
3. Apply `src/main/resources/db/karunya_seed.sql` to provision three library floors, seven seminar halls, 17 computer labs, 240 library seats, and 680 lab systems. Its facility and seat inserts are repeatable.
4. Optionally apply `src/main/resources/db/sample_data.sql` to add the legacy Campusly examples. Its accounts have random, undisclosed passwords and cannot be used to log in. Create real accounts with the secure CLI described below.
3. Use the dashboard and notification queries in `src/main/resources/db/queries.sql` as standalone SQL examples.
4. Create a least-privilege application account (run as a database administrator and replace the example password):

   ```sql
   CREATE USER 'campusly_app'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-long-random-secret';
   GRANT SELECT, INSERT, UPDATE, DELETE ON smart_campus_db.* TO 'campusly_app'@'127.0.0.1';
   ```

6. Configure these environment variables for the Tomcat process; do not put database credentials in source control:

   ```text
   DB_URL=jdbc:mysql://127.0.0.1:3306/smart_campus_db?serverTimezone=UTC
   DB_USER=campusly_app
   DB_PASSWORD=<secret>
   FRONTEND_ORIGIN=http://localhost:5500
   API_ORIGIN=http://localhost:8080
   CAMPUS_TIME_ZONE=Asia/Kolkata
   ```

   Set `FRONTEND_ORIGIN` to the exact origin serving the frontend when it is hosted separately (no trailing slash). Set `API_ORIGIN` to the HTTP(S) API origin for the frontend's Content Security Policy. When the frontend is served by this same WAR, same-origin requests work without a CORS exception. Set `CAMPUS_TIME_ZONE` to the campus's IANA zone; it defaults to UTC.

The Java connection factory reads `DB_URL`, `DB_USER`, and `DB_PASSWORD` and connects with JDBC using the MySQL Connector/J driver packaged by Maven. The schema stores password hashes only. `users.department_id` is a nullable foreign key to `departments`, which normalizes the requested department field.

## Build and deploy

From the project directory:

```powershell
mvn clean test package
```

Copy `target\campusly.war` into Tomcat's `webapps` directory and start Tomcat. The WAR serves the frontend and API under `/campusly`:

- `http://localhost:8080/campusly/`
- Karunya booking home: `http://localhost:8080/campusly/karunya.html`
- Booking map: `http://localhost:8080/campusly/campus-booking.html`
- API base URL: `http://localhost:8080/campusly` (configured in each page's `api-base-url` meta tag)

For backend development, serve this folder from a local HTTP server and configure the API base URL and CORS origin for Tomcat. Do not open backend-connected pages with `file://`.

### Windows startup and login troubleshooting

1. Start the installed MySQL service from Windows Services. Its service name varies by installation; check it with `Get-Service *mysql*`. Apply `src/main/resources/db/schema.sql`, create the configured application user, and make sure `DB_URL`, `DB_USER`, and `DB_PASSWORD` point to that database.
2. Run `mvn clean test package` and copy `target\campusly.war` to Tomcat 10.1's `webapps` folder. This WAR name determines the context path: `/campusly`, not `/campus`.
3. Configure the environment variables above for Tomcat. For a console launch, set them in the same PowerShell window and run `& 'C:\path\to\apache-tomcat-10.1\bin\catalina.bat' run`; for a Tomcat Windows service, configure them in that service's environment and restart it.
4. Open `http://localhost:8080/campusly/login.html` (or `http://localhost:8080/campusly/`). If using Live Server, use its HTTP URL and set `FRONTEND_ORIGIN` to that exact origin. Do not use a `file://` URL.
5. Confirm `http://localhost:8080/campusly/api/facilities?type=LIBRARY` returns facility JSON. A stopped Tomcat causes a network error; a missing DB connection is reported by the API as `503`; a wrong context usually returns `404`. Create real test accounts with `CreateUser` below, then test student, faculty, and admin login with those credentials. Never use sample fixtures for authentication.

## Create the initial admin and student accounts

There is deliberately no public signup endpoint. Create the first admin and student accounts from a terminal with secure password entry. With DB environment variables set:

```powershell
mvn dependency:copy-dependencies -DincludeScope=runtime
java -cp "target\classes;target\dependency\*" edu.campusly.tools.CreateUser
```

Choose `ADMIN` to create the first administrator. Repeat with `STUDENT` and `FACULTY` to provision accounts. Passwords must be at least 12 characters and are stored as PBKDF2-HMAC-SHA256 hashes. The tool does not print or accept passwords as command-line arguments.

## API

All API paths are relative to the WAR context. Authenticated requests use `Authorization: Bearer <token>`; login issues an opaque, random token and only its SHA-256 hash is persisted. Tokens expire after 12 hours and logout revokes the token. API errors use `{ "error": "...", "message": "..." }`.

| Method | Path | Access / behavior |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Public. Body `{ email, password, role }`; returns `{ token, expiresAt, user }`. |
| `POST` | `/api/auth/logout` | Authenticated. Revokes the current token. |
| `GET` | `/api/auth/me` | Authenticated. Returns the current profile. |
| `GET` | `/api/resources` | Public. Optional `search`, `category` (or `type`), and `available=true\|false` filters. Returns an array. |
| `GET` | `/api/resources/{id}` | Public. Returns one resource. |
| `POST` | `/api/resources` | Admin. Creates a resource; returns `201` and the saved record. |
| `PUT` | `/api/resources/{id}` | Admin. Updates a resource. |
| `DELETE` | `/api/resources/{id}` | Admin. Refuses deletion when bookings reference the resource. |
| `POST` | `/api/bookings` | Student. Body `{ resourceId, date, startTime, endTime, purpose }`; creates a pending request and returns `201`. |
| `GET` | `/api/bookings/my` | Student. Returns that student's bookings. |
| `GET` | `/api/bookings/{id}` | Owner or admin. Returns one booking. |
| `PUT` | `/api/bookings/{id}/cancel` | Owner/student. Cancels a future pending or approved booking. |
| `GET` | `/api/admin/bookings` | Admin. Returns requests; optional `status` filter. |
| `PUT` | `/api/admin/bookings/{id}/approve` | Admin. Approves a pending request if no approved booking overlaps. |
| `PUT` | `/api/admin/bookings/{id}/reject` | Admin. Rejects a pending request. |
| `GET` | `/api/admin/dashboard` | Admin. Returns student/resource/booking totals and status counts. |
| `GET` | `/api/admin/students` | Admin. Lists student accounts. |
| `PUT` | `/api/admin/students/{id}` | Admin. Body `{ active: true\|false }`; activates or deactivates the student. |
| `PATCH` | `/api/users/me` | Authenticated. Body `{ name, phone }`; updates the current profile. |
| `GET` | `/api/facilities?type=LIBRARY\|SEMINAR_HALL\|COMPUTER_LAB` | Public. Lists active Karunya facilities. |
| `GET` | `/api/facilities/{id}/availability?date=YYYY-MM-DD&startTime=HH:mm&endTime=HH:mm` | Public. Returns live seat/system states and whole-facility availability for the selected window. |
| `GET` | `/api/facilities/{id}/schedule?from=YYYY-MM-DD` | Public. Returns a seven-day facility schedule without personal booking details. |
| `POST` | `/api/campus-bookings` | Student/faculty. Creates a time-limited seat or facility booking; faculty may submit weekly whole-facility series. |
| `GET` | `/api/campus-bookings/my` | Student/faculty. Lists the user's Karunya bookings and check-in details. |
| `GET` | `/api/campus-bookings/{id}/qr` | Owner/admin. Returns a QR PNG data URL for check-in. |
| `PUT` | `/api/campus-bookings/{id}/cancel` | Owner/admin. Cancels an eligible booking. |
| `PUT` | `/api/campus-bookings/{id}/extend` | Owner. Body `{ endTime }`; extends when there is no conflict. |
| `PUT` | `/api/campus-bookings/{id}/check-in` | Owner. Body `{ code }`; checks in during the 15-minute grace period. |
| `GET` | `/api/notifications` | Authenticated. Lists in-app confirmations and reminders. |
| `PUT` | `/api/notifications/{id}/read` | Owner. Marks a notification as read. |
| `GET` | `/api/admin/campus/dashboard` | Admin. Returns booking analytics, facility count, block count, and policies. |
| `GET` | `/api/admin/campus/bookings` | Admin. Lists all Karunya bookings. |
| `GET` | `/api/admin/campus/facilities` | Admin. Lists active and inactive facilities. |
| `POST` / `PUT` / `DELETE` | `/api/admin/campus/facilities[/{id}]` | Admin. Adds, edits, or deactivates a facility. New library/lab facilities receive generated seat/system records. |
| `GET` / `POST` | `/api/admin/campus/blocks` | Admin. Lists blocks or creates a maintenance/event block for a facility or seat. |
| `DELETE` | `/api/admin/campus/blocks/{id}` | Admin. Removes a block. |
| `GET` | `/api/admin/campus/settings` | Admin. Reads bounded booking policy settings. |
| `PUT` | `/api/admin/campus/settings/{key}` | Admin. Updates a bounded booking policy; body `{ value }`. |

Resource JSON uses `{ id, name, type, location, capacity, description, imageUrl, available }`. Supported `type` values are `Classroom`, `Computer laboratory`, `Seminar hall`, `Library room`, `Sports facility`, `Projector`, and `Auditorium`. Booking statuses are `PENDING`, `APPROVED`, `REJECTED`, and `CANCELLED`.

## Implementation and security notes

- Servlet routes are separate by feature; JDBC access is in DAO classes and uses `PreparedStatement`.
- Booking creation locks the resource row and checks approved-booking interval overlap inside a transaction. Pending requests do not reserve a resource; approval rechecks conflicts against approved bookings while holding the same resource lock.
- Passwords use PBKDF2-HMAC-SHA256 with a per-password random salt. Invalid login responses do not disclose whether an email exists.
- Booking end times must be later than start times in both the API validation and a database `CHECK` constraint. The API also rejects past booking start times using the configured campus time zone.
- Dashboard statistics, booking-history and notification queries are in `src/main/resources/db/queries.sql`. Notifications are stored per user and indexed by user, status, and creation time.
- The API accepts a configured frontend origin and same-origin requests only. Use HTTPS in deployment; do not expose bearer tokens or database credentials in logs or source.
- The app sends a restrictive Content Security Policy and standard browser security headers. Configure Tomcat's proxy scheme correctly when TLS terminates upstream so secure-request headers are applied.
- Resource availability is enforced by the API, not only by frontend validation. Database errors and invalid/conflicting requests return explicit JSON errors.
- The Karunya pages are `index.html`, `campus-booking.html`, `karunya-dashboard.html`, `faculty.html`, and `karunya-admin.html`; `karunya.html` redirects to `index.html`. The standalone demo adapter in `demo.js` uses localStorage and does not contact the Java API. The Java backend's booking writes serialize on the facility row and recheck both bookings and maintenance blocks in a transaction; availability is calculated from exact time-range overlap.
- A Tomcat lifecycle job runs each minute to complete checked-in reservations, release no-shows after the configured grace period, and create in-app reminders. Booking confirmations and reminders appear in `/api/notifications`. Email delivery is not configured; add an institution-approved mail provider before treating email as enabled.
- QR codes are generated server-side and can be retrieved by the booking owner or an administrator. The check-in code is validated by the server; a QR image alone does not grant authorization.
- Password reset email delivery is not configured; the login page directs users to their campus administrator instead of pretending a reset succeeded.

The footer currently uses `campus-support@example.edu`; replace it with the institution's support address before deployment.
