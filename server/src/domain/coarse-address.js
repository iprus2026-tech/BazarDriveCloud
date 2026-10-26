// /server/src/domain/coarse-address.js — BD-ORDERS-PUBLIC-PROJECTION-01 (#1125, owner's decision R2).
// The order feed shows other people only the street, never the house. Street names that contain
// digits survive («2-я Владимирская ул.», «ул. 8 Марта», «Проектируемый проезд 4062»). An address
// that cannot be recognized yields null — the caller then shows no address at all, never the text.
//
// A WHITELIST, not a cut (owner, 2026-10-26, after the fourth CodeRabbit bypass on #1157): the
// result is only what is recognized as «street type + name»; everything else is dropped. A new
// spelling of a house number («10с2а», «№10», …) therefore cannot leak — it is simply not on the
// list. The label is free text typed by a passenger (there is no geocoder), so:
//   1. split on commas; the street is the first segment whose leading words form a street: a
//      street word («ул.», «проспект», «ш.» …) and at least one name word;
//   2. the street ends where the house part starts (a digit, «№», a house word like «д.», «корп»,
//      «кв», «с») or at the end of the segment. Name words are capitalized letter words (plus
//      «лет»/«года»/month/«им.» inside a name), ordinals («2-я», «1-й»), and a number that is part
//      of a name («8 Марта», «1905 года», «50 лет Октября», «50-летия»), at most three of them. Any
//      other word in the street segment is free text («ул. Ленина вход со двора») → null;
//   3. one owner's exception: a four-digit number right after «проезд»/«линия»/«просек» at the end
//      of the segment, when the next segment is a bare house number («Проектируемый проезд 4062,
//      6»). Without that comma it cannot be told from a house, so it is dropped;
//   4. only the street is returned — no city, no other segment. No street → null.

const STREET_WORDS = new Set([
  'ул', 'улица', 'пр-т', 'проспект', 'пр-д', 'проезд', 'пер', 'переулок', 'ш', 'шоссе', 'наб',
  'набережная', 'б-р', 'бульвар', 'пл', 'площадь', 'туп', 'тупик', 'аллея', 'линия', 'просек',
  'тракт', 'мкр', 'микрорайон',
]);
// Words that start the house part. A one-letter word is a name word only as an initial with a
// dot («Б. Никитская»), and never one of these.
const HOUSE_WORDS = new Set([
  'д', 'дом', 'вл', 'влад', 'владение', 'к', 'корп', 'корпус', 'с', 'стр', 'строение', 'кв',
  'квартира', 'офис', 'оф', 'под', 'подъезд', 'эт', 'этаж', 'лит', 'литер', 'литера',
]);
// Words a number may stand before inside a street name: «8 Марта», «1905 года», «50 лет Октября».
const NUMBER_NAME_WORDS = new Set([
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября',
  'октября', 'ноября', 'декабря', 'года', 'лет', 'летия',
]);
const LETTER_WORD = /^[а-яёa-z]+(?:[-'][а-яёa-z]+)*\.?$/i;
const ORDINAL = /^\d{1,3}-(?:я|й|е|ая|ий|ой|ый|го|ого|ей|ья|ье)$/i;
const JUBILEE = /^\d{1,3}-летия$/i;
const PLAIN_NUMBER = /^\d{1,4}$/;
// The owner's exception is narrow: numbered passages and lines carry four-digit numbers
// («Проектируемый проезд 4062»); «Тверская ул. 7, 2» is a house and a flat, not a street «7».
const NUMBERED_STREET_WORDS = new Set(['проезд', 'пр-д', 'линия', 'просек']);
const STREET_NUMBER = /^\d{4}$/;
// A bare house number segment: «15», «12а», «4к2», «10/2», «7 стр 2», «7с2», «№10».
const BARE_HOUSE = /^(?:№\s*)?\d{1,4}[а-яa-z]?(?:\s*(?:[\/кk]|корп\.?|к\.)\s*\d{1,3}[а-яa-z]?)?(?:\s*(?:стр\.?|с)\s*\d{1,3}[а-яa-z]?)?$/i;

// Lowercase words that may stand inside a name («50 лет Октября», «им. Ленина»). Every other name
// word is capitalized, so free text after a street («вход со двора», «рядом с аптекой») is not one.
const NAME_CONNECTORS = new Set([...NUMBER_NAME_WORDS, 'им', 'имени']);
// A street name is short; a long run of capitalized words is not trusted to be one.
const MAX_NAME_WORDS = 3;

const bare = (word) => word.toLowerCase().replace(/\.$/, '');

function isNameWord(word) {
  if (!LETTER_WORD.test(word)) return false;
  const key = bare(word);
  if (HOUSE_WORDS.has(key)) return false;
  if (!/^[А-ЯЁA-Z]/.test(word) && !NAME_CONNECTORS.has(key)) return false;
  return key.length > 1 || word.endsWith('.');
}

// Where a street may end inside its segment: the start of the house part (a digit, «№», a house
// word). Any other word there is free text, and the segment is not trusted.
const startsHouse = (word) => /\d|^№/.test(word) || HOUSE_WORDS.has(bare(word));

// The leading words of one segment that form a street, or null.
function streetOf(segment, nextSegment) {
  const words = segment.split(' ');
  const kept = [];
  let hasStreetWord = false;
  let hasName = false;
  let nameWords = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = words[i + 1];
    if (STREET_WORDS.has(bare(word))) {
      kept.push(word);
      hasStreetWord = true;
      continue;
    }
    if (isNameWord(word) || ORDINAL.test(word) || JUBILEE.test(word)) {
      kept.push(word);
      hasName = true;
      nameWords += 1;
    } else if (PLAIN_NUMBER.test(word) && next && NUMBER_NAME_WORDS.has(bare(next))) {
      kept.push(word);
      nameWords += 1;
    } else if (STREET_NUMBER.test(word) && !next && i > 0 && NUMBERED_STREET_WORDS.has(bare(words[i - 1]))
        && hasName && nextSegment !== undefined && BARE_HOUSE.test(nextSegment)) {
      // The owner's exception: «Проектируемый проезд 4062, 6».
      kept.push(word);
    } else if (startsHouse(word)) {
      break; // the house part starts: the street ends here
    } else {
      return null; // free text inside the street segment («вход со двора»): not trusted
    }
    if (nameWords > MAX_NAME_WORDS) return null;
  }
  return hasStreetWord && hasName ? kept.join(' ') : null;
}

export function coarseAddress(label) {
  if (typeof label !== 'string') return null;
  // «ул.Ленина» / «д.10» → «ул. Ленина» / «д. 10»: a dot glued to the next word splits them.
  const text = label.replace(/\.(?=[^\s.,])/g, '. ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const segments = text.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < segments.length; i += 1) {
    const street = streetOf(segments[i], segments[i + 1]);
    if (street) return street;
  }
  return null;
}
