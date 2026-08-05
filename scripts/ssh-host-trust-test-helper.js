async function trustTestHost(connection, mode = "persist") {
  const hostTrust = require("../dist/ssh-host-trust");
  try {
    return await hostTrust.ensureHostTrusted(connection);
  } catch (error) {
    if (!["SSH_HOST_KEY_UNKNOWN", "SSH_HOST_KEY_CHANGED"].includes(error?.code)) throw error;
    hostTrust.acceptHostTrust(error.challenge.token, mode);
    return hostTrust.ensureHostTrusted(connection);
  }
}

module.exports = { trustTestHost };
