#!/bin/bash
docker exec "haproxy-k8s-lb" /bin/bash -c 'kill -SIGUSR1 $(ps aux | grep -m1 "node ./dist/index.js" | awk "{print \$1}")'
