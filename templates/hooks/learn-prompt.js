#!/usr/bin/env node
"use strict";
// Legacy Cursor stop-hook entrypoint. Keep it inert: no automatic follow-up
// messages, stale-gate reminders, or injected chat turns.
try {
  require("./lib/cleanup-tmp.js").cleanupFxmindTmp(process.cwd());
} catch { /* Stop must never block the user's chat. */ }
process.stdout.write("{}");
