const $ = (id) => document.getElementById(id);
const els = {
  supportBadge: $('supportBadge'),
  browserStatus: $('browserStatus'),
  permissionStatus: $('permissionStatus'),
  subscriptionStatus: $('subscriptionStatus'),
  pwaStatus: $('pwaStatus'),
  iosNotice: $('iosNotice'),
  deviceName: $('deviceName'),
  subscribeBtn: $('subscribeBtn'),
  unsubscribeBtn: $('unsubscribeBtn'),
  clientMessage: $('clientMessage'),
  adminToken: $('adminToken'),
  loadDevicesBtn: $('loadDevicesBtn'),
  targetDevice: $('targetDevice'),
  notificationTitle: $('notificationTitle'),
  notificationBody: $('notificationBody'),
  notificationUrl: $('notificationUrl'),
  notificationTag: $('notificationTag'),
  requireInteraction: $('requireInteraction'),
  sendBtn: $('sendBtn'),
  adminMessage: $('adminMessage')
};

let registration = null;
let currentSubscription = null;
let publicVapidKey = null;

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function setMessage(el, text, kind = '') {
  el.textContent = text || '';
  el.className = `message ${kind}`.trim();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'PC Windows';
  if (/Macintosh/i.test(ua)) return 'Mac';
  return 'Mi dispositivo';
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}

async function refreshStatus() {
  els.browserStatus.textContent = supported ? 'Compatible' : 'No compatible';
  els.permissionStatus.textContent = 'Notification' in window ? Notification.permission : 'No disponible';
  els.pwaStatus.textContent = isStandalone ? 'Instalada' : 'Navegador';

  if (!supported) {
    els.supportBadge.textContent = 'No compatible';
    els.subscribeBtn.disabled = true;
    return;
  }

  els.supportBadge.textContent = 'Compatible';
  els.supportBadge.classList.add('ok');
  currentSubscription = registration ? await registration.pushManager.getSubscription() : null;
  els.subscriptionStatus.textContent = currentSubscription ? 'Activa' : 'No activa';
  els.subscribeBtn.disabled = Boolean(currentSubscription) || (isIos && !isStandalone);
  els.unsubscribeBtn.disabled = !currentSubscription;

  if (isIos && !isStandalone) els.iosNotice.classList.remove('hidden');
}

async function subscribe() {
  try {
    setMessage(els.clientMessage, '');
    if (!supported) throw new Error('Este navegador no soporta Web Push.');
    if (isIos && !isStandalone) throw new Error('En iPhone/iPad debes instalar la web en la pantalla de inicio antes de activar notificaciones.');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('No se concedio permiso para notificaciones.');

    if (!publicVapidKey) {
      const cfg = await api('/api/config');
      publicVapidKey = cfg.publicVapidKey;
    }

    currentSubscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
    });

    const deviceName = els.deviceName.value.trim() || defaultDeviceName();
    const result = await api('/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription: currentSubscription.toJSON(), deviceName })
    });

    localStorage.setItem('webpush-device-name', deviceName);
    localStorage.setItem('webpush-device-id', result.id);
    setMessage(els.clientMessage, `Notificaciones activadas para “${deviceName}”.`, 'success');
    await refreshStatus();
  } catch (error) {
    setMessage(els.clientMessage, error.message, 'error');
    await refreshStatus();
  }
}

async function unsubscribe() {
  try {
    setMessage(els.clientMessage, '');
    currentSubscription = await registration.pushManager.getSubscription();
    if (!currentSubscription) return refreshStatus();
    const endpoint = currentSubscription.endpoint;
    await currentSubscription.unsubscribe();
    await api('/api/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) });
    localStorage.removeItem('webpush-device-id');
    setMessage(els.clientMessage, 'Notificaciones desactivadas en este dispositivo.', 'success');
    await refreshStatus();
  } catch (error) {
    setMessage(els.clientMessage, error.message, 'error');
  }
}

function adminHeaders() {
  const token = els.adminToken.value.trim();
  if (!token) throw new Error('Ingresa el token de administrador.');
  sessionStorage.setItem('webpush-admin-token', token);
  return { 'x-admin-token': token };
}

async function loadDevices() {
  try {
    setMessage(els.adminMessage, 'Cargando dispositivos…');
    const data = await api('/api/admin/subscriptions', { headers: adminHeaders() });
    els.targetDevice.innerHTML = '<option value="all">Todos los dispositivos</option>';
    for (const item of data.subscriptions) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.deviceName;
      els.targetDevice.appendChild(option);
    }
    const myId = localStorage.getItem('webpush-device-id');
    if (myId && [...els.targetDevice.options].some((o) => o.value === myId)) els.targetDevice.value = myId;
    setMessage(els.adminMessage, `${data.subscriptions.length} dispositivo(s) registrado(s).`, 'success');
  } catch (error) {
    setMessage(els.adminMessage, error.message, 'error');
  }
}

async function sendNotification() {
  try {
    setMessage(els.adminMessage, 'Enviando…');
    const data = await api('/api/admin/send', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        targetId: els.targetDevice.value,
        title: els.notificationTitle.value,
        body: els.notificationBody.value,
        url: els.notificationUrl.value,
        tag: els.notificationTag.value,
        requireInteraction: els.requireInteraction.checked
      })
    });
    const kind = data.failed ? 'error' : 'success';
    setMessage(els.adminMessage, `Enviadas: ${data.sent}. Fallidas: ${data.failed}.`, kind);
    if (data.failed) await loadDevices();
  } catch (error) {
    setMessage(els.adminMessage, error.message, 'error');
  }
}

async function init() {
  els.deviceName.value = localStorage.getItem('webpush-device-name') || defaultDeviceName();
  els.adminToken.value = sessionStorage.getItem('webpush-admin-token') || '';

  if (!supported) return refreshStatus();
  try {
    registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const cfg = await api('/api/config');
    publicVapidKey = cfg.publicVapidKey;
  } catch (error) {
    setMessage(els.clientMessage, `No se pudo iniciar el Service Worker: ${error.message}`, 'error');
  }
  await refreshStatus();
}

els.subscribeBtn.addEventListener('click', subscribe);
els.unsubscribeBtn.addEventListener('click', unsubscribe);
els.loadDevicesBtn.addEventListener('click', loadDevices);
els.sendBtn.addEventListener('click', sendNotification);
window.addEventListener('focus', refreshStatus);

init();
