const iconv=require('iconv-lite');
const orig='ֻמבבט';
console.log(iconv.decode(Buffer.from(orig,'utf8'),'latin1'));
