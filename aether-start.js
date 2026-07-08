// Convenience entry point for running the AETHER STUDIO instance locally
// (`node aether-start.js`) or under pm2 (`pm2 start aether-start.js --name aether`).
// Sets BRAND before server.js's own .env loader runs, so it always wins over
// any BRAND value left in .env.
process.env.BRAND = "aether";
if (!process.env.PORT) process.env.PORT = "4199";
require("./server.js").start();
