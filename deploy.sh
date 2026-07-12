#!/usr/bin/env bash
# 一键部署脚本 —— 从零到 Bot 可用
#
# 用法(推荐,命令行传参):
#   ./deploy.sh --cf-token=xxx --cf-account=xxx --tg-token=xxx \
#               [--admin-key=xxx] [--turnstile-secret=xxx] \
#               [--worker=fingerprint-collector] [--db=fingerprint-db]
#
# 简写:
#   ./deploy.sh -t <cf_token> -a <cf_account> -b <tg_token>
#
# 交互式(不传参就逐项询问):
#   ./deploy.sh
#
# 环境变量也支持(命令行优先):
#   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID / TELEGRAM_BOT_TOKEN
#   ADMIN_KEY / TURNSTILE_SECRET / WORKER_NAME / DB_NAME
set -euo pipefail

usage() {
  sed -n '2,17p' "$0"; exit "${1:-0}"
}

# 默认取环境变量
CF_TOKEN="${CLOUDFLARE_API_TOKEN:-}"
CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-}"
TG_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
ADMIN_KEY_ARG="${ADMIN_KEY:-}"
TURNSTILE_SECRET_ARG="${TURNSTILE_SECRET:-}"
WORKER_NAME="${WORKER_NAME:-verification}"
DB_NAME="${DB_NAME:-fingerprint-db}"

# 命令行参数解析(支持 --key=val / --key val / -x val)
while [ $# -gt 0 ]; do
  case "$1" in
    --cf-token=*)   CF_TOKEN="${1#*=}"; shift ;;
    --cf-account=*) CF_ACCOUNT="${1#*=}"; shift ;;
    --tg-token=*)   TG_TOKEN="${1#*=}"; shift ;;
    --admin-key=*)  ADMIN_KEY_ARG="${1#*=}"; shift ;;
    --turnstile-secret=*) TURNSTILE_SECRET_ARG="${1#*=}"; shift ;;
    --worker=*)     WORKER_NAME="${1#*=}"; shift ;;
    --db=*)         DB_NAME="${1#*=}"; shift ;;
    --cf-token|-t)   CF_TOKEN="$2"; shift 2 ;;
    --cf-account|-a) CF_ACCOUNT="$2"; shift 2 ;;
    --tg-token|-b)   TG_TOKEN="$2"; shift 2 ;;
    --admin-key|-k)  ADMIN_KEY_ARG="$2"; shift 2 ;;
    --turnstile-secret) TURNSTILE_SECRET_ARG="$2"; shift 2 ;;
    --worker|-w)     WORKER_NAME="$2"; shift 2 ;;
    --db|-d)         DB_NAME="$2"; shift 2 ;;
    -h|--help)       usage 0 ;;
    *) echo "未知参数: $1" >&2; usage 1 ;;
  esac
done

# 缺失项交互式补齐
prompt_secret() {
  local var="$1" msg="$2" val
  read -r -s -p "$msg: " val; echo
  printf -v "$var" '%s' "$val"
}
[ -z "$CF_TOKEN"   ] && prompt_secret CF_TOKEN   "Cloudflare API Token"
[ -z "$CF_ACCOUNT" ] && read -r -p "Cloudflare Account ID: " CF_ACCOUNT
[ -z "$TG_TOKEN"   ] && prompt_secret TG_TOKEN   "Telegram Bot Token"

[ -z "$CF_TOKEN"   ] && { echo "❌ 缺 CF API Token"; exit 1; }
[ -z "$CF_ACCOUNT" ] && { echo "❌ 缺 CF Account ID"; exit 1; }
[ -z "$TG_TOKEN"   ] && { echo "❌ 缺 Telegram Bot Token"; exit 1; }

export CLOUDFLARE_API_TOKEN="$CF_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT"
TELEGRAM_BOT_TOKEN="$TG_TOKEN"
ADMIN_KEY="${ADMIN_KEY_ARG:-$(openssl rand -hex 32)}"

echo "==> 配置"
echo "    Worker  : $WORKER_NAME"
echo "    D1      : $DB_NAME"
echo "    Account : $CF_ACCOUNT"

cd "$(dirname "$0")"

# 从模板生成本地 wrangler.toml(不入 git)
if [ ! -f wrangler.toml ]; then
  cp wrangler.toml.example wrangler.toml
  echo "==> 从模板生成 wrangler.toml"
fi

echo "==> [1/8] 安装依赖"
npm install --silent

WRANGLER="npx --yes wrangler@latest"

echo "==> [2/8] 检查/创建 D1: $DB_NAME"
DB_ID=$($WRANGLER d1 list --json 2>/dev/null | \
  node -e "let d=JSON.parse(require('fs').readFileSync(0));console.log((d.find(x=>x.name==='$DB_NAME')||{}).uuid||'')")

if [ -z "$DB_ID" ]; then
  echo "    创建新 D1..."
  CREATE_OUT=$($WRANGLER d1 create "$DB_NAME")
  DB_ID=$(echo "$CREATE_OUT" | grep -Eo '[0-9a-f-]{36}' | head -1)
fi
echo "    D1 ID: $DB_ID"

echo "==> [3/8] 写入 wrangler.toml"
node -e "
const fs=require('fs');
let t=fs.readFileSync('wrangler.toml','utf8');
t=t.replace(/database_id = \".*\"/, 'database_id = \"$DB_ID\"');
t=t.replace(/database_name = \".*\"/, 'database_name = \"$DB_NAME\"');
t=t.replace(/^name = \".*\"/m, 'name = \"$WORKER_NAME\"');
fs.writeFileSync('wrangler.toml',t);
"

echo "==> [4/8] 初始化 D1 表结构(远程,按顺序跑所有迁移,已应用的会跳过)"
$WRANGLER d1 execute "$DB_NAME" --remote --command \
  "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)" >/dev/null

for f in migrations/*.sql; do
  name=$(basename "$f")
  hits=$($WRANGLER d1 execute "$DB_NAME" --remote --json \
    --command "SELECT 1 FROM _migrations WHERE name='$name'" 2>/dev/null | \
    node -e "let d=JSON.parse(require('fs').readFileSync(0));console.log((d[0]?.results||d[0]?.result||[]).length||0)")
  if [ "${hits:-0}" -gt 0 ]; then
    echo "    · $name  (已应用,跳过)"
    continue
  fi
  echo "    · $name  (应用中)"
  $WRANGLER d1 execute "$DB_NAME" --remote --file="$f"
  $WRANGLER d1 execute "$DB_NAME" --remote \
    --command "INSERT INTO _migrations (name, applied_at) VALUES ('$name', $(date +%s))" >/dev/null
done

echo "==> [5/8] 注入 secrets"
echo -n "$TELEGRAM_BOT_TOKEN" | $WRANGLER secret put TELEGRAM_BOT_TOKEN
echo -n "$ADMIN_KEY"          | $WRANGLER secret put ADMIN_KEY
if [ -n "$TURNSTILE_SECRET_ARG" ]; then
  echo -n "$TURNSTILE_SECRET_ARG" | $WRANGLER secret put TURNSTILE_SECRET
  echo "    · TURNSTILE_SECRET 已注入(服务端二次校验开启)"
else
  echo "    · TURNSTILE_SECRET 未提供(跳过服务端校验;前端仍会显示 widget)"
fi

echo "==> [6/8] 首次部署(拿到 workers.dev URL)"
$WRANGLER deploy

# workers.dev 子域名
SUBDOMAIN=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
  | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).result.subdomain)")
BASE_URL="https://$WORKER_NAME.$SUBDOMAIN.workers.dev"
echo "    BASE_URL: $BASE_URL"

echo "==> [7/8] 写回 BASE_URL 到 wrangler.toml 并重新部署"
node -e "
const fs=require('fs');
let t=fs.readFileSync('wrangler.toml','utf8');
t=t.replace(/BASE_URL = \".*\"/, 'BASE_URL = \"$BASE_URL\"');
fs.writeFileSync('wrangler.toml',t);
"
$WRANGLER deploy

echo "==> [8/8] 设置 Telegram webhook"
WEBHOOK_RESP=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${BASE_URL}/tg/webhook")
echo "    $WEBHOOK_RESP"

BOT_USERNAME=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe" | node -e "console.log(JSON.parse(require('fs').readFileSync(0)).result.username)")
ADMIN_URL="$BASE_URL/?key=$ADMIN_KEY"

cat <<EOF

✅ 部署完成!

🔗 管理后台(点开即用,key 已内嵌):
   $ADMIN_URL

🤖 Telegram Bot:  https://t.me/$BOT_USERNAME
🎯 采集链接前缀:  $BASE_URL/c/<token>

管理密钥 (保存好,勿泄露):
  ADMIN_KEY=$ADMIN_KEY

在 Telegram 里发 /new 生成采集链接。
EOF

# 自动打开管理后台(macOS)
if command -v open >/dev/null 2>&1; then
  open "$ADMIN_URL" 2>/dev/null || true
fi
