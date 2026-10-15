# RescueOS Competition Demonstration Walkthrough

**Tagline:** “Boot. Connect. Rescue.”  
**Target Duration:** 7 – 10 Minutes  
**Prerequisites:** 1 Laptop (RescueOS Station Host) + 1 or 2 Phones (Citizen / Volunteer clients).

---

## The Pitch in 30 Seconds

> “When catastrophic floods, earthquakes, or storms strike, the cellular towers collapse and the internet goes dark. 
> 
> RescueOS is a ₹0 / $0 additional cost operating system that turns any ordinary laptop into a localized disaster response coordination station. It operates 100% offline over built-in Wi-Fi with zero cloud, zero external CDNs, zero AI, and zero paid APIs.”

---

## Step-by-Step Live Demo Script

### 1. Boot & Host Station Start
1. In terminal, start RescueOS:
   ```bash
   cd backend
   npm start
   ```
2. Note the console output showing local IP address (e.g. `http://192.168.1.3:8080`).
3. Open `http://localhost:8080` on laptop.
4. **Show Judges:** The Command Center dashboard with live operational stats, incident feeds, and GIS vector map. Note that every single metric is computed live from the local SQLite database.

### 2. Connect Secondary Device & Prove Offline Operation
1. Connect a smartphone to the same local Wi-Fi / hotspot.
2. Open the phone's browser and navigate to `http://<LAPTOP_IP>:8080`.
3. **MANDATORY PROOF:** Turn off the Wi-Fi router's upstream internet cable or turn laptop Wi-Fi uplink off.
4. **Show Judges:** Notice the green `● LOCAL ONLINE` indicator is pulsating. The application runs seamlessly with internet completely disconnected!

### 3. Citizen Distress Signal (Mobile View)
1. On the phone, click **＋ SEND SOS** (or open the **Citizen SOS** tab).
2. Enter:
   - Name: `Ramesh Kumar`
   - Emergency Category: `FLOOD`
   - Description: `Flood water reached 4 feet. Elderly grandmother and 2 kids stranded on roof.`
   - Location: `Plot 14, Riverside Colony, Sector B`
   - Priority: `CRITICAL`
   - People Affected: `4`
3. Click **SEND EMERGENCY SOS NOW**.
4. The phone immediately generates a secure **Rescue ID Card** with a unique identifier (`RSC-XXXXXXXX`) and high-contrast verification QR code.

### 4. Real-Time Coordinator Dispatch (Laptop View)
1. Turn to the laptop Command Center screen.
2. **Without refreshing the page**, the new CRITICAL SOS appears in the live feed with a red highlight and audio alert!
3. Select `Rescue Team 01 (Swiftwater)` from the volunteer assignment dropdown.
4. Click **Dispatch Team**.
5. The status instantly transitions to `ASSIGNED`.

### 5. Volunteer Field Workflow (Second Mobile Device or Volunteer Tab)
1. Open the **Volunteer Ops** tab.
2. The newly assigned rescue appears in the volunteer's active queue.
3. Click **Accept & En Route** → Status updates to `IN_PROGRESS`.
4. Click **Add Field Notes** → Record: `Boat deployed on North Canal approach`.
5. Click **Complete Rescue (Resolve)** → Enter resolution: `All 4 family members extracted safely to Central Shelter`.
6. Status becomes `RESOLVED`.

### 6. Shelter & Resource Logistics
1. Switch to the **Shelters** tab:
   - Click **+1 Check-in** on `Riverside Community Hall`.
   - Watch the occupancy percentage bar increase dynamically.
   - When occupancy exceeds capacity, a `FULL` warning badge triggers automatically.
2. Switch to the **Resources** tab:
   - Note the real-time stock status badges (`LOW_STOCK`, `CRITICAL`).
   - Click **Record Stock Movement** → Record an `INCOMING` shipment of 50L potable water.

### 7. Emergency Broadcast System (Step 16)
1. In the Command Center sidebar, write an official broadcast:
   - Title: `MANDATORY EVACUATION: SECTOR B`
   - Priority: `CRITICAL`
2. Click **Broadcast Now**.
3. All connected screens instantly display the flashing top emergency banner!

### 8. Disaster Simulation Mode (Core Competition Feature)
1. Open the **⚡ Simulation** tab.
2. Select **Run Flood Surge Scenario**.
3. Point out the glowing warning banner: `⚠️ [SIMULATION MODE ACTIVE]`.
4. Watch as the simulation engine realistically steps through disaster phases:
   - River embankment failure reported
   - Secondary roadblocks triggered
   - Medical triage cases created
   - Shelter water resources depleted
5. Point out to judges: *Every simulated record is flagged `is_simulation = 1` and never corrupts real operational records.*
6. Click **Reset Simulation** to clear the training data.

### 9. Multi-Station USB Synchronization (Step 27)
1. Open the **🛡️ Station Sync & USB** tab.
2. Click **Export Signed Disaster Package**.
3. A verified JSON package is downloaded with an embedded SHA-256 integrity checksum.
4. Explain to judges:
   > “If another RescueOS station is running 5 miles away across a flooded river, a runner with a physical USB flash drive can carry this package, upload it on Station B, and the systems merge idempotently without conflict.”

### 10. The Finale
Point to the status bar and summarize:
> “Internet unavailable. Cloud unavailable. Cellular dead. RescueOS continues operating.”
