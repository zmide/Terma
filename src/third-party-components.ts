type ThirdPartyComponent = {
  name:string;
  version:string;
  license:string;
  project_url:string;
  use:string;
};

const THIRD_PARTY_COMPONENTS:ThirdPartyComponent[] = [
  {name:"xterm.js", version:"6.0.0", license:"MIT", project_url:"https://github.com/xtermjs/xterm.js", use:"终端显示与交互"},
  {name:"Ace Editor", version:"1.44.0", license:"BSD-3-Clause", project_url:"https://github.com/ajaxorg/ace-builds", use:"SFTP 文本编辑"},
  {name:"jsdiff", version:"9.0.0", license:"BSD-3-Clause", project_url:"https://github.com/kpdecker/jsdiff", use:"SFTP 文本差异比较"},
  {name:"noVNC", version:"1.7.0", license:"MPL-2.0", project_url:"https://github.com/novnc/noVNC", use:"内置 VNC 客户端"},
  {name:"ZMODEM.js", version:"0.1.10", license:"Apache-2.0", project_url:"https://github.com/FGasper/zmodemjs", use:"终端 sz/rz 文件传输"},
  {name:"ssh2", version:"1.17.0", license:"MIT", project_url:"https://github.com/mscdex/ssh2", use:"SSH/SFTP 通信"},
  {name:"Lucide", version:"1.30.0", license:"ISC", project_url:"https://lucide.dev", use:"界面图标"},
  {name:"Electron", version:"43.3.0", license:"MIT", project_url:"https://github.com/electron/electron", use:"桌面应用运行时"},
  {name:"node-pty", version:"1.1.0", license:"MIT", project_url:"https://github.com/microsoft/node-pty", use:"桌面端 PTY 会话"},
  {name:"VcXsrv", version:"21.1.10.0", license:"GPL-3.0", project_url:"https://sourceforge.net/projects/vcxsrv/", use:"Windows X Server 运行时"}
];

function listThirdPartyComponents():ThirdPartyComponent[] {
  return THIRD_PARTY_COMPONENTS.map(item => ({...item}));
}

module.exports = {listThirdPartyComponents};
