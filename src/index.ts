import * as colors from "colors/safe";
import os from "os";
import path from "path";
import process from "process";
import * as winston from "winston";
import WinstonDailyRotateFile from "winston-daily-rotate-file";
import WinstonSyslog from "winston-syslog";
import * as Transport from 'winston-transport';
import { ClusterModule, loadCluster, Worker } from "./dynamicImport";

// -----------------------------------------------------------------------------

const LOG_REQUEST = "RANDLABS:JS:LOGGER:log";

// -----------------------------------------------------------------------------

export type level = "error" | "info" | "warn" | "debug";

export interface Options {
	appName: string;
	disableConsoleLog?: boolean;
	fileLog?: FileLogOptions;
	sysLog?: SysLogOptions;
	debugLevel?: number;
	usingClusters?: boolean;
}

export interface FileLogOptions {
	dir?: string;
	daysToKeep?: number;
}

export interface SysLogOptions {
	host?: string;
	port?: number;
	transport?: "udp" | "tcp" | "tls";
	protocol?: "bsd" | "3164" | "5424" | "rfc3164" | "rfc5424";
	sendInfoNotifications?: boolean;
}

export interface LogNotifyOptions {
	noConsole?: boolean;
	noFile?: boolean;
	noSysLog?: boolean;
	onlyConsole?: boolean;
	onlyFile?: boolean;
	onlySysLog?: boolean;
}

// -----------------------------------------------------------------------------

let debugLevel = 0;
let logger: winston.Logger | null = null;
let consoleTransport: Transport | null = null;
let fileTransport: Transport | null = null;
let syslogTransport: Transport | null = null;
let syslogSendInfoNotifications = false;
let cluster: ClusterModule | null = null;
let actingAsWorker = false;

// -----------------------------------------------------------------------------

export function initialize(options: Options): Promise<void> {
	// NOTE: Currently we don't have asynchronous function calls but code is enclosed in a promise
	//       to maintain future compatibility if underlying engine is changed
	return new Promise((resolve, reject) => {
		let fileLogDir: string;
		const transports: Transport[] = [];

		if (typeof options !== "object" || Array.isArray(options)) {
			reject(new Error("Logger: Options not set"));
			return;
		}

		if ((!options.appName) || typeof options.appName !== "string") {
			reject(new Error("Logger: Application name not set or invalid."));
			return;
		}

		if (typeof options.debugLevel === "number" && options.debugLevel >= 0) {
			debugLevel = options.debugLevel;
		}

		if (options.usingClusters) {
			cluster = loadCluster();
		}

		if ((!cluster) || cluster.isMaster) {
			// Master or single instance

			// Create console transport
			if (!(options.disableConsoleLog)) {
				consoleTransport = new winston.transports.Console({
					format: winston.format.combine(
						winston.format.timestamp({
							format: "YYYY-MM-DD HH:mm:ss"
						}),
						colorizeLevel(),
						formattedOutputWithDate,
					)
				});
				transports.push(consoleTransport);
			}

			// Create daily rotation file transport
			if (options.fileLog) {
				if (typeof options.fileLog !== "object" || Array.isArray(options.fileLog)) {
					reject(new Error("Logger: Invalid file logger options."));
					return;
				}

				if (typeof options.fileLog.dir === "string") {
					fileLogDir = options.fileLog.dir;
				}
				else if (!options.fileLog.dir) {
					fileLogDir = "";
					if (process.platform == 'win32') {
						fileLogDir = process.env.APPDATA + path.sep + options.appName + '\\logs';
					}
					else if (process.platform == 'darwin') {
						fileLogDir = process.env.HOME + '/Library/Logs/' + options.appName;
					}
					else {
						fileLogDir = process.env.HOME + "/." + options.appName + "/logs";
					}
				}
				else {
					reject(new Error("Logger: Invalid log directory."));
					return;
				}
				if (!fileLogDir.endsWith(path.sep)) {
					fileLogDir += path.sep;
				}
				fileLogDir = path.normalize(fileLogDir);

				if (options.fileLog.daysToKeep) {
					if (typeof options.fileLog.daysToKeep !== "number" || (options.fileLog.daysToKeep % 1) != 0 ||
							options.fileLog.daysToKeep < 0 || options.fileLog.daysToKeep > 30) {
						reject(new Error("Logger: Invalid days to keep value."));
						return;
					}
				}

				fileTransport = new WinstonDailyRotateFile({
					level: "debug",
					filename: options.appName + ".%DATE%",
					extension: ".log",
					dirname: fileLogDir,
					datePattern: 'YYYY-MM-DD',
					utc: true,
					json: false,
					auditFile: fileLogDir + options.appName + ".audit.log",
					maxFiles: options.fileLog.daysToKeep ? options.fileLog.daysToKeep.toString() + 'd' : '7d',
					format: winston.format.combine(
						winston.format.timestamp({
							format: "YYYY-MM-DD HH:mm:ss"
						}),
						formattedOutputWithDate
					),
				});
				transports.push(fileTransport);
			}

			// Create syslog transport
			if (options.sysLog) {
				if (typeof options.sysLog !== "object" || Array.isArray(options.sysLog)) {
					reject(new Error("Logger: Invalid syslog logger options."));
					return;
				}

				let port = 514;
				let protocol = "udp";
				if (typeof options.sysLog.transport === "string") {
					switch (options.sysLog.transport.toLowerCase()) {
						case "udp":
							break;

						case "tcp":
							protocol = "tcp";
							port = 1468;
							break;

						case "tls":
							protocol = "tls";
							port = 6514;
							break;

						default:
							reject(new Error("Logger: Invalid syslog transport option."));
							return;
					}
				}
				else if (typeof options.sysLog.transport !== null) {
					reject(new Error("Logger: Invalid syslog transport option."));
					return;
				}

				let host = "127.0.0.1";
				if (typeof options.sysLog.host === "string") {
					if (options.sysLog.host.length == 0) {
						reject(new Error("Logger: Invalid syslog host option."));
						return;
					}
					host = options.sysLog.host;
				}
				else if (typeof options.sysLog.host != null) {
					reject(new Error("Logger: Invalid syslog host option."));
					return;
				}

				if (typeof options.sysLog.port === "number") {
					if ((options.sysLog.port % 1) != 0 || options.sysLog.port < 0 || options.sysLog.port > 65535) {
						reject(new Error("Logger: Invalid syslog port option."));
						return;
					}
					if (options.sysLog.port != 0) {
						port = options.sysLog.port;
					}
				}
				else if (options.sysLog.port != null) {
					reject(new Error("Logger: Invalid syslog port option."));
					return;
				}

				let type = "BSD";
				if (typeof options.sysLog.protocol === "string") {
					switch (options.sysLog.protocol.toLowerCase()) {
						case "bsd":
						case "3164":
						case "rfc3164":
							break;

						case "5424":
						case "rfc5424":
							type = "5424";
							break;

						default:
							reject(new Error("Logger: Invalid syslog protocol option."));
							return;
					}
				}
				else if (typeof options.sysLog.protocol !== null) {
					reject(new Error("Logger: Invalid syslog protocol option."));
					return;
				}

				syslogTransport = new WinstonSyslog.Syslog({
					host,
					port,
					protocol,
					facility: "user",
					type,
					app_name: options.appName,
					format: winston.format.combine(
						winston.format.timestamp({
							format: "YYYY-MM-DD HH:mm:ss"
						}),
						formattedOutputWithoutDate
					),
					...(protocol != "udp" && { eol: os.EOL })
				});
				transports.push(syslogTransport);

				syslogSendInfoNotifications = Boolean(options.sysLog.sendInfoNotifications);
			}

			// And create the logger
			if (transports.length > 0) {
				logger = winston.createLogger({
					level: "debug",
					transports
				});
				logger.exitOnError = false;
			}

			// At last, if running in a cluster, set up the message listener
			if (cluster) {
				cluster.on("message", (worker: Worker, message: any): void => {
					if (message.type === LOG_REQUEST) {
						notify(message.level as level, message.message as string, message.options as LogNotifyOptions);
					}
				});
			}
		}
		else {
			// I'm a worker
			actingAsWorker = true;
		}

		//done
		resolve();
	});
}

export function finalize(): Promise<void> {
	return new Promise((resolve) => {
		if (logger) {
			const promises = [];

			const done = function(): void {
				logger = null;
				consoleTransport = null;
				fileTransport = null;
				syslogTransport = null;
				cluster = null;
				actingAsWorker = false;

				process.nextTick(() => {
					resolve();
				});
			};

			//wait for active transports to flush messages and close
			if (fileTransport && (fileTransport as any).logStream) {
				promises.push(new Promise<void>((onCompletion: () => void) => {
					fileTransport!.on('finish', function () {
						onCompletion();
					});
				}));
			}

			if (syslogTransport) {
				promises.push(new Promise<void>((onCompletion: () => void) => {
					syslogTransport!.on('closed', function () {
						onCompletion();
					});
				}));
			}

			if (promises.length > 0) {
				Promise.allSettled(promises).then(() => {
					done();
				});
			}

			logger.close();

			if (promises.length == 0) {
				done();
			}
		}
		else {
			cluster = null;
			actingAsWorker = false;

			resolve();
		}
	});
}

export function setDebugLevel(newLevel: number): void {
	if (newLevel >= 0) {
		debugLevel = newLevel;
	}
}

export function notify(type: level, message: string, options?: LogNotifyOptions): void {
	if (!actingAsWorker) {
		let silentConsole;

		if (type == "error") {
			silentConsole = updateSilentSettings(options, false);
			if (logger) {
				logger.error(message);
			}
			else if (!silentConsole) {
				console.log("[ERROR] " + message);
			}
		}
		else if (type == "warn") {
			silentConsole = updateSilentSettings(options, false);
			if (logger) {
				logger.warn(message);
			}
			else if (!silentConsole) {
				console.log("[WARN] " + message);
			}
		}
		else if (type == "info") {
			silentConsole = updateSilentSettings(options, !syslogSendInfoNotifications);
			if (logger) {
				logger.info(message);
			}
			else if (!silentConsole) {
				console.log("[INFO] " + message);
			}
		}
		else if (type == "debug") {
			silentConsole = updateSilentSettings(options, true);
			if (logger) {
				logger.debug(message);
			}
			else if (!silentConsole) {
				console.log("[DEBUG] " + message);
			}
		}
	}
	else {
		process.send!({
			type: LOG_REQUEST,
			level: type,
			message,
			options: (options) ? options : {}
		});
	}
}

export function error(message: string, options?: LogNotifyOptions): void {
	notify("error", message, options);
}

export function warn(message: string, options?: LogNotifyOptions): void {
	notify("warn", message, options);
}

export function info(message: string, options?: LogNotifyOptions): void {
	notify("info", message, options);
}

export function debug(level: number, message: string, options?: LogNotifyOptions): void {
	if (level > 0 && level <= debugLevel) {
		notify("debug", message, options);
	}
}

// -----------------------------------------------------------------------------
// Private functions

function updateSilentSettings(options: LogNotifyOptions | null | undefined, enforceSysLogSilence: boolean): boolean {
	let silentConsole = false;
	let silentFile = false;
	let silentSysLog = false;

	if (options) {
		if (options.onlyConsole) {
			silentFile = true;
			silentSysLog = true;
		}
		else if (options.onlyFile) {
			silentConsole = true;
			silentSysLog = true;
		}
		else if (options.onlySysLog) {
			silentConsole = true;
			silentFile = true;
		}
		else {
			if (options.noConsole) {
				silentConsole = true;
			}
			if (options.noFile) {
				silentFile = true;
			}
			if (options.noSysLog) {
				silentSysLog = true;
			}
		}
	}

	if (consoleTransport) {
		consoleTransport.silent = silentConsole;
	}
	if (fileTransport) {
		fileTransport.silent = silentFile;
	}
	if (syslogTransport) {
		syslogTransport.silent = (!enforceSysLogSilence) ? silentSysLog : true;
	}

	return silentConsole;
}

const colorizeLevel = winston.format((formatInfo: winston.Logform.TransformableInfo): winston.Logform.TransformableInfo => {
	const level = formatInfo.level.toUpperCase();
	switch (formatInfo.level) {
		case "error":
			formatInfo.colorizedLevel = colors.red(level);
			break;

		case "warn":
			formatInfo.colorizedLevel = colors.yellow(level);
			break;

		case "info":
			formatInfo.colorizedLevel = colors.green(level);
			break;

		case "debug":
			formatInfo.colorizedLevel = colors.blue(level);
			break;
	}
	return formatInfo;
});

const formattedOutputWithDate = winston.format.printf((formatInfo: winston.Logform.TransformableInfo): string => {
	const level = formatInfo.colorizedLevel ? formatInfo.colorizedLevel : formatInfo.level.toUpperCase();

	return "[" + formatInfo.timestamp + "] [" + level + "] - " + formatInfo.message;
});

const formattedOutputWithoutDate = winston.format.printf((formatInfo: winston.Logform.TransformableInfo): string => {
	const level = formatInfo.colorizedLevel ? formatInfo.colorizedLevel : formatInfo.level.toUpperCase();

	return "[" + level + "] - " + formatInfo.message;
});
