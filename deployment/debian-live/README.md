# RescueOS — Bootable Debian Live ISO

> **"Boot. Connect. Rescue."**
>
> A portable, fully offline emergency coordination OS that boots straight into the
> RescueOS application, with no visible desktop, no browser controls, and no
> internet dependency after the ISO is built.

---

## Contents

- [What this is](#what-this-is)
- [Requirements](#requirements)
- [Build on Linux / WSL2](#build-on-linux--wsl2)
- [Test in a VM](#test-in-a-vm)
- [USB deployment](#usb-deployment)
- [Verified offline features](#verified-offline-features)
- [Runtime commands](#runtime-commands)
- [Demo credentials](#demo-credentials)
- [Architecture decisions](#architecture-decisions)
- [Known limitations](#known-limitations)

---

## What this is

RescueOS is a **Debian 13 (Trixie)** Live image that:

- Boots directly into Chromium kiosk showing the RescueOS application at `http://127.0.0.1:8080`
- Hides the desktop, panels, browser address bar, and browser controls entirely
- Runs a Node.js 22 backend with a SQLite database locally (in `/var/lib/rescueos`)
- Supports multi-device access over local Wi-Fi (other phones/laptops connect to the hotspot)
- Works completely offline after the ISO is built — no cloud, no APIs, no internet required

---

## Requirements

### Build host

| Requirement | Detail |
|-------------|--------|
| OS | Debian 12/13 or Ubuntu 22.04+ (amd64) |
| WSL2 | Debian or Ubuntu WSL2 (**can build** but cannot do hardware/hotspot testing) |
| RAM | 4 GB minimum, 8 GB recommended |
| Disk | ~25 GB free space during build |
| Network | Internet access **during build only** |
| Tools | `live-build`, `debootstrap`, `squashfs-tools`, `xorriso`, `curl`, `rsync`, `git` |

Install all tools at once:

```bash
sudo apt update
sudo apt install -y live-build debootstrap squashfs-tools xorriso curl rsync git
```

---

## Build on Linux / WSL2

```bash
# Clone or open the project
cd /path/to/ROS-master

# Run the build (must be root)
cd deployment/debian-live
sudo ./build-rescueos-iso.sh
```

The script will:
1. Sync the latest backend/frontend source into `config/includes.chroot/opt/rescueos/`
2. Download Node.js 22.14.0 from nodejs.org and verify its SHA-256 checksum
3. Validate `server.js` syntax with the pinned Node binary
4. Run `lb clean --purge`, `lb config`, `lb build`
5. Report the ISO path and exact QEMU test commands

**Build time**: ~20–40 minutes depending on download speed and machine speed.

**Output**: A file named like `live-image-amd64.hybrid.iso` in `deployment/debian-live/`.

Rename it for clarity:
```bash
mv live-image-amd64.hybrid.iso rescueos-amd64.iso
```

---

## Test in a VM

### BIOS boot (fastest test)

```bash
qemu-system-x86_64 \
  -m 2048 \
  -cdrom rescueos-amd64.iso \
  -boot d \
  -vga std
```

### UEFI boot

```bash
sudo apt install -y ovmf

qemu-system-x86_64 \
  -m 2048 \
  -bios /usr/share/ovmf/OVMF.fd \
  -cdrom rescueos-amd64.iso \
  -boot d \
  -vga std
```

### Test checklist (run in the VM)

| Test | Command / Action |
|------|-----------------|
| Boot completes, kiosk loads | Observe screen after ~60s |
| Backend service running | `sudo systemctl status rescueos` |
| Health endpoint responds | `curl http://127.0.0.1:8080/api/health` |
| DB writes persist in session | Submit an SOS, restart service, check data |
| Logs | `sudo journalctl -u rescueos -f` |
| Network status | `sudo rescueos-network status` |

### Test offline operation

1. Start the VM
2. Disconnect internet on the **host** machine (or block in QEMU networking)
3. Verify the application loads fully, SOS/shelter operations work
4. Confirm incident reports and operational records remain available offline

---

## USB deployment

> ⚠️ **WARNING**: flashing to USB overwrites all data on that device.

On Linux:

```bash
# Find your USB device (replace /dev/sdX with your actual device)
lsblk
sudo dd if=rescueos-amd64.iso of=/dev/sdX bs=4M status=progress oflag=sync
```

On Windows (use Rufus or balenaEtcher):
- Open Rufus / balenaEtcher
- Select `rescueos-amd64.iso`
- Select your USB drive
- Write in DD image mode

Boot the target machine from USB (F12 / F2 / DEL for boot menu).

---

## Verified offline features

| Feature | Offline | Notes |
|---------|---------|-------|
| SOS request CRUD | ✅ | SQLite, fully local |
| SOS assignment & status | ✅ | SQLite |
| Shelter management | ✅ | SQLite |
| Shelter check-in/check-out | ✅ | SQLite |
| Resource inventory & transactions | ✅ | SQLite |
| Medical triage cases | ✅ | SQLite |
| Missing persons registry | ✅ | SQLite |
| Incident reporting | ✅ | SQLite |
| Emergency announcements | ✅ | SQLite |
| Inter-agency chat | ✅ | SQLite + SSE |
| Real-time SSE updates | ✅ | HTTP SSE, local |
| Authentication & RBAC | ✅ | scrypt hash, SQLite sessions |
| QR rescue ID generation | ✅ | SVG generated server-side |
| Disaster simulation engine | ✅ | All local |
| Multi-station sync (USB) | ✅ | JSON export/import |
| SQLite inspection | ✅ | Admin-only read-only table/schema browser |
| Network diagnostics | ✅ | Interface, route, DNS, and external checks; external checks require connectivity |
| Wi-Fi hotspot | ⚠️ | Hardware-dependent; not all adapters support AP mode |
| LoRa transport | ❌ | Stub only — no hardware in this build |

---

## Runtime commands (on RescueOS)

Open a terminal on the running system (press Ctrl+Alt+T or use xterm):

```bash
# Service management
sudo systemctl status rescueos
sudo systemctl restart rescueos
sudo systemctl stop rescueos

# Live logs
sudo journalctl -u rescueos -f

# Network status and access URLs
sudo rescueos-network status

# Start Wi-Fi hotspot (asks for interface and password)
sudo rescueos-network hotspot

# Stop hotspot
sudo rescueos-network stop

# Shutdown and reboot
sudo shutdown -h now
sudo reboot
```

---

## Demo credentials

The database seeds with these accounts on first boot (password applies to all):

| Username | Role | Password |
|----------|------|----------|
| `admin` | Admin | `rescueos2026` |
| `coordinator` | Coordinator | `rescueos2026` |
| `doctor1` | Medical | `rescueos2026` |
| `volunteer1` | Volunteer | `rescueos2026` |
| `volunteer2` | Volunteer | `rescueos2026` |
| `citizen1` | Citizen | `rescueos2026` |

> **Security**: These are demo credentials for training and evaluation.
> Before operational deployment, change all passwords via the admin panel and
> do not expose port 8080 to the public internet.

---

## Architecture decisions

### Database location
- `db.js` reads `RESCUEOS_DATA_DIR` (set to `/var/lib/rescueos` by the systemd service)
- On Windows/macOS dev, defaults to `backend/` (no change to dev workflow)
- The systemd `StateDirectory=rescueos` directive creates `/var/lib/rescueos` owned by the `rescueos` service user before the process starts

### Security posture
- Backend runs as `rescueos:rescueos` system user (no login shell, no home in app dir)
- `ProtectSystem=strict` makes the entire filesystem read-only except `ReadWritePaths`
- `NoNewPrivileges=true` and `PrivateTmp=true` are set
- Firewall (nftables) allows only ports 8080, 22, DHCP (67/68), DNS (53), mDNS (5353)
- Hotspot passwords are entered through NetworkManager prompts; no default Wi-Fi password is configured

### Kiosk isolation
- LightDM auto-logs in as the Debian Live `user` account
- The `rescueos` xsession launches directly into Chromium via `rescueos-session` → `rescueos-kiosk`
- XFCE4 is installed only as a display server host (no panel, no icons, no taskbar)
- Chromium flags: `--kiosk --disable-infobars --noerrdialogs --disable-extensions --disable-sync`
- The XDG autostart `.desktop` file is removed by the chroot hook so kiosk only launches once

### Node.js bundling
- Node.js 22.14.0 is downloaded at build time, SHA-256 verified, and embedded in the ISO at `/usr/local/lib/nodejs/node-v22.14.0-linux-x64/`
- No npm packages are required (application uses only Node built-ins)

---

## Known limitations

2. **Hotspot AP mode is hardware-dependent** — Not every Wi-Fi chipset supports access-point mode. Test with your specific adapter.
3. **Data is ephemeral by default** — SQLite is stored in `/var/lib/rescueos` in RAM (tmpfs on live). Data is lost on reboot. For persistent operation, use a live-persistent partition or write to a mounted writable drive.
4. **WSL2 limitation** — WSL2 can build the ISO but cannot test full UEFI/BIOS boot, hardware Wi-Fi, or hotspot. Use QEMU or real hardware for those tests.
5. **This ISO has not been built or boot-tested by this scaffold** — Always validate in a VM before field deployment.
