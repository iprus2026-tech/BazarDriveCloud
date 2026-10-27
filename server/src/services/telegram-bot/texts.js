// /server/src/services/telegram-bot/texts.js — the bot's texts and keyboards (BD-TG-BOT-01 #1128).
// Owner-approved on 2026-10-27: plain, formal «вы», no emoji. Every message carries at most one
// reply_markup, so removing the legacy keyboard and showing the Mini App button are two messages.

export const BUTTON_SHARE_PHONE = 'Поделиться номером';
export const BUTTON_OPEN_APP = 'Открыть BazarDrive';

// ADR BD-DOCS-052 R9: the consent line goes in the message that carries the requestContact button.
export const CONSENT_LINE = 'Отправляя номер, вы соглашаетесь на обработку Telegram ID, имени и номера телефона для работы сервиса.';

// TODO(#1154): point the consent link at the privacy policy page instead of /#/rules, and add the
// line «Отозвать согласие и удалить данные: /delete» once #1154 ships the deletion flow.
export function rulesUrl(miniAppUrl) {
  const url = new URL(miniAppUrl);
  return `${url.origin}${url.pathname}#/rules`;
}

export function startText(miniAppUrl) {
  return [
    'BazarDrive — поездки и объявления для своих. Чтобы войти, подтвердите номер телефона: нажмите «Поделиться номером».',
    '',
    `${CONSENT_LINE} Правила: ${rulesUrl(miniAppUrl)}`,
  ].join('\n');
}

export const TEXT = Object.freeze({
  // /start with a confirmed number: the removal message, then the button message.
  confirmed: 'Номер подтверждён.',
  openApp: 'Откройте приложение.',
  // An accepted contact.
  linked: 'Номер подтверждён.',
  linkedOpenApp: 'Теперь можно войти в приложение.',
  // The same contact again.
  alreadyLinked: 'Этот номер уже подтверждён.',
  foreignContact: 'Нужен ваш собственный номер. Нажмите «Поделиться номером», а не отправляйте контакт из списка.',
  invalidPhone: 'Не удалось распознать номер. Нажмите «Поделиться номером» ещё раз.',
  conflict: 'Этот номер уже связан с другим Telegram.',
  revoked: 'Доступ для этого Telegram отключён.',
  other: 'Чтобы войти, отправьте /start.',
  saveFailed: 'Не получилось сохранить номер. Попробуйте ещё раз через минуту.',
});

// TELEGRAM_SUPPORT_CONTACT (@username) when the owner set it, otherwise the inviter.
export function supportLine(supportContact) {
  return supportContact
    ? `Напишите в поддержку: ${supportContact}.`
    : 'Напишите тому, кто пригласил вас в BazarDrive.';
}

export const contactKeyboard = () => ({
  keyboard: [[{ text: BUTTON_SHARE_PHONE, request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
});

export const removeKeyboard = () => ({ remove_keyboard: true });

export const openAppButton = (miniAppUrl) => ({
  inline_keyboard: [[{ text: BUTTON_OPEN_APP, web_app: { url: miniAppUrl } }]],
});
