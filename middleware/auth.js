function requireApiAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Debes iniciar sesión' });
  }
  next();
}

function requirePageAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
}

module.exports = { requireApiAuth, requirePageAuth };
