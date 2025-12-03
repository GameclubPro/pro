const iconv = require("iconv-lite");

const garbled = "РџСЂРёРІРµС‚"; // "Привет" that was decoded as UTF-8 while stored as cp1251
const candidates = ["utf8", "latin1", "macintosh", "cp866", "koi8-r", "win1251"];

for (const enc of candidates) {
  const bytes = iconv.encode(garbled, enc, { addBOM: false });
  const decoded = iconv.decode(bytes, "win1251");
  console.log(enc, "->", decoded);
}
