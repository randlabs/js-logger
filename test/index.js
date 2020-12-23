const Logger = require("../dist");
const test = require("ava");
const path = require("path");

// -----------------------------------------------------------------------------

test('Basic functionality', async (t) => {
	await Logger.initialize({
		appName: "test",
		disableConsoleLog: false,
		fileLog: {
			dir: path.join(__dirname, "./logs/"),
			daysToKeep: 7
		},
		sysLog: {
			host: "127.0.0.1",
			port: 514,
			transport: "udp",
			protocol: "bsd",
			sendInfoNotifications: false
		},
		debugLevel: 1
	});

	Logger.error("This is a sample error message");
	Logger.warn("This is a sample warning message");
	Logger.info("This is a sample information message");
	Logger.debug(1, "This is a sample debug message");

	await Logger.finalize();

	t.pass();
});
