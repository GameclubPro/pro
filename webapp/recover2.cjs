const iconv=require('iconv-lite');
const sample='¦þüýðªð';
for(const enc of ['cp437','cp866','macintosh','latin1','koi8-r','win1251']){
  const bytes=iconv.encode(sample, enc, {addBOM:false});
  const decoded=iconv.decode(bytes,'win1251');
  console.log(enc, bytes, decoded);
}
