const JAVA_GUI_COMPATIBILITY_COMMANDS = Object.freeze([
  {
    id:"java2d",
    label:"Java2D",
    command:"java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -jar app.jar"
  },
  {
    id:"java2d-safe",
    label:"Java2D 深度兼容",
    command:"NO_J2D_MITSHM=true java -Dsun.java2d.xrender=false -Dsun.java2d.opengl=false -Dsun.java2d.pmoffscreen=false -jar app.jar"
  },
  {
    id:"javafx",
    label:"JavaFX",
    command:"java -Dprism.order=sw -jar app.jar"
  }
]);

const XRDP_RENDER_PROBE_SCRIPT = String.raw`
td_render_xrdp_display=""
td_render_xrdp_pid=""
td_render_xrdp_log=""
td_render_xrdp_drm_device=""
td_render_xrdp_drm_available=0
td_render_xrdp_software=0
td_render_xrdp_dri3=0
for td_render_config in /etc/X11/xrdp/xorg.conf /etc/xrdp/xorg.conf; do
  [ -r "$td_render_config" ] || continue
  td_render_xrdp_drm_device=$(sed -n 's/.*[Oo]ption[[:space:]]*"DRMDevice"[[:space:]]*"\([^"]*\)".*/\1/p' "$td_render_config" | head -n 1)
  grep -Eiq '[Oo]ption[[:space:]]*"DRI3"[[:space:]]*"?(1|true|on|yes)"?' "$td_render_config" && td_render_xrdp_dri3=1
  [ -n "$td_render_xrdp_drm_device" ] && break
done
if command -v pgrep >/dev/null 2>&1; then
  for td_render_pid in $(pgrep -x Xorg 2>/dev/null); do
    [ -r "/proc/$td_render_pid/cmdline" ] || continue
    td_render_args=$(tr '\000' ' ' < "/proc/$td_render_pid/cmdline" 2>/dev/null)
    case "$td_render_args" in
      *xrdp/xorg.conf*|*xorgxrdp*) ;;
      *) continue ;;
    esac
    td_render_xrdp_pid=$td_render_pid
    td_render_xrdp_display=$(printf '%s\n' "$td_render_args" | awk '{for (i=1; i<=NF; i++) if ($i ~ /^:[0-9]+([.][0-9]+)?$/) {print $i; exit}}')
    td_render_number=$(printf '%s' "$td_render_xrdp_display" | sed 's/^://; s/[.].*$//')
    td_render_cwd=$(readlink -f "/proc/$td_render_pid/cwd" 2>/dev/null || true)
    if [ -n "$td_render_cwd" ] && [ -n "$td_render_number" ] && [ -r "$td_render_cwd/.xorgxrdp.$td_render_number.log" ]; then
      td_render_xrdp_log="$td_render_cwd/.xorgxrdp.$td_render_number.log"
    elif [ -n "$td_render_cwd" ]; then
      td_render_xrdp_log=$(find "$td_render_cwd" -maxdepth 1 -type f -name '.xorgxrdp.*.log' -readable 2>/dev/null | sort | tail -n 1)
    fi
    break
  done
fi
if [ -n "$td_render_xrdp_drm_device" ] && [ -e "$td_render_xrdp_drm_device" ]; then
  td_render_xrdp_drm_available=1
fi
if [ -n "$td_render_xrdp_log" ] && grep -Eiq 'DRMDevice.*open failed|not DRI2 capable|DRISWRAST|swrast|llvmpipe|software raster' "$td_render_xrdp_log" 2>/dev/null; then
  td_render_xrdp_software=1
fi
`;

function compatibilityCommands() {
  return JAVA_GUI_COMPATIBILITY_COMMANDS.map(item => ({...item}));
}

function renderingResult(values: any) {
  const risk = Boolean(values.java_gui_risk);
  return {
    visible:values.visible !== false,
    state:String(values.state || "unknown"),
    protocol:String(values.protocol || ""),
    backend:String(values.backend || ""),
    display:String(values.display || ""),
    source_display:String(values.source_display || ""),
    drm_device:String(values.drm_device || ""),
    drm_device_available:Boolean(values.drm_device_available),
    software_rendering:Boolean(values.software_rendering),
    java_gui_risk:risk,
    summary:String(values.summary || ""),
    detail:String(values.detail || ""),
    log_file:String(values.log_file || ""),
    compatibility_commands:risk ? compatibilityCommands() : []
  };
}

function createXrdpRenderingDiagnostics(input: any = {}) {
  const installed = Boolean(input.installed);
  const active = Boolean(input.active);
  const display = String(input.display || "");
  const drmDevice = String(input.drm_device || "");
  const drmAvailable = Boolean(input.drm_device_available);
  const software = Boolean(input.software_rendering) || Boolean(drmDevice && !drmAvailable);
  if (!installed) return renderingResult({visible:false, protocol:"rdp"});
  if (software) {
    const missing = drmDevice && !drmAvailable;
    return renderingResult({
      protocol:"rdp",
      backend:"xorgxrdp",
      state:"software",
      display,
      drm_device:drmDevice,
      drm_device_available:drmAvailable,
      software_rendering:true,
      java_gui_risk:true,
      summary:active && display ? `XRDP ${display} 已回退到软件渲染` : "XRDP 图形加速当前不可用",
      detail:missing
        ? `xorgxrdp 配置的 DRM 设备 ${drmDevice} 不存在；Java2D、JavaFX、OpenGL 或内嵌浏览器界面可能白屏。`
        : "xorgxrdp 日志检测到 swrast/软件 OpenGL 回退；Java2D、JavaFX、OpenGL 或内嵌浏览器界面可能白屏。",
      log_file:input.log_file
    });
  }
  if (active && display && drmAvailable && input.log_file) {
    return renderingResult({
      protocol:"rdp",
      backend:"xorgxrdp",
      state:"accelerated",
      display,
      drm_device:drmDevice,
      drm_device_available:true,
      summary:`XRDP ${display} 已检测到 DRM 渲染节点`,
      detail:"当前日志未发现软件 OpenGL 回退；具体应用仍可能受自身图形后端限制。",
      log_file:input.log_file
    });
  }
  return renderingResult({
    protocol:"rdp",
    backend:"xorgxrdp",
    state:"unknown",
    display,
    drm_device:drmDevice,
    drm_device_available:drmAvailable,
    summary:"XRDP 渲染状态等待活动会话确认",
    detail:"建立 RDP 图形会话后可进一步判断 DRM 和软件 OpenGL 回退状态。",
    log_file:input.log_file
  });
}

function createVncRenderingDiagnostics(input: any = {}) {
  const installed = Boolean(input.installed);
  const platform = String(input.platform || "").toLowerCase();
  const mode = String(input.server_mode || "unknown");
  const display = String(input.source_display || input.display || "");
  if (!installed) return renderingResult({visible:false, protocol:"vnc"});
  if (platform === "macos") {
    return renderingResult({
      protocol:"vnc",
      backend:"macOS Screen Sharing",
      state:"shared",
      summary:"VNC 正在共享 macOS 已有桌面",
      detail:"应用仍由本机桌面会话负责渲染，系统屏幕共享只传输最终画面。"
    });
  }
  if (mode === "shared-x11" && input.source_xrdp) {
    const inherited = createXrdpRenderingDiagnostics({
      installed:true,
      active:true,
      display:input.xrdp_display || display,
      drm_device:input.xrdp_drm_device,
      drm_device_available:input.xrdp_drm_device_available,
      software_rendering:input.xrdp_software_rendering,
      log_file:input.xrdp_log_file
    });
    return renderingResult({
      ...inherited,
      protocol:"vnc",
      backend:"x11vnc -> xorgxrdp",
      source_display:display,
      summary:inherited.java_gui_risk
        ? `VNC 正在共享受限的 XRDP ${display || "会话"}`
        : `VNC 正在共享 XRDP ${display || "会话"}`,
      detail:inherited.java_gui_risk
        ? "x11vnc 不会改变应用的渲染方式，因此会继承源 XRDP 会话的软件 OpenGL 限制。"
        : "x11vnc 直接共享源 XRDP 会话，应用渲染能力与该会话保持一致。"
    });
  }
  if (mode === "virtual") {
    return renderingResult({
      protocol:"vnc",
      backend:"TigerVNC/Xvnc",
      state:"software",
      display,
      source_display:display,
      software_rendering:true,
      java_gui_risk:true,
      summary:"VNC 使用独立虚拟显示，通常只有软件渲染",
      detail:"TigerVNC/Xvnc 不等同于物理 GPU 桌面；JavaFX、OpenGL 或依赖硬件合成的 Java 界面可能白屏。"
    });
  }
  if (mode === "shared-wayland") {
    return renderingResult({
      protocol:"vnc",
      backend:"wayvnc",
      state:"shared",
      source_display:display,
      summary:"VNC 正在共享已有 Wayland 桌面",
      detail:"应用仍由原桌面会话负责渲染，VNC 只传输最终画面。"
    });
  }
  if (mode === "shared-x11") {
    return renderingResult({
      protocol:"vnc",
      backend:"x11vnc",
      state:"shared",
      display,
      source_display:display,
      summary:`VNC 正在共享已有 X11 ${display || "桌面"}`,
      detail:"应用仍由源 X11 会话负责渲染，VNC 本身不会把硬件渲染改成软件渲染。"
    });
  }
  return renderingResult({
    protocol:"vnc",
    state:"unknown",
    display,
    source_display:display,
    summary:"VNC 渲染来源尚未确定",
    detail:"启动 VNC 服务后可判断它共享已有桌面还是创建独立虚拟显示。"
  });
}

function createXdmcpRenderingDiagnostics(input: any = {}) {
  const available = Boolean(input.enabled || input.listening || input.ready);
  if (!available) return renderingResult({visible:false, protocol:"xdmcp"});
  return renderingResult({
    protocol:"xdmcp",
    backend:"remote X11",
    state:"remote-x11",
    java_gui_risk:true,
    summary:"XDMCP 使用客户端 X Server，直接 GPU 渲染通常受限",
    detail:"普通 X11 界面通常可用，但 JavaFX、OpenGL、JOGL 或内嵌浏览器可能需要软件渲染参数。"
  });
}

module.exports = {
  JAVA_GUI_COMPATIBILITY_COMMANDS,
  XRDP_RENDER_PROBE_SCRIPT,
  compatibilityCommands,
  createVncRenderingDiagnostics,
  createXdmcpRenderingDiagnostics,
  createXrdpRenderingDiagnostics
};
