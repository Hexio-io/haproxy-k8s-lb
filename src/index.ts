/**
 * haproxy-k8s-lb
 *
 * Kubernetes EXTERNAL Load Balancer using HA Proxy
 *
 * @author Jiri Hybek <jiri.hybek@hexio.io>
 * @copyright 2019 Hexio a.s. (https://hexio.io)
 * @license Apache-2.0 See the LICENSE file distributed with this source codes.
 */

import { spawn } from "child_process";
import { default as logger, parseLogLevel } from "meta2-logger";
import Request from "request";
import { compile as compileTemplate } from "handlebars";
import { readFileSync, writeFileSync } from "fs";

/**
 * Kubernetes server config
 */
interface IKubeConfig {
	server: string;
	serverCert: string;
	serviceToken: string;
	namespace: string;
}

/**
 * Kubernetes Service Item
 */
interface IKubeServiceItem {
	metadata: {
		name: string;
		namespace: string;
		selfLink: string;
		uid: string;
		resourceVersion: string;
		creationTimestamp: string;
		annotations: { [K: string]: string };
	};
	spec: {
		ports: Array<{
			protocol: string;
			port?: number;
			targetPort?: number;
			nodePort?: number;
		}>;
		selector: { [K: string]: string; };
		clusterIP?: string;
		type: "LoadBalancer"|"ClusterIP"|"NodePort"|"ExternalName";
		sessionAffinity?: string;
		loadBalancerIP?: string;
		externalTrafficPolicy?: string;
	};
	status?: {
		loadBalancer?: {
			ingress: Array<{
				ip: string;
			}>
		}
	};
}

/**
 * Kubernetes Node Item
 */
interface IKubeNodeItem {
	metadata: {
		name: string;
		selfLink: string;
		uid: string;
		resourceVersion: string;
		creationTimestamp: string;
		labels: { [K: string]: string };
		annotations: { [K: string]: string };
	};
	spec: {
		podCIDR: string;
		providerId: string;
	};
	status: {
		capacity: any;
		allocatable: any;
		conditions: any;
		addresses: Array<{
			type: "InternalIP"|"Hostname",
			address: string;
		}>;
		daemonEndpoints: {
			kubeletEndpoint: { Port: number };
		};
		nodeInfo: {
			machineID: string;
			systemUUID: string;
			bootID: string;
			kernelVersion: string;
			osImage: string;
			containerRuntimeVersion: string;
			kubeletVersion: string;
			kubeProxyVersion: string;
			operatingSystem: string;
			architecture: string;
		};
		images: Array<{
			names: Array<string>,
			sizeBytes: number;
		}>;
	};
}

/**
 * Verifies the HA Proxy configuration
 *
 * @param configFile Configuration filename
 */
function verifyHAProxyConfig(configFile: string): Promise<boolean> {

	return new Promise((resolve, reject) => {

		const proc = spawn("haproxy", [ "-c", "-f", configFile ]);

		proc.on("exit", (code) => {

			resolve( code > 0 ? false : true );

		});

		proc.on("error", (err) => reject(err));

	});

}

/**
 * Starts or reloads HA Proxy process
 *
 * @param configFile Config filename
 * @param pid Previous process pid
 */
function reloadHAProxy(configFile: string, pid: number): Promise<number> {

	logger.debug("Reloading HA Proxy", { config: configFile, prevPid: pid });

	return new Promise((resolve, reject) => {

		const args = ["-f", configFile];

		if (pid)
			args.push("-sf", String(pid));

		const proc = spawn("haproxy", args);
		let hasError = false;

		proc.on("error", (err) => {

			logger.warn("Failed to reload HA Proxy process", { config: configFile, prevPid: pid }, err);

			hasError = true;
			reject(err);

		});

		proc.stdout.pipe(process.stdout);
		proc.stderr.pipe(process.stderr);

		setTimeout(() => {

			if (!hasError) {

				logger.debug("HA Proxy reloaded.");
				resolve(proc.pid);

			}

		}, 100);

	});

}

/**
 * Fetches service list from Kubernetes API
 *
 * @param config Kube config
 */
function fetchServices(config: IKubeConfig, timeout: number = 5000): Promise<Array<IKubeServiceItem>> {

	return new Promise((resolve, reject) => {

		Request({
			method: "GET",
			url: `${config.server}/api/v1/namespaces/${config.namespace}/services`,
			json: true,
			auth: {
				bearer: config.serviceToken
			},
			ca: Buffer.from(config.serverCert, "base64").toString("ascii"),
			timeout: timeout
		}, (err, _res, body) => {

			if (err)
				return reject(err);

			if (!body || !body.items)
				throw new Error("Unexpected API response.");

			resolve(body.items);

		});

	});

}

/**
 * Fetches node list from Kubernetes API
 *
 * @param config Kube config
 */
function fetchNodes(config: IKubeConfig, timeout: number = 5000): Promise<Array<IKubeNodeItem>> {

	return new Promise((resolve, reject) => {

		Request({
			method: "GET",
			url: `${config.server}/api/v1/nodes`,
			json: true,
			auth: {
				bearer: config.serviceToken
			},
			ca: Buffer.from(config.serverCert, "base64").toString("ascii"),
			timeout: timeout
		}, (err, res, body) => {

			if (err)
				return reject(err);

			if (!body || !body.items)
				throw new Error(`Unexpected API response, received status ${res.statusCode}, body: ${JSON.stringify(body)}`);

			resolve(body.items);

		});

	});

}

/**
 * Fetches node list from Kubernetes API
 *
 * @param config Kube config
 */
function updateServiceStatus(config: IKubeConfig, service: IKubeServiceItem, timeout: number = 5000): Promise<any> {

	return new Promise((resolve, reject) => {

		Request({
			method: "PATCH",
			url: `${config.server}/api/v1/namespaces/${config.namespace}/services/${service.metadata.name}/status`,
			json: true,
			auth: {
				bearer: config.serviceToken
			},
			ca: config.serverCert ? Buffer.from(config.serverCert, "base64").toString("ascii") : null,
			timeout: timeout,
			body: [
				{
					op: "replace",
					path: "/status",
					value: service.status
				}
			],
			headers: {
				"Content-Type": "application/json-patch+json"
			}
		}, (err, _res, body) => {

			if (err)
				return reject(err);

			resolve(body);

		});

	});

}

/**
 * Main applicaton function
 */
async function main() {

	// Setup logger
	logger.toConsole({
		colorize: true,
		level: parseLogLevel(process.env["LOG_LEVEL"] || "warn"),
		timestamp: true
	});

	// Define kube config
	const kubeConfig: IKubeConfig = {
		server: process.env["KUBE_SERVER"],
		serverCert: process.env["KUBE_SERVER_CA"],
		serviceToken: process.env["KUBE_SERVICE_TOKEN"],
		namespace: process.env["KUBE_NAMESPACE"] || "default"
	};

	const haProxyConfig = {
		global: {
			maxconn: process.env["HAPROXY_GLOBAL_MAX_CONN"] || 16000,
			spreadChecks: process.env["HAPROXY_GLOBAL_SPREAD_CHECKS"] || 4,
			tuneMaxRewrite: process.env["HAPROXY_GLOBAL_TUNE_MAX_REWRITE"] || 1024,
			tuneBufferSize: process.env["HAPROXY_GLOBAL_TUNE_BUFFER_SIZE"] || 32768,
		},
		maxconn: process.env["HAPROXY_MAX_CONN"] || 8000,
		retries: process.env["HAPROXY_RETRIES"] || 3,
		timeoutHttpRequest: process.env["HAPROXY_TIMEOUT_HTTP_REQUEST"] || "10s",
		timeoutQueue: process.env["HAPROXY_TIMEOUT_QUEUE"] || "1m",
		timeoutConnect: process.env["HAPROXY_TIMEOUT_CONNECT"] || "10s",
		timeoutClient: process.env["HAPROXY_TIMEOUT_CLIENT"] || "1m",
		timeoutServer: process.env["HAPROXY_TIMEOUT_SERVER"] || "1m",
		timeoutHttpKeepAlive: process.env["HAPROXY_TIMEOUT_HTTP_KEEP_ALIVE"] || "10s",
		timeoutCheck: process.env["HAPROXY_TIMEOUT_CHECK"] || "10s",
	};

	// Get interval
	const updateInterval = parseInt(process.env["UPDATE_INTERVAL"] || "60", 10) * 1000;

	// Set HA Proxy config filename
	const configFilename = process.env["HAPROXY_CONFIG"] || "/var/lib/haproxy/haproxy.cfg";

	// Validate config
	if (!kubeConfig.server || !kubeConfig.serviceToken)
		throw new Error("Environment variables 'KUBE_SERVER' and 'KUBE_SERVICE_ACCOUNT' must be set.");

	// Load config template
	const configTemplateFilename = process.env["CONFIG_TEMPLATE"] || "./haproxy.template.cfg";
	const configTemplateContents = readFileSync(configTemplateFilename, { encoding: "utf-8" });
	const configTemplate = compileTemplate(configTemplateContents);

	// Start update process
	let haProxyPid = null;
	let lastConfig = null;
	let updating = false;

	const updateConfig = async () => {

		try {

			if (updating) {
				logger.debug("Still updating...");
				return;
			}

			updating = true;

			// Fetch nodes
			logger.debug("Fetching Kubernetes nodes...");

			const nodes = await fetchNodes(kubeConfig);

			logger.debug("Received Kubernetes node list:", nodes);

			// Fetch services
			logger.debug("Fetching Kubernetes services...");

			const services = await fetchServices(kubeConfig);

			logger.debug("Received Kubernetes services:", services);

			// Generate config
			logger.debug("Generating new config...");

			const portMappingIndex = {};

			const newConfig = configTemplate({
				config: haProxyConfig,
				services: services
					.filter((service) => {
						return ( service.spec.type === "NodePort" || service.spec.type === "LoadBalancer" )
							&& service.metadata.annotations
							&& service.metadata.annotations["haproxy-lb.hexio.io/loadBalancer"];
					})
					.map((service) => {

						const bindAddress = service.metadata.annotations["haproxy-lb.hexio.io/loadBalancerBindIP"] || service.spec.loadBalancerIP;

						if (!bindAddress)
							logger.warn("Service has no bind IP addres nor LoadBalancerIP set:", {
								service: service.metadata.name + "." + service.metadata.namespace + ".svc"
							});

						return {
							name: service.metadata.namespace + "-" + service.metadata.name,
							bindAddress: bindAddress,
							ports: service.spec.ports.map((port) => {

								// Check if the same mapping already exists
								const mappingKey = port.protocol + ":" + bindAddress + ":" + port.port;

								const exists = portMappingIndex[mappingKey] ? true : false;
								const isProtocolSupported = (port.protocol.toLowerCase() === "tcp" || port.protocol.toLowerCase() === "http");

								portMappingIndex[mappingKey] = true;

								if (exists)
									logger.warn("Service port with specified protocol, IP and port is already defined by another service:", {
										service: service.metadata.name + "." + service.metadata.namespace + ".svc",
										port: port
									});

								if (!isProtocolSupported)
									logger.warn("Service port protocol is not supported by HA Proxy", {
										service: service.metadata.name + "." + service.metadata.namespace + ".svc",
										port: port
									});

								return {
									protocol: port.protocol.toLowerCase(),
									valid: isProtocolSupported && !exists && bindAddress,
									bindPort: port.port,
									nodePort: port.nodePort,
								};

							}),
							serviceObject: service
						};

					}),
				nodes: nodes
					.map((node) => ({
						name: node.metadata.name,
						ipAddress: node.status.addresses.find((val) => val.type === "InternalIP").address,
						nodeObject: node
					}))
			});

			// Update LB services
			for (let i = 0; i < services.length; i++) {

				const service = services[i];

				if (
					service.spec.type === "LoadBalancer"
					&& service.metadata.annotations
					&& service.metadata.annotations["haproxy-lb.hexio.io/loadBalancer"]
					&& service.spec.loadBalancerIP
					&& !service.status.loadBalancer.ingress
				) {

					const newSvc = {
						...service,
						status: {
							...service.status,
							loadBalancer: {
								ingress: [
									{ ip: service.spec.loadBalancerIP }
								]
							}
						}
					};

					logger.debug("Updating LB object:", newSvc);

					await updateServiceStatus(kubeConfig, newSvc);

				}

			}

			logger.debug("New config:", newConfig);

			// Compare to previous one and skip if there are no changes
			if (lastConfig === newConfig) {

				logger.debug("Config did not change.");
				updating = false;
				return;

			}

			logger.debug("Writing configuration file to:", configFilename);
			writeFileSync(configFilename, newConfig, { encoding: "utf-8" });

			// Validate config
			if (!await verifyHAProxyConfig(configFilename))
				throw new Error("HA Proxy configuration is not valid.");

			// Reload service
			haProxyPid = await reloadHAProxy(configFilename, haProxyPid);
			lastConfig = newConfig;

		} catch (err) {

			logger.error("Failed to update configuration:", err);

		} finally {

			updating = false;

		}

	};

	logger.info("Starting watch process, update interval (ms):", updateInterval);

	// Start interval
	setInterval(() => {

		updateConfig().catch((err) => logger.error("Failed to execute update function:", err));

	}, updateInterval);

	// Do first load immediately
	updateConfig().catch((err) => logger.error("Failed to execute update function:", err));

}

/*
 * Start controller
 */
main().catch((err) => {

	console.error("Failed to start application:", err);

});
