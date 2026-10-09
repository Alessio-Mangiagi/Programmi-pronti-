// babel-preset-expo aggiunge da solo il plugin di react-native-worklets (reanimated 4) se installato.
module.exports = function (api) {
  api.cache(true)
  return { presets: ['babel-preset-expo'] }
}
