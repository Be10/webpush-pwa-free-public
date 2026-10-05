const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

if (fs.existsSync(envPath)) {
  console.log('.env ya existe. No se sobrescribio.');
  process.exit(0);
}

const ecdh = crypto.createECDH('prime256v1');
const publicKey = ecdh.generateKeys();
const privateKey = ecdh.getPrivateKey();
const token = crypto.randomBytes(24).toString('hex');

const body = [
  'PORT=3000',
  'VAPID_SUBJECT=mailto:admin@example.com',
  `VAPID_PUBLIC_KEY=${b64url(publicKey)}`,
  `VAPID_PRIVATE_KEY=${b64url(privateKey)}`,
  `ADMIN_TOKEN=${token}`,
  ''
].join('\n');

fs.writeFileSync(envPath, body, { mode: 0o600 });
console.log('Configuracion creada en .env');
console.log(`ADMIN_TOKEN=${token}`);
console.log('Guarda este token: se usa para abrir el panel de envio.');
