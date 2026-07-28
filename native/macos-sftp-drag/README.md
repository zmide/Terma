# macOS SFTP 原生拖出模块

该模块只负责把一次鼠标拖动转换为 macOS 的 `NSFilePromiseProvider` /
`NSDraggingSession`。它不会提前下载远端内容，也不会接触 SSH 密码或私钥。
Finder 接受拖放并确定目标路径后，模块通过事件请求 TunnelDesk 后端写入文件。

## 导出接口

### `probe()`

返回平台能力。成功加载时固定为：

```js
{
  available: true,
  supported: true,
  platform: "darwin",
  apiVersion: 1,
  delayed: true,
  protocol: "NSFilePromiseProvider/NSDraggingSession",
  mode: "file-promise",
  oneGesture: true,
  delayedContent: true,
  multipleItems: true,
  directories: true
}
```

### `startDrag(spec, onEvent)`

桌面主进程应在窗口创建时加载模块并先调用一次 `probe()`，这样模块能在 Chromium
处理事件前保存原生 `leftMouseDown`。在渲染端收到 `pointerdown` 后调用
`startDrag` 并进入“已武装”状态；模块监听同一窗口随后出现的原生
`leftMouseDragged`，用之前保存的按下事件直接启动系统拖放，因此用户只需要
拖动一次。

```js
const result = nativeDrag.startDrag(
  {
    viewHandle: browserWindow.getNativeWindowHandle(),
    token: dragTicket.token,
    sessionId: dragTicket.sessionId,
    items: [
      {
        id: manifestItem.id,
        name: manifestItem.name,
        isDirectory: manifestItem.isDirectory,
        fileType: manifestItem.uti
      }
    ],
    dragImagePath: optionalSmallIconPath,
    armTimeoutMs: 10000,
    // AppKit point / renderer CSS pixel；webContents zoomFactor 为 1 时填 1。
    cssScale: 1
  },
  (event) => {
    // 见下方事件说明。
  }
);
```

`viewHandle` 必须是 Electron `BrowserWindow.getNativeWindowHandle()` 返回的
`Buffer`（macOS 中保存 `NSView *`），也可传指针 `bigint`。文件名必须是单个
安全的文件名，不能包含路径分隔符。一次最多拖动 512 个顶层项目。

### `writeRequested`

Finder 接受拖放后，会为需要写入的顶层项目发出请求：

```js
{
  type: "writeRequested",
  sessionId,
  token,
  requestId,
  itemId,
  promisedName,
  targetPath,
  targetDirectory,
  isDirectory
}
```

后端应使用票据 `token` 和 `itemId` 将对应远端文件或目录写到
`targetPath`。`targetDirectory` 同时提供给只支持“投递到目录”的后端接口。
Finder 遇到同名项目时可能让 `targetPath` 使用不同于 `promisedName` 的唯一名称；
调用方必须遵循 AppKit 约定写入 Finder 提供的完整路径，不能自行改回承诺名称。
写入完成后必须调用：

```js
nativeDrag.completeWrite(requestId);
// 或：
nativeDrag.completeWrite(requestId, "写入失败原因");
```

模块收到回告后才会调用 AppKit 的 Promise 完成回调。

Finder 可能对同一个顶层项目重复请求写入。每次回调都有独立的 `requestId`，
但会保留相同的 `itemId`；调用方必须逐个完成这些 `requestId`。模块内部按
`itemId` 统计项目完成状态，重复请求不会重复增加完成数量，也不会让尚有其他
项目未交付的拖动会话提前清理。

### 其他事件

- `started`：系统原生拖放已经开始。
- `motion`：拖动中的屏幕坐标，以及相对 Electron content view 左上角的
  `clientX/clientY`。后两者已除以 `cssScale`，坐标空间标记为
  `content-view-css`，可直接用于工作区标签命中、切换和内部目标反馈。
- `ended`：系统拖放结束，带有相同的屏幕/内容区坐标及
  `copy` / `move` / `link` / `none` 操作结果。
- `cancelled`：应用在 Finder 已发起 File Promise 写入后接受了取消请求。尚未完成以及
  随后到达的 Promise 回调都会收到
  `NSCocoaErrorDomain / NSUserCancelledError`，Finder 会把它识别为用户取消，而不是普通读取失败。
- `error`：参数、原生会话或 Promise 请求失败。

### 其他方法

- `setInternalTarget(sessionId, targetJson)`：保存当前 TunnelDesk 内部 SFTP
  投放目标；结束事件会原样带回该 JSON，供桌面端完成跨主机复制。
- `cancelDrag(sessionId?)`：取消尚未进入原生拖动的已武装状态；Finder 已经发出
  `writeRequested` 后也可请求取消，成功接受时返回 `true` 并发送一次 `cancelled`。
  AppKit 正在跟随鼠标的 `NSDraggingSession` 没有公开的程序化取消接口，此阶段仍只能由用户
  松开或按 Esc 结束，因此返回 `false`。
- 原生模块只能结束 File Promise 回调，不能自行中止调用方已经开始的 SFTP 写入。
  调用方接受取消后还必须通过 `AbortSignal` 或等价取消句柄中断对应的
  `writeRequested` 投递，并在投递真正结束前保留拖出票据；取消后的迟到
  `completeWrite(requestId, ...)` 会返回 `false`，不能据此提前释放票据。
- `dispose()`：移除事件监听并让所有尚未完成的 Promise 失败；应用退出时调用。

## 构建

模块使用 Node-API C 接口，不依赖 `node-addon-api`。在 macOS 上使用 Electron
对应版本的头文件重建，例如：

```bash
npx node-gyp rebuild \
  --directory native/macos-sftp-drag \
  --target="$ELECTRON_VERSION" \
  --dist-url=https://electronjs.org/headers \
  --arch=x64
```

Apple Silicon 构建时使用 `--arch=arm64`。生成文件位于
`native/macos-sftp-drag/build/Release/tunneldesk_macos_sftp_drag.node`，
打包时必须放入 `asarUnpack`，并随应用一起签名。

## 尚需真机确认

- Intel 与 Apple Silicon 上 Finder 对多文件、目录和同名冲突的实际行为。
- Electron 当前版本返回的 `NSView *` 与本模块原生事件监听是否稳定配合。
- Finder、桌面和其他支持文件 Promise 的目标应用之间的拖放兼容性。
- 签名、公证后的 `.node` 是否被正确装入安装版和便携运行目录。
