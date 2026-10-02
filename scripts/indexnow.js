// Pings IndexNow (Bing, Yandex, Seznam, Naver...) with every URL in the sitemap.
// Run after each deploy: npm run indexnow
const fs = require('fs');
const path = require('path');

const HOST = 'gtavivicecity.com';
const KEY = 'a9af9ab8ec497d6fdb93fe8071fb17ac';

const sitemap = fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>(https:\/\/[^<]+)<\/loc>/g)]
  .map(m => m[1])
  .filter(url => !url.includes('/images/'));

fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }),
})
  .then(res => console.log(`IndexNow: HTTP ${res.status} for ${urlList.length} URLs`))
  .catch(err => {
    console.error('IndexNow failed:', err.message);
    process.exitCode = 1;
  });
