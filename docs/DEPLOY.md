# 部署

单机部署：Docker Compose 跑应用容器 + nginx 容器，数据落在宿主机 `./data/ledger.db`。
管理器脚本 `deploy/manage.sh` 负责构建、启停、升级和状态检查。

## 前置条件

- Linux / macOS 服务器，已安装 Docker（含 Compose v2，即 `docker compose` 子命令）
- 从 GitHub 部署时需要 `git`
- 建议 1 核 1G 以上；镜像基于 `node:22-bookworm-slim`（内置 `node:sqlite`）

## 快速开始

```bash
git clone <仓库地址> ledger
cd ledger
./deploy/manage.sh start
```

首次运行会：

1. 根据 `.env.example` 生成 `.env`；
2. 构建应用镜像（多阶段：装依赖 → 构建前端与 API → 只带生产依赖的运行镜像）；
3. 启动 `app` 与 `nginx` 两个容器，等待健康检查通过；
4. 打印访问地址（默认 `http://127.0.0.1:8080`）。

## 配置（.env）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HTTP_PORT` | `8080` | nginx 映射到宿主机的端口 |
| `SERVER_NAME` | `_` | 域名；填了域名后 nginx 按该域名匹配 |
| `LEDGER_BRANCH` | 当前分支 | `upgrade` 拉取的分支 |
| `APP_UID` / `APP_GID` | 当前用户 | 容器运行身份，决定 `./data` 的写入权限 |

## 常用命令

```bash
./deploy/manage.sh start     # 构建并启动
./deploy/manage.sh status    # 容器状态 + 健康检查 + 数据文件大小
./deploy/manage.sh logs      # 跟踪日志（Ctrl-C 退出）
./deploy/manage.sh stop      # 停止（数据保留在 ./data）
./deploy/manage.sh upgrade   # 拉取最新代码 → 重建镜像 → 自动重启
```

### upgrade 做了什么

1. 检查工作区没有未提交改动（有则中止，避免冲突）；
2. `git fetch` + `git pull --ff-only`（分支取 `LEDGER_BRANCH`，默认当前分支）；
3. `docker compose build --pull`：重建应用镜像，同时更新基础镜像；
4. `docker compose up -d`：重建并重启变化的容器，nginx 不动；
5. 轮询 `/api/health`，通过后打印当前提交与访问地址；失败则输出最近日志并以非 0 退出。

数据在宿主机 `./data`，升级不会丢账本。

## 反向代理

`deploy/nginx.conf.template` 挂载到 nginx 官方镜像的 `/etc/nginx/templates/`，
容器启动时用 envsubst 替换 `${APP_HOST}` `${APP_PORT}` `${SERVER_NAME}`
（`NGINX_ENVSUBST_FILTER` 限定了这三个变量，nginx 自身的 `$host` 等不受影响）。

如果你已经有宿主机 nginx：

1. 停掉 compose 里的 nginx（`docker compose stop nginx`）并把 `app` 的端口暴露给宿主机；
2. 把模板里的三个变量替换成实际值（如 `127.0.0.1:3000`），include 到你的配置里；
3. 重载 nginx。

模板已包含：`/assets/` 长缓存、入口 HTML 不缓存、gzip、上传体积上限（12m）。

## HTTPS

推荐在宿主机 nginx 上加证书（certbot 等），把 80 跳转到 443 后反代到 `127.0.0.1:8080`
（或 app 容器端口）。也可以用 Cloudflare Tunnel / Caddy 之类放在前面。
本项目自身不处理 TLS。

## 数据与备份

- 数据文件：`./data/ledger.db`（WAL 模式，同时会有 `-wal` / `-shm` 文件）。
- 备份：`sqlite3 data/ledger.db ".backup 'backup.db'"`；或停服后直接复制 `./data` 目录。
- 重置：停服后删除 `./data/ledger.db*`，下次启动会重新建库。

## 安全提示

本项目按「无账号、善意使用」设计：知道链接的人就能加入活动，身份可被冒用。
请勿把服务直接暴露在公网而不做限制，建议至少：

- 放在 HTTPS 后面；
- 活动创建者设置管理员密码，保护回滚、关闭活动等操作；
- 必要时用 nginx `allow/deny`、Basic Auth 或 Cloudflare Access 再包一层。

## 常见问题

**`./data` 权限错误（容器无法写库）**
`manage.sh` 已经用当前用户 uid:gid 运行容器；若仍失败，检查目录归属：
`ls -ln data`，必要时 `sudo chown -R $(id -u):$(id -g) data`。

**端口被占用**
改 `.env` 里的 `HTTP_PORT`，再 `./deploy/manage.sh start`。

**跨架构部署（如在 Apple Silicon 上构建、部署到 x86 服务器）**
在目标服务器上构建，或使用 buildx：
`docker buildx build --platform linux/amd64 -t ledger-app:local --load .`

**升级后页面还是旧的**
入口 HTML 已设 `no-cache`；若中间还有 CDN，请清理 CDN 缓存或缩短其缓存时间。

**健康检查一直不通过**
`./deploy/manage.sh logs` 看 app 日志；常见原因是数据目录不可写或端口冲突。
