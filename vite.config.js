// GitHub Pages（https://ogrew.github.io/kuva/）でも動くよう、読み込むファイルのパスを相対にする
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

// スマホの実機で確かめる用（npm run dev:phone）：同じ Wi-Fi から https で開けるようにする。
// カメラ（getUserMedia）は https でないと使えないため。証明書はその場で作る自己署名のもの（.cert/。コミットしない）。
// LAN の IP アドレスが変わったら作り直す
function phoneHttps() {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  const dir = '.cert', key = `${dir}/key.pem`, cert = `${dir}/cert.pem`, stamp = `${dir}/ips.txt`;
  const want = ips.join(',');
  if (!existsSync(cert) || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== want) {
    mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '30',
      '-keyout', key, '-out', cert, '-subj', '/CN=kuva-dev', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
    writeFileSync(stamp, want);
  }
  return { host: true, https: { key: readFileSync(key), cert: readFileSync(cert) } };
}

// 実機で確かめる用：スマホには開発者ツールがないので、JS のエラーを画面の上に文字で出し、
// サーバのターミナルにも送る（/__phone-log。[info] はターミナルだけ）。読み込まれたファイルもターミナルに出す。dev:phone のときだけ
const PHONE_LOG = `<script>
(function () {
  var box;
  function log(msg) { try { fetch('/__phone-log', { method: 'POST', body: msg }); } catch (e) {} }
  function show(msg) {
    log(msg);
    paint(msg);
  }
  function paint(msg) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', function () { paint(msg); }); return; }
    if (!box) {
      box = document.createElement('pre');
      box.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;margin:0;padding:8px;max-height:60vh;overflow:auto;white-space:pre-wrap;font:11px/1.4 monospace;background:rgba(160,20,20,.92);color:#fff';
      document.body.appendChild(box);
    }
    box.textContent += msg + '\\n';
  }
  window.addEventListener('error', function (e) {
    show('[error] ' + e.message + ' @ ' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; show('[rejection] ' + (r && (r.stack || r.message) || r));
  });
  log('[info] ' + navigator.userAgent);
  setTimeout(function () {
    log('[info] after 5s: body.class="' + (document.body && document.body.className) + '" webgl2=' + !!document.createElement('canvas').getContext('webgl2'));
  }, 5000);
})();
</script>`;
const phoneLog = {
  name: 'kuva-phone-log',
  transformIndexHtml: (html) => html.replace('<head>', `<head>${PHONE_LOG}`),
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/__phone-log' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => { console.log(`[phone] ${body}`); res.end(); });
        return;
      }
      const ua = req.headers['user-agent'] || '';
      if (/iPhone|iPad|Android/.test(ua)) console.log(`[phone] GET ${req.url}`);
      next();
    });
  },
};

export default {
  base: './',
  ...(process.env.KUVA_PHONE ? { server: phoneHttps(), plugins: [phoneLog] } : {}),
};
