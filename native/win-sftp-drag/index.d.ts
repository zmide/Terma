export interface WindowsSftpDragProbe {
  available: boolean;
  supported?: boolean;
  platform: string;
  apiVersion: 1;
  delayed: true;
  protocol?: "CFSTR_FILEDESCRIPTORW/CFSTR_FILECONTENTS";
  mode?: "virtual-file-stream";
  oneGesture?: true;
  delayedContent?: true;
  multipleItems?: true;
  directories?: true;
  reason?: string;
}

export interface WindowsSftpDragItem {
  id: string;
  relativePath?: string;
  name?: string;
  size?: number | bigint | string;
  mtimeMs?: number | bigint | string;
  isDirectory?: boolean;
  contentUrl?: string;
}

export interface WindowsSftpDragSpec {
  baseUrl?: string;
  token?: string;
  manifestUrl?: string;
  contentBaseUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  armTimeoutMs?: number;
  waitForActivation?: boolean;
  sourceWindowHandle?: number | bigint | string;
  items?: WindowsSftpDragItem[];
}

export type WindowsSftpDragEvent =
  | {
      type: "preparing" | "ready" | "started" | "motion" | "released";
      requestId: string;
      screenX?: number;
      screenY?: number;
    }
  | {
      type: "completed" | "cancelled";
      requestId: string;
      dropEffect: "copy" | "none";
      message?: string;
      screenX?: number;
      screenY?: number;
    }
  | {
      type: "error" | "contentError";
      requestId: string;
      message: string;
      hresult?: number;
      screenX?: number;
      screenY?: number;
    };

export interface WindowsSftpDragStartResult {
  requestId: string;
  accepted: true;
}

export function probe(): WindowsSftpDragProbe;
export function startDrag(
  spec: WindowsSftpDragSpec,
  onRead: ((request: unknown) => void) | undefined | null,
  onEvent: (event: WindowsSftpDragEvent) => void
): WindowsSftpDragStartResult;
export function startDrag(
  spec: WindowsSftpDragSpec,
  onEvent: (event: WindowsSftpDragEvent) => void
): WindowsSftpDragStartResult;
export function activateDrag(requestId: string): boolean;
export function setInternalTarget(requestId: string, active: boolean): boolean;
export function cancelDrag(requestId: string): boolean;
