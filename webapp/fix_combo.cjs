const iconv=require('iconv-lite');
const str='юцшфрэшх';
const encs=['utf8','win1251','latin1'];
for(const enc1 of encs){
  for(const enc2 of encs){
    try{
      const buf=iconv.encode(str, enc1);
      const res=iconv.decode(buf, enc2);
      console.log(`${enc1} -> ${enc2}: ${res}`);
    }catch(e){
      console.log(`${enc1} -> ${enc2}: error ${e.message}`);
    }
  }
}
