"use strict";

try {
  if (process.env.TERMA_DISTRIBUTION !== "fnos") throw new Error("This helper requires the fnOS distribution");
  const operation=String(process.env.TRIM_APP_STATUS || "").toUpperCase();
  if (["validate","apply"].includes(process.argv[2]) && operation && operation !== "CONFIG") {
    console.log(`fnOS configuration ignored outside CONFIG: ${operation}`);
    process.exit(0);
  }
  const config = require("../dist/infrastructure/fnos-configuration");
  const input = {password:process.env.wizard_new_web_password || "", confirmation:process.env.wizard_new_web_password_confirm || "",
    listen_hosts:process.env.wizard_listen_hosts || "", allowed_hosts:process.env.wizard_allowed_hosts || "",
    trusted_proxies:process.env.wizard_trusted_proxies || "", reset_network:process.env.wizard_reset_network || "false",
    origin_protocol_check:process.env.wizard_origin_protocol_check || "keep"};
  switch (process.argv[2]) {
    case "validate": config.validateFnosConfiguration(input); break;
    case "apply": config.applyFnosConfiguration(input); break;
    case "rollback": config.rollbackFnosConfiguration(); break;
    case "commit": config.commitFnosConfiguration(); break;
    case "listen-hosts": console.log(config.fnosListenHosts().join(",")); break;
    default: throw new Error("Unknown configuration action");
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
