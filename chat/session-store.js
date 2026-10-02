// express-session store backed by the JSON data file, so people stay logged in across restarts.
const session = require('express-session');

class JsonSessionStore extends session.Store {
  constructor(store) {
    super();
    this.store = store;
  }

  get(sid, callback) {
    callback(null, this.store.sessionGet(sid));
  }

  set(sid, data, callback) {
    const expires = data.cookie && data.cookie.expires ? new Date(data.cookie.expires).getTime() : null;
    this.store.sessionSet(sid, data, expires);
    callback && callback(null);
  }

  // Called on every request; only rewrite when the expiry moved by more than a day.
  touch(sid, data, callback) {
    const current = this.store.sessionGet(sid);
    const before = current && current.cookie && current.cookie.expires ? new Date(current.cookie.expires).getTime() : 0;
    const after = data.cookie && data.cookie.expires ? new Date(data.cookie.expires).getTime() : 0;
    if (!current || Math.abs(after - before) > 24 * 60 * 60 * 1000) return this.set(sid, data, callback);
    callback && callback(null);
  }

  destroy(sid, callback) {
    this.store.sessionDestroy(sid);
    callback && callback(null);
  }
}

module.exports = { JsonSessionStore };
