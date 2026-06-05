# Deployment Guide — Development Server

Target stack: **NestJS + PostgreSQL + PM2 + Nginx** on Ubuntu/Debian.

---

## A. Prerequisites

Install the following on the server before deploying.

```bash
# Node.js LTS (v20 recommended via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (global)
sudo npm install -g pm2

# Nginx
sudo apt-get install -y nginx

# Git
sudo apt-get install -y git

# PostgreSQL client libs (if DB is remote, you only need the client)
sudo apt-get install -y postgresql-client
# Or full local install:
# sudo apt-get install -y postgresql postgresql-contrib
```

Verify:
```bash
node -v    # should be v20.x
npm -v
pm2 -v
nginx -v
git --version
```

---

## B. Clone the Repository

```bash
sudo mkdir -p /var/www
sudo chown $USER:$USER /var/www
cd /var/www
git clone <REPO_URL> kesh-kyb-kyc-be
cd kesh-kyb-kyc-be
```

---

## C. Copy and Configure `.env`

```bash
cp .env.example .env
nano .env   # or use your preferred editor
```

**Required values to fill in:**

| Variable | Description |
|---|---|
| `JWT_SECRET` | Long random string — generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `DATABASE_URL` | Full Postgres connection string, e.g. `postgres://user:pass@host:5432/dbname` |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | Fallback individual vars for migration scripts |
| `CORS_ORIGIN` | Comma-separated frontend origins, e.g. `https://kyc-dev.kesh.co.id` |
| `BASE_URL` | Public HTTPS URL of this API, e.g. `https://kyc-api-dev.kesh.co.id` |
| `UPLOAD_DIR` | Local path for file uploads (default: `uploads`) |
| `MAX_UPLOAD_MB` | Max upload size in MB (default: `20`) |

---

## D. Install Dependencies

```bash
cd /var/www/kesh-kyb-kyc-be
npm ci
```

> **Note:** Untuk development server, devDependencies boleh terinstall karena NestJS build butuh `@nestjs/cli` dan `typescript`.
> Untuk production optimization, bisa jalankan `npm prune --omit=dev` setelah build jika benar-benar dibutuhkan dan sudah dipastikan semua runtime dependency lengkap.

---

## E. Build the Application

```bash
npm run build
```

A successful build produces the `dist/` folder.

---

## F. Run Database Migrations

```bash
npm run db:migrate
```

This reads `DATABASE_URL` (or individual `PG*` vars) from `.env` and applies all SQL migrations in `infra/db/migrations/`.

---

## G. (Optional) Seed Development Data

```bash
# Development only — do NOT run on production
npm run db:seed
```

---

## H. Start with PM2

```bash
# Ensure runtime directories exist
mkdir -p uploads logs

# Start (first time) or restart (subsequent deploys)
pm2 start ecosystem.config.cjs --env development

# Verify it started
pm2 status
pm2 logs kesh-kyb-kyc-be-dev --lines 50
```

---

## I. PM2 Auto-start on Server Reboot

```bash
pm2 save
pm2 startup
# PM2 will print a sudo command — copy and run it, e.g.:
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
```

---

## J. Nginx Reverse Proxy

1. Edit the domain in the config file:
   ```bash
   nano deploy/nginx/kesh-kyb-kyc-be-dev.conf
   # Change `kyc-api-dev.kesh.co.id` to your actual domain / IP
   ```

2. Install and enable:
   ```bash
   sudo cp deploy/nginx/kesh-kyb-kyc-be-dev.conf /etc/nginx/sites-available/kesh-kyb-kyc-be-dev
   sudo ln -s /etc/nginx/sites-available/kesh-kyb-kyc-be-dev /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## K. SSL — Let's Encrypt (Optional but Recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d kyc-api-dev.kesh.co.id
# Follow the prompts; certbot auto-updates the nginx config
sudo systemctl reload nginx
```

After SSL is active, uncomment the HTTPS block in the nginx config and enable the HTTP→HTTPS redirect.

---

## L. Health Check / Smoke Test

```bash
# API health endpoint
curl http://localhost:4000/api/health

# Through Nginx
curl http://kyc-api-dev.kesh.co.id/api/health

# Auth endpoint (should return 401 without credentials)
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"wrong"}'
```

---

## M. Subsequent Deploys

Use the deploy script:

```bash
cd /var/www/kesh-kyb-kyc-be
bash scripts/deploy-dev.sh
```

The script does: `git pull` → `npm ci` → `npm run build` → `npm run db:migrate` → `pm2 startOrRestart`.

---

## N. Troubleshooting

```bash
# PM2 process status
pm2 status

# Live logs
pm2 logs kesh-kyb-kyc-be-dev

# Last 100 error lines
pm2 logs kesh-kyb-kyc-be-dev --err --lines 100

# Nginx config test
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx

# Check if app is listening on port 4000
ss -tlnp | grep 4000

# Direct health check bypassing Nginx
curl http://localhost:4000/api/health

# Check .env is present and has required keys
grep -E "^(DATABASE_URL|JWT_SECRET|API_PORT)" /var/www/kesh-kyb-kyc-be/.env
```

### Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| PM2 shows `errored` | Missing `.env` or bad `DATABASE_URL` | Check `pm2 logs`, fix `.env`, then `pm2 restart kesh-kyb-kyc-be-dev` |
| 502 Bad Gateway | App not running or wrong port | `pm2 status`, verify `API_PORT=4000` in `.env` |
| Upload fails / 413 | `client_max_body_size` too small | Increase in nginx config and reload |
| CORS error | Origin not in `CORS_ORIGIN` | Add frontend origin to `.env` and restart PM2 |
| Migration fails | Wrong DB credentials | Verify `DATABASE_URL` and `PG*` vars in `.env` |
