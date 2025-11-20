const iconv=require('iconv-lite');
const orig='ֻמבבט';
const corrupted=iconv.decode(Buffer.from(orig,'utf8'), 'win1251');
console.log('corrupted', corrupted);
