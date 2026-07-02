/**
 * TRIDEX LIVE - Bağlantı Ayarı
 * -----------------------------
 * Eğer server.js AYNI hosting/domain üzerinde çalışıyorsa (Node destekli hosting):
 *   WS_URL değerini BOŞ bırak ("") — otomatik olarak bu sayfanın adresini kullanır.
 *
 * Eğer server.js FARKLI bir yerde çalışıyorsa (örn. statik dosyaları A hostinginde,
 * WebSocket sunucusunu Render/VPS gibi B adresinde barındırıyorsan):
 *   WS_URL değerine sunucunun tam adresini yaz, örn:
 *   "wss://tridex-server.senin-alanadin.com"
 *   (http/https karışmaz, WebSocket için HER ZAMAN "wss://" kullan - HTTPS şart)
 */
window.TRIDEX_CONFIG = {
  WS_URL: "" // boş = aynı domain, dolu = "wss://baska-sunucu-adresin.com"
};
