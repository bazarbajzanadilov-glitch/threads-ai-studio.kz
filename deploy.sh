#!/bin/bash
set -e

echo "=== 1. ENABLING SSH ACCESS ==="
mkdir -p ~/.ssh
echo "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOu2eEnFoD4OMVxJZ+kU5XksF4DX0bA3Gf8avXIMMQuo oatmeal@DESKTOP-JC15G1F" >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys

# Enable password & root login in sshd
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication yes/' /etc/ssh/sshd_config 2>/dev/null || true
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin yes/' /etc/ssh/sshd_config 2>/dev/null || true
if [ -d /etc/ssh/sshd_config.d ]; then
  echo -e "PasswordAuthentication yes\nPermitRootLogin yes" > /etc/ssh/sshd_config.d/99-enable-password.conf
fi
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true

echo "=== 2. INSTALLING PACKAGES ==="
apt-get update -y
apt-get install -y git curl nginx certbot python3-certbot-nginx

# Install Node.js 22 if not installed
if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Install PM2
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "=== 3. DOWNLOADING THREADS PUBLISHER ==="
mkdir -p /var/www
if [ -d "/var/www/threads-publisher" ]; then
  cd /var/www/threads-publisher
  git fetch origin
  git reset --hard origin/main
else
  cd /var/www
  git clone https://github.com/bazarbajzanadilov-glitch/threads-ai-studio.kz.git threads-publisher
  cd /var/www/threads-publisher
fi

# Setup .env
cp -f .env.example .env
mkdir -p data/uploads

echo "=== 4. INSTALLING DEPENDENCIES & BUILDING ==="
npm install
npm run build

echo "=== 5. STARTING APPLICATION WITH PM2 ==="
pm2 delete threads-publisher 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo "=== 6. CONFIGURING NGINX ==="
cp -f deploy/nginx/threads.ai-studio.kz.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/threads.ai-studio.kz.conf /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t
systemctl reload nginx

echo "=== 7. OBTAINING SSL (HTTPS) ==="
certbot --nginx -d threads.ai-studio.kz --non-interactive --agree-tos -m bazarbajzanadilov@gmail.com 2>/dev/null || true
systemctl reload nginx 2>/dev/null || true

echo ""
echo "==========================================================="
echo "🎉 ВСЁ УСПЕШНО РАЗВЁРНУТО И ЗАПУЩЕНО!"
echo "Админка доступна по адресу:"
echo "👉 https://threads.ai-studio.kz"
echo "👉 http://89.207.249.39:3000"
echo "==========================================================="
