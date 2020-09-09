import log4js, { Logger } from "log4js";
import serverWatchdog from "@randlabs/server-watchdog-nodejs";
import path from "path";
import process from "process";

// -----------------------------------------------------------------------------

export type level = "error" | "info" | "warn" | "debug";

export interface Options {
	appName: string;
	dir?: string;
	daysToKeep?: number;
	serverWatchdog?: ServerWatchdogOptions;
	debugLevel?: number;
}

export interface ServerWatchdogOptions {
	host: string;
	port: number;
	apiKey: string;
	defaultChannel: string;
	timeout?: number;
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
let debugLevel = 0;

// -----------------------------------------------------------------------------

export async function initialize(options: Options): Promise<void> {
	let logDir: string;

	if (!options) {
		throw new Error("Logger: Options not set");
	}

	if (!options.appName || typeof options.appName !== "string") {
		throw new Error("Logger: Application name not set or invalid.");
	}

	if (typeof options.dir === "string") {
		logDir = options.dir;
	}
	else if (!options.dir) {
		logDir = "";
		if (process.platform == 'win32') {
			logDir = process.env.APPDATA + path.sep + appName + '\\logs';
		}
		else if (process.platform == 'darwin') {
			logDir = process.env.HOME + '/Library/Logs/' + appName;
		}
		else {
			logDir = process.env.HOME + "/." + appName + "/logs";
		}
	}
	else {
		throw new Error("Logger: Invalid log directory.");
	}
	if (!logDir.endsWith(path.sep)) {
		logDir += path.sep;
	}
	logDir = path.normalize(logDir);

	if (typeof options.debugLevel === "number" && options.debugLevel >= 0) {
		debugLevel = options.debugLevel;
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
				filename: path.resolve(logDir, options.appName + ".log"),
				layout: {
					type: "pattern",
					pattern: "[%d{yyyy-MM-dd hh:mm:ss}] [%p] - %m"
				},
				level: "all",
				keepFileExt: true,
				daysToKeep: options.daysToKeep ? options.daysToKeep : 7,
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
}

export async function finalize(): Promise<void> {
	if (swProcessRegister.timer !== null) {
		clearTimeout(swProcessRegister.timer);

		swProcessRegister.timer = null;
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

export function setDebugLevel(newLevel: number): void {
	if (newLevel >= 0) {
		debugLevel = newLevel;
	}
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

export function error(message: string): void {
	notify("error", message);
}

export function warn(message: string): void {
	notify("warn", message);
}

export function info(message: string): void {
	notify("info", message);
}

export function debug(level: number, message: string): void {
	if (level > 0 && level <= debugLevel) {
		notify("debug", message);
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
