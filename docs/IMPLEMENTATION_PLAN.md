# RescueOS V2 implementation plan

## Baseline
- Source: vanilla HTML/CSS/JavaScript frontend, dependency-free Node.js backend, built-in `node:sqlite` database.
- OS integration: Debian 13 Live image using systemd, LightDM/Chromium kiosk, NetworkManager (`nmcli`), and shell helpers.
- Backup checkpoint: untouched `D:\software\ROS.V2-main.zip`. No Git metadata was present in the archive.

## Completed in this pass
1. Replaced the horizontal tab strip with a persistent, responsive left navigation rail; added active-page semantics and focus styles.
2. Removed the map section, navigation, Leaflet code/assets, GeoJSON file, stale map CSS, and unnecessary CSS animation/transition declarations.
3. Added a Network page showing reported IPv4 interfaces, DNS resolvers, and gateway where supported, with bounded interface/link/IP/route/DNS/external checks.
4. Added an admin-only, read-only SQLite browser with real table/schema listings, bounded pagination, query timing, and sensitive credential column redaction. No arbitrary SQL endpoint is exposed.
5. Added host OS, sampled CPU, memory, uptime, and root storage readings to a System page.
6. Tightened the Debian hotspot helper to accept only enumerated Wi-Fi interfaces and have NetworkManager prompt for the password without exposing it in command arguments. Removed broad passwordless `nmcli` and `nft` grants.
7. Updated project documentation and synchronized app files into the Debian Live overlay consumed by the ISO builder.
8. Added diagnostics, database access-control/redaction, and system reading assertions to the existing backend integration suite.

## Validation and constraints
- Node syntax checks passed for backend, frontend, and tests.
- `npm test`: 20 workflow groups passed, 0 failed (baseline before changes); final suite has 23 groups (including Network API and diagnostics response checks).
- Debian ISO builder syntax check passed in WSL Debian; required build tools are installed and about 933 GB was free.
- ISO build was not run: WSL's configured user cannot use noninteractive sudo (`sudo: a password is required`). The build script requires root. No existing ISO was overwritten.
- No browser visual verification, kiosk boot test, or physical Wi-Fi/AP test was performed.
- A web terminal and hotspot page with start/stop controls are not implemented. Hotspot use remains through the documented native terminal helper; no web shell or unrestricted command endpoint was added.
