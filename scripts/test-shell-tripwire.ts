// The shell wrapper validates in a short-lived child, then execs the real
// tool. Keeping its PID matters to SIGKILL/reconnect process fixtures.
import { ISOLATION, TRIPWIRE } from "./test-isolation";
import { guardCommand } from "./test-tripwire";
const [root, command, ...args] = process.argv.slice(2);
process.env[ISOLATION] ||= root;
process.env[TRIPWIRE] ||= `${root}/tripwire.log`;
guardCommand([command!, ...args]);
