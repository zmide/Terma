export interface TerminalPromptSession {
 key?:string;
 term?:{element?:HTMLElement;buffer?:{active?:{baseY?:number;cursorY?:number;cursorX?:number;getLine(row:number):{translateToString(trim?:boolean):string}|undefined}}};
}


export function cleanTerminalCommandText(text:unknown) {
  return String(text || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .trim();
}

export function terminalPromptStateAtRow(session:TerminalPromptSession, requestedRow:number|null=null) {
  try {
    const buffer = session.term?.buffer?.active;
    const currentRow = Number(buffer?.baseY || 0) + Number(buffer?.cursorY || 0);
    const row = requestedRow!==null&&Number.isInteger(requestedRow) ? requestedRow : currentRow;
    const line = buffer?.getLine(row)?.translateToString(true) || "";
    const text = cleanTerminalCommandText(line);
    const markers = ["# ", "$ ", "% ", "> ", "]: "];
    let index = -1;
    let promptMarker = "";
    for (const marker of markers) {
      const markerIndex = text.lastIndexOf(marker);
      if (markerIndex > index) {
        index = markerIndex;
        promptMarker = marker;
      }
    }
    if (index < 0) {
      const trailingMarker = text.match(/(?:^|[\w.@:/~()[\]{}\\-])([#$%])$/)?.[1]
        || text.match(/^(?:PS\s+.+|[^\s]+)>$/i)?.[0]?.slice(-1)
        || (/\]:$/.test(text) ? "]:" : "");
      if (trailingMarker) {
        index = text.length - trailingMarker.length;
        promptMarker = trailingMarker;
      }
    }
    if (index < 0) return null;
    const start = index + promptMarker.length;
    const command = text.slice(start).trimEnd();
    const cursorColumn = row === currentRow ? Number(buffer?.cursorX || 0) : text.length;
    return {
      row,
      command,
      cursor:Math.max(0, Math.min(command.length, cursorColumn - start))
    };
  } catch {
    return null;
  }
}

export function currentTerminalPromptCommand(session:TerminalPromptSession) {
  return terminalPromptStateAtRow(session)?.command.trim() || "";
}
