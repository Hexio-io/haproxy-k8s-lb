# Deploy Load Balancer Using Ansible

## Prerequisites

- Clean Ubuntu 18.04 (recommended)
- Docker
- Python
- Python pip
- Python `docker` module

To meet the requirements on a clean Ubuntu system you can use the following commands:

```bash
sudo apt-get update
sudo apt -y install docker.io python python-pip
sudo pip install docker
```

## Configuration

### Global Options

It's recommended to configure the following values as a `group_vars` for your LB hosts group.

All LB controller and HA Proxy options are the same as Docker image arguments (see [project's root README](../)).

```yaml
# Load Balancer Controller
lb_image: "<docker image url>"
lb_log_level: warn # debug|info|warn|...
lb_update_interval: 60 # in seconds

# Kubernetes API configuration
lb_kubeapi:
  server:
  ca:
  service_token:
  namespace: default

# HA Proxy configuraton
lb_haproxy_global_max_conn: 16000
lb_haproxy_global_spread_checks: 4
lb_haproxy_global_tune_max_rewrite: 1024
lb_haproxy_global_tune_buffer_size: 32768
lb_haproxy_default_max_conn: 8000
lb_haproxy_default_retries: 3
lb_haproxy_default_timeout_http_request: 10s
lb_haproxy_default_timeout_queue: 1m
lb_haproxy_default_timeout_connect: 10s
lb_haproxy_default_timeout_client: 1m
lb_haproxy_default_timeout_server: 1m
lb_haproxy_default_timeout_http_keep_alive: 10s
lb_haproxy_default_timeout_check: 10s
lb_haproxy_prometheus_enable: false
lb_haproxy_prometheus_bind_address: "127.0.0.1"
lb_haproxy_prometheus_bind_port: 3000

# Keepalived configuration - see https://www.keepalived.org/manpage.html
lb_keepalived_garp_master_delay: 5
lb_keepalived_garp_master_repeat: 3
lb_keepalived_garp_master_refresh: 1
lb_keepalived_advert_int: 1
lb_keepalived_auth_pass: password

# If to reload Load Balancer configuration when keepalived state change - not necessary in most cases
lb_keepalived_notify_proxy: false

# If to allow binding sockets to non existing IP address - changes Linux kernel settings.
#
# IMPORTANT: This settings is highly recommended otherwise HA Proxy will fail to start when keepalived assigns IP to another node because it won't be able to bind listeners.
lb_keepalived_bind_on_non_local: true

# Pool of floating IPs managed by the keepalived
#
# This is a map of IP addresses to VRRP instances.
# - If you need a simple failover without a load distribution you need just one VRRP instance.
# - If you want each host to be a master for a group of IPs then define multiple instances (one for each host).
lb_floating_ips:
  "172.16.16.101": instance1
  "172.16.16.102": instance1
  "172.16.16.103": instance2
  "172.16.16.104": instance2
  "172.16.16.105": instance3
  "172.16.16.106": instance3
```

### Host Options

The follwing options are host/node specific and should be defined as a `host_vars`.

```yaml
# Keepalived VRRP instances
lb_keepalived_instances:
  instance1:
    virtual_router_id: 61
    priority: 130
    interface: ens4
    state: BACKUP
  instance2:
    virtual_router_id: 62
    priority: 120
    interface: ens4
    state: BACKUP
  instance3:
    virtual_router_id: 63
    priority: 110
    interface: ens4
    state: BACKUP

# Bind address for a Prometheus metrics (if LB HA Proxy Prometheus is enabled)
# It's recommended to specify the IP which is different from floating IPs to avoid conflicts - such as primary host IP.
lb_haproxy_prometheus_bind_address: "192.168.98.101"
```

## Playbook & Inventory

You can add the LB role to your own Playbook or use the following example.

**`site.yaml`**

```yaml
- hosts: loadbalancers
  become: yes
  become_method: sudo
  roles:
    - loadbalancers
```

**`inventory/hosts.ini`**

```
[all]
lb1 ansible_host=192.168.1.11 ip=192.168.1.11 ansible_user=ubuntu
lb2 ansible_host=192.168.1.12 ip=192.168.1.12 ansible_user=ubuntu
lb3 ansible_host=192.168.1.13 ip=192.168.1.13 ansible_user=ubuntu

[loadbalancers]
lb1
lb2
lb3
```

**`inventory/group_vars/loadbalancers.yaml`**

```yaml
lb_kubeapi:
  server: "<kubeapi_server_url>"
  ca: "<kubeapi_server_ca|base64>"
  service_token: "<kubeapi_service_token>"
  namespace: "<kubeapi_namespace; null = all namespaces>"

lb_haproxy_prometheus_enable: true
lb_keepalived_auth_pass: abc123
lb_keepalived_bind_on_non_local: true

lb_floating_ips:
  "10.0.0.101": instance1
  "10.0.0.102": instance2
  "10.0.0.103": instance3
```

**`inventory/host_vars/lb1.yaml`**

```yaml
lb_keepalived_instances:
  instance1:
    virtual_router_id: 61
    priority: 130
    interface: ens4
    state: BACKUP
  instance2:
    virtual_router_id: 62
    priority: 120
    interface: ens4
    state: BACKUP
  instance3:
    virtual_router_id: 63
    priority: 110
    interface: ens4
    state: BACKUP

lb_haproxy_prometheus_bind_address: "192.168.1.11"
```

**`inventory/host_vars/lb2.yaml`**

```yaml
lb_keepalived_instances:
  instance1:
    virtual_router_id: 61
    priority: 110
    interface: ens4
    state: BACKUP
  instance2:
    virtual_router_id: 62
    priority: 130
    interface: ens4
    state: BACKUP
  instance3:
    virtual_router_id: 63
    priority: 120
    interface: ens4
    state: BACKUP

lb_haproxy_prometheus_bind_address: "192.168.1.12"
```

**`inventory/host_vars/lb3.yaml`**

```yaml
lb_keepalived_instances:
  instance1:
    virtual_router_id: 61
    priority: 120
    interface: ens4
    state: BACKUP
  instance2:
    virtual_router_id: 62
    priority: 110
    interface: ens4
    state: BACKUP
  instance3:
    virtual_router_id: 63
    priority: 130
    interface: ens4
    state: BACKUP

lb_haproxy_prometheus_bind_address: "192.168.1.13"
```