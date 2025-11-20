const iconv=require('iconv-lite');
const s='Ló¨þúø';
const buf=iconv.encode(s,'cp866');
console.log('cp866 bytes',buf);
console.log('decoded utf8', buf.toString('utf8'));
console.log('decode cp1251', iconv.decode(buf,'win1251'));
