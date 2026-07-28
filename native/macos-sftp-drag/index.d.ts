/// <reference types="node" />

export interface MacSftpDragProbe {
  available: true;
  supported: true;
  platform: "darwin";
  apiVersion: 1;
  delayed: true;
  protocol: "NSFilePromiseProvider/NSDraggingSession";
  mode: "file-promise";
  oneGesture: true;
  delayedContent: true;
  multipleItems: true;
  directories: true;
}

export interface MacSftpDragUnavailableProbe {
  available: false;
  supported: false;
  platform: NodeJS.Platform;
  apiVersion: 1;
  delayed: true;
  mode: "file-promise";
  reason: string;
}

export interface MacSftpDragItem {
  id: string;
  name: string;
  isDirectory?: boolean;
  fileType?: string;
  size?: number;
}

export interface MacSftpDragSpec {
  viewHandle: Buffer | bigint;
  token: string;
  items: MacSftpDragItem[];
  sessionId?: string;
  dragImagePath?: string;
  armTimeoutMs?: number;
  /** AppKit point / renderer CSS pixel；默认 1。 */
  cssScale?: number;
}

export type MacSftpDragEvent =
  | {
      type: "started";
      sessionId: string;
      token: string;
    }
  | {
      type: "motion";
      sessionId: string;
      token: string;
      screenX: number;
      screenY: number;
      clientX: number;
      clientY: number;
      clientScale: number;
      coordinateSpace: "content-view-css";
    }
  | {
      type: "writeRequested";
      sessionId: string;
      token: string;
      /**
       * Finder 每次写入回调的唯一标识；同一个 itemId 可能产生多个 requestId，
       * 每个 requestId 都必须单独调用 completeWrite()。
       */
      requestId: string;
      /** 顶层拖出项目的稳定标识，用于按项目去重完成状态。 */
      itemId: string;
      promisedName: string;
      targetPath: string;
      targetDirectory: string;
      isDirectory: boolean;
    }
  | {
      type: "ended";
      sessionId: string;
      token: string;
      operation: "copy" | "move" | "link" | "none" | "unknown";
      screenX: number;
      screenY: number;
      clientX: number;
      clientY: number;
      clientScale: number;
      coordinateSpace: "content-view-css";
      internalTargetJson?: string;
    }
  | {
      type: "cancelled";
      sessionId: string;
      token: string;
      message: string;
    }
  | {
      type: "error";
      sessionId: string;
      token: string;
      message: string;
      code?: string;
    };

export interface MacSftpDragStartResult {
  sessionId: string;
  state: "armed";
}

export function probe(): MacSftpDragProbe | MacSftpDragUnavailableProbe;
export function startDrag(
  spec: MacSftpDragSpec,
  onEvent: (event: MacSftpDragEvent) => void
): MacSftpDragStartResult;
/**
 * 完成一个 Finder 写入请求。模块内部按 itemId 统计项目完成状态；
 * 同一项目的重复 Finder 请求不会让整个拖动会话提前完成。
 */
export function completeWrite(requestId: string, error?: string | null): boolean;
/**
 * 取消尚未开始的武装状态，或取消 Finder 已经发起但尚未完成的 File Promise 写入。
 * AppKit 正在跟随鼠标的 NSDraggingSession 没有公开的程序化取消接口，此阶段返回 false。
 */
export function cancelDrag(sessionId?: string): boolean;
export function setInternalTarget(
  sessionId: string,
  targetJson?: string | null
): boolean;
export function dispose(): void;
