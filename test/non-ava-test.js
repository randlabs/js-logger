const Logger = require("../dist");
const path = require("path");

// -----------------------------------------------------------------------------

main().then(() => {
	process.exit(0);
}).catch(() => {
	console.error(err.stack || err.toString());
	process.exit(1);
});

async function main() {
	await Logger.initialize({
		appName: "non-ava-test",
		disableConsoleLog: false,
		fileLog: {
			dir: path.join(__dirname, "./logs/"),
			daysToKeep: 7
		},
		debugLevel: 1
	});

	Logger.error("This is a sample error message");
	Logger.warn("This is a sample warning message");
	Logger.info("This is a sample information message");
	Logger.debug(1, "This is a sample debug message");

	await Logger.finalize();
}
