# -----
# Build
# -----
FROM node:alpine AS build

# Envs
ENV HAPROXY_BRANCH 2.1
ENV HAPROXY_MINOR 2.1-dev1
ENV HAPROXY_MD5 d8c03534b553aa89e6c5e459fa5b2f14
ENV HAPROXY_SRC_URL http://www.haproxy.org/download

ENV HAPROXY_UID haproxy
ENV HAPROXY_GID haproxy

# Install packages
RUN apk add --update --no-cache --virtual build-deps gcc libc-dev bind-tools \
	linux-headers lua5.3-dev make openssl openssl-dev pcre-dev tar \
	zlib-dev curl shadow

# Download and compile HA Proxy
RUN curl -sfSL "$HAPROXY_SRC_URL/$HAPROXY_BRANCH/src/devel/haproxy-$HAPROXY_MINOR.tar.gz" -o haproxy.tar.gz && \
    echo "$HAPROXY_MD5  haproxy.tar.gz" | md5sum -c - && \
    groupadd "$HAPROXY_GID" && \
    useradd -g "$HAPROXY_GID" "$HAPROXY_UID" && \
    mkdir -p /tmp/haproxy && \
    tar -xzf haproxy.tar.gz -C /tmp/haproxy --strip-components=1 && \
    rm -f haproxy.tar.gz && \
    make -C /tmp/haproxy TARGET=linux-glibc CPU=generic USE_PCRE=1 USE_REGPARM=1 USE_OPENSSL=1 \
                            USE_ZLIB=1 USE_TFO=1 USE_LINUX_TPROXY=1 \
                            USE_LUA=1 LUA_LIB=/usr/lib/lua5.3 LUA_INC=/usr/include/lua5.3 \
                            EXTRA_OBJS="contrib/prometheus-exporter/service-prometheus.o" \
                            all install-bin install-man && \
    rm -rf /tmp/haproxy && \
    apk add --no-cache openssl zlib lua5.3-libs pcre

# Add files
WORKDIR /app

ADD ./package.json /app/package.json
RUN npm install

ADD ./src /app/src
ADD ./tsconfig.json /app/tsconfig.json
RUN npm run build

# -------
# Runtime
# -------
FROM node:alpine AS runtime

LABEL Name Kubernetes HA Proxy External Load Balancer
LABEL Vendor Hexio a.s.
LABEL Version 1.0

ENV HAPROXY_UID haproxy
ENV HAPROXY_GID haproxy

RUN apk add --no-cache openssl zlib lua5.3-libs pcre bash busybox-extras shadow

RUN groupadd "$HAPROXY_GID" && \
	useradd -g "$HAPROXY_GID" "$HAPROXY_UID"

WORKDIR /app

COPY --from=build /app/dist /app/dist
COPY --from=build /app/package.json /app/package.json
COPY --from=build /usr/local/sbin/haproxy /usr/local/sbin/haproxy

RUN npm install \
	&& mkdir -p /var/lib/haproxy \
	&& ln -s /usr/local/sbin/haproxy /usr/sbin/haproxy

ADD ./haproxy.template.cfg /app/haproxy.template.cfg

# Command
ENTRYPOINT ["npm", "run", "start"]