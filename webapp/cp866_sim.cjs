const iconv=require('iconv-lite');
const orig='Игроки';
const bytes=iconv.encode(orig,'win1251');
const wrong=iconv.decode(bytes,'cp866');
console.log('wrong', wrong);
