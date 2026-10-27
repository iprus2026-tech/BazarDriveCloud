// /server/test/telegram-fixtures.mjs — shared by the BD-AUTH-TELEGRAM-01 tests (not a test file).
// A fake bot token and Telegram's initData signing, written independently of the module under test.
import crypto from 'node:crypto';

export const FAKE_BOT_TOKEN = '1234567890:TEST_fake_token_for_unit_tests_only_x';
export const OTHER_BOT_TOKEN = '9876543210:TEST_another_fake_bot_token_value_yy';

export function signedInitData(fields, botToken = FAKE_BOT_TOKEN) {
  const dataCheckString = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}
