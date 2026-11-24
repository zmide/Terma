import type { ManagementModel } from './RemoteManagementView';

export interface GraphicsRenderingDiagnostics {
  visible?: boolean;
  protocol?: string;
  state?: string;
  backend?: string;
  display?: string;
  source_display?: string;
  drm_device?: string;
  drm_device_available?: boolean;
  java_gui_risk?: boolean;
  compatibility_commands?: {id?: string; label?: string; command?: string}[];
  summary?: string;
  detail?: string;
}

export interface GraphicsRenderingPort {
  tr(key: string, params?: Record<string, unknown>): string;
  write(command: string): Promise<void>;
  busy(button: HTMLElement, busy: boolean, label?: string): void;
  notify(message: string, kind: 'success' | 'error'): void;
}

export function createGraphicsRenderingModel(port: GraphicsRenderingPort) {
  const {tr} = port;

  function copyFor(rendering: GraphicsRenderingDiagnostics) {
    const protocol = String(rendering.protocol || "").toLowerCase();
    const state = String(rendering.state || "unknown").toLowerCase();
    const backend = String(rendering.backend || "");
    const display = String(rendering.source_display || rendering.display || "");
    if (protocol === "rdp") {
      if (state === "software") {
        return {
          summary:display
            ? tr("remote:rendering.rdp_software_display", {display, defaultValue:`XRDP ${display} 已回退到软件渲染`})
            : tr("remote:rendering.rdp_software", {defaultValue:"XRDP 图形加速当前不可用"}),
          detail:rendering.drm_device && !rendering.drm_device_available
            ? tr("remote:rendering.rdp_missing_drm", {device:rendering.drm_device, defaultValue:`xorgxrdp 配置的 DRM 设备 ${rendering.drm_device} 不存在；Java2D、JavaFX、OpenGL 或内嵌浏览器界面可能白屏。`})
            : tr("remote:rendering.rdp_software_detail", {defaultValue:"xorgxrdp 日志检测到 swrast/软件 OpenGL 回退；Java2D、JavaFX、OpenGL 或内嵌浏览器界面可能白屏。"})
        };
      }
      if (state === "accelerated") return {
        summary:tr("remote:rendering.rdp_accelerated", {display, defaultValue:`XRDP ${display} 已检测到 DRM 渲染节点`}),
        detail:tr("remote:rendering.rdp_accelerated_detail", {defaultValue:"当前日志未发现软件 OpenGL 回退；具体应用仍可能受自身图形后端限制。"})
      };
      if (state === "unknown") return {
        summary:tr("remote:rendering.rdp_pending", {defaultValue:"XRDP 渲染状态等待活动会话确认"}),
        detail:tr("remote:rendering.rdp_pending_detail", {defaultValue:"建立 RDP 图形会话后可进一步判断 DRM 和软件 OpenGL 回退状态。"})
      };
    }
    if (protocol === "vnc") {
      if (backend === "macOS Screen Sharing") return {
        summary:tr("remote:rendering.vnc_macos_shared", {defaultValue:"VNC 正在共享 macOS 已有桌面"}),
        detail:tr("remote:rendering.vnc_macos_shared_detail", {defaultValue:"应用仍由本机桌面会话负责渲染，系统屏幕共享只传输最终画面。"})
      };
      if (backend === "x11vnc -> xorgxrdp") return rendering.java_gui_risk ? {
        summary:tr("remote:rendering.vnc_xrdp_limited", {display:display || tr("remote:rendering.session", {defaultValue:"会话"}), defaultValue:`VNC 正在共享受限的 XRDP ${display || "会话"}`}),
        detail:tr("remote:rendering.vnc_xrdp_limited_detail", {defaultValue:"x11vnc 不会改变应用的渲染方式，因此会继承源 XRDP 会话的软件 OpenGL 限制。"})
      } : {
        summary:tr("remote:rendering.vnc_xrdp_shared", {display:display || tr("remote:rendering.session", {defaultValue:"会话"}), defaultValue:`VNC 正在共享 XRDP ${display || "会话"}`}),
        detail:tr("remote:rendering.vnc_xrdp_shared_detail", {defaultValue:"x11vnc 直接共享源 XRDP 会话，应用渲染能力与该会话保持一致。"})
      };
      if (backend === "TigerVNC/Xvnc" || backend === "TigerVNC") return {
        summary:tr("remote:rendering.vnc_virtual", {defaultValue:"VNC 使用独立虚拟显示，通常只有软件渲染"}),
        detail:tr("remote:rendering.vnc_virtual_detail", {defaultValue:"TigerVNC 不等同于物理 GPU 桌面；JavaFX、OpenGL 或依赖硬件合成的 Java 界面可能白屏。"})
      };
      if (backend === "wayvnc") return {
        summary:tr("remote:rendering.vnc_wayland_shared", {defaultValue:"VNC 正在共享已有 Wayland 桌面"}),
        detail:tr("remote:rendering.vnc_wayland_shared_detail", {defaultValue:"应用仍由原桌面会话负责渲染，VNC 只传输最终画面。"})
      };
      if (backend === "x11vnc") return {
        summary:tr("remote:rendering.vnc_x11_shared", {display:display || tr("remote:rendering.desktop", {defaultValue:"桌面"}), defaultValue:`VNC 正在共享已有 X11 ${display || "桌面"}`}),
        detail:tr("remote:rendering.vnc_x11_shared_detail", {defaultValue:"应用仍由源 X11 会话负责渲染，VNC 本身不会把硬件渲染改成软件渲染。"})
      };
      if (state === "unknown") return {
        summary:tr("remote:rendering.vnc_unknown", {defaultValue:"VNC 渲染来源尚未确定"}),
        detail:tr("remote:rendering.vnc_unknown_detail", {defaultValue:"启动 VNC 服务后可判断它共享已有桌面还是创建独立虚拟显示。"})
      };
    }
    if (protocol === "xdmcp" && (state === "remote-x11" || backend === "remote X11")) return {
      summary:tr("remote:rendering.xdmcp_remote_x11", {defaultValue:"XDMCP 使用客户端 X Server，直接 GPU 渲染通常受限"}),
      detail:tr("remote:rendering.xdmcp_remote_x11_detail", {defaultValue:"普通 X11 界面通常可用，但 JavaFX、OpenGL、JOGL 或内嵌浏览器可能需要软件渲染参数。"})
    };
    return {summary:String(rendering.summary || ""), detail:String(rendering.detail || "")};
  }

  async function copyCommand(command: string, label: string, button: HTMLElement) {
    try {
      if (!command) throw new Error(tr('remote:rendering.command_empty'));
      if (button.isConnected) port.busy(button, true, tr('remote:rendering.copying'));
      await port.write(command);
      port.notify(tr('remote:rendering.command_copied', {label}), 'success');
    } catch (error) {
      const message = (error as {message?: string} | null)?.message || tr('remote:rendering.copy_failed');
      port.notify(message, 'error');
    } finally {
      if (button.isConnected) port.busy(button, false);
    }
  }

  return function renderingModel(rendering?: GraphicsRenderingDiagnostics): ManagementModel['rendering'] {
    if (!rendering || rendering.visible === false || !rendering.summary) return undefined;
    const copy = copyFor(rendering);
    const risk = Boolean(rendering.java_gui_risk);
    const accelerated = rendering.state === 'accelerated';
    const display = rendering.source_display || rendering.display;
    const clean = (value: string) => value.replaceAll('TigerVNC/Xvnc', 'TigerVNC');
    const meta = [
      rendering.backend && tr('remote:rendering.backend', {backend: clean(rendering.backend)}),
      display && tr('remote:rendering.display', {display}),
      rendering.drm_device && tr('remote:rendering.drm', {device: rendering.drm_device,
        status: tr(rendering.drm_device_available ? 'remote:rendering.available' : 'remote:rendering.unavailable')})
    ].filter(Boolean).join(' · ');
    const commands = Array.isArray(rendering.compatibility_commands) ? rendering.compatibility_commands : [];
    return {
      summary: clean(copy.summary),
      detail: clean(copy.detail),
      meta,
      tone: risk ? 'warning' : accelerated ? 'ready' : '',
      icon: risk ? 'triangle-alert' : accelerated ? 'badge-check' : 'monitor-cog',
      actions: risk ? commands.map((item, index) => {
        const label = item.id === 'java2d-safe' ? tr('remote:rendering.java2d_safe') : item.label || 'Java';
        return {id: `rendering-${index}`, label, icon: 'copy',
          run: button => copyCommand(String(item.command || ''), label, button)};
      }) : []
    };
  };
}
