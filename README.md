<p align="right"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

# Terma

Terma is a remote connection workspace for desktop and self-hosted Web environments. It brings SSH, terminals, SFTP, remote desktops, port forwarding, and batch commands into one interface.

> Name migration: Terma remains compatible with legacy TunnelDesk data and `TUNNELDESK_*` environment variables. The desktop app offers to migrate old data when it is detected and keeps the old directory available for rollback.

[Download the latest release](https://github.com/zmide/Terma/releases/latest) · [View release history](https://github.com/zmide/Terma/releases) · [GPL-3.0 license](LICENSE)

<p align="center">
  <img src=".github/assets/screenshots/desktop-overview.png" alt="Terma connection management and server dashboard" width="100%">
</p>

## Interface preview

<table>
  <tr>
    <td width="50%"><strong>Terminal sessions and runtime diagnostics</strong><br><img src=".github/assets/screenshots/desktop-terminal.png" alt="Terma terminal sessions and runtime diagnostics"></td>
    <td width="50%"><strong>Remote desktops and other connections</strong><br><img src=".github/assets/screenshots/desktop-remote.png" alt="Terma remote desktops and other connections"></td>
  </tr>
  <tr>
    <td colspan="2"><strong>SFTP file management</strong><br><img src=".github/assets/screenshots/desktop-sftp.png" alt="Terma SFTP file management"></td>
  </tr>
  <tr>
    <td colspan="2"><strong>Linux desktop management</strong><br><img src=".github/assets/screenshots/desktop-linux-management.png" alt="Terma Linux desktop management"></td>
  </tr>
  <tr>
    <td colspan="2"><strong>Port forwarding</strong><br><img src=".github/assets/screenshots/desktop-forwarding.png" alt="Terma port forwarding"></td>
  </tr>
</table>

## Highlights

- One data set powers the Electron desktop app, desktop browsers, and mobile Web access, so connection settings do not need to be maintained twice.
- SSH connections, terminals, SFTP, tunnels, and batch operations share one multi-tab workspace.
- Desktop packages are available for Windows, macOS, and Linux; Web mode also runs on Linux servers and Termux.
- Supports private-key and password authentication, encrypted configuration, database backup and restore, and SSH config import/export.
- Listens only on loopback by default. LAN access can be protected with a password, session management, and trusted-proxy policies.

## Core features

### SSH and workspaces

- Group, search, tag, favorite, sort, batch-edit, and health-check SSH connections, with recent-use tracking.
- Authenticate with passwords, regular or passphrase-protected private keys, and SSH Agent. Terma can read keys from the user `~/.ssh` directory and the runtime data directory, and includes an Ed25519 key-generation and public-key deployment wizard.
- The first connection displays the SHA-256 host fingerprint for confirmation. Host-key changes produce a prominent warning, and terminals, SFTP, forwarding, and batch commands share the same trust record.
- Terminals, commands, and forwarding prefer the built-in SSH implementation and fall back to system OpenSSH for compatible OpenSSH-only settings. Structured timeouts, keepalives, and one-hop jump hosts are supported.
- The lightning button and `Ctrl+K` open a global quick panel for connections, tags, named workspaces, command snippets, and common actions. Snippets support variables, favorites, import/export, terminal insertion, and confirmed batch execution.
- Multi-tab workspaces support pinned tabs, recently closed recovery, and recursive desktop splits. Composition mode can be opened from a tab or the empty tab-bar area; use the left mouse button or `Ctrl/Cmd` to select tabs for an independent workspace and drag to reorder workspaces. Each workspace keeps its own tabs and split layout and can be saved as a searchable, previewable, repairable, importable, and exportable named preset.
- Inspect basic server information, runtime status, and listening ports.

### Terminal

- Multi-session Web terminals prefer a local PTY and automatically fall back to an SSH remote PTY when needed.
- Use ZMODEM directly in SSH terminals: `sz` downloads and `rz` uploads files. Before `rz`, Terma checks for same-name remote files and offers overwrite, automatic rename, or cancel, while showing the actual filename and transfer progress. Transfers can be cancelled from the UI or with `Ctrl+C`.
- SSH tests can detect the remote default shell, common shells, Python/Node, and session tools. Startup profiles may be saved to the connection or applied only to the current tab.
- Drag local files or folders into the terminal's current directory, or drag remote SFTP items to a terminal or another SFTP tab. Name conflicts offer overwrite, automatic `(1)`, `(2)` renaming, or cancel.
- Switch between UTF-8, GB18030/GBK, Big5, Shift_JIS, EUC-KR, and ISO-8859-1.
- Save font family, size, line height, and weight per connection; hold `Ctrl` while using the mouse wheel to adjust the font size.
- Includes recent commands, shortcut keys, a quick-command bar, context actions, terminal logs, and interaction-latency display. The quick-command bar can collapse to a compact single row with independent scrolling and supports short text buttons, optional Chinese badges, immediate execution, or insertion only.
- Select multiple terminals as a synchronized group so input in any member is broadcast to the entire group. Multi-line input, dangerous commands, and hidden-input prompts trigger additional confirmation or automatic suspension.
- Tabs can indicate new output, command completion, and disconnection. Long background tasks can send notifications, with muting per connection or tab.
- Open the selected terminal path or current directory in SFTP. `Ctrl+Shift+T` restores the most recently closed terminal or SFTP tab.
- Mobile terminals provide Esc, Tab, arrow keys, Ctrl combinations, and a command input bar.

### SFTP

- Browse, search, sort, paginate, favorite, upload, download, and edit files online. Search supports `Ctrl+F`, progress feedback, and optional recursive traversal.
- The desktop app can open one or more Local Files tabs from a terminal or SFTP tab in a new tab or an upper, lower, left, or right split. Local Files uses the same toolbar, breadcrumb, selection, and pagination model as SFTP. Files can be dragged directly between local and remote tabs, and remote items can be sent to the desktop. On Windows, navigating above a drive root opens This PC for switching drives.
- Create, rename, delete, recycle, change permissions and owners, compress, and extract files and directories.
- A global Task Center in the workspace header combines SFTP transfers, directory synchronization, and Linux desktop installation/removal progress. A non-obstructing floating progress card is enabled by default, can be hidden temporarily or muted permanently, and can be restored under General settings > Task Center.
- Configure filename encoding independently from text-content encoding, including common Chinese, Japanese, and Korean legacy encodings.
- Copy and move items on the same host or stream them directly between two SSH hosts.
- Edit remote files with system applications, VS Code, or a custom editor on desktop. When content changes, Terma asks whether to save; text conflicts can be reviewed side by side before choosing backup and overwrite, save as, or keep unsaved. The internal editor can compare the ten most recent backup versions.
- Compare local and remote directories and run upload, download, or bidirectional synchronization on desktop. Review each planned item first; conflicts are skipped by default, and tasks support cancellation, retry, and result export.
- Jump between terminal and SFTP views for the current connection.

### Remote desktops and other protocols

- SSH and non-SSH protocols have separate activity entries. RDP, VNC, XDMCP, FTP/FTPS, Telnet, and serial connections can be grouped, searched, and created independently. Default profiles for one or all protocols can also be generated while creating an SSH connection or from its More menu.
- RDP uses the platform's native client. Profiles generated from SSH open the target address directly and let the native client request desktop credentials. On macOS, the official standalone Microsoft PKG can be installed when Windows App is missing, including from a package placed in Downloads for offline installation. VNC can use the embedded viewer, the system client, or automatic embedded-first selection. It supports encrypted password storage, in-workspace control, automatic bidirectional clipboard sync, full screen, and reconnection. Cursor display is selected automatically for the remote platform and can also be toggled manually. Manual clipboard send/receive remains available when permissions are limited, and an incorrect saved password can be replaced in place.
- Windows desktop packages include and manage an X Server. Terma manages XQuartz startup, shutdown, and XDMCP windows on macOS; Linux reuses the current graphical desktop with Xephyr. The X11 launcher detects installed remote terminals, tools, file managers, browsers, and desktop sessions over SSH, supports saved-password and custom applications, and can inspect XQuartz, xauth, sshd, and `XAuthLocation` on macOS. Missing remote XQuartz components can be installed from the official package in the app.
- Linux Desktop Management detects Debian, Ubuntu, RHEL, Fedora, Arch, openSUSE, and related distributions over SSH and can install or remove common desktop environments. Removal is verified using core launch programs and does not purge unrelated automatic dependencies by default. XDMCP, desktop management, RDP session repair, SSH X11 forwarding, and remote X11/XQuartz installation can use an operation-scoped administrator password, private key, or SSH Agent without saving those credentials. X Server Management can inspect, enable, or disable remote SSH X11 forwarding, and X11-enabled terminals display the actual forwarding result.
- Windows, Linux, and macOS desktop builds support direct, indirect, and LAN-broadcast XDMCP. Windows uses bundled components, Linux uses Xephyr, and macOS uses the Xephyr supplied by XQuartz. Terma can inspect desktop sessions, display managers, and UDP 177 through an SSH connection for the same host, manage LightDM and legacy GDM versions that still support XDMCP, and—with confirmation—switch GDM 50+ or Debian/Ubuntu SDDM systems to LightDM. It removes only UFW/firewalld rules it created. XDMCP is unencrypted and should be used only on a trusted LAN.
- FTP/FTPS provides an embedded file workspace. Telnet and serial connections provide embedded terminals with common terminal encodings and serial-port parameters.

### Forwarding and batch operations

- Local `-L`, remote `-R`, and SOCKS5 dynamic `-D` forwarding.
- Start and stop each forwarding rule independently; use templates, optional URL paths, automatic reconnection, and startup restoration.
- The Forwarding List manages rules across every SSH connection with search, status/server filters, ungrouped or per-SSH views, sticky group/server headers, drag ordering, and direct add/edit/delete/access actions.
- Both Quick Open surfaces can find forwarding rules by connection, service, note, address, port, status, or URL path and start or stop them in place.
- Copy local access addresses, proxy addresses, and target addresses, and quickly test connectivity.
- Run commands on multiple hosts with reusable templates and TXT/JSON result export.

### Data and updates

- SQLite stores connections, forwarding rules, settings, and task state.
- Database backup and restore, configuration snapshots, and encrypted migration packages.
- During database restore, private keys can be rebound and passwords can be supplied without preserving paths from the old computer.
- Desktop builds check GitHub Releases and select update files by operating system, architecture, and installation type. Before download, Terma compares direct and available accelerated routes, uses the faster route, retries another route on failure, and still verifies SHA-256.

## Architecture

```text
Electron desktop ─┐
Browser / mobile ─┼─> Web UI (public/)
                  │        │ HTTP / WebSocket
                  └─> Node.js service (src/ -> dist/)
                           ├─ SSH / PTY / X11 / port forwarding
                           ├─ SFTP / FTP / VNC / remote protocols
                           ├─ SQLite / logs / backups
                           └─ updates and runtime settings
```

The desktop app is an Electron container around the same Web UI and Node.js service, so desktop and Web modes share the same data structures and feature implementations.

| Directory | Purpose |
| --- | --- |
| `src/` | TypeScript backend, SSH, terminal, SFTP, authentication, and data services |
| `public/` | Native HTML, CSS, and JavaScript frontend |
| `desktop/` | Electron main process, preload scripts, and desktop icons |
| `scripts/` | Start/stop, tests, dependency checks, packaging, and release helpers |
| `data/` | Local database, settings, logs, and managed-key directory for source runs |
| `.github/workflows/` | Cross-platform Release build workflows |

## Platform support

| Platform | Desktop | Web mode | Release artifacts |
| --- | --- | --- | --- |
| Windows 10/11 | Supported | Supported | Installer and portable executable |
| macOS | Supported | Supported | DMG and installation-free ZIP |
| Linux | Supported | Supported | AppImage, DEB, and RPM |
| Termux / headless Linux | Not recommended | Supported | Run from source |

## Requirements

- Node.js 22 or later
- npm
- Git when cloning the repository
- An OpenSSH client with `ssh` available on the command line
- XQuartz is required for X11/XDMCP on macOS. Terma can download, verify, and request administrator authorization to install it locally, and can inspect remote X11 state over SSH. macOS RDP requires Windows App or a usable FreeRDP installation. Linux X11 requires a graphical `DISPLAY` and `xauth`; the XDMCP client requires Xephyr, while a complete remote desktop also requires a display manager listening on UDP 177 (LightDM is preferred; GDM 50 and later no longer support XDMCP).

Clone the project before running from source:

```sh
git clone https://github.com/zmide/Terma.git
cd Terma
```

The startup scripts check `package.json` and `package-lock.json`. They install dependencies automatically when the dependency tree is missing or the manifests changed, then build and start the application.

## Run from source

### Windows

```bat
start.bat
stop.bat
```

### Linux / macOS

```sh
chmod +x start.sh stop.sh
./start.sh
./stop.sh
```

With a graphical environment, the startup script prefers the desktop app. If Electron is unavailable or Web-only mode is explicitly enabled, it runs the background Web service. The default URL is:

```text
http://127.0.0.1:8088
```

### Termux / headless servers

Prepare a first-time Termux environment:

```sh
pkg update
pkg upgrade
pkg install git nodejs openssh
```

Start Web mode:

```sh
chmod +x start.sh stop.sh
TERMA_WEB_ONLY=1 ./start.sh
./stop.sh
```

Termux and headless Linux do not package the desktop application. `start.sh` checks dependencies, builds the source, and starts the Web service automatically.

### LAN access

The recommended setup is to choose the listen address and set a Web password under Settings > Startup and Runtime. For a temporary session, use:

```sh
TERMA_LAN=1 ./start.sh
# or
TERMA_WEB_ONLY=1 ./start.sh --host 0.0.0.0 --port 8088
```

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `TERMA_WEB_ONLY=1` | Start only the Web service |
| `TERMA_LAN=1` | Temporarily listen on all IPv4 interfaces |
| `TERMA_NO_BROWSER=1` | Do not open a browser after Web-mode startup |
| `TERMA_DATA_DIR` | Override the runtime data directory |
| `TERMA_SSH_DIR` | Override the managed SSH key directory |
| `TERMA_RESET_WEB_ACCESS=1` | Reset the Web password and access tokens |
| `TERMA_DISABLE_UPDATE_CHECK=1` | Disable the automatic startup update check |
| `TUNNEL_WEB_HOST` | Set the listen address |
| `TUNNEL_WEB_PORT` | Set the listen port; defaults to `8088` |

Legacy variables such as `TUNNELDESK_WEB_ONLY` and `TUNNELDESK_LAN` remain accepted for compatibility. New scripts and deployments should use `TERMA_*`.

## Development and verification

```sh
npm install --include=dev
npm run build
npm run native:build:if-needed
npm run desktop:run
```

Common checks:

```sh
npm run check:strict
npm run regression
npm run ui:smoke
```

## Desktop builds and packaging

Desktop packages contain the platform-specific native SFTP drag-and-drop module, so they must be built on the target operating system. Prepare the toolchain first:

- Windows: Visual Studio 2022 C++ Build Tools with Desktop development with C++. The packaging script downloads and verifies a pinned VcXsrv runtime.
- Linux (Debian / Ubuntu): `build-essential cmake fuse3 libcurl4-openssl-dev libfuse3-dev nlohmann-json3-dev pkg-config rpm`.
- macOS: Xcode Command Line Tools, installable with `xcode-select --install`.

Install dependencies and build packages on the current platform:

```sh
npm ci
npm run dist
```

Select a platform and artifacts explicitly:

```sh
# Windows x64: installer and portable executable
npm run dist -- --win nsis portable --x64 --publish never

# Linux x64: AppImage, DEB, and RPM
npm run dist -- --linux AppImage deb rpm --x64 --publish never

# macOS: Intel and Apple Silicon
npm run dist -- --mac dmg zip --x64 --arm64 --publish never
```

Build output is written to `release/`:

- Windows installer: run `*-installer.exe` and follow the wizard; run `*-portable.exe` directly for the portable build.
- Linux: run `chmod +x release/*.AppImage` before launching an AppImage; install DEB and RPM packages with the system package manager.
- macOS DMG: open the `.dmg` for the machine architecture and drag Terma to Applications.
- macOS ZIP: extract and run `Terma.app` without installation. “Installation-free” applies to the app bundle only; runtime data is still stored in the system user-data directory. Choose `x64` for Intel or `arm64` for Apple Silicon.

Pushing a `v*` tag starts the Release workflow, which builds and verifies Windows, Linux, and macOS artifacts separately.

## Upgrading from TunnelDesk

- The new desktop identity is `com.zmide.terma`; the main executable and Linux package use `terma`. The Windows installer, macOS `/Applications/Terma.app`, and Linux application menu all use Terma, and an old TunnelDesk installation is not reused as the new program.
- Desktop data migrates by default to `%APPDATA%\Terma\runtime` on Windows, `~/.config/Terma/runtime` on Linux, and `~/Library/Application Support/Terma/runtime` on macOS. The old `TunnelDesk` directory is retained only as a migration source and rollback copy.
- Import/Export > Legacy data migration can inspect and run the migration again. Existing data in both locations is never overwritten silently; confirming a migration first backs up current Terma data.
- Terma recognizes legacy backups, `TUNNELDESK_*` compatibility variables, and remote `tunneldesk-*` managed configurations. New XDMCP, VNC, and SSH X11 configurations use the `terma` name. Do not manually delete old configurations or applications before migration succeeds.

## Data and security

- Source runs and Windows portable builds use the project `data/` directory by default. Installed builds use the system user-data directory and can migrate it elsewhere from Settings.
- SSH passwords, private-key paths, access tokens, and database backups are sensitive. Protect the runtime data directory and enable configuration encryption when appropriate. Encryption uses a separate key and password verifier. Legacy v1/v2 data is rotated to `termaenc:v3:` with a new salt after unlocking with the original master password, without re-entering connection credentials. Generate a fresh backup and remove obsolete v1 backups after rotation; if an old backup was exposed, also rotate the SSH, VNC, and other credentials stored in it.
- After configuration encryption is enabled, a restarted and locked Terma can still show ordinary lists and change non-sensitive display settings, but it cannot download a full-credential migration package, restore a database or snapshot, fully edit connections, save credentials, or save terminal startup profiles. Enter the master password to unlock those operations. If power is lost while enabling or disabling encryption, Terma retains a resumable transition state and blocks sensitive fields until the password is entered again.
- When a Web password or access token is configured, regular browsers must authenticate even on loopback. The login page accepts either credential. The Electron desktop app uses a separate random credential for each launch.
- SSH private keys must be real, independent regular private-key files located in the active managed-key directory or at the top level of the user's `~/.ssh`. Directories, external paths, symbolic or hard links, public keys, and config files are rejected. Additional SSH arguments are limited to algorithms, compression, timeouts, and similar connection tuning; they cannot replace the host, user, jump host, forwarding, X11, local program, credentials, or host-trust boundaries. Previously saved incompatible paths or arguments are reported while editing and are never moved or rewritten silently.
- Permanently trusted SSH host keys are stored in the runtime data directory and can be reviewed or removed under Settings > Security. The fingerprint is requested again after removal.
- The service listens only on `127.0.0.1` by default. Set a Web password for LAN access; use a private network such as Tailscale, ZeroTier, or WireGuard for remote access.
- Behind Nginx, Caddy, or another reverse proxy, configure the IP that directly connects to Terma as a trusted proxy—usually `127.0.0.1` for a same-host deployment—and add the exact Host used by the browser. Keep the Terma Web password or token enabled. Proxying to `127.0.0.1` does not grant the browser loopback authentication exemption.
- Local desktop capabilities such as file and directory selection, X Server control, and external clients accept only the random credential from the current Electron process. A regular browser visiting loopback does not receive those capabilities.
- `stop.bat` and `stop.sh` request graceful shutdown with the current instance's temporary `shutdown.token`. The token is removed at shutdown, and process-level fallback is used only if graceful shutdown fails.
- Windows, Linux, and macOS tighten local permissions on the data directory, database, security settings, snapshots, and restore staging files. Startup is rejected with a concrete path when critical storage cannot be secured, rather than continuing silently on a shared directory or invalid ACL.
- Do not expose Terma directly to the public Internet. It can operate terminals, SFTP, tunnels, keys, and backups and therefore has a larger risk surface than a read-only dashboard.
- Never commit `data/`, `.ssh/`, logs, or database backups.

### Reverse proxy example

Nginx should preserve the browser's Host and forward the real source and external protocol. `$http_host` also preserves a non-standard port:

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Caddy can use `reverse_proxy 127.0.0.1:8088` directly. By default it preserves Host, sets `X-Forwarded-For` / `X-Forwarded-Proto`, and proxies WebSockets. Do not rewrite the upstream Host to `127.0.0.1`. Add Caddy's direct connection address to trusted proxy IPs and the site domain—with its port when non-standard—to allowed Hosts.

## License

Terma is released under the [GNU General Public License v3.0](LICENSE). Bundled third-party components and their source locations are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
