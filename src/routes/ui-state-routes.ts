import { IncomingMessage, ServerResponse } from "node:http";

interface UiStateRouteDependencies {
  databaseRevision(): number;
  securityDiagnostics(): {sessions?: number; desktop_browser_grants?: number};
  securitySettingsRevision(): string;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
}

export async function handleUiStateRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: UiStateRouteDependencies
): Promise<boolean> {
  if (request.method !== "GET" || pathname !== "/api/ui-state/revision") return false;
  const diagnostics = dependencies.securityDiagnostics();
  dependencies.sendJson(response, {
    revision:[
      dependencies.databaseRevision(),
      dependencies.securitySettingsRevision(),
      Number(diagnostics?.sessions || 0),
      Number(diagnostics?.desktop_browser_grants || 0)
    ].join(":")
  });
  return true;
}
