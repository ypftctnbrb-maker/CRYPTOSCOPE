'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { REF_BINGX } = require('../assets/config.js');
const { RISK } = require('../assets/referrals.js');
function buildCopy() {
  const link = 'Реферальная ссылка: ' + REF_BINGX;
  const risk = RISK + '.';
  const signature = link + '\n' + risk;
  const blocks = [
    ['Telegram: описание канала', 'CRYPTOSCOPE · данные крипторынка и ограничения показателей.\n' + signature],
    ['Telegram: закреплённый пост', 'Здесь публикуются обзоры рынка CRYPTOSCOPE. Проверяйте источник и время данных.\n' +
      'BingX — партнёрская ссылка проекта для регистрации. Условия сервиса и доступность в вашем регионе проверяйте перед использованием.\n' + signature],
    ['Ежедневный отчёт: подпись', 'Партнёрское размещение CRYPTOSCOPE · BingX.\n' + signature],
    ['X: био', signature],
    ['YouTube: описание канала', 'CRYPTOSCOPE — обзоры и данные крипторынка.\nBingX: партнёрская регистрация.\n' + signature],
    ['Telegram-бот: описание', 'Бот CRYPTOSCOPE: доступные функции указаны в меню.\nBingX: партнёрское размещение.\n' + signature],
    ['Обзор или видео: подпись', 'Материал CRYPTOSCOPE. Партнёрское размещение BingX.\n' + signature]
  ];
  const external = '# Готовые тексты для собственных площадок\n\n' +
    'Сгенерировано из assets/config.js. Публикация не выполнялась. Не размещать в чужих чатах и комментариях.\n\n' +
    blocks.map(([title, text]) => '## ' + title + '\n\n```text\n' + text + '\n```').join('\n\n') + '\n';
  const readme = '# CRYPTOSCOPE 3.0\n\nБесплатный инструмент для самостоятельного изучения крипторынка.\n\n' +
    '[Открыть сайт](https://ypftctnbrb-maker.github.io/CRYPTOSCOPE/) · ' +
    '[Методология](https://ypftctnbrb-maker.github.io/CRYPTOSCOPE/methodology.html)\n\n' +
    '## BingX · партнёрское размещение\n\n' +
    '<a href="' + REF_BINGX + '" target="_blank" rel="sponsored noopener noreferrer">Торговать на BingX</a>\n\n' +
    '**Реферальная ссылка**. Проект может получить партнёрское вознаграждение. Проверяйте условия и наличие инструмента на бирже.\n\n' +
    risk + '\n\nНе является инвестиционной рекомендацией.\n\n' +
    '## Разработка и проверка\n\nОдин PR — одна задача, сначала тест, затем изменение. Независимое ревью Claude обязательно; автоматическое слияние не разрешено.\n\n' +
    'Адрес хранится в assets/config.js (REF_BINGX). Этот README и внешние шаблоны генерируются командой:\n\n' +
    '```sh\nnode scripts/render-referral-copy.cjs\n```\n\n' +
    'Счётчики кликов локальны для браузера. Для общей статистики нужен настроенный Umami/Plausible; регистрации проверяются в партнёрском кабинете.\n';
  const description = 'CRYPTOSCOPE — криптоаналитика. ' + signature + '\n';
  return { 'README.md': readme, 'docs/referrals/external-templates.md': external,
    'docs/referrals/github-pages-description.txt': description };
}
if (require.main === module) {
  for (const [file, text] of Object.entries(buildCopy())) {
    const output = path.join(__dirname, '..', file);
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, text);
  }
}
module.exports = { buildCopy };
