const iconv = require("iconv-lite");

const correct = "Игроки";
const cp866Bytes = iconv.encode(correct, "cp866");
const garbled = iconv.decode(cp866Bytes, "win1251");
const restored = iconv.decode(iconv.encode(garbled, "win1251"), "cp866");

console.log({ correct, garbled, restored });
