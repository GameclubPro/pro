const iconv=require('iconv-lite');
const sample='¦þüýðªð';
const bytes=iconv.encode(sample,'cp866');
console.log('cp866 bytes', bytes);
console.log('decode cp1251', iconv.decode(bytes,'win1251'));
