/* eslint-disable global-require */
/* eslint-disable @typescript-eslint/no-var-requires */
import cluster from "cluster";

// -----------------------------------------------------------------------------

export type ClusterModule = typeof cluster;
export type Worker = cluster.Worker;

// -----------------------------------------------------------------------------

let _cluster: ClusterModule;

// -----------------------------------------------------------------------------

export function loadCluster(): ClusterModule {
	if (!_cluster) {
		_cluster = require('cluster');
	}
	return _cluster;
}
