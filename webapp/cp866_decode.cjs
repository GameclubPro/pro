const iconv = require("iconv-lite");

const word = "Игроки";
const cp866 = iconv.encode(word, "cp866");

console.log("source", word);
console.log("cp866 bytes", cp866);
console.log("cp866 -> win1251", iconv.decode(cp866, "win1251"));
console.log("cp866 -> utf8", iconv.decode(cp866, "utf8"));
