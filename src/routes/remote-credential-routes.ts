import { IncomingMessage, ServerResponse } from "node:http";

interface RemoteCredentialRouteDependencies {
  getRemoteProfile(id: number): any;
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  testFtpCredentials(profile: any): Promise<any>;
}

function credentialText(value: unknown, label: string, maximum: number, required = false): string {
  const text = String(value || "").trim();
  if (required && !text) throw new Error(`请输入${label}`);
  if (text.length > maximum || /[\0\r\n]/.test(text)) throw new Error(`${label}无效`);
  return text;
}

export async function handleRemoteCredentialRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  dependencies: RemoteCredentialRouteDependencies
): Promise<boolean> {
  const match = pathname.match(/^\/api\/remote-profiles\/(\d+)\/test-credentials$/);
  if (!match || request.method !== "POST") return false;

  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("远程连接 ID 无效");
  const profile = dependencies.getRemoteProfile(id);
  if (profile.protocol !== "ftp") throw new Error("当前协议不支持应用内凭据修复");
  const data = await dependencies.readJson(request);
  const username = credentialText(data.username, "FTP 用户名", 255, true);
  const password = String(data.password || "");
  if (!password || password.length > 4096 || /[\0\r\n]/.test(password)) throw new Error("FTP 密码无效");
  const port = Number(data.port || profile.port || 21);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FTP 端口必须在 1-65535 之间");

  const result = await dependencies.testFtpCredentials({
    ...profile,
    username,
    password,
    port
  });
  dependencies.sendJson(response, result);
  return true;
}
