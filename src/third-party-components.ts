type ThirdPartyComponent = {
  name:string;
  version:string;
  license:string;
  project_url:string;
  use:string;
};

const THIRD_PARTY_COMPONENTS:ThirdPartyComponent[] = [
  {name:"xterm.js", version:"6.0.0", license:"MIT", project_url:"https://github.com/xtermjs/xterm.js", use:"terminal"},
  {name:"Ace Editor", version:"1.44.0", license:"BSD-3-Clause", project_url:"https://github.com/ajaxorg/ace-builds", use:"sftp_text_edit"},
  {name:"jsdiff", version:"9.0.0", license:"BSD-3-Clause", project_url:"https://github.com/kpdecker/jsdiff", use:"sftp_diff"},
  {name:"noVNC", version:"1.7.0", license:"MPL-2.0", project_url:"https://github.com/novnc/noVNC", use:"builtin_vnc"},
  {name:"ZMODEM.js", version:"0.1.10", license:"Apache-2.0", project_url:"https://github.com/FGasper/zmodemjs", use:"zmodem_transfer"},
  {name:"ssh2", version:"1.17.0", license:"MIT", project_url:"https://github.com/mscdex/ssh2", use:"ssh_sftp_transport"},
  {name:"node-x11", version:"3.9.1", license:"MIT", project_url:"https://github.com/sidorares/node-x11", use:"x11_protocol_client"},
  {name:"i18next", version:"26.3.6", license:"MIT", project_url:"https://github.com/i18next/i18next", use:"interface_i18n"},
  {name:"Lucide", version:"1.31.0", license:"ISC", project_url:"https://lucide.dev", use:"interface_icons"},
  {name:"Electron", version:"43.4.0", license:"MIT", project_url:"https://github.com/electron/electron", use:"desktop_runtime"},
  {name:"node-pty", version:"1.1.0", license:"MIT", project_url:"https://github.com/microsoft/node-pty", use:"desktop_pty"},
  {name:"VcXsrv", version:"21.1.10.0", license:"GPL-3.0", project_url:"https://sourceforge.net/projects/vcxsrv/", use:"windows_x_server"}
];

function listThirdPartyComponents():ThirdPartyComponent[] {
  return THIRD_PARTY_COMPONENTS.map(item => ({...item}));
}

module.exports = {listThirdPartyComponents};
