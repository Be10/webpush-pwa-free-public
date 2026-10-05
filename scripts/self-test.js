const crypto = require('crypto');
const {
  encryptPayload,
  createVapidAuthorization,
  hkdfExtract,
  hkdfExpand,
  b64url,
  fromB64url,
  VAPID_PUBLIC_KEY
} = require('../server');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const client = crypto.createECDH('prime256v1');
const clientPublic = client.generateKeys();
const auth = crypto.randomBytes(16);
const payload = JSON.stringify({ title: 'Prueba', body: 'Web Push OK', url: '/' });
const subscription = {
  endpoint: 'https://push.example.test/send/123',
  keys: {
    p256dh: b64url(clientPublic),
    auth: b64url(auth)
  }
};

const body = encryptPayload(subscription, payload);
const salt = body.subarray(0, 16);
const rs = body.readUInt32BE(16);
const idLen = body[20];
const serverPublic = body.subarray(21, 21 + idLen);
const encrypted = body.subarray(21 + idLen);

assert(idLen === 65, 'La clave publica efimera debe ocupar 65 bytes.');
assert(rs >= 4096, 'Record size inesperado.');

const shared = client.computeSecret(serverPublic);
const prkKey = hkdfExtract(auth, shared);
const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPublic, serverPublic]);
const ikm = hkdfExpand(prkKey, keyInfo, 32);
const prk = hkdfExtract(salt, ikm);
const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

const ciphertext = encrypted.subarray(0, -16);
const tag = encrypted.subarray(-16);
const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
decipher.setAuthTag(tag);
const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
assert(clear.at(-1) === 2, 'Delimitador final aes128gcm incorrecto.');
assert(clear.subarray(0, -1).toString('utf8') === payload, 'El payload descifrado no coincide.');

const authHeader = createVapidAuthorization(subscription.endpoint);
const match = /^vapid t=([^,]+), k=(.+)$/.exec(authHeader);
assert(match, 'Cabecera VAPID invalida.');
assert(match[2] === VAPID_PUBLIC_KEY, 'La clave publica VAPID no coincide.');
const jwt = match[1];
const [head, claims, sig] = jwt.split('.');
const decodedClaims = JSON.parse(fromB64url(claims).toString('utf8'));
assert(decodedClaims.aud === 'https://push.example.test', 'Audience VAPID incorrecta.');

const pub = fromB64url(VAPID_PUBLIC_KEY);
const publicKey = crypto.createPublicKey({
  key: {
    kty: 'EC', crv: 'P-256',
    x: b64url(pub.subarray(1, 33)),
    y: b64url(pub.subarray(33, 65))
  },
  format: 'jwk'
});
const verified = crypto.verify('sha256', Buffer.from(`${head}.${claims}`), {
  key: publicKey,
  dsaEncoding: 'ieee-p1363'
}, fromB64url(sig));
assert(verified, 'Firma VAPID no valida.');

console.log('OK: cifrado aes128gcm Web Push y firma VAPID ES256 validados localmente.');
