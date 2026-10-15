# RescueOS REST & Real-Time API Reference

RescueOS exposes a lightweight, zero-dependency REST & SSE API over HTTP port 8080.

---

## 1. Authentication & Security Headers

Authenticated requests must include the Bearer session token:
```http
Authorization: Bearer <token>
```
Or via standard cookie: `rescueos_session=<token>`.

### Error Responses
All errors return standard JSON:
```json
{
  "error": "Descriptive error message"
}
```

---

## 2. API Endpoints

### 2.1 Real-Time Server-Sent Events (SSE)
- **`GET /events`**
  - **Description:** Real-time push stream. Clients receive initial full state upon connection, followed by event updates.
  - **Content-Type:** `text/event-stream`
  - **Keepalive:** Pings sent every 25 seconds.
  - **Event Types:** `sos_created`, `sos_updated`, `sos_assigned`, `shelter_updated`, `resource_updated`, `announcement`, `incident_created`, `incident_updated`, `missing_updated`, `medical_updated`, `message_created`, `simulation_event`, `audit`, `state`.

### 2.2 System State
- **`GET /api/state`**
  - **Description:** Returns entire system state snapshot, including stats, SOS list, volunteers, shelters, resources, incidents, missing persons, and simulation status.

---

### 2.3 Authentication & Users
- **`POST /api/auth/register`**
  - **Body:** `{ "username": "...", "password": "...", "full_name": "...", "role": "CITIZEN|VOLUNTEER|MEDICAL|COORDINATOR|ADMIN", "phone": "..." }`
  - **Returns:** `{ "user": { ... }, "token": "...", "expiresAt": 1727... }` (Status 201)
- **`POST /api/auth/login`**
  - **Body:** `{ "username": "...", "password": "..." }`
  - **Rate Limit:** 5 failed attempts per 60s per IP (HTTP 429).
  - **Returns:** `{ "user": { ... }, "token": "...", "expiresAt": 1727... }` (Status 200)
- **`POST /api/auth/logout`**
  - **Description:** Destroys current session token.
- **`GET /api/auth/me`**
  - **Description:** Returns authenticated profile and permissions.
- **`GET /api/users`**
  - **Role:** Requires `ADMIN` or `COORDINATOR`.
  - **Returns:** List of registered users.

---

### 2.4 Emergency SOS Engine
- **`GET /api/sos`**
  - **Query Params:** `status`, `priority`, `type`, `is_simulation`.
  - **Returns:** Array of matching SOS requests.
- **`POST /api/sos`**
  - **Description:** Creates an emergency SOS. Can be submitted anonymously by citizens or authenticated users.
  - **Body:**
    ```json
    {
      "name": "Ramesh Kumar",
      "emergency": "Flood water entering ground floor",
      "emergency_type": "FLOOD",
      "people": 4,
      "priority": "CRITICAL",
      "location": "Plot 14, Riverside Colony, Sector B",
      "lat": 12.9642,
      "lng": 77.5873
    }
    ```
  - **Returns:** Created SOS record with `rescue_id` (`RSC-XXXXXXXX`). Status 201.
- **`POST /api/sos/:id/assign`**
  - **Role:** Requires `COORDINATOR` or `ADMIN`.
  - **Body:** `{ "volunteer": "Rescue Team 01 (Swiftwater)", "instructions": "..." }`
- **`POST /api/sos/:id/status`**
  - **Body:** `{ "status": "IN_PROGRESS|RESOLVED|CANCELLED", "notes": "...", "resolution": "..." }`
- **`GET /api/qr/:rescueId`**
  - **Description:** Resolves a Rescue ID to an SVG QR badge and verified record. Non-sensitive summary for civilians; full details for authorized staff.

---

### 2.5 Shelter Management
- **`GET /api/shelters`**
  - **Returns:** List of evacuation shelters with calculated occupancy %.
- **`POST /api/shelters`**
  - **Role:** Requires `COORDINATOR` or `ADMIN`.
  - **Body:** `{ "name": "...", "capacity": 200, "location": "...", "water": 500, "food": 300 }`
- **`PATCH /api/shelters/:id`**
  - **Body:** `{ "occupancy": 80, "water": 450, "food": 250, "status": "OPEN|FULL" }`
- **`POST /api/shelters/:id/checkin`**
  - **Body:** `{ "count": 1 }`
- **`POST /api/shelters/:id/checkout`**
  - **Body:** `{ "count": 1 }`

---

### 2.6 Resource Logistics
- **`GET /api/resources`**
  - **Returns:** Resource inventory with stock status (`NORMAL`, `LOW_STOCK`, `CRITICAL`, `OUT_OF_STOCK`).
- **`POST /api/resources`**
  - **Role:** Requires `COORDINATOR` or `ADMIN`.
  - **Body:** `{ "name": "...", "category": "Water", "quantity": 500, "unit": "Liters", "minimum_threshold": 100 }`
- **`POST /api/resources/:id/transaction`**
  - **Body:** `{ "type": "INCOMING|OUTGOING|TRANSFER", "quantity": 50, "source_or_destination": "Truck 4", "notes": "..." }`

---

### 2.7 Emergency Announcements
- **`GET /api/announcements`**
  - **Returns:** Recent official broadcasts.
- **`POST /api/announcements`**
  - **Role:** Restricted to `COORDINATOR` and `ADMIN`.
  - **Body:** `{ "title": "...", "message": "...", "priority": "CRITICAL|HIGH|NORMAL|INFO" }`

---

### 2.8 Field Incidents & Roadblocks
- **`GET /api/incidents`**
  - **Returns:** List of reported hazard incidents.
- **`POST /api/incidents`**
  - **Body:** `{ "title": "...", "incident_type": "ROAD_BLOCK|FLOOD|FIRE|LANDSLIDE...", "severity": "CRITICAL|HIGH", "location": "..." }`
- **`PATCH /api/incidents/:id/status`**
  - **Body:** `{ "status": "REPORTED|VERIFIED|RESPONDING|RESOLVED" }`

---

### 2.9 Missing Persons Registry
- **`GET /api/missing`**
  - **Query Param:** `?q=search_term`
- **`POST /api/missing`**
  - **Body:** `{ "full_name": "...", "age": 9, "gender": "MALE", "last_seen_location": "...", "identifying_features": "..." }`
- **`PATCH /api/missing/:id/status`**
  - **Body:** `{ "status": "MISSING|FOUND|IDENTIFIED|REUNITED", "notes": "..." }`

---

### 2.10 Medical Coordination
- **`GET /api/medical`**
  - **Returns:** Clinical triage cases sorted by severity.
- **`POST /api/medical`**
  - **Body:** `{ "patient_name": "...", "triage_priority": "RED_IMMEDIATE|YELLOW_DELAYED|GREEN_MINOR|BLACK_EXPECTANT", "symptoms": "...", "vitals_summary": "..." }`
- **`PATCH /api/medical/:id`**
  - **Body:** `{ "triage_status": "WAITING|TRIAGED|TREATMENT|STABILIZED|REFERRED|RESOLVED" }`

---

### 2.11 Inter-Agency Local Chat
- **`GET /api/chat/:channel`**
  - **Channels:** `GENERAL`, `COMMAND`, `VOLUNTEERS`, `MEDICAL`.
- **`POST /api/chat/:channel`**
  - **Body:** `{ "message": "..." }`

---

### 2.12 Disaster Simulation
- **`GET /api/simulation`**
  - **Returns:** Status (`IDLE`, `RUNNING`, `PAUSED`, `ENDED`), scenario, and progress.
- **`POST /api/simulation/start`**
  - **Body:** `{ "scenario": "FLOOD|EARTHQUAKE|LANDSLIDE|CYCLONE|FIRE", "speedMs": 7000 }`
- **`POST /api/simulation/pause`**
- **`POST /api/simulation/resume`**
- **`POST /api/simulation/reset`**
- **`POST /api/simulation/end`**

---

### 2.13 Multi-Station & USB Sync
- **`GET /api/sync/export`**
  - **Returns:** Tamper-evident Disaster Package JSON with SHA-256 checksum.
- **`POST /api/sync/import`**
  - **Body:** Disaster Package JSON.
  - **Returns:** Summary of merged, updated, and deduplicated records.

---

### 2.14 Hardware & Networking
- **`GET /api/network`**
  - **Returns:** Local LAN IP addresses, port, station ID, and active client count.
- **`GET /api/lora`**
  - **Returns:** Pluggable LoRa adapter status (`FUTURE_EXTENSION_UNPLUGGED`).
- **`POST /api/demo/reset`**
  - **Returns:** Resets database to default competition dataset.
