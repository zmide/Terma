import i18next from 'i18next';

const zh = {
  title: 'Terma 登录',
  description: '请输入 Web 访问密码；仅配置 Token 时也可直接输入 Token。',
  setupHint: '首次使用时，请先在运行 Terma 的设备上设置 Web 密码；登录后可在“设置 → 安全”中修改。',
  fnosSetupHint: '请输入安装时设置的 Web 密码。如需设置或重置，请进入“飞牛应用中心 → Terma → 应用设置”。这里使用 Terma 自己的密码，无需用户名。',
  credential: '密码或 Token',
  showPassword: '显示密码',
  hidePassword: '隐藏密码',
  submit: '登录',
  failed: '登录失败',
  protocolMismatch: '浏览器与后端的 HTTPS/HTTP 协议不一致，尚未校验密码。若使用 HTTPS 转发到 HTTP，请通过可用地址进入 Terma“设置 → 安全”，关闭“校验 HTTPS/HTTP 来源协议”；飞牛也可在“应用中心 → Terma → 应用设置”中关闭。',
  originForbidden: '访问来源校验失败，尚未校验密码。请通过可用地址检查 Terma“设置 → 安全”中的允许域名、端口和 HTTPS/HTTP 来源协议；NAS 也可使用应用设置。',
  notConfigured: '尚未设置 Web 密码或访问 Token',
  invalid: '密码或 Token 不正确',
  temporarilyLocked: '密码或 Token 不正确，登录已暂时锁定 {{seconds}} 秒',
  tooManyAttempts: '登录尝试过多，请在 {{seconds}} 秒后重试',
  switchLanguage: '切换到 English'
};

const en: Record<keyof typeof zh, string> = {
  title: 'Sign in to Terma',
  description: 'Enter the Web access password. If only an access token is configured, enter that token instead.',
  setupHint: 'First use: set a Web password in Terma on the device running the service. After signing in, you can change it in Settings > Security.',
  fnosSetupHint: 'Use the Web password chosen during installation. To set or reset it, open fnOS App Center > Terma > Application Settings. This is Terma\'s own password; no username is required.',
  credential: 'Password or token',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  submit: 'Sign in',
  failed: 'Sign-in failed',
  protocolMismatch: 'The browser and backend use different HTTPS/HTTP protocols. Your password has not been checked. For HTTPS forwarding to HTTP, open Terma at a working address, then turn off “Check HTTPS/HTTP origin protocol” in Settings > Security. On fnOS, you can also use App Center > Terma > Application Settings.',
  originForbidden: 'Request origin checking failed before your password was checked. Open Terma at a working address and check Allowed Hosts, ports and HTTPS/HTTP origin protocol in Settings > Security. NAS packages may also offer application settings.',
  notConfigured: 'No Web password or access token has been configured',
  invalid: 'The password or token is incorrect',
  temporarilyLocked: 'The password or token is incorrect. Sign-in is locked for {{seconds}} seconds',
  tooManyAttempts: 'Too many sign-in attempts. Try again in {{seconds}} seconds',
  switchLanguage: 'Switch to Simplified Chinese'
};

export type LoginLanguage = 'zh-CN' | 'en-US';
export type LoginTranslation = keyof typeof zh;

export async function createLoginI18n() {
  const instance = i18next.createInstance();
  await instance.init({
    lng: 'zh-CN',
    fallbackLng: 'en-US',
    defaultNS: 'login',
    resources: { 'zh-CN': { login: zh }, 'en-US': { login: en } },
    interpolation: { escapeValue: false }
  });
  return instance;
}
