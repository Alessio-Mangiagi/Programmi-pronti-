/**
 * Config dinamica sopra app.json (Expo la riceve già letta in `config`).
 * Notifiche push Android: basta mettere google-services.json (Firebase, app
 * com.cosedil.incampo) accanto a questo file; finché manca la build parte
 * comunque, solo senza push. Il file contiene solo identificativi pubblici e si
 * può committare; la chiave del service account FCM va invece su EAS.
 */
const fs = require('fs')
const path = require('path')

module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json')
  if (!fs.existsSync(googleServices)) return config
  return { ...config, android: { ...config.android, googleServicesFile: './google-services.json' } }
}
