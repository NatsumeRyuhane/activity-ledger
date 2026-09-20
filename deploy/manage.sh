#!/usr/bin/env bash
#
# 活动账本部署管理器
#
#   ./deploy/manage.sh start     构建并启动（首次部署用这个）
#   ./deploy/manage.sh stop      停止服务（数据保留在 ./data）
#   ./deploy/manage.sh upgrade   从 GitHub 拉取最新代码，重建镜像并自动重启
#   ./deploy/manage.sh status    查看容器状态与健康检查
#   ./deploy/manage.sh logs      跟踪容器日志
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

C_RESET=$'\033[0m'
C_INFO=$'\033[1;36m'
C_WARN=$'\033[1;33m'
C_ERR=$'\033[1;31m'
log() { printf '%s==>%s %s\n' "${C_INFO}" "${C_RESET}" "$*"; }
warn() { printf '%s==> %s%s\n' "${C_WARN}" "$*" "${C_RESET}" >&2; }
die() {
  printf '%s==> %s%s\n' "${C_ERR}" "$*" "${C_RESET}" >&2
  exit 1
}

require_cmd() { command -v "$1" >/dev/null 2>&1 || die "找不到命令：$1"; }

require_docker() {
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "需要 Docker Compose v2（docker compose 子命令）"
  docker info >/dev/null 2>&1 || die "Docker 守护进程未运行，请先启动 Docker"
}

load_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    log "已根据 .env.example 生成 .env（可修改端口与域名）"
  fi
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  HTTP_PORT="${HTTP_PORT:-8080}"
  SERVER_NAME="${SERVER_NAME:-_}"
  export HTTP_PORT SERVER_NAME
  # 让容器以当前用户身份写入 ./data
  export APP_UID="${APP_UID:-$(id -u)}"
  export APP_GID="${APP_GID:-$(id -g)}"
}

health_ok() {
  docker compose exec -T app node -e \
    "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
    >/dev/null 2>&1
}

wait_healthy() {
  log "等待服务就绪…"
  for _ in $(seq 1 30); do
    if health_ok; then
      log "健康检查通过"
      return 0
    fi
    sleep 2
  done
  warn "60 秒内未通过健康检查，最近日志："
  docker compose logs --tail=50 app || true
  die "服务启动失败"
}

print_url() {
  if [ "${SERVER_NAME}" = "_" ] || [ -z "${SERVER_NAME}" ]; then
    log "访问地址：http://127.0.0.1:${HTTP_PORT}"
  else
    log "访问地址：http://${SERVER_NAME}（已配 HTTPS 时用 https://${SERVER_NAME}）"
  fi
}

cmd_start() {
  require_docker
  load_env
  mkdir -p data
  log "构建镜像（首次或依赖变更时会稍慢）"
  docker compose build
  log "启动容器"
  docker compose up -d --remove-orphans
  wait_healthy
  print_url
}

cmd_stop() {
  require_docker
  load_env
  docker compose down --remove-orphans
  log "已停止，数据保留在 ./data"
}

cmd_status() {
  require_docker
  load_env
  docker compose ps
  if health_ok; then
    log "健康检查通过"
    print_url
  else
    warn "健康检查未通过（服务可能未启动）"
  fi
  if [ -f data/ledger.db ]; then
    log "数据文件：./data/ledger.db（$(du -h data/ledger.db | cut -f1)）"
  fi
}

cmd_logs() {
  require_docker
  load_env
  docker compose logs -f --tail=100
}

cmd_upgrade() {
  require_docker
  load_env
  require_cmd git
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
    die "当前目录不是 git 仓库，无法从 GitHub 升级；请用 git clone 部署"

  [ -z "$(git status --porcelain)" ] || die "工作区有未提交的改动，请先提交或还原后再升级"

  local branch
  branch="${LEDGER_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

  log "拉取 origin/${branch} 最新代码"
  git fetch --prune origin
  git checkout "${branch}"
  git pull --ff-only origin "${branch}"

  log "重新构建镜像（--pull 会同时更新基础镜像）"
  docker compose build --pull

  log "重建容器并自动重启"
  docker compose up -d --remove-orphans

  wait_healthy
  print_url
  log "当前版本：$(git --no-pager log --oneline -1)"
}

usage() {
  cat <<'EOF'
活动账本部署管理器

用法：./deploy/manage.sh <子命令>

子命令：
  start     构建镜像并启动服务
  stop      停止服务（数据保留在 ./data）
  upgrade   从 GitHub 拉取最新代码，重建镜像并自动重启
  status    查看容器状态与健康检查
  logs      跟踪容器日志
  help      显示本帮助

配置：首次运行会生成 .env，可设置 HTTP_PORT（默认 8080）、SERVER_NAME（默认 _）。
      升级分支默认使用当前分支，可在 .env 里设置 LEDGER_BRANCH。
EOF
}

main() {
  case "${1:-}" in
    start) cmd_start ;;
    stop) cmd_stop ;;
    upgrade) cmd_upgrade ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    "" | -h | --help | help) usage ;;
    *)
      usage
      die "未知子命令：$1"
      ;;
  esac
}

main "$@"
