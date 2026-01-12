require('@rushstack/eslint-patch/modern-module-resolution')

module.exports = {
  extends: ['eslint:recommended', '@electron-toolkit', '@electron-toolkit/eslint-config-ts/eslint-recommended']
}
