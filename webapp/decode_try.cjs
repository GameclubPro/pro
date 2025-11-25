const iconv = require("iconv-lite");

const sample = "Игроки";
const encodings = ["utf8", "win1251", "koi8-r", "cp866", "latin1", "macintosh"];

for (const from of encodings) {
  const bytes = iconv.encode(sample, from);
  for (const to of encodings) {
    const decoded = iconv.decode(bytes, to);
    if (decoded !== sample) {
      console.log(`${from}->${to}: ${decoded}`);
    }
  }
}
