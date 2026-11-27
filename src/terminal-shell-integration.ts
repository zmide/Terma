import type {Client, ClientChannel} from 'ssh2';
const {buildRemotePosixCommand} = require('./remote-posix');

// Session-only zsh integration. The user's startup files remain in their original
// directory; no rc file is edited and the private bootstrap removes itself.
export const MACOS_SHELL_INTEGRATION = buildRemotePosixCommand(String.raw`
case "\${SHELL:-/bin/sh}" in
*/zsh) ;;
*) exec "\${SHELL:-/bin/sh}" -il ;;
esac
terma_init_umask=$(umask)
umask 077
terma_init_dir=$(mktemp -d "\${TMPDIR:-/tmp}/terma-zsh.XXXXXX") || {
  umask "$terma_init_umask"
  exec "$SHELL" -il
}
cat > "$terma_init_dir/.zshenv" <<'TERMA_ZSH_ENV'
typeset _terma_init_dir="$ZDOTDIR"
if [[ "$TERMA_ZDOTDIR_SET" == 1 ]]; then
  export ZDOTDIR="$TERMA_ZDOTDIR"
else
  unset ZDOTDIR
fi
unset TERMA_ZDOTDIR TERMA_ZDOTDIR_SET
/bin/rm -f -- "$_terma_init_dir/.zshenv"
/bin/rmdir -- "$_terma_init_dir" 2>/dev/null
unset _terma_init_dir
[[ -r "\${ZDOTDIR:-$HOME}/.zshenv" ]] && source "\${ZDOTDIR:-$HOME}/.zshenv"
function _terma_report_directory() {
  local i ch encoded='' hex LC_ALL=C
  for (( i=1; i<=\${#PWD}; i++ )); do
    ch="$PWD[i]"
    if [[ "$ch" == [a-zA-Z0-9/._~-] ]]; then encoded+="$ch"
    else printf -v hex '%02X' "'$ch"; encoded+="%$hex"; fi
  done
  printf '\e]7;file://localhost%s\a' "$encoded"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd _terma_report_directory
TERMA_ZSH_ENV
if [ ! -s "$terma_init_dir/.zshenv" ]; then
  rm -f -- "$terma_init_dir/.zshenv"
  rmdir "$terma_init_dir" 2>/dev/null
  umask "$terma_init_umask"
  exec "$SHELL" -il
fi
umask "$terma_init_umask"
TERMA_ZDOTDIR_SET=\${ZDOTDIR+x}
[ "$TERMA_ZDOTDIR_SET" = x ] && TERMA_ZDOTDIR_SET=1
TERMA_ZDOTDIR="\${ZDOTDIR:-}"
ZDOTDIR="$terma_init_dir"
export ZDOTDIR TERMA_ZDOTDIR TERMA_ZDOTDIR_SET
exec "$SHELL" -il
`.replace(/\\\$/g, '$').trim());

/** A denied/slow diagnostic must never prevent an ordinary shell from opening. */
export function detectMacShellIntegration(client: Client): Promise<string> {
  return new Promise(resolve => {
    let stream: ClientChannel | undefined, output = '', settled = false;
    const finish = (value = '') => {
      if (settled) return;
      settled = true; clearTimeout(timer); resolve(value);
    };
    const timer = setTimeout(() => {stream?.close(); finish();}, 1500);
    try {
      client.exec('uname -s', (error, channel) => {
        if (error || settled) {channel?.close(); finish(); return;}
        stream = channel;
        channel.on('data', chunk => {
          output += String(chunk);
          if (output.length > 256) {channel.close(); finish();}
        });
        channel.on('error', () => finish());
        channel.on('close', () => finish(output.trim() === 'Darwin' ? MACOS_SHELL_INTEGRATION : ''));
      });
    } catch {finish();}
  });
}
