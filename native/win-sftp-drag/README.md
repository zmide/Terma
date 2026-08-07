# Terma Windows SFTP 原生拖出模块

该模块使用 Windows Shell 虚拟文件协议实现 SFTP 文件的一次拖出：

- `CFSTR_FILEDESCRIPTORW` 提供文件和目录清单。
- `CFSTR_FILECONTENTS` + `IStream` 在目标程序真正读取时按需获取内容。
- 拖放运行在独立 STA 线程，不阻塞 Electron 主线程。
- 原生层只访问本机 Terma 的临时票据接口，不接触 SSH 密码或私钥。

## 导出接口

```js
const nativeDrag = require("./native/win-sftp-drag");

nativeDrag.probe();
// {
//   available: true,
//   supported: true,
//   platform: "win32",
//   apiVersion: 1,
//   delayed: true,
//   protocol: "CFSTR_FILEDESCRIPTORW/CFSTR_FILECONTENTS",
//   mode: "virtual-file-stream",
//   oneGesture: true
// }

const result = nativeDrag.startDrag(spec, onRead, onEvent);
// { requestId: "win-...", accepted: true }

nativeDrag.cancelDrag(result.requestId);
```

`startDrag` 立即返回，实际拖放在专用线程异步进行。`onRead` 为统一跨平台接口保留；Windows 当前由 `IStream` 直接请求本机 HTTP 接口，不调用它。
收到 `completed`、`cancelled` 或 `error` 后，由桌面主进程释放一次性票据；原生模块不会自行调用业务 API 删除票据。

`onEvent` 会收到：

```js
{ type: "started", requestId }
{ type: "preparing", requestId }
{ type: "motion", requestId, screenX, screenY }
{ type: "completed", requestId, dropEffect: "copy" }
{ type: "cancelled", requestId, dropEffect: "none" }
{ type: "contentError", requestId, message, hresult }
{ type: "error", requestId, message, hresult }
```

`motion` 由 Windows 拖放循环节流发送；`started`、`completed` 和
`cancelled` 也会尽量附带 `screenX` / `screenY`。桌面主进程可据此命中
Electron 内的其他 SFTP 标签，并在浏览器拖放事件不可用时完成跨主机复制。

`contentError` 只表示某个虚拟文件流读取失败，是非终态事件；Windows Shell
仍可继续处理或重试其他项目。`error` 仅用于原生拖放会话无法继续时的终态错误。

## 取消语义

`cancelDrag(requestId)` 接受请求后会唤醒拖放线程，并最终发送一次
`cancelled` 终态事件。若 Windows 文件管理器已经开始读取虚拟文件：

- 后续 `IStream::Read` 返回 `HRESULT_FROM_WIN32(ERROR_CANCELLED)`，让目标端将其识别为用户取消。
- 取消不会发送 `contentError`，也不会伪装成 `STG_E_READFAULT`；真正的网络、协议或短读取错误仍按读取故障报告。
- WinHTTP 请求使用同步模式，因此请求句柄只由执行该请求的线程关闭。取消线程只设置状态并唤醒拖放生命周期，不会跨线程调用 `WinHttpCloseHandle`。

桌面主进程应等待 `cancelled` 终态事件后再完成业务清理。目标文件管理器是否保留或删除已经写入的部分文件，由 Windows Shell 决定。

## `spec`

```js
{
  baseUrl: "http://127.0.0.1:8088",
  token: "one-time-ticket",
  manifestUrl: "http://127.0.0.1:8088/api/sftp/native-drag/ticket",
  // 可选。优先于 baseUrl + token；支持 {id} 占位符。
  contentBaseUrl: "http://127.0.0.1:8088/api/sftp/native-drag/ticket/content",
  // 可选，仅允许无换行的请求头。token 默认作为 Bearer Token 发送。
  headers: { "X-Terma-Drag": "..." },
  timeoutMs: 30000,
  // 可选。主要用于测试；生产环境通常由 manifestUrl 在线获取。
  items: [
    {
      id: "manifest-entry-id",
      relativePath: "folder/file.txt",
      size: 1234,
      mtimeMs: 1785123456789,
      isDirectory: false,
      // 可选。设置后覆盖 contentBaseUrl 的拼接结果。
      contentUrl: "http://127.0.0.1:8088/api/.../content/manifest-entry-id"
    }
  ]
}
```

约束：

- `manifestUrl` 返回 `{ entries: [...] }`，其中每项至少包含
  `index`、`relative_path`、`type`、`size` 和 `modified_at`。目录也要单独列出。
- `items` 是 `manifestUrl` 的兼容替代，两者至少提供一个。
- 所有内容 URL 必须指向 `localhost`、`127.0.0.1` 或 `::1`。
- 文件名使用相对路径，不允许绝对路径、盘符、`.` 或 `..`。
- 单次最多 10,000 个清单项；Windows Shell 的单个相对路径上限为 259 个 UTF-16 字符。
- 内容接口必须支持标准 `Range: bytes=start-end`，并严格返回 `206`、匹配请求区间和完整文件大小的 `Content-Range`，以及与区间长度一致的响应体；缺失、错位或短响应都会使该虚拟文件流读取失败。

未提供 `contentBaseUrl` 时，模块使用：

```text
{baseUrl}/api/sftp/native-drag/{token}/content/{id}
```

未提供 `manifestUrl` 时，模块使用：

```text
{baseUrl}/api/sftp/native-drag/{token}
```

当 `contentBaseUrl` 不含 `{id}` 时，模块会在末尾追加 `/<index>`。

## 构建

模块只依赖 Node-API 和 Windows SDK：

```powershell
npx node-gyp rebuild --target=<Electron version> --dist-url=https://electronjs.org/headers
```

需要 Visual Studio C++ Build Tools 和 Windows 10/11 SDK。最终 `.node` 必须随桌面端解包分发，不能留在 ASAR 内。

原生取消契约与实际回调可分别检查：

```powershell
npm run check:source
npm run check:cancel
```
