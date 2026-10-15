# 🚨 RescueOS

### Portable Offline Disaster Communication & Coordination Operating System
> **“Boot. Connect. Rescue.”**

[![Zero Cost](https://img.shields.io/badge/Cost-%E2%82%B90%20%2F%20%240-brightgreen)](#zero-cost-architecture)
[![Offline First](https://img.shields.io/badge/Network-100%25%20Offline%20First-blue)](#offline-first-philosophy)
[![No Cloud / No AI](https://img.shields.io/badge/Cloud%20Dependency-None-success)](#zero-cost-architecture)
[![Test Suite](https://img.shields.io/badge/Tests-20%2F20%20Passing-emerald)](#automated-testing)

---

## 1. Problem Statement

During extreme disasters (cyclones, catastrophic floods, earthquakes, landslides):
- **Cellular towers fail** due to physical destruction or power grid collapse.
- **Internet fiber backbones sever**, rendering cloud platforms, messaging apps, and web services inoperable.
- **Victims and volunteer responders are isolated**, unable to report trapped survivors, triage injuries, or allocate scarce drinking water and medical resources.
- **Commercial emergency hardware** (satellite phones, dedicated LoRa devices) is expensive, proprietary, and unavailable to ordinary civilians and local rescue teams.

---

## 2. The Solution: RescueOS

**RescueOS** turns any standard consumer laptop into an immediate local emergency coordination base station:
1. **Boot:** The laptop starts RescueOS (via Node.js or a Live Linux USB).
2. **Connect:** The operator may start a Wi-Fi hotspot with the Debian Live `rescueos-network hotspot` terminal helper. Availability depends on the adapter and NetworkManager.
3. **Rescue:** Survivors and responders connect with standard smartphone browsers. No app store installation, no internet, and zero cellular signal required.

---

## 3. Core Capabilities & Feature Matrix

| Module | Features & Capabilities |
| :--- | :--- |
| **Emergency SOS Engine** | Real-time distress intake, automatic priority scoring (`CRITICAL`, `HIGH`, `MEDIUM`), category tags (`FLOOD`, `TRAPPED`, `FIRE`, `MEDICAL`, `FOOD_WATER`), and dispatch state machine (`NEW` → `ASSIGNED` → `IN_PROGRESS` → `RESOLVED`). |
| **Command Center Dashboard** | Live operational metrics computed from local SQLite (Active SOS, Critical count, shelter occupancy %, low stock alerts, missing count), incident feed, and real-time dispatch queue. |
| **Role-Based Access Control** | Authenticated tiers (`CITIZEN`, `VOLUNTEER`, `MEDICAL`, `COORDINATOR`, `ADMIN`) with salted `scrypt` password hashing, token sessions, and brute-force rate limiting. |
| **Volunteer Field Ops** | Dedicated mobile interface for rescue teams: task assignment notifications, accept & deploy, field note updates, and resolution logging. |
| **Medical Coordination** | Field triage intake with standardized color prioritization (`RED_IMMEDIATE`, `YELLOW_DELAYED`, `GREEN_MINOR`, `BLACK_EXPECTANT`), patient vitals tracking, and medical supply requests. |
| **Shelter Management** | Evacuation center capacities, real-time occupancy calculations, automated `LOW CAPACITY` (>85%) and `FULL` triggers, and supply balances. |
| **Resource Logistics** | Inventory tracking for Potable Water, Rations, Trauma Kits, Blankets, and Generator Fuel with automated threshold alerts and transaction audit logging (`INCOMING`, `OUTGOING`, `TRANSFER`). |
| **Hazard & Roadblock Reports** | Locally stored incident reports with status, severity, and operational timeline. The GIS map was removed from this build. |
| **SQLite Inspection** | Administrator-only, read-only table/schema browsing with pagination and sensitive credential column redaction. |
| **Missing Persons Registry** | Searchable family reunification registry with photo descriptions, last seen locations, and lifecycle workflow (`MISSING` → `FOUND` → `IDENTIFIED` → `REUNITED`). |
| **QR Rescue Identity** | Cryptographically random `RSC-XXXXXXXX` identifiers, printable emergency badges, and offline QR verification cards. |
| **Local Inter-Agency Chat** | Peer-to-peer radio channels (`#GENERAL`, `#COMMAND`, `#VOLUNTEERS`, `#MEDICAL`) operating over local Wi-Fi. |
| **Disaster Simulation Engine** | Core training engine with pre-scripted multi-phase scenarios (`FLOOD`, `EARTHQUAKE`, `LANDSLIDE`, `CYCLONE`, `FIRE`) generating realistic simulated casualties and resource pressure without corrupting real data. |
| **Multi-Station USB Sync** | Decentralized sync package export/import with SHA-256 tamper-evident checksums and idempotent merge resolution. |
| **Pluggable LoRa Transport** | Architecture interface with binary packet framing (`RescueOS-LoRa-Frame-v1`) for future hardware bridges. |

---

## 4. Zero-Cost Architecture

- **₹0 / $0 Cost:** Runs on laptops and phones already owned by responders and civilians.
- **Allowed Tech:** Node.js, built-in `node:sqlite`, and vanilla HTML/CSS/JavaScript with locally bundled assets.
- **Forbidden & Eliminated:** Zero paid cloud (AWS/GCP/Firebase), zero external CDNs, zero proprietary SDKs, and zero AI/LLMs.

---

## 5. Quickstart & Local Setup

### System Requirements
- Node.js 18+ (Node 22+ recommended for built-in `node:sqlite`).
- Any modern web browser on laptop or phone (Chrome, Safari, Firefox, Edge).

### Running RescueOS
```bash
# 1. Clone or extract repository
cd RescueOS/backend

# 2. Run automated test suite
npm test

# 3. Start RescueOS emergency station
npm start
```

Open your browser to:
```
http://localhost:8080
```

### Command-Line Management (Daemon Mode)
- **Linux:** `./scripts/rescueos.sh {start|stop|restart|status|logs|test}`
- **Windows:** `scripts\rescueos.bat {start|stop|restart|status|test}`

---

## 6. Local Wi-Fi Network Access (Connecting Phones)

1. Enable **Mobile Hotspot** on the laptop:
   - SSID: `RESCUEOS-EMERGENCY`
2. Start RescueOS. The terminal prints your detected LAN IP:
   ```
   🚨 RESCUEOS — DISASTER RESPONSE COORDINATION SYSTEM
   📡 Local Wi-Fi / LAN: http://192.168.1.3:8080
   ```
3. Connect phones to `RESCUEOS-EMERGENCY`.
4. On phone browsers, open: `http://<LAPTOP_IP>:8080`.

---

## 7. Demo Accounts & Credentials

The database comes pre-seeded with realistic disaster operational records.

| Username | Password | Role | Responsibilities |
| :--- | :--- | :--- | :--- |
| `admin` | `rescueos2026` | `ADMIN` | Operations Director (Full system control, simulation, user management) |
| `coordinator` | `rescueos2026` | `COORDINATOR` | Dispatch Lead (Task assignments, shelter/resource updates, broadcasts) |
| `doctor1` | `rescueos2026` | `MEDICAL` | Field Triage Lead (Clinical intakes, patient status, supply requests) |
| `volunteer1` | `rescueos2026` | `VOLUNTEER` | Swiftwater Rescue Team (Field task acceptance, rescue completion) |
| `volunteer2` | `rescueos2026` | `VOLUNTEER` | Urban Search & Rescue (Supply delivery, evacuations) |
| `citizen1` | `rescueos2026` | `CITIZEN` | Resident / Victim (Distress SOS submission, missing person reports) |

*1-Click Role Switcher is available in the bottom-right of the login modal for competition judges.*

---

## 8. Automated Testing

RescueOS includes an end-to-end automated integration test suite verifying all 20 core workflows:
```bash
npm test
```
**Test Coverage:**
- Initial disaster state loading
- Credential hashing & rate-limiting
- RBAC permission enforcement
- Full SOS lifecycle: Creation → Assignment → Field In-Progress → Resolution
- QR ID generation & verification
- Shelter check-in / check-out & capacity calculations
- Resource inventory transactions & auto-stock status
- Incident reporting & verification
- Missing person registration & search
- Medical triage coordination
- Local mesh radio chat
- Disaster simulation engine (Start, Pause, Reset)
- Multi-station disaster package export/import with SHA-256 checksums
- Dynamic network detection & honest LoRa adapter status

---

## 9. Documentation Index

- [**DEMO.md**](DEMO.md) — 7-minute competition demonstration script for judges.
- [**ARCHITECTURE.md**](ARCHITECTURE.md) — System architecture, SOS state machine, and sync protocols.
- [**SECURITY.md**](SECURITY.md) — Threat model, security controls, and vulnerability disclosures.
- [**DEPLOYMENT.md**](DEPLOYMENT.md) — Bootable Linux Live USB creation and systemd service setup.
- [**API.md**](API.md) — Complete REST & Server-Sent Events API specifications.
- [**DATABASE.md**](DATABASE.md) — SQLite schema, indexes, constraints, and maintenance queries.

---

## 10. Known Limitations & Future Roadmap

### Known Limitations
- **Wi-Fi Range:** Dependent on host laptop antenna (typically 50–100m outdoors; extendable using standard directional antennas).
- **Physical Security:** Direct keyboard access to host laptop permits file inspection; host should use full-disk encryption.

### Future Extensions
- **Physical LoRa Mesh Adapter:** Connect hardware SX1262 USB bridges to extend distress packet relay over 5–15 km using the included `lora_adapter.js` packet framing architecture.
- **Captive Portal Micro-DNS:** Automated phone redirection upon Wi-Fi association without typing manual IP addresses.

---

**RescueOS — Boot. Connect. Rescue.**
