const iconv = require("iconv-lite");

const correct = "Привет";
const cp1251Bytes = iconv.encode(correct, "win1251");
const garbled = iconv.decode(cp1251Bytes, "latin1");
const recovered = iconv.decode(iconv.encode(garbled, "latin1"), "win1251");

console.log({ correct, garbled, recovered });
