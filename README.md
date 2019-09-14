# haproxy-k8s-lb

External LoadBalancer for Kubernetes.

This container consists of a HA Proxy and a controller. Controller pools Kubernetes services in regular intervals and automatically updates a HA Proxy configuration.

This container is ment to run OUTSIDE of Kubernetes cluster and it's purpose is to provide an external LBaaS when no cloud provider is available (or not wanted).

Of course you can use MetalLB but when you have no access to L2 network or BGP is not applicable this is a good alternative.

**IMPORTANT: It's necessary to run a container in a host network in order to HA Proxy to be able to bind IP addresses.**

Also, you can open ports using classic Docker way but then bind IPs in k8s services must be set to `127.0.0.1` or `*`.

**NOTE:** The controller also updates the k8s service status so the service will not remain in a `<pending>` state and the specified `loadBalancerIP` will be available as a service `External IP`.

## Prerequisities

You must setup a service account in your k8s cluster that has access to `services` and `nodes` resources. The `service` resources must be writable.

You can find sample manifests in a `deployment` directory.

## Run

```
docker run --network host <image_tag>
```

## Configuration

Configuration is done using the following environment variables.

```bash
# Controller config
LOG_LEVEL="debug|info|notice|warn|error|critical|alert|emergency" # Default: warn
UPDATE_INTERVAL="60" # In seconds

# Kubernetes API
KUBE_SERVER="https://192.168.0.1:6443" # Required
KUBE_SERVER_CA="<base64 encoded server certificate>" # Required
KUBE_SERVICE_TOKEN="<Kubernetes service account token>" # Required
KUBE_NAMESPACE="default"

# HA Proxy Config
HAPROXY_GLOBAL_MAX_CONN="16000"
HAPROXY_GLOBAL_SPREAD_CHECKS="4"
HAPROXY_GLOBAL_TUNE_MAX_REWRITE="1024"
HAPROXY_GLOBAL_TUNE_BUFFER_SIZE="32768"
HAPROXY_MAX_CONN="8000"
HAPROXY_RETRIES="3"
HAPROXY_TIMEOUT_HTTP_REQUEST="10s"
HAPROXY_TIMEOUT_QUEUE="1m"
HAPROXY_TIMEOUT_CONNECT="10s"
HAPROXY_TIMEOUT_CLIENT="1m"
HAPROXY_TIMEOUT_SERVER="1m"
HAPROXY_TIMEOUT_HTTP_KEEP_ALIVE="10s"
HAPROXY_TIMEOUT_CHECK="10s"
```

## Usage

You can create a standard k8s services of a `LoadBalancer` type and you MUST add the following annotation:

```
"haproxy-lb.hexio.io/loadBalancer": true
```

**Example:**

```yaml
apiVersion: v1
kind: Service
metadata:
  annotations:
    haproxy-lb.hexio.io/loadBalancer: "true"
  name: my-lb-service
spec:
  type: LoadBalancer
  loadBalancerIP: 1.2.3.4
  ports:
  - port: 80
    protocol: TCP
    targetPort: 8080
  selector:
    app: my-app
  sessionAffinity: None
```

### Bind IP

When your Load balancer is not able to bind directly to the `loadBalancerIP`, eg. it is behind the NAT you can add the following annotation to specify real bind IP address for a HA Proxy:

```
"haproxy-lb.hexio.io/loadBalancerBindIP": "10.0.0.42"
```

If you want your load balancer to bind on all interfaces you can use a wildcard:

```
"haproxy-lb.hexio.io/loadBalancerBindIP": "*"
```

**Example:**

```yaml
apiVersion: v1
kind: Service
metadata:
  annotations:
    haproxy-lb.hexio.io/loadBalancer: "true"
    haproxy-lb.hexio.io/loadBalancerBindIP": "10.0.0.42"
  name: my-lb-service
spec:
  type: LoadBalancer
  loadBalancerIP: 1.2.3.4
  ports:
  - port: 80
    protocol: TCP
    targetPort: 8080
  selector:
    app: my-app
  sessionAffinity: None
```

## Development

The controller is written in a TypeScript for a Node.JS runtime.

**Note that if you don't have HA proxy installed on your system the config update process will be failing because HA Proxy binary won't be found.**

Running application outside of a Docker is good for a Kubernetes API testing. For full dev & tests it's recommended to run app in a Docker.

```bash
# Prepare temp directory for sample output HA Proxy config
mkdir -p ./temp

# Install packages
npm install

# Build sources
npm build

# Setup config
export KUBE_SERVER="<k8s api server url>"
export TOKEN_SECRET="<name of the secret containing the service account token>"
export KUBE_SERVER_CA=$(kubectl get secret/${TOKEN_SECRET} -o jsonpath='{.data.ca\.crt}')
export KUBE_SERVICE_TOKEN=$(kubectl get secret/${TOKEN_SECRET} -o jsonpath='{.data.token}' | base64 --decode)
export KUBE_NAMESPACE=$(kubectl get secret/${TOKEN_SECRET} -o jsonpath='{.data.namespace}' | base64 --decode)
export LOG_LEVEL="debug"

# Build sources & run application
npm run start-dev

# Build Docker container
docker build -t <image_tag> .
```

## License

Copyright 2019 Hexio a.s. <contact@hexio.io> [https://hexio.io/](https://hexio.io/).

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.