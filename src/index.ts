import log4js from "log4js";
import serverWatchdog from "@randlabs/server-watchdog-nodejs";
import path from "path";

// -----------------------------------------------------------------------------

export type level = "error" | "info" | "warn" | "debug";

export interface Options {
	appName: string;
	dir: string;
	serverWatchdog: {
		host: string;
		port: number;
		apiKey: string;
		defaultChannel: string;
		timeout: number;
	};
}

// -----------------------------------------------------------------------------

let swClient: any = null;
let logger: log4js.Logger;
let appName = "";
const swProcessRegister: {
	timer: NodeJS.Timeout|null;
	lastSucceeded: boolean;
} = {
	timer: null,
	lastSucceeded: false
};

// -----------------------------------------------------------------------------

export async function initialize(options: Options): Promise<void> {
	if (!options) {
		throw new Error("Options not set");
	}

	//create the local logger
	log4js.configure({
		appenders: {
			out: {
				type: "console",
				layout: {
					type: "pattern",
					pattern: "[%d{yyyy-MM-dd hh:mm:ss}] [%[%p%]] - %m"
				},
				level: "all"
			},
			everything: {
				type: "dateFile",
				filename: path.resolve(options.dir, options.appName + ".log"),
				layout: {
					type: "pattern",
					pattern: "[%d{yyyy-MM-dd hh:mm:ss}] [%p] - %m"
				},
				level: "all",
				keepFileExt: true,
				daysToKeep: 7,
				alwaysIncludePattern: true
			}
		},
		categories: {
			default: {
				appenders: [
					"out",
					"everything"
				],
				level: "all"
			}
		}
	});
	logger = log4js.getLogger();

	if (options.serverWatchdog) {
		appName = options.appName;

		//create the server-watchdog client logger
		swClient = serverWatchdog.create(options.serverWatchdog);

		//setup a periodic timer to re-register the process in server-watcher every 30 seconds
		await registerProcess();
		swProcessRegister.timer = setInterval(registerProcess, 30000);
	}

	process.on('beforeExit', shutdown);
}

export function notify(type: level, message: string): void {
	if (type == "error") {
		if (logger) {
			logger.error(message);
		}
		else {
			console.log("[ERROR] " + message);
		}

		if (swClient) {
			swClient.error(message).catch(() => {
				logger.error("Unable to deliver message to Server Watcher");
			});
		}
	}
	else if (type == "info") {
		if (logger) {
			logger.info(message);
		}
		else {
			console.log("[INFO] " + message);
		}

	}
	else if (type == "warn") {
		if (logger) {
			logger.warn(message);
		}
		else {
			console.log("[WARN] " + message);
		}

		if (swClient) {
			swClient.warn(message).catch(() => {
				logger.error("Unable to deliver message to Server Watcher");
			});
		}
	}
	else if (type == "debug") {
		if (logger) {
			logger.debug(message);
		}
		else {
			console.log("[DEBUG] " + message);
		}
	}
}

// -----------------------------------------------------------------------------

async function registerProcess(): Promise<void> {
	try {
		await swClient.processWatch(process.pid, appName, "error");

		swProcessRegister.lastSucceeded = true;
	}
	catch (err) {
		if (swProcessRegister.lastSucceeded) {
			logger.error("Unable to deliver process watch to Server Watcher [" + err.toString() + "]");
			swProcessRegister.lastSucceeded = false;
		}
	}
}

async function shutdown(): Promise<void> {
	if (swProcessRegister.timer !== null) {
		clearTimeout(swProcessRegister.timer);
	}
	swProcessRegister.lastSucceeded = true;

	if (swClient) {
		try {
			await swClient.processUnwatch(process.pid);
		}
		catch (err) {
			// keep linter happy
		}
		swClient = null;
	}

	appName = "";
}
