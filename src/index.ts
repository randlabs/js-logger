import log4js from "log4js";
import path from "path";
import process from "process";
import syslog from "syslog-client";
import util from "util";

// -----------------------------------------------------------------------------

// eslint-disable-next-line camelcase
const async_log4js_shutdown = util.promisify(log4js.shutdown);

// -----------------------------------------------------------------------------

export type level = "error" | "info" | "warn" | "debug";

export interface Options {
	appName: string;
	fileLog?: FileLogOptions;
	sysLog?: SysLogOptions;
	debugLevel?: number;
}

export interface FileLogOptions {
	enabled?: boolean;
	dir?: string;
	daysToKeep?: number;
}

export interface SysLogOptions {
	enabled?: boolean;
	host?: string;
	port?: number;
	useTcp?: boolean;
	useRFC3164?: boolean;
	sendInfoNotifications?: boolean;
}

// -----------------------------------------------------------------------------

let appName = "";

let syslogClient: syslog.Client | null = null;
let syslogSendInfoNotifications = false;
let logger: log4js.Logger | null = null;

let debugLevel = 0;

// -----------------------------------------------------------------------------

export function initialize(options: Options): void {
	if (typeof options !== "object" || Array.isArray(options)) {
		throw new Error("Logger: Options not set");
	}

	if ((!options.appName) || typeof options.appName !== "string") {
		throw new Error("Logger: Application name not set or invalid.");
	}

	if (typeof options.debugLevel === "number" && options.debugLevel >= 0) {
		debugLevel = options.debugLevel;
	}

	if (options.fileLog && options.fileLog.enabled) {
		if (typeof options.fileLog !== "object" || Array.isArray(options.fileLog)) {
			throw new Error("Logger: Invalid file logger options.");
		}

		let enabled = true;
		if (typeof options.fileLog.enabled === "boolean") {
			enabled = options.fileLog.enabled;
		}
		else if (typeof options.fileLog.enabled !== "undefined") {
			throw new Error("Logger: Invalid syslog enable value.");
		}

		if (enabled) {
			let logDir: string;
			if (typeof options.fileLog.dir === "string") {
				logDir = options.fileLog.dir;
			}
			else if (!options.fileLog.dir) {
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

			if (options.fileLog.daysToKeep) {
				if (typeof options.fileLog.daysToKeep !== "number" || (options.fileLog.daysToKeep % 1) != 0 ||
						options.fileLog.daysToKeep < 0 || options.fileLog.daysToKeep > 30) {
					throw new Error("Logger: Invalid days to keep value.");
				}
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
						daysToKeep: options.fileLog.daysToKeep ? options.fileLog.daysToKeep : 7,
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
		}
	}

	if (options.sysLog) {
		if (typeof options.sysLog !== "object" || Array.isArray(options.sysLog)) {
			throw new Error("Logger: Invalid syslog options.");
		}

		let enabled = true;
		if (typeof options.sysLog.enabled === "boolean") {
			enabled = options.sysLog.enabled;
		}
		else if (typeof options.sysLog.enabled !== "undefined") {
			throw new Error("Logger: Invalid syslog enable value.");
		}

		if (enabled) {
			const clientOptions: syslog.ClientOptions = {
				appName: options.appName,
				port: 514,
				transport: options.sysLog.useTcp ? syslog.Transport.Tcp : syslog.Transport.Udp,
				rfc3164: Boolean(options.sysLog.useRFC3164)
			};

			if (options.sysLog.host && typeof options.sysLog.host !== "string") {
				throw new Error("Logger: Invalid syslog host value.");
			}

			if (options.sysLog.port) {
				if (typeof options.sysLog.port !== "number" || (options.sysLog.port % 1) != 0 || options.sysLog.port < 1 ||
						options.sysLog.port > 65535) {
					throw new Error("Logger: Invalid syslog port value.");
				}
				clientOptions.port = options.sysLog.port;
			}

			syslogSendInfoNotifications = Boolean(options.sysLog.sendInfoNotifications);

			syslogClient = syslog.createClient(options.sysLog.host ? options.sysLog.host : "127.0.0.1", clientOptions);
		}
	}
}

export async function finalize(): Promise<void> {
	if (syslogClient) {
		syslogClient.close();
		syslogClient = null;
		syslogSendInfoNotifications = false;
	}

	if (logger) {
		try {
			await async_log4js_shutdown();
		}
		catch (err) {
			//keep ESLint happy
		}
		logger = null;
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

		sendToSysLog(message, syslog.Severity.Error);
	}
	else if (type == "warn") {
		if (logger) {
			logger.warn(message);
		}
		else {
			console.log("[WARN] " + message);
		}

		sendToSysLog(message, syslog.Severity.Warning);
	}
	else if (type == "info") {
		if (logger) {
			logger.info(message);
		}
		else {
			console.log("[INFO] " + message);
		}

		if (syslogSendInfoNotifications) {
			sendToSysLog(message, syslog.Severity.Informational);
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

function sendToSysLog(message: string, severity: syslog.Severity): void {
	if (syslogClient) {
		const opts: syslog.MessageOptions = {};

		opts.facility = syslog.Facility.User;
		opts.severity = severity;

		syslogClient.log(message, opts, (err: Error | null) => {
			if (err && logger) {
				logger.error("Unable to deliver message to SysLog [" + err.toString() + "]");
			}
		});
	}
}
