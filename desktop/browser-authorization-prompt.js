function createDesktopBrowserAuthorizationPromptGate() {
  let pendingPrompt = null;

  return {
    async request(showPrompt) {
      if (pendingPrompt) return false;
      const prompt = Promise.resolve().then(showPrompt);
      pendingPrompt = prompt;
      try {
        return Boolean(await prompt);
      } finally {
        if (pendingPrompt === prompt) pendingPrompt = null;
      }
    },
    pending() {
      return Boolean(pendingPrompt);
    }
  };
}

module.exports = { createDesktopBrowserAuthorizationPromptGate };
