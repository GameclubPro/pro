const iconv=require('iconv-lite');
const s='Ló¨þúø';
const bytes=iconv.encode(s,'cp866');
console.log('bytes', bytes);
console.log('cp866->cp1251', iconv.decode(bytes,'win1251'));
console.log('cp866->utf8', iconv.decode(bytes,'utf8'));
