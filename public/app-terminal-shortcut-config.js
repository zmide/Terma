"use strict";

((root, factory) => {
  const config = factory();
  if (typeof module === "object" && module.exports) module.exports = config;
  else root.termaTerminalShortcuts = config;
})(globalThis, () => {
  const arrows = {Up:"A", Down:"B", Right:"C", Left:"D"};
  const tildeKeys = {Insert:2, Delete:3, PgUp:5, PgDn:6, F5:15, F6:17, F7:18, F8:19, F9:20, F10:21, F11:23, F12:24};
  const keys = Object.freeze([
    "Esc", "Tab", "Enter", "Backspace", "Space", "Insert", "Delete", "Home", "End", "PgUp", "PgDn",
    "Up", "Left", "Down", "Right", ...Array.from({length:12}, (_, index) => `F${index + 1}`),
    "/", "-", "|", "~", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  ]);
  const defaults = Object.freeze([
    ...["Esc", "Tab", "Home", "End", "PgUp", "PgDn", "/", "-", "|", "~", "Up", "Left", "Down", "Right"]
      .map(key => Object.freeze({key, label:"", ctrl:false, alt:false, shift:false, enabled:true})),
    ...["C", "D", "L", "A", "E", "R", "Z"]
      .map(key => Object.freeze({key, label:"", ctrl:true, alt:false, shift:false, enabled:true}))
  ]);

  function invalid() {
    const error = new Error("Invalid terminal shortcut configuration");
    error.code = "terminal_shortcuts_invalid";
    throw error;
  }

  function normalize(value=defaults) {
    if (!Array.isArray(value) || value.length > 48) invalid();
    return value.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) invalid();
      const key = String(item.key || "");
      const label = String(item.label || "").trim();
      if ((!keys.includes(key) && !/^[\x20-\x7e]$/.test(key)) || label.length > 24 || /[\x00-\x1f\x7f]/.test(label)) invalid();
      for (const flag of ["ctrl", "alt", "shift", "enabled"]) {
        if (item[flag] !== undefined && typeof item[flag] !== "boolean") invalid();
      }
      const shortcut = {key, label, ctrl:item.ctrl === true, alt:item.alt === true, shift:item.shift === true, enabled:item.enabled !== false};
      if (["Esc", "Enter"].includes(key) && (shortcut.ctrl || shortcut.shift)) invalid();
      if (key === "Tab" && shortcut.ctrl) invalid();
      if (shortcut.ctrl && key.length === 1 && !/^[A-Za-z2-8@\[\\\]\^_?/|]$/.test(key)) invalid();
      return shortcut;
    });
  }

  function label(shortcut) {
    const names = {Up:"↑", Down:"↓", Left:"←", Right:"→"};
    return shortcut.label || [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift", names[shortcut.key] || shortcut.key].filter(Boolean).join("+");
  }

  function sequence(shortcut, applicationCursor=false) {
    const {key, ctrl, alt, shift} = normalize([shortcut])[0];
    const modifier = 1 + Number(shift) + 2 * Number(alt) + 4 * Number(ctrl);
    const suffix = arrows[key] || ({Home:"H", End:"F"})[key];
    if (suffix) return modifier > 1 ? `\x1b[1;${modifier}${suffix}` : `\x1b${applicationCursor ? "O" : "["}${suffix}`;
    if (tildeKeys[key]) return `\x1b[${tildeKeys[key]}${modifier > 1 ? `;${modifier}` : ""}~`;
    if (/^F[1-4]$/.test(key)) {
      const last = String.fromCharCode(79 + Number(key.slice(1)));
      return modifier > 1 ? `\x1b[1;${modifier}${last}` : `\x1bO${last}`;
    }
    let data = ({Esc:"\x1b", Tab:shift ? "\x1b[Z" : "\t", Enter:"\r", Backspace:ctrl ? "\b" : "\x7f", Space:ctrl ? "\0" : " "})[key];
    if (data === undefined) {
      if (ctrl) {
        const special = {"2":0, "3":27, "4":28, "5":29, "6":30, "7":31, "8":127, "?":127, "/":31, "|":28};
        data = String.fromCharCode(special[key] ?? (key.toUpperCase().charCodeAt(0) & 31));
      } else if (/^[A-Z]$/.test(key)) {
        data = shift ? key : key.toLowerCase();
      } else {
        const shifted = Object.fromEntries([..."1234567890`-=[]\\;',./"].map((item, index) => [item, "!@#$%^&*()~_+{}|:\"<>?"[index]]));
        data = shift ? shifted[key] || key : key;
      }
    }
    return (alt ? "\x1b" : "") + data;
  }

  return Object.freeze({defaults, keys, normalize, label, sequence});
});
