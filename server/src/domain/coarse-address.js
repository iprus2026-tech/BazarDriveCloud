// /server/src/domain/coarse-address.js — BD-ORDERS-PUBLIC-PROJECTION-01 (#1125, owner's decision R2).
// The order feed shows other people only the street, never the house: the house number and
// everything after it are cut. Street names that contain digits survive («2-я Владимирская ул.»,
// «ул. 8 Марта», «Проектируемый проезд 4062»). An address that cannot be parsed reliably yields
// null — the caller then shows no address at all, never the full text.
//
// The label is free text typed by a passenger (there is no geocoder), so the rules are deliberately
// conservative:
//   1. split on commas; the first segment that is a house part ends the address:
//      «д. 10», «дом 10», «к. 2», «корп. 2», «стр. 3», «кв. 5», «вл. 4», «подъезд 2», «этаж 3»,
//      «офис 7» — or a bare house number («15», «4к2», «10/2», «12а», «7 стр 2»);
//   2. only when no such segment was found, the last kept segment is cut at a house word inside it
//      («ул. Ленина д. 10» → «ул. Ленина») and at a trailing number after a street word and a name
//      («ул. Ленина 10» → «ул. Ленина»). Without a comma «Проектируемый проезд 4062» cannot be told
//      from «Нагорный проезд 7», so it is cut too («Проектируемый проезд») — coarser, never a leak;
//   3. if a house marker («д.», «дом», «кв.» …) is still left anywhere, or nothing is left, the
//      address is unreliable → null.

const STREET_WORDS = '(?:ул|улица|пр-т|проспект|пр-д|проезд|пер|переулок|ш|шоссе|наб|набережная|б-р|бульвар|пл|площадь|туп|тупик|аллея|линия|просек|тракт|мкр|микрорайон)';

// A bare house number: «15», «12а», «4к2», «4 к2», «10/2», «7 стр 2», «7с2», «15 корп 1».
const BARE_HOUSE = /^\d{1,4}[а-яa-z]?(?:\s*(?:[\/кk]|корп\.?|к\.)\s*\d{1,3}[а-яa-z]?)?(?:\s*(?:стр\.?|с)\s*\d{1,3})?$/i;
// A segment that starts with a house-part word followed by a number.
const HOUSE_WORD = /^(?:д|дом|влад|вл|владение|к|корп|корпус|стр|строение|кв|квартира|офис|оф|под|подъезд|эт|этаж|литер|лит)\.?\s*№?\s*\d/i;
// A house word inside a segment, after the street: «ул. Ленина д. 10», «Тверская ул. стр 2».
const INNER_HOUSE = /\s(?:д|дом|вл|влад|к|корп|корпус|стр|строение|кв|квартира)\.?\s*№?\s*\d.*$/i;
// A house marker anywhere — if one survives the cut, the address is not trusted.
// («дома 5» / «доме 5» included: free text like «возле дома 5».)
const HOUSE_MARKER = /(?:^|[\s,])(?:д|дом[а-я]*|кв|квартира|корп|корпус|стр|строение|подъезд|этаж|офис)\.?\s*№?\s*\d/i;
// A trailing house number after a street word and a street name inside one segment. JS `\b` does
// not see Cyrillic word edges, so the street word is anchored on the start or a space instead.
const TRAILING_AFTER_WORD_FIRST = new RegExp(
  `^(.*?(?:^|\\s)${STREET_WORDS}\\.?\\s+[^,]*?\\S)\\s+\\d{1,4}[а-яa-z]?(?:\\s*(?:[\\/кk]|корп\\.?)\\s*\\d{1,3}[а-яa-z]?)?$`, 'i',
);
const TRAILING_AFTER_WORD_LAST = new RegExp(
  `^(.*?\\S\\s+${STREET_WORDS}\\.?)\\s+\\d{1,4}[а-яa-z]?(?:\\s*(?:[\\/кk]|корп\\.?)\\s*\\d{1,3}[а-яa-z]?)?$`, 'i',
);

export function coarseAddress(label) {
  if (typeof label !== 'string') return null;
  const text = label.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const segments = text.split(',').map((s) => s.trim()).filter(Boolean);
  const kept = [];
  let houseSegment = false;
  for (const segment of segments) {
    if (BARE_HOUSE.test(segment) || HOUSE_WORD.test(segment)) { houseSegment = true; break; } // cut it and the rest
    kept.push(segment);
  }
  if (kept.length === 0) return null;
  // No separate house segment: the last segment may still end in its house number («ул. Ленина 10»).
  // With a house segment found, the street segment is kept whole («Проектируемый проезд 4062, 6»).
  if (!houseSegment) {
    // «ул. Ленина д. 10» / «пр-т Мира корп 2»: a house word inside the segment cuts it there.
    const inner = INNER_HOUSE.exec(kept[kept.length - 1]);
    if (inner) kept[kept.length - 1] = kept[kept.length - 1].slice(0, inner.index).trim();
    const last = kept[kept.length - 1];
    const trailing = TRAILING_AFTER_WORD_LAST.exec(last) || TRAILING_AFTER_WORD_FIRST.exec(last);
    if (trailing) kept[kept.length - 1] = trailing[1].trim();
    if (!kept[kept.length - 1]) kept.pop();
  }
  const result = kept.join(', ').trim();
  if (!result || HOUSE_MARKER.test(result)) return null;
  return result;
}
