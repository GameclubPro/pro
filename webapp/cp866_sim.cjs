const iconv = require("iconv-lite");

const word = "Игроки";
const cp1251 = iconv.encode(word, "win1251");
const misread = iconv.decode(cp1251, "cp866");

console.log("cp1251 bytes", cp1251);
console.log("misread as cp866", misread);
