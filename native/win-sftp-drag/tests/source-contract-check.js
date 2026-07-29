"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "src", "addon.cc"),
  "utf8"
);

assert.match(
  source,
  /if \(fetch_result == HRESULT_FROM_WIN32\(ERROR_CANCELLED\)[\s\S]*return CancelledReadResult\(nullptr\);[\s\S]*session_->Emit\("contentError",\s*error,\s*\{\},\s*STG_E_READFAULT\);[\s\S]*return STG_E_READFAULT;/,
  "IStream cancellation must bypass contentError while real read failures remain STG_E_READFAULT"
);
const cancelledFetchBody =
  /if \(fetch_result == HRESULT_FROM_WIN32\(ERROR_CANCELLED\) \|\|[\s\S]*?\) \{([\s\S]*?)\n\s+\}/
    .exec(source)?.[1] || "";
assert.match(cancelledFetchBody, /return CancelledReadResult\(nullptr\)/);
assert.doesNotMatch(
  cancelledFetchBody,
  /contentError|STG_E_READFAULT/,
  "A cancelled IStream read must not emit contentError or return a storage fault"
);
assert.match(
  source,
  /HRESULT CancelledReadResult\([\s\S]*HRESULT_FROM_WIN32\(ERROR_CANCELLED\)/,
  "Cancelled virtual-file reads must return the Windows user-cancellation HRESULT"
);
assert.match(
  source,
  /HRESULT FetchRange\([\s\S]*session->cancelled\.load\(\)[\s\S]*CancelledReadResult\(error\)/,
  "Range reads must preserve user cancellation instead of converting it to a storage fault"
);
assert.match(
  source,
  /if \(status != 206\)/,
  "Range reads must require HTTP 206"
);
assert.match(
  source,
  /WINHTTP_QUERY_CUSTOM,\s*L"Content-Range"/,
  "Range reads must query Content-Range"
);
assert.match(
  source,
  /response_start != offset \|\| response_end != end \|\|\s*response_total != item\.size/,
  "Content-Range must match the requested range and full item size"
);
assert.match(
  source,
  /if \(output->size\(\) != fetch_length\)/,
  "Short HTTP responses must fail instead of returning a truncated stream"
);
assert.match(
  source,
  /session->Emit\("error", "Windows drag-and-drop failed"/,
  "RunDrag final failures must remain terminal error events"
);
assert.match(
  source,
  /waitForActivation/,
  "Windows drag must support pointer-down preparation before activation"
);
assert.match(
  source,
  /activation_cv\.wait_for/,
  "An armed drag must sleep instead of polling the pointer"
);
assert.match(
  source,
  /CoWaitForMultipleHandles\([\s\S]*COWAIT_DISPATCH_CALLS \| COWAIT_DISPATCH_WINDOW_MESSAGES/,
  "Explorer asynchronous reads must keep the COM STA responsive"
);
assert.match(
  source,
  /data_object->SetAsyncMode\(TRUE\)[\s\S]*SHDoDragDrop/,
  "The data source must opt into Explorer asynchronous extraction before drag/drop"
);
assert.doesNotMatch(
  source,
  /FD_PROGRESSUI/,
  "Virtual descriptors must let Explorer own the background copy UI"
);
assert.match(
  source,
  /SHDoDragDrop\([\s\S]*input_attachment\.Detach\(\)[\s\S]*CoWaitForMultipleHandles/,
  "The worker must detach from Electron input before background content delivery"
);
assert.match(
  source,
  /EndOperation\(HRESULT result,[\s\S]*async_result\.store\(result\)[\s\S]*async_in_operation\.store\(false\)/,
  "EndOperation must publish Explorer's result before completing the async operation"
);
assert.match(
  source,
  /HRESULT async_result = session->async_result\.load\(\)[\s\S]*FAILED\(async_result\)[\s\S]*Windows background file copy failed[\s\S]*async_result/,
  "Explorer background-copy failures must become terminal native drag errors"
);
assert.match(
  source,
  /bool IsUserCancellationResult\(HRESULT result\)[\s\S]*HRESULT_FROM_WIN32\(ERROR_CANCELLED\)[\s\S]*HRESULT_FROM_WIN32\(ERROR_OPERATION_ABORTED\)[\s\S]*COPYENGINE_S_USER_IGNORED[\s\S]*COPYENGINE_E_USER_CANCELLED[\s\S]*COPYENGINE_E_CANCELLED/,
  "Windows copy-engine cancellation HRESULTs must be recognized as user cancellation"
);
assert.match(
  source,
  /performed_effect_set_\.store\(true\)[\s\S]*bool has_performed_effect\(\) const[\s\S]*const bool has_performed_effect = data_object->has_performed_effect\(\)[\s\S]*if \(has_performed_effect\) \{\s*effect = performed;[\s\S]*const bool user_cancelled =\s*IsUserCancellationResult\(async_result\)[\s\S]*has_performed_effect && SUCCEEDED\(async_result\)[\s\S]*effect == DROPEFFECT_NONE/,
  "A conflict dialog cancellation with no performed effect must not become a copy error"
);
assert.match(
  source,
  /if \(session->cancelled\.load\(\) \|\| user_cancelled\) \{\s*session->Cancel\(\);\s*session->Emit\("cancelled"/,
  "Explorer user cancellation must emit a terminal cancelled event"
);
assert.match(
  source,
  /existing->released\.load\(\)/,
  "A new pointer gesture must not cancel an earlier Explorer background transfer"
);
assert.match(
  source,
  /existing->activated\.load\(\) \|\| existing->dragging\.load\(\)[\s\S]*Another Windows native drag gesture is still active/,
  "Only one live pointer gesture may own the Windows OLE drag loop"
);
assert.match(
  source,
  /internal_target_active\.load\(\) \|\|[\s\S]*IsCursorOverSourceWindow\(\)[\s\S]*\? DRAGDROP_S_CANCEL[\s\S]*: DRAGDROP_S_DROP/,
  "An internal SFTP target must cancel the shell drop before it extracts virtual files"
);
assert.match(
  source,
  /IsCursorOverSourceWindow\(\)[\s\S]*WindowFromPoint\(cursor\)[\s\S]*GetAncestor\(source_window, GA_ROOT\)[\s\S]*source_root == target_root/,
  "A drop anywhere inside the TunnelDesk window must stay out of Windows file extraction"
);
assert.match(
  source,
  /void StartManifestWorker[\s\S]*manifest_worker = std::thread[\s\S]*PrepareManifest\(session\)/,
  "Manifest loading and the OLE pointer gesture must run independently"
);
assert.match(
  source,
  /if \(ArmDrag\(session\)[\s\S]*StartManifestWorker\(session\)[\s\S]*RunDragOnWorkerThread\(session\)/,
  "Directory enumeration must start only after an actual drag gesture is activated"
);
assert.match(
  source,
  /HRESULT ResolveManifestForDataRequest\(\)[\s\S]*IsManifestPending\(\)[\s\S]*IsCursorOverSourceWindow\(\)[\s\S]*!session_->async_in_operation\.load\(\)[\s\S]*return E_PENDING;/,
  "OLE data probes must stay non-blocking until an asynchronous drop operation owns the directory manifest"
);
assert.match(
  source,
  /QueryGetData\(FORMATETC\* format\)[\s\S]*session_->IsManifestPending\(\)[\s\S]*return S_OK;[\s\S]*session_->WaitForManifest\(\)/,
  "QueryGetData must advertise delayed directory data without synchronously waiting for recursive enumeration"
);
assert.match(
  source,
  /HRESULT GetDescriptors\(STGMEDIUM\* medium\) \{\s*HRESULT manifest_result = ResolveManifestForDataRequest\(\);/,
  "FILEGROUPDESCRIPTOR requests must use the non-blocking manifest gate"
);
const cancelBody = /void Cancel\(\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] || "";
assert.match(cancelBody, /cancelled\.store\(true\)/, "Cancellation must publish the session cancellation flag");
assert.match(cancelBody, /async_event[\s\S]*SetEvent/, "Cancellation must wake the asynchronous drag lifecycle");
assert.doesNotMatch(
  cancelBody,
  /WinHttpCloseHandle|active_http_requests/,
  "Cancellation must not close a synchronous WinHTTP request from another thread"
);
assert.doesNotMatch(
  source,
  /class RegisteredHttpRequest/,
  "Synchronous WinHTTP handles must stay owned by the thread executing the request"
);
assert.ok(
  (source.match(/RegisterHttpRequest\(request\.get\(\)\)/g) || []).length >= 2,
  "Manifest and ranged content requests must check cancellation before network I/O"
);
assert.match(
  source,
  /if \(session->cancelled\.load\(\) \|\| user_cancelled\) \{\s*session->Cancel\(\);\s*session->Emit\("cancelled"/,
  "An accepted app or Explorer cancellation must produce a terminal cancelled callback"
);
assert.doesNotMatch(
  source,
  /The pointer gesture ended before native drag was ready/,
  "A released gesture before OLE startup must be treated as a normal cancellation"
);
assert.match(
  source,
  /\{"activateDrag", nullptr, ActivateDrag/,
  "The native activation API must be exported"
);
assert.match(
  source,
  /\{"setInternalTarget", nullptr, SetInternalTarget/,
  "The native internal-target switch must be exported"
);

console.log("Windows SFTP native drag source contract check passed.");
