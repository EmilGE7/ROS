# RescueOS Deployment Guide & Bootable USB Setup

RescueOS is engineered to deploy rapidly in the field under zero-infrastructure conditions.

---

## 1. Local Wi-Fi Hotspot Setup (5-Minute Quickstart)

RescueOS turns any standard consumer laptop into an offline emergency coordination base station.

```
Laptop Running RescueOS
      ↓
Built-in Wi-Fi Hotspot (SSID: RESCUEOS-EMERGENCY)
      ↓
Smartphones / Tablets Connecting over Local Wi-Fi
      ↓
Browser Opens: http://<LAPTOP_IP>:8080
```

### 1.1 Windows Host Hotspot
1. Turn on **Mobile Hotspot** in Windows Settings:
   - SSID: `RESCUEOS-EMERGENCY`
   - Network Band: Any (2.4 GHz recommended for long range through masonry)
2. Open terminal in RescueOS directory and run:
   ```cmd
   scripts\rescueos.bat start
   ```
3. The console prints your local IPv4 address (e.g. `http://192.168.137.1:8080`).
4. Survivors and field volunteers connect to `RESCUEOS-EMERGENCY` on their phones and navigate to the displayed IP in any browser.

### 1.2 Linux Host Hotspot (NetworkManager)
1. Create and activate an ad-hoc Wi-Fi Access Point:
   ```bash
   nmcli dev wifi hotspot ifname wlan0 ssid RESCUEOS-EMERGENCY password "rescueos2026"
   ```
2. Start RescueOS:
   ```bash
   ./scripts/rescueos.sh start
   ```

---

## 2. Bootable Live USB Creation (Step 25)

You can install RescueOS onto a bootable live Linux USB drive (Ubuntu/Debian Live or Alpine Linux) for instant field triage.

### 2.1 Hardware Compatibility
- **BIOS / UEFI:** Compatible with legacy BIOS and modern UEFI (x86_64).
- **Secure Boot:** Supported on Ubuntu/Debian Live bases signed by Microsoft Third-Party UEFI CA.
- **Wi-Fi Drivers:** Standard Intel, Realtek, Qualcomm Atheros, and Broadcom drivers are included in mainstream Linux kernel distros.

### 2.2 Live USB Setup Steps
1. **Download Live Linux ISO:**
   - Ubuntu Desktop 24.04 LTS or Debian 12 Live ISO.
2. **Flash to USB Drive:**
   - Use an open-source tool like Rufus, Ventoy, or `dd`:
     ```bash
     sudo dd if=ubuntu-24.04-desktop-amd64.iso of=/dev/sdX bs=4M status=progress oflag=sync
     ```
3. **Configure Persistent Storage & Auto-Start:**
   - Copy the `RescueOS/` directory into `/opt/rescueos` on the persistence partition.
   - Install Node.js 18+ (Node 22+ recommended for built-in SQLite).

### 2.3 Systemd Auto-Start Service Unit

Create `/etc/systemd/system/rescueos.service`:

```ini
[Unit]
Description=RescueOS Emergency Station Engine
After=network.target network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/rescueos/backend
ExecStart=/usr/bin/node /opt/rescueos/backend/server.js
Restart=always
RestartSec=3
Environment=PORT=8080
Environment=STATION_ID=STATION-ALPHA

[Install]
WantedBy=multi-user.target
```

Enable the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable rescueos.service
```

---

## 3. Captive Portal Configuration (Optional Field Optimization)

To make connected phones automatically pop up the RescueOS portal without typing an IP address:

### Using `dnsmasq`
Install `dnsmasq` on the Linux host and add this wildcard rule to redirect all DNS queries to the host laptop:
```conf
# /etc/dnsmasq.d/captive.conf
address=/#/192.168.4.1
interface=wlan0
dhcp-range=192.168.4.10,192.168.4.250,255.255.255.0,12h
```
When civilian phones connect to `RESCUEOS-EMERGENCY`, their operating system's captive portal detector will automatically open RescueOS!

---

## 4. Disaster Resilience Checklist

- [ ] Laptop battery charged + 12V car battery inverter available.
- [ ] Wi-Fi hotspot password configured or open for emergency public access.
- [ ] USB flash drives formatted for multi-station synchronization packages.
- [ ] Pre-printed laminated QR ID cards for triage identification.
