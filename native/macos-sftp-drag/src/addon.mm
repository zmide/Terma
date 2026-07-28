#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import <node_api.h>

#include <algorithm>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

struct TDNativeEvent {
  std::string type;
  std::string sessionId;
  std::string token;
  std::string requestId;
  std::string itemId;
  std::string promisedName;
  std::string targetPath;
  std::string targetDirectory;
  std::string operation;
  std::string message;
  std::string code;
  std::string internalTargetJson;
  bool isDirectory = false;
  bool hasPoint = false;
  bool hasClientPoint = false;
  double screenX = 0;
  double screenY = 0;
  double clientX = 0;
  double clientY = 0;
  double clientScale = 1;
};

static napi_value TDString(napi_env env, const std::string &value) {
  napi_value result = nullptr;
  napi_create_string_utf8(env, value.c_str(), value.size(), &result);
  return result;
}

static void TDSetString(napi_env env,
                        napi_value object,
                        const char *name,
                        const std::string &value) {
  napi_set_named_property(env, object, name, TDString(env, value));
}

static void TDSetBool(napi_env env,
                      napi_value object,
                      const char *name,
                      bool value) {
  napi_value result = nullptr;
  napi_get_boolean(env, value, &result);
  napi_set_named_property(env, object, name, result);
}

static void TDSetDouble(napi_env env,
                        napi_value object,
                        const char *name,
                        double value) {
  napi_value result = nullptr;
  napi_create_double(env, value, &result);
  napi_set_named_property(env, object, name, result);
}

static void TDCallJavaScript(napi_env env,
                             napi_value callback,
                             void *,
                             void *data) {
  std::unique_ptr<TDNativeEvent> event(
      static_cast<TDNativeEvent *>(data));
  if (env == nullptr || callback == nullptr) {
    return;
  }

  napi_value object = nullptr;
  napi_create_object(env, &object);
  TDSetString(env, object, "type", event->type);
  TDSetString(env, object, "sessionId", event->sessionId);
  TDSetString(env, object, "token", event->token);

  if (!event->requestId.empty()) {
    TDSetString(env, object, "requestId", event->requestId);
  }
  if (!event->itemId.empty()) {
    TDSetString(env, object, "itemId", event->itemId);
  }
  if (!event->promisedName.empty()) {
    TDSetString(env, object, "promisedName", event->promisedName);
  }
  if (!event->targetPath.empty()) {
    TDSetString(env, object, "targetPath", event->targetPath);
  }
  if (!event->targetDirectory.empty()) {
    TDSetString(env, object, "targetDirectory", event->targetDirectory);
  }
  if (!event->operation.empty()) {
    TDSetString(env, object, "operation", event->operation);
  }
  if (!event->message.empty()) {
    TDSetString(env, object, "message", event->message);
  }
  if (!event->code.empty()) {
    TDSetString(env, object, "code", event->code);
  }
  if (!event->internalTargetJson.empty()) {
    TDSetString(
        env, object, "internalTargetJson", event->internalTargetJson);
  }
  if (event->type == "writeRequested") {
    TDSetBool(env, object, "isDirectory", event->isDirectory);
  }
  if (event->hasPoint) {
    TDSetDouble(env, object, "screenX", event->screenX);
    TDSetDouble(env, object, "screenY", event->screenY);
  }
  if (event->hasClientPoint) {
    TDSetDouble(env, object, "clientX", event->clientX);
    TDSetDouble(env, object, "clientY", event->clientY);
    TDSetDouble(env, object, "clientScale", event->clientScale);
    TDSetString(env, object, "coordinateSpace", "content-view-css");
  }

  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  napi_value ignored = nullptr;
  napi_call_function(env, undefined, callback, 1, &object, &ignored);
}

static void TDThrow(napi_env env,
                    const char *code,
                    const std::string &message) {
  napi_throw_error(env, code, message.c_str());
}

static bool TDGetString(napi_env env,
                        napi_value value,
                        std::string *output) {
  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string) {
    return false;
  }

  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) !=
      napi_ok) {
    return false;
  }

  std::vector<char> buffer(length + 1, '\0');
  size_t copied = 0;
  if (napi_get_value_string_utf8(
          env, value, buffer.data(), buffer.size(), &copied) != napi_ok) {
    return false;
  }
  output->assign(buffer.data(), copied);
  return true;
}

static bool TDGetNamedValue(napi_env env,
                            napi_value object,
                            const char *name,
                            napi_value *output) {
  bool hasProperty = false;
  if (napi_has_named_property(env, object, name, &hasProperty) != napi_ok ||
      !hasProperty) {
    return false;
  }
  return napi_get_named_property(env, object, name, output) == napi_ok;
}

static bool TDGetNamedString(napi_env env,
                             napi_value object,
                             const char *name,
                             std::string *output) {
  napi_value value = nullptr;
  return TDGetNamedValue(env, object, name, &value) &&
         TDGetString(env, value, output);
}

static bool TDGetNamedBool(napi_env env,
                           napi_value object,
                           const char *name,
                           bool defaultValue) {
  napi_value value = nullptr;
  if (!TDGetNamedValue(env, object, name, &value)) {
    return defaultValue;
  }
  bool result = defaultValue;
  if (napi_get_value_bool(env, value, &result) != napi_ok) {
    return defaultValue;
  }
  return result;
}

static double TDGetNamedDouble(napi_env env,
                               napi_value object,
                               const char *name,
                               double defaultValue) {
  napi_value value = nullptr;
  if (!TDGetNamedValue(env, object, name, &value)) {
    return defaultValue;
  }
  double result = defaultValue;
  if (napi_get_value_double(env, value, &result) != napi_ok) {
    return defaultValue;
  }
  return result;
}

static NSString *TDNSString(const std::string &value) {
  return [[NSString alloc] initWithBytes:value.data()
                                  length:value.size()
                                encoding:NSUTF8StringEncoding];
}

static std::string TDStdString(NSString *value) {
  if (value == nil) {
    return {};
  }
  const char *utf8 = value.UTF8String;
  return utf8 == nullptr ? std::string() : std::string(utf8);
}

static bool TDIsSafePromisedName(NSString *name) {
  if (name.length == 0 || [name isEqualToString:@"."] ||
      [name isEqualToString:@".."]) {
    return false;
  }
  return [name rangeOfString:@"/"].location == NSNotFound &&
         [name rangeOfString:@":"].location == NSNotFound;
}

static void *TDGetNativePointer(napi_env env, napi_value value) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) == napi_ok && isBuffer) {
    void *data = nullptr;
    size_t length = 0;
    if (napi_get_buffer_info(env, value, &data, &length) != napi_ok ||
        data == nullptr || length < sizeof(void *)) {
      return nullptr;
    }
    void *pointer = nullptr;
    std::memcpy(&pointer, data, sizeof(pointer));
    return pointer;
  }

  napi_valuetype type = napi_undefined;
  if (napi_typeof(env, value, &type) == napi_ok && type == napi_bigint) {
    uint64_t raw = 0;
    bool lossless = false;
    if (napi_get_value_bigint_uint64(env, value, &raw, &lossless) ==
            napi_ok &&
        lossless) {
      return reinterpret_cast<void *>(static_cast<uintptr_t>(raw));
    }
  }

  return nullptr;
}

static NSString *TDOperationName(NSDragOperation operation) {
  if ((operation & NSDragOperationCopy) != 0) {
    return @"copy";
  }
  if ((operation & NSDragOperationMove) != 0) {
    return @"move";
  }
  if ((operation & NSDragOperationLink) != 0) {
    return @"link";
  }
  if (operation == NSDragOperationNone) {
    return @"none";
  }
  return @"unknown";
}

static NSError *TDUserCancelledPromiseError(void) {
  return [NSError
      errorWithDomain:NSCocoaErrorDomain
                 code:NSUserCancelledError
             userInfo:@{
               NSLocalizedDescriptionKey : @"用户已取消 SFTP 拖出"
             }];
}

@class TDDragController;

@interface TDPromiseItem : NSObject
@property(nonatomic, copy) NSString *itemId;
@property(nonatomic, copy) NSString *name;
@property(nonatomic, copy) NSString *fileType;
@property(nonatomic, assign) BOOL directory;
@end

@implementation TDPromiseItem
@end

@interface TDFilePromiseDelegate : NSObject <NSFilePromiseProviderDelegate>
@property(nonatomic, weak) TDDragController *controller;
@property(nonatomic, strong) TDPromiseItem *item;
@property(nonatomic, strong) NSOperationQueue *writeQueue;
@end

@interface TDDragController : NSObject <NSDraggingSource> {
 @private
  napi_threadsafe_function _threadsafeFunction;
  std::mutex _eventMutex;
  NSView *_sourceView;
  NSEvent *_mouseDownEvent;
  NSString *_sessionId;
  NSString *_token;
  NSString *_internalTargetJson;
  NSArray<TDPromiseItem *> *_items;
  NSMutableArray<TDFilePromiseDelegate *> *_delegates;
  NSMutableDictionary<NSString *, id> *_pendingCompletions;
  NSMutableDictionary<NSString *, NSString *> *_pendingItemIds;
  NSMutableSet<NSString *> *_completedItems;
  NSLock *_pendingLock;
  id _eventMonitor;
  NSString *_dragImagePath;
  BOOL _armed;
  BOOL _dragging;
  BOOL _ended;
  BOOL _cancelRequested;
  BOOL _promiseWriteObserved;
  BOOL _cancelledEventEmitted;
  NSTimeInterval _armDeadline;
  double _cssScale;
}

- (instancetype)initWithView:(NSView *)view
                    sessionId:(NSString *)sessionId
                        token:(NSString *)token
                        items:(NSArray<TDPromiseItem *> *)items
               mouseDownEvent:(NSEvent *)mouseDownEvent
                dragImagePath:(NSString *)dragImagePath
                 armTimeoutMs:(double)armTimeoutMs
                     cssScale:(double)cssScale
           threadsafeFunction:(napi_threadsafe_function)threadsafeFunction;
- (void)requestWriteForItem:(TDPromiseItem *)item
                      toURL:(NSURL *)url
          completionHandler:(void (^)(NSError *_Nullable))completionHandler;
- (BOOL)completeRequest:(NSString *)requestId error:(NSString *)error;
- (BOOL)containsRequest:(NSString *)requestId;
- (BOOL)cancelIfArmed;
- (BOOL)cancelPromiseWrites;
- (void)finishPendingPromiseWritesAsUserCancelled;
- (void)scheduleCleanupIfFullyCompleted:(NSString *)reason;
- (BOOL)setInternalTarget:(NSString *)targetJson
                sessionId:(NSString *)sessionId;
- (void)disposeWithReason:(NSString *)reason;
- (BOOL)isBusy;
- (BOOL)isEnded;
- (BOOL)isFullyCompleted;
- (NSString *)sessionId;
- (BOOL)emitEvent:(std::unique_ptr<TDNativeEvent>)event;
- (std::unique_ptr<TDNativeEvent>)baseEvent:(const std::string &)type;
- (void)emitError:(NSString *)message code:(NSString *)code;
- (NSEvent *)handleLocalMouseEvent:(NSEvent *)event;
- (NSString *)resolvedFileTypeForItem:(TDPromiseItem *)item;
- (NSImage *)dragImageForItem:(TDPromiseItem *)item;
- (BOOL)beginDraggingWithEvent:(NSEvent *)event;
- (void)populatePointEvent:(TDNativeEvent *)event
               screenPoint:(NSPoint)screenPoint;

@end

static NSMutableArray<TDDragController *> *gControllers = nil;
static TDDragController *gActiveController = nil;
static id gMouseDownMonitor = nil;
static NSEvent *gLastMouseDownEvent = nil;
static NSTimeInterval gLastMouseDownTime = 0;

static void TDCleanupController(TDDragController *controller,
                                BOOL force,
                                NSString *reason);

static void TDEnsureMouseDownMonitor(void) {
  if (![NSThread isMainThread]) {
    dispatch_sync(dispatch_get_main_queue(), ^{
      TDEnsureMouseDownMonitor();
    });
    return;
  }
  if (gMouseDownMonitor != nil) {
    return;
  }
  gMouseDownMonitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown
                                   handler:^NSEvent *_Nullable(
                                       NSEvent *_Nonnull event) {
    gLastMouseDownEvent = event;
    gLastMouseDownTime = [NSProcessInfo processInfo].systemUptime;
    return event;
  }];
}

@implementation TDFilePromiseDelegate

- (instancetype)init {
  self = [super init];
  if (self != nil) {
    _writeQueue = [[NSOperationQueue alloc] init];
    _writeQueue.name = @"com.tunneldesk.sftp-file-promise";
    _writeQueue.maxConcurrentOperationCount = 1;
    _writeQueue.qualityOfService = NSQualityOfServiceUserInitiated;
  }
  return self;
}

- (NSString *)filePromiseProvider:(NSFilePromiseProvider *)filePromiseProvider
              fileNameForType:(NSString *)fileType {
  return self.item.name;
}

- (void)filePromiseProvider:(NSFilePromiseProvider *)filePromiseProvider
          writePromiseToURL:(NSURL *)url
          completionHandler:
              (void (^)(NSError *_Nullable errorOrNil))completionHandler {
  TDDragController *controller = self.controller;
  if (controller == nil) {
    NSError *error = [NSError
        errorWithDomain:@"com.tunneldesk.sftp-drag"
                   code:1007
               userInfo:@{
                 NSLocalizedDescriptionKey :
                     @"SFTP 拖出会话已经结束，无法写入 Promise"
               }];
    completionHandler(error);
    return;
  }
  [controller requestWriteForItem:self.item
                            toURL:url
                completionHandler:completionHandler];
}

- (NSOperationQueue *)operationQueueForFilePromiseProvider:
    (NSFilePromiseProvider *)filePromiseProvider {
  return self.writeQueue;
}

@end

@implementation TDDragController

- (instancetype)initWithView:(NSView *)view
                    sessionId:(NSString *)sessionId
                        token:(NSString *)token
                        items:(NSArray<TDPromiseItem *> *)items
               mouseDownEvent:(NSEvent *)mouseDownEvent
                dragImagePath:(NSString *)dragImagePath
                 armTimeoutMs:(double)armTimeoutMs
                     cssScale:(double)cssScale
           threadsafeFunction:
               (napi_threadsafe_function)threadsafeFunction {
  self = [super init];
  if (self == nil) {
    return nil;
  }

  _sourceView = view;
  _mouseDownEvent = mouseDownEvent;
  _sessionId = [sessionId copy];
  _token = [token copy];
  _items = [items copy];
  _dragImagePath = [dragImagePath copy];
  _threadsafeFunction = threadsafeFunction;
  _delegates = [[NSMutableArray alloc] init];
  _pendingCompletions = [[NSMutableDictionary alloc] init];
  _pendingItemIds = [[NSMutableDictionary alloc] init];
  _completedItems = [[NSMutableSet alloc] init];
  _pendingLock = [[NSLock alloc] init];
  _armed = YES;
  _dragging = NO;
  _ended = NO;
  _cancelRequested = NO;
  _promiseWriteObserved = NO;
  _cancelledEventEmitted = NO;
  _cssScale = std::clamp(cssScale, 0.25, 8.0);

  const double boundedTimeout =
      std::clamp(armTimeoutMs, 1000.0, 30000.0);
  _armDeadline =
      [NSProcessInfo processInfo].systemUptime + boundedTimeout / 1000.0;

  __weak TDDragController *weakSelf = self;
  NSEventMask mask = NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp;
  _eventMonitor =
      [NSEvent addLocalMonitorForEventsMatchingMask:mask
                                            handler:^NSEvent *_Nullable(
                                                NSEvent *_Nonnull event) {
    TDDragController *strongSelf = weakSelf;
    if (strongSelf == nil) {
      return event;
    }
    return [strongSelf handleLocalMouseEvent:event];
  }];

  return self;
}

- (void)dealloc {
  if (_eventMonitor != nil) {
    [NSEvent removeMonitor:_eventMonitor];
    _eventMonitor = nil;
  }
}

- (NSString *)sessionId {
  return _sessionId;
}

- (BOOL)isBusy {
  [_pendingLock lock];
  BOOL hasPending = _pendingCompletions.count > 0;
  [_pendingLock unlock];
  return _armed || _dragging || hasPending;
}

- (BOOL)isEnded {
  return _ended;
}

- (BOOL)isFullyCompleted {
  [_pendingLock lock];
  BOOL done = _ended && _pendingCompletions.count == 0 &&
              _completedItems.count >= _items.count;
  [_pendingLock unlock];
  return done;
}

- (BOOL)emitEvent:(std::unique_ptr<TDNativeEvent>)event {
  napi_status status = napi_generic_failure;
  {
    std::lock_guard<std::mutex> lock(_eventMutex);
    if (_threadsafeFunction == nullptr) {
      return NO;
    }
    status = napi_call_threadsafe_function(
        _threadsafeFunction, event.get(), napi_tsfn_nonblocking);
  }
  if (status != napi_ok) {
    return NO;
  }
  event.release();
  return YES;
}

- (std::unique_ptr<TDNativeEvent>)baseEvent:(const std::string &)type {
  auto event = std::make_unique<TDNativeEvent>();
  event->type = type;
  event->sessionId = TDStdString(_sessionId);
  event->token = TDStdString(_token);
  return event;
}

- (void)emitError:(NSString *)message code:(NSString *)code {
  auto event = [self baseEvent:"error"];
  event->message = TDStdString(message);
  event->code = TDStdString(code);
  [self emitEvent:std::move(event)];
}

- (void)populatePointEvent:(TDNativeEvent *)event
               screenPoint:(NSPoint)screenPoint {
  event->hasPoint = true;
  event->screenX = screenPoint.x;
  event->screenY = screenPoint.y;
  if (_sourceView == nil || _sourceView.window == nil) {
    return;
  }

  NSPoint windowPoint =
      [_sourceView.window convertPointFromScreen:screenPoint];
  NSPoint viewPoint =
      [_sourceView convertPoint:windowPoint fromView:nil];
  const NSRect bounds = _sourceView.bounds;
  const CGFloat pointX = viewPoint.x - NSMinX(bounds);
  const CGFloat pointY = _sourceView.isFlipped
                             ? viewPoint.y - NSMinY(bounds)
                             : NSMaxY(bounds) - viewPoint.y;
  event->hasClientPoint = true;
  event->clientX = pointX / _cssScale;
  event->clientY = pointY / _cssScale;
  event->clientScale = _cssScale;
}

- (NSEvent *)handleLocalMouseEvent:(NSEvent *)event {
  if (!_armed || _dragging || _ended) {
    return event;
  }

  if ([NSProcessInfo processInfo].systemUptime > _armDeadline) {
    _armed = NO;
    _ended = YES;
    [self emitError:@"等待拖动操作超时" code:@"ARM_TIMEOUT"];
    auto ended = [self baseEvent:"ended"];
    ended->operation = "none";
    [self populatePointEvent:ended.get()
                 screenPoint:NSEvent.mouseLocation];
    [self emitEvent:std::move(ended)];
    if (gActiveController == self) {
      gActiveController = nil;
    }
    TDCleanupController(self, NO, @"等待拖动操作超时");
    return event;
  }

  if (_sourceView == nil || _sourceView.window == nil ||
      event.window != _sourceView.window) {
    return event;
  }

  if (event.type == NSEventTypeLeftMouseUp) {
    _armed = NO;
    _ended = YES;
    auto ended = [self baseEvent:"ended"];
    ended->operation = "none";
    [self populatePointEvent:ended.get()
                 screenPoint:NSEvent.mouseLocation];
    [self emitEvent:std::move(ended)];
    TDCleanupController(self, NO, @"拖动已取消");
    return event;
  }

  if (event.type != NSEventTypeLeftMouseDragged) {
    return event;
  }

  if (![self beginDraggingWithEvent:event]) {
    if (_ended) {
      if (gActiveController == self) {
        gActiveController = nil;
      }
      TDCleanupController(self, NO, @"无法启动原生拖动");
    }
    return event;
  }
  return nil;
}

- (NSString *)resolvedFileTypeForItem:(TDPromiseItem *)item {
  if (item.fileType.length > 0) {
    return item.fileType;
  }
  if (item.directory) {
    return UTTypeFolder.identifier;
  }
  NSString *extension = item.name.pathExtension;
  if (extension.length > 0) {
    UTType *type = [UTType typeWithFilenameExtension:extension];
    if (type.identifier.length > 0) {
      return type.identifier;
    }
  }
  return UTTypeData.identifier;
}

- (NSImage *)dragImageForItem:(TDPromiseItem *)item {
  NSImage *image = nil;
  if (_dragImagePath.length > 0) {
    image = [[NSImage alloc] initWithContentsOfFile:_dragImagePath];
  }
  if (image == nil) {
    NSString *type = [self resolvedFileTypeForItem:item];
    image = [[NSWorkspace sharedWorkspace] iconForFileType:type];
  }
  if (image == nil) {
    image = [NSImage imageNamed:NSImageNameMultipleDocuments];
  }
  image = [image copy];
  image.size = NSMakeSize(32, 32);
  return image;
}

- (BOOL)beginDraggingWithEvent:(NSEvent *)event {
  if (_items.count == 0 || _sourceView == nil) {
    [self emitError:@"没有可拖动的 SFTP 项目"
               code:@"EMPTY_MANIFEST"];
    _armed = NO;
    return NO;
  }
  if (_mouseDownEvent == nil ||
      _mouseDownEvent.type != NSEventTypeLeftMouseDown ||
      _mouseDownEvent.window != _sourceView.window) {
    [self emitError:
              @"没有捕获到本次拖动的原生鼠标按下事件，请确认模块在交互前已加载"
               code:@"MOUSE_DOWN_NOT_CAPTURED"];
    _armed = NO;
    _ended = YES;
    return NO;
  }

  NSMutableArray<NSDraggingItem *> *draggingItems =
      [[NSMutableArray alloc] initWithCapacity:_items.count];
  [_delegates removeAllObjects];

  NSPoint point =
      [_sourceView convertPoint:event.locationInWindow fromView:nil];
  NSUInteger index = 0;
  for (TDPromiseItem *item in _items) {
    TDFilePromiseDelegate *delegate =
        [[TDFilePromiseDelegate alloc] init];
    delegate.controller = self;
    delegate.item = item;
    [_delegates addObject:delegate];

    NSFilePromiseProvider *provider = [[NSFilePromiseProvider alloc]
        initWithFileType:[self resolvedFileTypeForItem:item]
                delegate:delegate];
    NSDraggingItem *draggingItem =
        [[NSDraggingItem alloc] initWithPasteboardWriter:provider];

    const CGFloat offset =
        std::min<NSUInteger>(index, 6) * static_cast<CGFloat>(2);
    NSRect frame = NSMakeRect(point.x - 16 + offset,
                              point.y - 16 - offset,
                              32,
                              32);
    [draggingItem setDraggingFrame:frame
                          contents:[self dragImageForItem:item]];
    [draggingItems addObject:draggingItem];
    index += 1;
  }

  _armed = NO;
  _dragging = YES;
  NSDraggingSession *session =
      [_sourceView beginDraggingSessionWithItems:draggingItems
                                          event:_mouseDownEvent
                                         source:self];
  if (session == nil) {
    _dragging = NO;
    _ended = YES;
    [self emitError:@"AppKit 无法启动 SFTP 文件拖动"
               code:@"SESSION_START_FAILED"];
    return NO;
  }

  session.animatesToStartingPositionsOnCancelOrFail = YES;
  session.draggingFormation =
      draggingItems.count > 1 ? NSDraggingFormationList
                              : NSDraggingFormationDefault;

  auto started = [self baseEvent:"started"];
  [self emitEvent:std::move(started)];
  return YES;
}

- (NSDragOperation)draggingSession:(NSDraggingSession *)session
    sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  return NSDragOperationCopy;
}

- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session {
  return YES;
}

- (void)draggingSession:(NSDraggingSession *)session
           movedToPoint:(NSPoint)screenPoint {
  auto motion = [self baseEvent:"motion"];
  [self populatePointEvent:motion.get() screenPoint:screenPoint];
  [self emitEvent:std::move(motion)];
}

- (void)draggingSession:(NSDraggingSession *)session
          endedAtPoint:(NSPoint)screenPoint
             operation:(NSDragOperation)operation {
  _dragging = NO;
  _ended = YES;
  if (_eventMonitor != nil) {
    [NSEvent removeMonitor:_eventMonitor];
    _eventMonitor = nil;
  }

  auto ended = [self baseEvent:"ended"];
  ended->operation = TDStdString(TDOperationName(operation));
  [self populatePointEvent:ended.get() screenPoint:screenPoint];
  ended->internalTargetJson = TDStdString(_internalTargetJson);
  [self emitEvent:std::move(ended)];

  if (gActiveController == self) {
    gActiveController = nil;
  }

  if (operation == NSDragOperationNone) {
    [self finishPendingPromiseWritesAsUserCancelled];
    TDCleanupController(self, YES, @"拖动已取消");
    return;
  }

  __weak TDDragController *weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW,
                    static_cast<int64_t>(3600 * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        TDDragController *strongSelf = weakSelf;
        if (strongSelf != nil) {
          TDCleanupController(
              strongSelf, YES, @"SFTP 文件 Promise 等待超时");
        }
      });
}

- (void)requestWriteForItem:(TDPromiseItem *)item
                      toURL:(NSURL *)url
          completionHandler:
              (void (^)(NSError *_Nullable))completionHandler {
  if (!url.isFileURL || url.path.length == 0) {
    NSError *error = [NSError
        errorWithDomain:@"com.tunneldesk.sftp-drag"
                   code:1002
               userInfo:@{
                 NSLocalizedDescriptionKey : @"Finder 没有提供有效的目标路径"
               }];
    completionHandler(error);
    [self emitError:error.localizedDescription
               code:@"INVALID_DESTINATION"];
    return;
  }

  NSString *requestId = NSUUID.UUID.UUIDString;
  BOOL cancelled = NO;
  [_pendingLock lock];
  _promiseWriteObserved = YES;
  cancelled = _cancelRequested;
  if (cancelled) {
    if (item.itemId.length > 0) {
      [_completedItems addObject:item.itemId];
    }
  } else {
    _pendingCompletions[requestId] = [completionHandler copy];
    _pendingItemIds[requestId] = item.itemId;
  }
  [_pendingLock unlock];

  if (cancelled) {
    completionHandler(TDUserCancelledPromiseError());
    [self scheduleCleanupIfFullyCompleted:@"SFTP 文件 Promise 已取消"];
    return;
  }

  auto request = [self baseEvent:"writeRequested"];
  request->requestId = TDStdString(requestId);
  request->itemId = TDStdString(item.itemId);
  request->promisedName = TDStdString(item.name);
  request->targetPath = TDStdString(url.path);
  request->targetDirectory =
      TDStdString(url.URLByDeletingLastPathComponent.path);
  request->isDirectory = item.directory;

  if (![self emitEvent:std::move(request)]) {
    [self completeRequest:requestId
                    error:@"无法把文件写入请求发送给 TunnelDesk"];
  }
}

- (BOOL)containsRequest:(NSString *)requestId {
  [_pendingLock lock];
  BOOL found = _pendingCompletions[requestId] != nil;
  [_pendingLock unlock];
  return found;
}

- (BOOL)completeRequest:(NSString *)requestId error:(NSString *)error {
  __block void (^completion)(NSError *_Nullable) = nil;
  __block NSString *itemId = nil;
  [_pendingLock lock];
  completion = _pendingCompletions[requestId];
  if (completion != nil) {
    itemId = _pendingItemIds[requestId];
    [_pendingCompletions removeObjectForKey:requestId];
    [_pendingItemIds removeObjectForKey:requestId];
    if (itemId.length > 0) {
      // Finder may ask the same NSFilePromiseProvider to write more than once.
      // Count the promised top-level item, not the number of AppKit callbacks,
      // otherwise duplicate requests can make the drag session look complete
      // before the remaining items have been delivered.
      [_completedItems addObject:itemId];
    }
  }
  [_pendingLock unlock];

  if (completion == nil) {
    return NO;
  }

  NSError *nativeError = nil;
  if (error.length > 0) {
    nativeError = [NSError
        errorWithDomain:@"com.tunneldesk.sftp-drag"
                   code:1003
               userInfo:@{NSLocalizedDescriptionKey : error}];
  }
  completion(nativeError);

  [self scheduleCleanupIfFullyCompleted:@"SFTP 文件 Promise 已全部完成"];
  return YES;
}

- (void)scheduleCleanupIfFullyCompleted:(NSString *)reason {
  if (![self isFullyCompleted]) {
    return;
  }
  __weak TDDragController *weakSelf = self;
  dispatch_after(
      dispatch_time(DISPATCH_TIME_NOW,
                    static_cast<int64_t>(2 * NSEC_PER_SEC)),
      dispatch_get_main_queue(), ^{
        TDDragController *strongSelf = weakSelf;
        // Finder may enqueue another request for an already completed item
        // during the grace period. Re-check pending requests before releasing
        // delegates and the thread-safe callback.
        if (strongSelf != nil && [strongSelf isFullyCompleted]) {
          TDCleanupController(strongSelf, NO, reason);
        }
      });
}

- (void)finishPendingPromiseWritesAsUserCancelled {
  NSDictionary<NSString *, id> *pending = nil;
  [_pendingLock lock];
  _cancelRequested = YES;
  pending = [_pendingCompletions copy];
  for (NSString *requestId in pending) {
    NSString *itemId = _pendingItemIds[requestId];
    if (itemId.length > 0) {
      [_completedItems addObject:itemId];
    }
  }
  [_pendingCompletions removeAllObjects];
  [_pendingItemIds removeAllObjects];
  [_pendingLock unlock];

  NSError *error = TDUserCancelledPromiseError();
  for (id blockObject in pending.allValues) {
    void (^completion)(NSError *_Nullable) = blockObject;
    completion(error);
  }
}

- (BOOL)cancelPromiseWrites {
  [_pendingLock lock];
  BOOL alreadyCancelled = _cancelRequested;
  BOOL hasOutstandingPromiseWork =
      _promiseWriteObserved &&
      (_pendingCompletions.count > 0 ||
       _completedItems.count < _items.count);
  [_pendingLock unlock];

  if (alreadyCancelled) {
    return YES;
  }
  if (_dragging || !_ended || !hasOutstandingPromiseWork) {
    return NO;
  }

  [self finishPendingPromiseWritesAsUserCancelled];
  if (!_cancelledEventEmitted) {
    _cancelledEventEmitted = YES;
    auto cancelled = [self baseEvent:"cancelled"];
    cancelled->message = "用户已取消 SFTP 拖出";
    [self emitEvent:std::move(cancelled)];
  }
  [self scheduleCleanupIfFullyCompleted:@"SFTP 文件 Promise 已取消"];
  return YES;
}

- (BOOL)cancelIfArmed {
  if (!_armed || _dragging) {
    return NO;
  }
  _armed = NO;
  _ended = YES;
  if (_eventMonitor != nil) {
    [NSEvent removeMonitor:_eventMonitor];
    _eventMonitor = nil;
  }
  auto ended = [self baseEvent:"ended"];
  ended->operation = "none";
  [self populatePointEvent:ended.get()
               screenPoint:NSEvent.mouseLocation];
  [self emitEvent:std::move(ended)];
  if (gActiveController == self) {
    gActiveController = nil;
  }
  return YES;
}

- (BOOL)setInternalTarget:(NSString *)targetJson
                sessionId:(NSString *)sessionId {
  if (![_sessionId isEqualToString:sessionId] || _ended) {
    return NO;
  }
  _internalTargetJson = [targetJson copy];
  return YES;
}

- (void)disposeWithReason:(NSString *)reason {
  _armed = NO;
  _dragging = NO;
  _ended = YES;
  if (_eventMonitor != nil) {
    [NSEvent removeMonitor:_eventMonitor];
    _eventMonitor = nil;
  }

  [_pendingLock lock];
  NSDictionary<NSString *, id> *pending =
      [_pendingCompletions copy];
  [_pendingCompletions removeAllObjects];
  [_pendingItemIds removeAllObjects];
  [_pendingLock unlock];

  NSError *error = [NSError
      errorWithDomain:@"com.tunneldesk.sftp-drag"
                 code:1006
             userInfo:@{
               NSLocalizedDescriptionKey :
                   reason.length > 0 ? reason : @"SFTP 拖出会话已结束"
             }];
  for (id blockObject in pending.allValues) {
    void (^completion)(NSError *_Nullable) = blockObject;
    completion(error);
  }

  [_delegates removeAllObjects];
  {
    std::lock_guard<std::mutex> lock(_eventMutex);
    if (_threadsafeFunction != nullptr) {
      napi_release_threadsafe_function(
          _threadsafeFunction, napi_tsfn_release);
      _threadsafeFunction = nullptr;
    }
  }
}

@end

static void TDEnsureControllers(void) {
  if (gControllers == nil) {
    gControllers = [[NSMutableArray alloc] init];
  }
}

static void TDCleanupController(TDDragController *controller,
                                BOOL force,
                                NSString *reason) {
  if (![NSThread isMainThread]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      TDCleanupController(controller, force, reason);
    });
    return;
  }

  TDEnsureControllers();
  if (![gControllers containsObject:controller]) {
    return;
  }
  if (!force && [controller isBusy] && ![controller isFullyCompleted]) {
    return;
  }

  if (gActiveController == controller) {
    gActiveController = nil;
  }
  [controller disposeWithReason:reason];
  [gControllers removeObject:controller];
}

static napi_value TDProbe(napi_env env, napi_callback_info info) {
  TDEnsureMouseDownMonitor();
  napi_value result = nullptr;
  napi_create_object(env, &result);
  TDSetBool(env, result, "available", true);
  TDSetBool(env, result, "supported", true);
  TDSetString(env, result, "platform", "darwin");
  TDSetDouble(env, result, "apiVersion", 1);
  TDSetBool(env, result, "delayed", true);
  TDSetString(
      env,
      result,
      "protocol",
      "NSFilePromiseProvider/NSDraggingSession");
  TDSetString(env, result, "mode", "file-promise");
  TDSetBool(env, result, "oneGesture", true);
  TDSetBool(env, result, "delayedContent", true);
  TDSetBool(env, result, "multipleItems", true);
  TDSetBool(env, result, "directories", true);
  return result;
}

static napi_value TDStartDrag(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    TDThrow(env,
            "ERR_INVALID_ARG",
            "startDrag(spec, onEvent) 需要拖动参数和事件回调");
    return nullptr;
  }

  napi_valuetype specType = napi_undefined;
  napi_valuetype callbackType = napi_undefined;
  napi_typeof(env, argv[0], &specType);
  napi_typeof(env, argv[1], &callbackType);
  if (specType != napi_object || callbackType != napi_function) {
    TDThrow(env,
            "ERR_INVALID_ARG",
            "startDrag 的 spec 必须是对象，onEvent 必须是函数");
    return nullptr;
  }

  napi_value handleValue = nullptr;
  if (!TDGetNamedValue(env, argv[0], "viewHandle", &handleValue)) {
    TDThrow(env, "ERR_INVALID_VIEW", "缺少 macOS 原生 viewHandle");
    return nullptr;
  }
  void *nativePointer = TDGetNativePointer(env, handleValue);
  if (nativePointer == nullptr) {
    TDThrow(env,
            "ERR_INVALID_VIEW",
            "viewHandle 不是有效的原生指针 Buffer 或 bigint");
    return nullptr;
  }

  std::string tokenString;
  if (!TDGetNamedString(env, argv[0], "token", &tokenString) ||
      tokenString.empty()) {
    TDThrow(env, "ERR_INVALID_TOKEN", "缺少 SFTP 拖出票据 token");
    return nullptr;
  }

  std::string sessionString;
  if (!TDGetNamedString(
          env, argv[0], "sessionId", &sessionString) ||
      sessionString.empty()) {
    sessionString = TDStdString(NSUUID.UUID.UUIDString);
  }

  napi_value itemsValue = nullptr;
  bool isArray = false;
  if (!TDGetNamedValue(env, argv[0], "items", &itemsValue) ||
      napi_is_array(env, itemsValue, &isArray) != napi_ok || !isArray) {
    TDThrow(env, "ERR_INVALID_ITEMS", "items 必须是非空数组");
    return nullptr;
  }

  uint32_t itemCount = 0;
  napi_get_array_length(env, itemsValue, &itemCount);
  if (itemCount == 0 || itemCount > 512) {
    TDThrow(env,
            "ERR_INVALID_ITEMS",
            "一次拖动必须包含 1 到 512 个顶层项目");
    return nullptr;
  }

  NSMutableArray<TDPromiseItem *> *items =
      [[NSMutableArray alloc] initWithCapacity:itemCount];
  NSMutableSet<NSString *> *itemIds =
      [[NSMutableSet alloc] initWithCapacity:itemCount];
  for (uint32_t index = 0; index < itemCount; index += 1) {
    napi_value itemValue = nullptr;
    if (napi_get_element(env, itemsValue, index, &itemValue) != napi_ok) {
      TDThrow(env, "ERR_INVALID_ITEM", "无法读取拖动项目");
      return nullptr;
    }

    std::string idString;
    std::string nameString;
    std::string fileTypeString;
    if (!TDGetNamedString(env, itemValue, "id", &idString) ||
        idString.empty() ||
        !TDGetNamedString(env, itemValue, "name", &nameString) ||
        nameString.empty()) {
      TDThrow(env,
              "ERR_INVALID_ITEM",
              "每个拖动项目都必须包含 id 和 name");
      return nullptr;
    }
    TDGetNamedString(
        env, itemValue, "fileType", &fileTypeString);

    NSString *name = TDNSString(nameString);
    if (!TDIsSafePromisedName(name)) {
      TDThrow(env,
              "ERR_INVALID_ITEM_NAME",
              "Promise 文件名不能包含路径分隔符");
      return nullptr;
    }

    NSString *itemId = TDNSString(idString);
    if ([itemIds containsObject:itemId]) {
      TDThrow(env,
              "ERR_DUPLICATE_ITEM_ID",
              "每个拖动项目的 id 必须唯一");
      return nullptr;
    }
    [itemIds addObject:itemId];

    TDPromiseItem *item = [[TDPromiseItem alloc] init];
    item.itemId = itemId;
    item.name = name;
    item.fileType = TDNSString(fileTypeString);
    item.directory =
        TDGetNamedBool(env, itemValue, "isDirectory", false);
    [items addObject:item];
  }

  std::string dragImageString;
  TDGetNamedString(
      env, argv[0], "dragImagePath", &dragImageString);
  const double armTimeoutMs =
      TDGetNamedDouble(env, argv[0], "armTimeoutMs", 10000);
  const double cssScale =
      TDGetNamedDouble(env, argv[0], "cssScale", 1);

  napi_value resourceName = TDString(env, "TunnelDesk macOS SFTP drag");
  napi_threadsafe_function threadsafeFunction = nullptr;
  napi_status functionStatus = napi_create_threadsafe_function(
      env,
      argv[1],
      nullptr,
      resourceName,
      0,
      1,
      nullptr,
      nullptr,
      nullptr,
      TDCallJavaScript,
      &threadsafeFunction);
  if (functionStatus != napi_ok || threadsafeFunction == nullptr) {
    TDThrow(
        env, "ERR_CALLBACK_INIT", "无法创建原生拖动事件通道");
    return nullptr;
  }

  __block TDDragController *controller = nil;
  void (^createController)(void) = ^{
    TDEnsureMouseDownMonitor();
    TDEnsureControllers();
    if (gActiveController != nil && [gActiveController isBusy]) {
      return;
    }

    NSView *view = (__bridge NSView *)nativePointer;
    NSEvent *mouseDownEvent = gLastMouseDownEvent;
    const NSTimeInterval mouseDownAge =
        [NSProcessInfo processInfo].systemUptime - gLastMouseDownTime;
    NSEvent *currentEvent = NSApp.currentEvent;
    if (currentEvent.type == NSEventTypeLeftMouseDown) {
      mouseDownEvent = currentEvent;
      gLastMouseDownEvent = currentEvent;
      gLastMouseDownTime = [NSProcessInfo processInfo].systemUptime;
    } else if (mouseDownAge < 0 || mouseDownAge > 5 ||
               mouseDownEvent.window != view.window) {
      mouseDownEvent = nil;
    }
    controller = [[TDDragController alloc]
              initWithView:view
                 sessionId:TDNSString(sessionString)
                     token:TDNSString(tokenString)
                     items:items
            mouseDownEvent:mouseDownEvent
             dragImagePath:TDNSString(dragImageString)
              armTimeoutMs:armTimeoutMs
                  cssScale:cssScale
        threadsafeFunction:threadsafeFunction];
    if (controller != nil) {
      [gControllers addObject:controller];
      gActiveController = controller;
    }
  };

  if ([NSThread isMainThread]) {
    createController();
  } else {
    dispatch_sync(dispatch_get_main_queue(), createController);
  }

  if (controller == nil) {
    napi_release_threadsafe_function(
        threadsafeFunction, napi_tsfn_abort);
    TDThrow(env,
            "ERR_DRAG_BUSY",
            "另一个 macOS SFTP 原生拖动仍在进行");
    return nullptr;
  }

  napi_value result = nullptr;
  napi_create_object(env, &result);
  TDSetString(env, result, "sessionId", sessionString);
  TDSetString(env, result, "state", "armed");
  return result;
}

static napi_value TDCompleteWrite(napi_env env,
                                  napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  std::string requestString;
  if (argc < 1 || !TDGetString(env, argv[0], &requestString) ||
      requestString.empty()) {
    TDThrow(env,
            "ERR_INVALID_REQUEST",
            "completeWrite 需要有效的 requestId");
    return nullptr;
  }

  std::string errorString;
  if (argc >= 2) {
    napi_valuetype type = napi_undefined;
    napi_typeof(env, argv[1], &type);
    if (type == napi_string) {
      TDGetString(env, argv[1], &errorString);
    }
  }

  __block BOOL completed = NO;
  void (^completeBlock)(void) = ^{
    TDEnsureControllers();
    NSString *requestId = TDNSString(requestString);
    for (TDDragController *controller in [gControllers copy]) {
      if ([controller containsRequest:requestId]) {
        completed =
            [controller completeRequest:requestId
                                  error:TDNSString(errorString)];
        break;
      }
    }
  };
  if ([NSThread isMainThread]) {
    completeBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), completeBlock);
  }

  napi_value result = nullptr;
  napi_get_boolean(env, completed, &result);
  return result;
}

static napi_value TDCancelDrag(napi_env env,
                               napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  std::string sessionString;
  if (argc >= 1) {
    napi_valuetype type = napi_undefined;
    napi_typeof(env, argv[0], &type);
    if (type == napi_string) {
      TDGetString(env, argv[0], &sessionString);
    }
  }

  __block BOOL cancelled = NO;
  void (^cancelBlock)(void) = ^{
    TDEnsureControllers();
    TDDragController *controller = nil;
    NSString *requestedSession =
        sessionString.empty() ? nil : TDNSString(sessionString);
    if (requestedSession.length > 0) {
      for (TDDragController *candidate in [gControllers reverseObjectEnumerator]) {
        if ([[candidate sessionId] isEqualToString:requestedSession]) {
          controller = candidate;
          break;
        }
      }
    } else {
      controller = gActiveController;
    }
    if (controller == nil) {
      return;
    }
    cancelled = [controller cancelIfArmed];
    if (cancelled) {
      TDCleanupController(controller, YES, @"拖动已取消");
      return;
    }
    cancelled = [controller cancelPromiseWrites];
  };
  if ([NSThread isMainThread]) {
    cancelBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), cancelBlock);
  }

  napi_value result = nullptr;
  napi_get_boolean(env, cancelled, &result);
  return result;
}

static napi_value TDSetInternalTarget(napi_env env,
                                      napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);

  std::string sessionString;
  if (argc < 1 || !TDGetString(env, argv[0], &sessionString) ||
      sessionString.empty()) {
    TDThrow(env,
            "ERR_INVALID_SESSION",
            "setInternalTarget 需要 sessionId");
    return nullptr;
  }

  std::string targetString;
  if (argc >= 2) {
    napi_valuetype type = napi_undefined;
    napi_typeof(env, argv[1], &type);
    if (type == napi_string) {
      TDGetString(env, argv[1], &targetString);
    }
  }

  __block BOOL updated = NO;
  void (^updateBlock)(void) = ^{
    TDEnsureControllers();
    for (TDDragController *controller in gControllers) {
      if ([[controller sessionId]
              isEqualToString:TDNSString(sessionString)]) {
        updated = [controller
            setInternalTarget:
                (targetString.empty() ? nil : TDNSString(targetString))
                     sessionId:TDNSString(sessionString)];
        break;
      }
    }
  };
  if ([NSThread isMainThread]) {
    updateBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), updateBlock);
  }

  napi_value result = nullptr;
  napi_get_boolean(env, updated, &result);
  return result;
}

static void TDDisposeAll(void *) {
  void (^disposeBlock)(void) = ^{
    TDEnsureControllers();
    for (TDDragController *controller in [gControllers copy]) {
      TDCleanupController(
          controller, YES, @"TunnelDesk 正在关闭");
    }
    gActiveController = nil;
    if (gMouseDownMonitor != nil) {
      [NSEvent removeMonitor:gMouseDownMonitor];
      gMouseDownMonitor = nil;
      gLastMouseDownEvent = nil;
      gLastMouseDownTime = 0;
    }
  };
  if ([NSThread isMainThread]) {
    disposeBlock();
  } else {
    dispatch_sync(dispatch_get_main_queue(), disposeBlock);
  }
}

static napi_value TDDispose(napi_env env, napi_callback_info info) {
  TDDisposeAll(nullptr);
  napi_value undefined = nullptr;
  napi_get_undefined(env, &undefined);
  return undefined;
}

static napi_value TDInit(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"probe", nullptr, TDProbe, nullptr, nullptr, nullptr, napi_default,
       nullptr},
      {"startDrag", nullptr, TDStartDrag, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"completeWrite", nullptr, TDCompleteWrite, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"cancelDrag", nullptr, TDCancelDrag, nullptr, nullptr, nullptr,
       napi_default, nullptr},
      {"setInternalTarget", nullptr, TDSetInternalTarget, nullptr, nullptr,
       nullptr, napi_default, nullptr},
      {"dispose", nullptr, TDDispose, nullptr, nullptr, nullptr, napi_default,
       nullptr},
  };
  napi_define_properties(
      env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, TDDisposeAll, nullptr);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, TDInit)
