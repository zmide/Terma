const passwordInput = document.getElementById("password");
const passwordToggle = document.getElementById("passwordToggle");
const passwordShowIcon = document.getElementById("passwordShowIcon");
const passwordHideIcon = document.getElementById("passwordHideIcon");
const loginButton = document.getElementById("loginButton");

function setPasswordVisible(visible) {
  const selectionStart = passwordInput.selectionStart;
  const selectionEnd = passwordInput.selectionEnd;
  passwordInput.type = visible ? "text" : "password";
  const actionLabel = visible ? "隐藏密码" : "显示密码";
  passwordToggle.title = actionLabel;
  passwordToggle.setAttribute("aria-label", actionLabel);
  passwordToggle.setAttribute("aria-pressed", String(visible));
  passwordShowIcon.hidden = visible;
  passwordHideIcon.hidden = !visible;
  passwordInput.focus({preventScroll:true});
  if (selectionStart !== null && selectionEnd !== null) {
    try { passwordInput.setSelectionRange(selectionStart, selectionEnd); } catch {}
  }
}

async function login() {
  const response = await fetch("/api/auth/login", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({password:passwordInput.value})
  });
  if (response.ok) {
    location.href = "/";
    return;
  }
  let message = "登录失败";
  try { message = (await response.json()).error || message; } catch {}
  document.getElementById("err").textContent = message;
}

passwordToggle.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));
loginButton.addEventListener("click", login);
passwordInput.addEventListener("keydown", event => {
  if (event.key === "Enter") void login();
});
